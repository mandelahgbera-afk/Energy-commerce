-- Power Store: the customer's energy record.
-- Every serial-tracked unit that leaves on a sale becomes a row in equipment_units (its own record),
-- and readings over time build the health picture. This is a record of what the customer owns and
-- how it performs: no money moves here, nothing is calculated from cost, and nothing here ever
-- controls a device. History is append-only; a mistaken reading is voided with a reason, never edited.
-- The age maths mirrors owner_today's batteries-due basis (sold_on + battery_life_months), so the
-- owner's list and the customer's page can never disagree.

create table equipment_units (
  id uuid primary key default gen_random_uuid(),
  serial_id uuid not null references serial_units(id),
  product_id uuid not null references products(id),
  customer_id uuid references customers(id),
  order_id uuid references orders(id),
  sold_on date not null,
  warranty_ends_on date,
  closed_on date,
  created_at timestamptz not null default now()
);
create index equipment_customer on equipment_units (customer_id) where customer_id is not null;
create index equipment_serial on equipment_units (serial_id);
create index equipment_open on equipment_units (serial_id, order_id) where closed_on is null;

-- A reading is what someone saw: hours of backup, voltage, charge percent, energy, or how it feels.
-- One is enough; nonsense is refused by the checks.
create table energy_readings (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references equipment_units(id),
  taken_on date not null default shop_today(),
  source text not null default 'staff' check (source in ('customer', 'staff')),
  backup_hours numeric(6,2) check (backup_hours is null or (backup_hours >= 0 and backup_hours <= 240)),
  voltage_mv int check (voltage_mv is null or (voltage_mv >= 0 and voltage_mv <= 1000000)),
  charge_pct int check (charge_pct is null or (charge_pct between 0 and 100)),
  energy_kwh numeric(10,2) check (energy_kwh is null or (energy_kwh >= 0 and energy_kwh <= 100000)),
  felt text check (felt in ('strong', 'weaker', 'weak')),
  note text check (note is null or char_length(note) <= 500),
  recorded_by uuid,
  client_key text not null unique,
  client_hash text not null,
  created_at timestamptz not null default now(),
  check (backup_hours is not null or voltage_mv is not null or charge_pct is not null or energy_kwh is not null or felt is not null)
);
create index energy_readings_equipment on energy_readings (equipment_id, taken_on);
create trigger energy_readings_append_only before update or delete on energy_readings
  for each row execute function forbid_change();
create trigger energy_readings_no_truncate before truncate on energy_readings
  for each statement execute function forbid_change();

-- The correction path for a wrong reading: the reading stays, and a void hides it. Nothing is edited.
create table reading_voids (
  reading_id uuid primary key references energy_readings(id),
  voided_by uuid,
  voided_at timestamptz not null default now(),
  reason text not null check (char_length(reason) <= 200)
);
create trigger reading_voids_append_only before update or delete on reading_voids
  for each row execute function forbid_change();
create trigger reading_voids_no_truncate before truncate on reading_voids
  for each statement execute function forbid_change();

-- Delivery pairs a sold serial with its line in both delivery paths (selling and POS), so hooking
-- here catches every way a unit can leave, now and later. Every stint is its own row: a unit that
-- comes back and goes out again gets a fresh record, and the closed one stays as history.
create function equipment_on_pairing() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  v_order uuid;
begin
  select order_id into v_order from order_lines where id = NEW.line_id;
  if not exists (select 1 from equipment_units where serial_id = NEW.serial_id and order_id = v_order and closed_on is null) then
    insert into equipment_units (serial_id, product_id, customer_id, order_id, sold_on, warranty_ends_on)
    select NEW.serial_id, u.product_id, u.customer_id, v_order, u.sold_on, u.warranty_ends_on
    from serial_units u where u.id = NEW.serial_id;
  end if;
  return NEW;
end $$;
create trigger equipment_on_pairing after insert on order_line_serials
  for each row execute function equipment_on_pairing();

-- A return or write-off ends the customer's record for that unit. The row stays (history), closed.
create function equipment_on_serial_leave() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if OLD.status = 'sold' and NEW.status <> 'sold' then
    update equipment_units set closed_on = shop_today() where serial_id = NEW.id and closed_on is null;
  end if;
  return NEW;
end $$;
create trigger equipment_on_serial_leave after update on serial_units
  for each row execute function equipment_on_serial_leave();

-- The verdict. Batteries are judged against the shop's own battery_life_months, from the sale day
-- (the same basis as owner_today), and every verdict says its basis. Other goods are judged by
-- warranty, and nothing pretends to know more than it does.
create function i_health_verdict(p_equipment uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  e equipment_units;
  pr products;
  v_life int;
  v_age int;
  v_warranty int;
  v_latest jsonb;
begin
  select * into e from equipment_units where id = p_equipment;
  if not found then raise exception 'no_such_unit'; end if;
  select * into pr from products where id = e.product_id;
  v_age := (extract(year from age(shop_today(), e.sold_on)) * 12 + extract(month from age(shop_today(), e.sold_on)))::int;
  v_warranty := case when e.warranty_ends_on is not null and e.warranty_ends_on >= shop_today()
    then (extract(year from age(e.warranty_ends_on, shop_today())) * 12 + extract(month from age(e.warranty_ends_on, shop_today())))::int
    else null end;
  v_latest := (select jsonb_build_object('taken_on', r.taken_on, 'backup_hours', r.backup_hours, 'voltage_mv', r.voltage_mv,
      'charge_pct', r.charge_pct, 'energy_kwh', r.energy_kwh, 'felt', r.felt)
    from energy_readings r
    where r.equipment_id = e.id
      and not exists (select 1 from reading_voids v where v.reading_id = r.id)
    order by r.taken_on desc, r.created_at desc limit 1);
  if coalesce(pr.family, '') ilike '%batter%' or coalesce(pr.name, '') ilike '%batter%' then
    select battery_life_months into v_life from shop_settings;
    return jsonb_build_object(
      'basis', 'age_vs_life', 'age_months', v_age, 'life_months', v_life,
      'months_to_due', greatest(v_life - v_age, 0),
      'stage', case when v_age * 5 < v_life * 2 then 'new'
                    when v_age * 5 < v_life * 4 then 'mid'
                    when v_age < v_life then 'ageing' else 'due' end,
      'warranty_left_months', v_warranty, 'latest', coalesce(v_latest, 'null'::jsonb));
  end if;
  return jsonb_build_object(
    'basis', 'warranty', 'age_months', v_age,
    'warranty_left_months', v_warranty,
    'stage', case when v_warranty is null then 'uncovered' else 'covered' end,
    'latest', coalesce(v_latest, 'null'::jsonb));
end $$;

-- One shape for the three readers. Voided readings never appear; at most the latest 30 do.
create function i_units_json(p_customer uuid, p_order uuid, p_open_only boolean) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'product', p.name, 'sku', p.sku, 'serial', u.serial,
    'sold_on', e.sold_on, 'warranty_ends_on', e.warranty_ends_on, 'closed_on', e.closed_on,
    'verdict', i_health_verdict(e.id),
    'readings', (select coalesce(jsonb_agg(q.x order by q.taken_on desc, q.created_at desc), '[]')
      from (select jsonb_build_object('taken_on', r.taken_on, 'backup_hours', r.backup_hours, 'voltage_mv', r.voltage_mv,
              'charge_pct', r.charge_pct, 'energy_kwh', r.energy_kwh, 'felt', r.felt) as x, r.taken_on, r.created_at
            from energy_readings r
            where r.equipment_id = e.id
              and not exists (select 1 from reading_voids v where v.reading_id = r.id)
            order by r.taken_on desc, r.created_at desc limit 30) q)) order by e.created_at desc, e.id), '[]')
  from equipment_units e
  join serial_units u on u.id = e.serial_id
  join products p on p.id = e.product_id
  where (p_customer is null or e.customer_id = p_customer)
    and (p_order is null or e.order_id = p_order)
    and (not p_open_only or e.closed_on is null);
$$;

-- The customer's own page. Staff have customer_equipment instead, so this refuses them.
create function my_equipment() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me uuid := auth.uid();
  v_cust uuid;
begin
  if exists (select 1 from staff where id = me and active) then raise exception 'not_allowed'; end if;
  select id into v_cust from customers where user_id = me;
  if v_cust is null then raise exception 'not_allowed'; end if;
  return i_units_json(v_cust, null, true);
end $$;

-- The counter's view of one customer's record, open and closed units.
create function customer_equipment(p_customer uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter', 'dispatcher', 'accountant']::staff_role[]);
begin
  if not exists (select 1 from customers where id = p_customer) then raise exception 'no_such_customer'; end if;
  return i_units_json(p_customer, null, false);
end $$;

-- The private link on a receipt shows this order's units, and nothing else about anyone.
create function receipt_equipment(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_order uuid;
begin
  select id into v_order from orders where receipt_token = p_token;
  if not found then raise exception 'no_such_order'; end if;
  return i_units_json(null, v_order, true);
end $$;

-- One tap, one key. Staff (counter, dispatcher, accountant) record for any customer; a logged-in
-- customer records only on their own units. A retry with the same key returns the first result.
create function add_reading(p_key text, p_unit uuid, p_backup_hours numeric default null,
  p_voltage_mv int default null, p_charge_pct int default null, p_energy_kwh numeric default null,
  p_felt text default null, p_note text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := auth.uid();
  v_staff boolean;
  v_cust uuid;
  e equipment_units;
  v_id uuid;
  v_seen text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_hash text := md5(p_unit::text || '|' || coalesce(p_backup_hours::text, '') || '|' || coalesce(p_voltage_mv::text, '') || '|' ||
    coalesce(p_charge_pct::text, '') || '|' || coalesce(p_energy_kwh::text, '') || '|' || coalesce(p_felt, '') || '|' || coalesce(v_note, ''));
begin
  perform i_require_key(p_key);
  select exists (select 1 from staff where id = me and active) into v_staff;
  if v_staff then
    perform require_staff(array['counter', 'dispatcher', 'accountant']::staff_role[]);
  else
    select id into v_cust from customers where user_id = me;
    if v_cust is null then raise exception 'not_allowed'; end if;
  end if;
  select * into e from equipment_units where id = p_unit for update;
  if not found then raise exception 'no_such_unit'; end if;
  if e.closed_on is not null then raise exception 'unit_closed'; end if;
  if not v_staff and e.customer_id <> v_cust then raise exception 'no_such_unit'; end if;
  select id, client_hash into v_id, v_seen from energy_readings where client_key = p_key;
  if found then
    if v_seen is distinct from v_hash then raise exception 'key_reused'; end if;
    return v_id;
  end if;
  if p_backup_hours is not null and (p_backup_hours < 0 or p_backup_hours > 240) then raise exception 'bad_reading'; end if;
  if p_voltage_mv is not null and (p_voltage_mv < 0 or p_voltage_mv > 1000000) then raise exception 'bad_reading'; end if;
  if p_charge_pct is not null and (p_charge_pct < 0 or p_charge_pct > 100) then raise exception 'bad_reading'; end if;
  if p_energy_kwh is not null and (p_energy_kwh < 0 or p_energy_kwh > 100000) then raise exception 'bad_reading'; end if;
  if p_felt is not null and p_felt not in ('strong', 'weaker', 'weak') then raise exception 'bad_reading'; end if;
  if v_note is not null and length(v_note) > 500 then raise exception 'bad_reading'; end if;
  if p_backup_hours is null and p_voltage_mv is null and p_charge_pct is null and p_energy_kwh is null and p_felt is null then
    raise exception 'bad_reading';
  end if;
  insert into energy_readings (equipment_id, taken_on, source, backup_hours, voltage_mv, charge_pct, energy_kwh, felt, note, recorded_by, client_key, client_hash)
  values (p_unit, shop_today(), case when v_staff then 'staff' else 'customer' end, p_backup_hours, p_voltage_mv, p_charge_pct, p_energy_kwh, p_felt, v_note, me, p_key, v_hash)
  returning id into v_id;
  perform i_audit(me, 'add_reading', 'equipment', p_unit::text, jsonb_build_object('reading', v_id, 'source', case when v_staff then 'staff' else 'customer' end));
  return v_id;
end $$;

-- Only the owner removes a reading, and only by voiding it with a reason. The reading itself stays.
create function void_reading(p_reading uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array[]::staff_role[]);
  v_unit uuid;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  if length(p_reason) > 200 then raise exception 'bad_reading'; end if;
  select equipment_id into v_unit from energy_readings where id = p_reading;
  if not found then raise exception 'no_such_reading'; end if;
  insert into reading_voids (reading_id, voided_by, reason) values (p_reading, me, trim(p_reason))
  on conflict (reading_id) do nothing;
  if not found then raise exception 'already_voided'; end if;
  perform i_audit(me, 'void_reading', 'equipment', v_unit::text, jsonb_build_object('reading', p_reading, 'reason', trim(p_reason)));
end $$;

-- Row-level security policies run with the caller's rights, and reading_voids is accountant-only,
-- so a policy on energy_readings cannot see the voids itself. This helper is security definer, so it can.
-- Like has_staff_role it must be runnable by the caller; it says only whether a given reading was voided.
create function reading_is_live(p_reading uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select not exists (select 1 from reading_voids v where v.reading_id = p_reading);
$$;

-- ---- Who can see and do what ----

alter table equipment_units enable row level security;
alter table energy_readings enable row level security;
alter table reading_voids enable row level security;

-- The reading rows everyone may see, and only those columns: the staff note, who recorded it and
-- the retry keys stay inside. A voided reading is gone from this table, exactly as the screen shows.
grant select on equipment_units, reading_voids to authenticated;
grant select (id, equipment_id, taken_on, source, backup_hours, voltage_mv, charge_pct, energy_kwh, felt, created_at) on energy_readings to authenticated;

create policy equipment_read on equipment_units for select to authenticated using (
  has_staff_role(array['counter', 'dispatcher', 'accountant']::staff_role[])
  or customer_id in (select id from customers where user_id = auth.uid()));

create policy energy_readings_read on energy_readings for select to authenticated using (
  reading_is_live(id)
  and equipment_id in (select id from equipment_units where
    has_staff_role(array['counter', 'dispatcher', 'accountant']::staff_role[])
    or customer_id in (select id from customers where user_id = auth.uid())));

create policy reading_voids_read on reading_voids for select to authenticated using (
  has_staff_role(array['accountant']::staff_role[]));

grant execute on function my_equipment() to authenticated;
grant execute on function customer_equipment(uuid) to authenticated;
grant execute on function receipt_equipment(uuid) to anon, authenticated;
grant execute on function add_reading(text, uuid, numeric, int, int, numeric, text, text) to authenticated;
grant execute on function void_reading(uuid, text) to authenticated;
grant execute on function reading_is_live(uuid) to authenticated;
