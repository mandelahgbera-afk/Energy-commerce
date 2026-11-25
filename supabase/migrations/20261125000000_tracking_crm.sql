-- Power Store (2026-11-25): order tracking, riders, and a small CRM.
-- Design and evidence: docs/plans/2026-11-25-orders-tracking-crm.md.
-- Goods given to a rider are held, not sold. The sale is booked at the door, through the same
-- i_deliver as every other delivery, once the customer's code is given. While goods are out:
-- their serials can't change, their hold never runs out, and only the rider's drop can deliver
-- or the order be cancelled. No payment gateway: the money rules are the ones already in force.

-- One delivery per order. A failed try puts it back to 'booked' for another day.
create table shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders(id),
  status text not null default 'booked' check (status in ('booked', 'out', 'delivered')),
  address text not null check (length(address) between 3 and 300),
  landmark text check (length(landmark) <= 200),
  contact_name text check (length(contact_name) <= 80),
  contact_phone text not null check (contact_phone ~ '^234[0-9]{10}$'),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  scheduled_on date not null,
  time_of_day text check (time_of_day in ('morning', 'afternoon', 'evening')),
  rider_id uuid references staff(id),
  packed_lines jsonb,
  tries int not null default 0,
  out_at timestamptz,
  -- The rider's last point only, while out. No trail is kept.
  rider_lat double precision check (rider_lat between -90 and 90),
  rider_lng double precision check (rider_lng between -180 and 180),
  rider_seen_at timestamptz,
  created_at timestamptz not null default now(),
  check ((lat is null) = (lng is null)),
  check (status <> 'out' or (rider_id is not null and packed_lines is not null)),
  check (status = 'out' or (rider_lat is null and rider_seen_at is null))
);
create index shipments_rider on shipments (rider_id) where status = 'out';

-- The customer's door code. API roles can't read this table; only the tracking link shows it.
create table shipment_codes (
  shipment_id uuid primary key references shipments(id),
  code text not null check (code ~ '^[0-9]{4}$'),
  wrong int not null default 0
);

-- Serials on a bike. A held unit can't be sold, moved or written off until the drop closes.
create table shipment_serials (
  serial_id uuid primary key references serial_units(id),
  shipment_id uuid not null references shipments(id)
);
create index shipment_serials_shipment on shipment_serials (shipment_id);

-- What happened to an order's delivery, in order. Never changed.
create table order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references orders(id),
  kind text not null check (kind in ('booked', 'pin', 'out', 'failed', 'delivered')),
  note text,
  actor uuid,
  client_key text unique,
  at timestamptz not null default now()
);
create index order_events_order on order_events (order_id, at);
create trigger order_events_append_only before update or delete on order_events
  for each row execute function forbid_change();
create trigger order_events_no_truncate before truncate on order_events
  for each statement execute function forbid_change();

-- The small CRM: what was said, and what to do next.
create table customer_notes (
  id bigint generated always as identity primary key,
  client_key text not null unique,
  customer_id uuid not null references customers(id),
  kind text not null check (kind in ('call', 'whatsapp', 'visit', 'note')),
  body text not null check (length(body) between 1 and 500),
  actor uuid not null,
  at timestamptz not null default now()
);
create index customer_notes_customer on customer_notes (customer_id, at desc);
create trigger customer_notes_append_only before update or delete on customer_notes
  for each row execute function forbid_change();
create trigger customer_notes_no_truncate before truncate on customer_notes
  for each statement execute function forbid_change();

create table follow_ups (
  id uuid primary key default gen_random_uuid(),
  client_key text not null unique,
  customer_id uuid not null references customers(id),
  what text not null check (length(what) between 1 and 300),
  due_on date not null,
  assigned_to uuid not null references staff(id),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  done_by uuid,
  check ((done_at is null) = (done_by is null))
);
create index follow_ups_open on follow_ups (due_on) where done_at is null;
create index follow_ups_customer on follow_ups (customer_id);

do $$
declare t text;
begin
  foreach t in array array['shipments', 'shipment_codes', 'shipment_serials', 'order_events', 'customer_notes', 'follow_ups'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from public, anon, authenticated, service_role', t);
  end loop;
end $$;

-- Guards. They sit on the tables, so every path is covered, not only the new screens.
create function i_guard_held_serial() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from shipment_serials where serial_id = old.id) then
    raise exception 'serial_on_delivery: %', old.serial;
  end if;
  return new;
end $$;
create trigger serial_units_held before update on serial_units for each row execute function i_guard_held_serial();

create function i_guard_order_out() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from shipments where order_id = new.id and status = 'out') then
    if new.goods_status is distinct from old.goods_status then raise exception 'order_on_delivery'; end if;
    new.hold_until := null;
  end if;
  return new;
end $$;
create trigger orders_out before update of goods_status, hold_until on orders for each row execute function i_guard_order_out();

create function i_guard_delivery_out() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from shipments where order_id = new.order_id and status = 'out') then raise exception 'order_on_delivery'; end if;
  return new;
end $$;
create trigger deliveries_out before insert on deliveries for each row execute function i_guard_delivery_out();

-- Card taps waiting for the second person's check: the customer has paid, the books don't count it yet.
create function i_pos_waiting(p_order uuid) returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(x.amount_kobo), 0)::bigint from payments x
    where x.order_id = p_order and x.method = 'pos' and x.kind = 'payment' and x.status = 'pending';
$$;

-- Money that lets goods leave: confirmed money plus card taps waiting for the check, or credit. As pack_list.
create function i_order_covered(o orders) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select o.on_credit or o.paid_kobo + i_pos_waiting(o.id) >= o.total_kobo;
$$;

-- One plain stage, worked out from the records, so it can't disagree with them.
create function i_order_stage(o orders) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when o.goods_status = 'cancelled' then 'cancelled'
    when o.goods_status = 'delivered' then 'delivered'
    when o.needs_approval then 'approval'
    when exists (select 1 from shipments s where s.order_id = o.id and s.status = 'out') then 'on_the_way'
    when i_order_covered(o) then 'paid'
    else 'placed' end;
$$;

create function i_order_event(p_order uuid, p_kind text, p_note text, p_actor uuid, p_key text default null) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into order_events (order_id, kind, note, actor, client_key) values (p_order, p_kind, p_note, p_actor, p_key);
$$;

-- Book or rebook a delivery. The contact phone defaults to the customer's.
create function book_delivery(p_order uuid, p_address text, p_on date, p_time text default null, p_landmark text default null,
  p_contact_name text default null, p_contact_phone text default null, p_lat double precision default null, p_lng double precision default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter', 'dispatcher']::staff_role[]);
  o orders;
  s shipments;
  c customers;
  v_phone text;
  v_id uuid;
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'no_such_order'; end if;
  if o.goods_status not in ('waiting', 'part_delivered') then raise exception 'order_not_open'; end if;
  select * into s from shipments where order_id = p_order for update;
  if found and s.status = 'out' then raise exception 'order_on_delivery'; end if;
  if length(trim(coalesce(p_address, ''))) < 3 or length(p_address) > 300 then raise exception 'address_required'; end if;
  if length(coalesce(p_landmark, '')) > 200 or length(coalesce(p_contact_name, '')) > 80 then raise exception 'note_too_long'; end if;
  if p_on is null or p_on < shop_today() or p_on > shop_today() + 60 then raise exception 'bad_delivery_day'; end if;
  if p_time is not null and p_time not in ('morning', 'afternoon', 'evening') then raise exception 'bad_choice'; end if;
  if (p_lat is null) <> (p_lng is null) or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'bad_pin'; end if;
  select * into c from customers where id = o.customer_id;
  v_phone := normalize_phone(coalesce(nullif(trim(p_contact_phone), ''), c.phone));
  insert into shipments (order_id, address, landmark, contact_name, contact_phone, lat, lng, scheduled_on, time_of_day)
  values (p_order, trim(p_address), nullif(trim(p_landmark), ''), coalesce(nullif(trim(p_contact_name), ''), c.name), v_phone, p_lat, p_lng, p_on, p_time)
  on conflict (order_id) do update set address = excluded.address, landmark = excluded.landmark, contact_name = excluded.contact_name,
    contact_phone = excluded.contact_phone, lat = coalesce(excluded.lat, shipments.lat), lng = coalesce(excluded.lng, shipments.lng),
    scheduled_on = excluded.scheduled_on, time_of_day = excluded.time_of_day, status = 'booked'
  returning id into v_id;
  -- A 4-digit code from the random generator: enough for a door with five tries, never shown to staff.
  insert into shipment_codes (shipment_id, code) values (v_id, lpad(floor(random() * 10000)::int::text, 4, '0'))
    on conflict (shipment_id) do update set wrong = 0;
  if s.id is null or s.scheduled_on is distinct from p_on or s.time_of_day is distinct from p_time then
    perform i_order_event(p_order, 'booked', p_on::text || coalesce(' ' || p_time, ''), me);
  end if;
  perform i_audit(me, 'book_delivery', 'order', p_order::text, jsonb_build_object('on', p_on));
  return v_id;
end $$;

-- The customer drops their own pin from the tracking link, before or while the rider is out.
create function set_drop_pin(p_token uuid, p_lat double precision, p_lng double precision, p_landmark text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o orders;
  s shipments;
begin
  select * into o from orders where receipt_token = p_token;
  if not found then raise exception 'no_such_order'; end if;
  select * into s from shipments where order_id = o.id for update;
  if not found or s.status = 'delivered' or o.goods_status not in ('waiting', 'part_delivered') then raise exception 'no_delivery_booked'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'bad_pin'; end if;
  if length(coalesce(p_landmark, '')) > 200 then raise exception 'note_too_long'; end if;
  if (select count(*) from order_events where order_id = o.id and kind = 'pin') >= 20 then raise exception 'too_many_requests'; end if;
  update shipments set lat = p_lat, lng = p_lng, landmark = coalesce(nullif(trim(p_landmark), ''), landmark) where id = s.id;
  perform i_order_event(o.id, 'pin', null, null);
end $$;

-- Give packed goods to a rider. Nothing is sold: the count stays held for the order, each serial is
-- locked to this drop, and the hold can't run out. p_lines as deliver_order: null means everything left.
create function dispatch_order(p_key text, p_order uuid, p_rider uuid, p_lines jsonb default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['storekeeper', 'dispatcher']::staff_role[]);
  o orders;
  s shipments;
  li order_lines;
  pr products;
  req jsonb;
  q numeric;
  v_need numeric;
  v_held numeric;
  v_serial text;
  u serial_units;
  v_serials jsonb;
  v_packed jsonb := '[]';
  v_rider text;
  v_seen order_events;
begin
  perform i_require_key(p_key);
  select * into v_seen from order_events where client_key = p_key;
  if found then
    if v_seen.order_id <> p_order then raise exception 'key_reused'; end if;
    return (select id from shipments where order_id = p_order);
  end if;
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'no_such_order'; end if;
  if o.goods_status = 'cancelled' then raise exception 'order_cancelled'; end if;
  if o.goods_status not in ('waiting', 'part_delivered') then raise exception 'order_not_open'; end if;
  if o.needs_approval then raise exception 'awaiting_approval'; end if;
  select * into s from shipments where order_id = p_order for update;
  if not found then raise exception 'no_delivery_booked'; end if;
  if s.status = 'out' then raise exception 'order_on_delivery'; end if;
  select name into v_rider from staff where id = p_rider and active and role = 'driver';
  if v_rider is null then raise exception 'not_a_rider'; end if;
  if not i_order_covered(o) then raise exception 'payment_required: % short', o.total_kobo - o.paid_kobo; end if;
  for li in select * from order_lines where order_id = p_order and delivered_qty < qty order by product_id loop
    req := null;
    if p_lines is null then
      q := li.qty - li.delivered_qty;
    else
      select value into req from jsonb_array_elements(p_lines) where (value ->> 'product_id')::uuid = li.product_id limit 1;
      if req is null then continue; end if;
      q := coalesce((req ->> 'qty')::numeric, li.qty - li.delivered_qty);
    end if;
    select * into pr from products where id = li.product_id;
    perform i_check_qty(pr.unit, q);
    if q > li.qty - li.delivered_qty then raise exception 'more_than_ordered'; end if;
    v_need := greatest(q - li.reserved_qty, 0);
    if v_need > 0 then
      v_held := i_reserve_up_to(li.product_id, o.location_id, v_need);
      if v_held < v_need then raise exception 'insufficient_stock: %', pr.name; end if;
      update order_lines set reserved_qty = reserved_qty + v_held where id = li.id;
    end if;
    v_serials := '[]';
    if pr.tracking = 'serial' then
      if coalesce(jsonb_array_length(req -> 'serials'), 0) <> q then raise exception 'serial_required: %', pr.sku; end if;
      for v_serial in select upper(trim(value)) from jsonb_array_elements_text(req -> 'serials') order by 1 loop
        select * into u from serial_units where serial = v_serial and product_id = li.product_id for update;
        if not found or u.status <> 'in_stock' or u.location_id is distinct from o.location_id
           or exists (select 1 from shipment_serials where serial_id = u.id) then
          raise exception 'serial_not_available: %', v_serial;
        end if;
        insert into shipment_serials (serial_id, shipment_id) values (u.id, s.id);
        v_serials := v_serials || to_jsonb(v_serial);
      end loop;
    end if;
    v_packed := v_packed || jsonb_build_array(jsonb_build_object('product_id', li.product_id, 'qty', q, 'serials', v_serials));
  end loop;
  if jsonb_array_length(v_packed) = 0 then raise exception 'nothing_to_deliver'; end if;
  if p_lines is not null and jsonb_array_length(p_lines) <> jsonb_array_length(v_packed) then raise exception 'line_not_on_order'; end if;
  update shipments set status = 'out', rider_id = p_rider, packed_lines = v_packed, out_at = now(), tries = tries + 1 where id = s.id;
  update orders set hold_until = null, hold_lapsed = false where id = p_order;
  perform i_order_event(p_order, 'out', split_part(v_rider, ' ', 1), me, p_key);
  perform i_audit(me, 'dispatch', 'order', p_order::text, jsonb_build_object('rider', p_rider, 'lines', v_packed));
  return s.id;
end $$;

-- At the door. The customer's code books the sale through i_deliver. A wrong code is counted and
-- answered, not raised, so the count sticks; five wrong and only a dispatcher can finish it.
-- Without a code, a dispatcher or the owner confirms with a reason the owner can read.
create function confirm_drop(p_key text, p_order uuid, p_code text default null, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['driver', 'dispatcher']::staff_role[]);
  v_role staff_role;
  o orders;
  s shipments;
  sc shipment_codes;
  v_done deliveries;
  v_delivery uuid;
begin
  perform i_require_key(p_key);
  select * into v_done from deliveries where client_key = 'drop:' || p_key;
  if found then
    if v_done.order_id <> p_order then raise exception 'key_reused'; end if;
    return jsonb_build_object('delivery', v_done.id);
  end if;
  select role into v_role from staff where id = me;
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'no_such_order'; end if;
  select * into s from shipments where order_id = p_order for update;
  if not found or s.status <> 'out' then raise exception 'not_out'; end if;
  if v_role = 'driver' and s.rider_id <> me then raise exception 'not_your_drop'; end if;
  select * into sc from shipment_codes where shipment_id = s.id for update;
  if p_code is not null then
    if sc.wrong >= 5 then raise exception 'code_locked'; end if;
    if trim(p_code) <> sc.code then
      update shipment_codes set wrong = wrong + 1 where shipment_id = s.id;
      return jsonb_build_object('wrong_code', true, 'tries_left', 4 - sc.wrong);
    end if;
  else
    if v_role = 'driver' then raise exception 'code_required'; end if;
    if length(trim(coalesce(p_reason, ''))) < 5 or length(p_reason) > 300 then raise exception 'reason_required'; end if;
  end if;
  delete from shipment_serials where shipment_id = s.id;
  update shipments set status = 'delivered', rider_lat = null, rider_lng = null, rider_seen_at = null where id = s.id;
  v_delivery := i_deliver(me, 'drop:' || p_key, p_order, s.packed_lines, shop_today());
  perform i_order_event(p_order, 'delivered', case when p_code is null then 'Confirmed without the code: ' || trim(p_reason) end, me);
  perform i_audit(me, 'confirm_drop', 'order', p_order::text, jsonb_build_object('delivery', v_delivery, 'code', p_code is not null, 'reason', p_reason));
  return jsonb_build_object('delivery', v_delivery);
end $$;

-- The drop didn't happen. The goods come back to the shelf, still held for the customer.
create function fail_drop(p_key text, p_order uuid, p_reason text, p_next_on date default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['driver', 'dispatcher']::staff_role[]);
  v_role staff_role;
  o orders;
  s shipments;
  cfg shop_settings;
  v_seen order_events;
begin
  perform i_require_key(p_key);
  select * into v_seen from order_events where client_key = p_key;
  if found then
    if v_seen.order_id <> p_order then raise exception 'key_reused'; end if;
    return;
  end if;
  select role into v_role from staff where id = me;
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'no_such_order'; end if;
  select * into s from shipments where order_id = p_order for update;
  if not found or s.status <> 'out' then raise exception 'not_out'; end if;
  if v_role = 'driver' and s.rider_id <> me then raise exception 'not_your_drop'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 or length(p_reason) > 300 then raise exception 'reason_required'; end if;
  if p_next_on is not null and (p_next_on < shop_today() or p_next_on > shop_today() + 60) then raise exception 'bad_delivery_day'; end if;
  select * into cfg from shop_settings;
  delete from shipment_serials where shipment_id = s.id;
  update shipments set status = 'booked', rider_id = null, packed_lines = null, rider_lat = null, rider_lng = null, rider_seen_at = null,
    scheduled_on = coalesce(p_next_on, scheduled_on) where id = s.id;
  update orders set hold_until = now() + make_interval(days => cfg.hold_deposit_days) where id = p_order;
  perform i_order_event(p_order, 'failed', trim(p_reason), me, p_key);
  perform i_audit(me, 'fail_drop', 'order', p_order::text, jsonb_build_object('reason', p_reason, 'next_on', p_next_on));
end $$;

-- The rider's phone sends its point while the drop screen is open. Only the last point is kept.
create function share_position(p_lat double precision, p_lng double precision) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['driver']::staff_role[]);
  v_n int;
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'bad_pin'; end if;
  update shipments set rider_lat = p_lat, rider_lng = p_lng, rider_seen_at = now() where rider_id = me and status = 'out';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- The rider's own drops. No prices, no other riders.
create function my_drops() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['driver']::staff_role[]);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'order_id', o.id, 'invoice_no', o.invoice_no, 'customer', c.name, 'contact_name', s.contact_name, 'contact_phone', s.contact_phone,
      'address', s.address, 'landmark', s.landmark, 'lat', s.lat, 'lng', s.lng, 'scheduled_on', s.scheduled_on, 'time_of_day', s.time_of_day,
      'out_at', s.out_at, 'rider', st.name,
      'items', (select coalesce(jsonb_agg(jsonb_build_object('name', p.name, 'qty', (x ->> 'qty')::numeric, 'unit', p.unit, 'serials', x -> 'serials') order by p.name), '[]')
        from jsonb_array_elements(s.packed_lines) x join products p on p.id = (x ->> 'product_id')::uuid))
    order by s.scheduled_on, array_position(array['morning', 'afternoon', 'evening'], s.time_of_day) nulls last, s.out_at), '[]')
    from shipments s join orders o on o.id = s.order_id left join customers c on c.id = o.customer_id join staff st on st.id = s.rider_id
    where s.status = 'out' and (s.rider_id = me or exists (select 1 from staff where id = me and role = 'owner')));
end $$;

-- The customer's page, from the receipt link. The door code shows only to someone not signed in as staff.
create function track_order(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  o orders;
  s shipments;
  v_stage text;
begin
  select * into o from orders where receipt_token = p_token;
  if not found then raise exception 'no_such_order'; end if;
  select * into s from shipments where order_id = o.id;
  v_stage := i_order_stage(o);
  return jsonb_build_object(
    'invoice_no', o.invoice_no, 'stage', v_stage, 'placed_at', o.created_at,
    'paid_at', case when v_stage in ('paid', 'on_the_way', 'delivered') then (select max(coalesce(p.decided_at, p.created_at)) from payments p
      where p.order_id = o.id and p.kind = 'payment' and (p.status = 'confirmed' or (p.status = 'pending' and p.method = 'pos'))) end,
    'delivered_at', case when v_stage = 'delivered' then (select max(d.created_at) from deliveries d where d.order_id = o.id) end,
    -- To the customer a card tap is paid; the second person's check is the shop's business.
    'total', o.total_kobo, 'paid', o.paid_kobo + i_pos_waiting(o.id),
    'balance', greatest(o.total_kobo - o.paid_kobo - i_pos_waiting(o.id), 0), 'on_credit', o.on_credit,
    'items', (select coalesce(jsonb_agg(jsonb_build_object('name', p.name, 'qty', l.qty, 'unit', p.unit) order by p.name), '[]')
      from order_lines l join products p on p.id = l.product_id where l.order_id = o.id),
    'delivery', case when s.id is not null then jsonb_build_object(
      'status', s.status, 'address', s.address, 'landmark', s.landmark, 'lat', s.lat, 'lng', s.lng,
      'scheduled_on', s.scheduled_on, 'time_of_day', s.time_of_day, 'tries', s.tries,
      'rider', case when s.status = 'out' then (select split_part(name, ' ', 1) from staff where id = s.rider_id) end,
      'rider_lat', s.rider_lat, 'rider_lng', s.rider_lng, 'rider_seen_at', s.rider_seen_at,
      'code', case when s.status in ('booked', 'out') and not is_staff() then (select code from shipment_codes where shipment_id = s.id) end) end,
    'events', (select coalesce(jsonb_agg(jsonb_build_object('kind', e.kind, 'at', e.at, 'note', case when e.kind = 'failed' then e.note end) order by e.at), '[]')
      from order_events e where e.order_id = o.id and e.kind <> 'pin'),
    'shop', (select jsonb_build_object('name', shop_name, 'phone', shop_phone) from shop_settings where id));
end $$;

-- The board: every open order, and the last two days' finished ones, with one stage each.
create function orders_board() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter', 'dispatcher', 'accountant']::staff_role[]);
begin
  return jsonb_build_object(
    'orders', (select coalesce(jsonb_agg(x.j order by x.at desc), '[]') from (
      select o.created_at at, jsonb_build_object(
        'order_id', o.id, 'invoice_no', o.invoice_no, 'created_at', o.created_at, 'channel', o.channel, 'token', o.receipt_token,
        'customer', case when c.id is not null then jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone) end,
        'total', o.total_kobo, 'paid', o.paid_kobo, 'waiting', i_pos_waiting(o.id), 'on_credit', o.on_credit, 'stage', i_order_stage(o),
        'items', (select string_agg(p.name || case when l.qty <> 1 then ' × ' || rtrim(to_char(l.qty, 'FM999990.###'), '.') else '' end, ', ' order by p.name)
          from order_lines l join products p on p.id = l.product_id where l.order_id = o.id),
        'delivery', case when s.id is not null then jsonb_build_object(
          'status', s.status, 'address', s.address, 'landmark', s.landmark, 'lat', s.lat, 'lng', s.lng, 'contact_name', s.contact_name,
          'contact_phone', s.contact_phone, 'scheduled_on', s.scheduled_on, 'time_of_day', s.time_of_day, 'tries', s.tries,
          'rider', (select name from staff where id = s.rider_id), 'rider_lat', s.rider_lat, 'rider_lng', s.rider_lng, 'rider_seen_at', s.rider_seen_at,
          'last_failed', (select e.note from order_events e where e.order_id = o.id and e.kind = 'failed' order by e.at desc limit 1),
          'override', (select e.note from order_events e where e.order_id = o.id and e.kind = 'delivered' and e.note is not null order by e.at desc limit 1)) end) j
      from orders o left join customers c on c.id = o.customer_id left join shipments s on s.order_id = o.id
      where not o.is_opening and (o.goods_status in ('waiting', 'part_delivered')
        or o.created_at > now() - interval '2 days'
        or exists (select 1 from deliveries d where d.order_id = o.id and d.created_at > now() - interval '2 days'))
      order by o.created_at desc limit 200) x),
    'riders', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]') from staff where role = 'driver' and active));
end $$;

-- The pack list, as before, with the delivery beside each order. Orders already with a rider leave
-- it, and units on a bike are never offered. Still no phone numbers and no money in the stock room.
create or replace function pack_list() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['storekeeper', 'dispatcher', 'counter']::staff_role[]);
  v_ready jsonb;
  v_waiting int;
begin
  with todo as (
    select o.id, o.invoice_no, o.customer_id, o.channel, o.created_on, o.created_at, o.location_id, o.on_credit, o.total_kobo,
      o.paid_kobo + coalesce((select sum(x.amount_kobo) from payments x
        where x.order_id = o.id and x.method = 'pos' and x.kind = 'payment' and x.status = 'pending'), 0) as covered
    from orders o
    where o.goods_status in ('waiting', 'part_delivered') and not o.needs_approval and not o.is_opening
      and exists (select 1 from order_lines l where l.order_id = o.id and l.delivered_qty < l.qty)
      and not exists (select 1 from shipments s where s.order_id = o.id and s.status = 'out')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'order_id', t.id, 'invoice_no', t.invoice_no, 'customer', c.name, 'channel', t.channel, 'created_on', t.created_on,
      'location_id', t.location_id, 'on_credit', t.on_credit,
      'delivery', (select jsonb_build_object('scheduled_on', s.scheduled_on, 'time_of_day', s.time_of_day, 'landmark', s.landmark, 'tries', s.tries)
        from shipments s where s.order_id = t.id),
      'lines', (select jsonb_agg(jsonb_build_object(
          'product_id', l.product_id, 'sku', p.sku, 'name', p.name, 'unit', p.unit, 'tracking', p.tracking,
          'remaining', l.qty - l.delivered_qty,
          'oldest', case when p.tracking = 'serial' then (
            select coalesce(jsonb_agg(u.serial order by coalesce(u.made_on, u.received_on), u.received_on, u.serial), '[]'::jsonb)
            from (select s.serial, s.made_on, s.received_on from serial_units s
                  where s.product_id = l.product_id and s.location_id = t.location_id and s.status = 'in_stock'
                    and not exists (select 1 from shipment_serials h where h.serial_id = s.id)
                  order by coalesce(s.made_on, s.received_on), s.received_on, s.serial
                  limit least(ceil(l.qty - l.delivered_qty)::int + 2, 20)) u) end)
          order by p.name)
        from order_lines l join products p on p.id = l.product_id
        where l.order_id = t.id and l.delivered_qty < l.qty))
      order by t.created_at), '[]'::jsonb)
    into v_ready
    from todo t left join customers c on c.id = t.customer_id
    where t.on_credit or t.covered >= t.total_kobo;
  select count(*) into v_waiting from (
    select 1 from orders o
    where o.goods_status in ('waiting', 'part_delivered') and not o.needs_approval and not o.is_opening and not o.on_credit
      and o.paid_kobo + coalesce((select sum(x.amount_kobo) from payments x
        where x.order_id = o.id and x.method = 'pos' and x.kind = 'payment' and x.status = 'pending'), 0) < o.total_kobo
  ) w;
  return jsonb_build_object('ready', v_ready, 'waiting_for_money', v_waiting,
    'riders', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]') from staff where role = 'driver' and active));
end $$;

-- As before, without units that are out with a rider.
create or replace function oldest_serials(p_product uuid, p_location uuid, p_count int) returns table (serial text, made_on date, received_on date)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform require_staff(array['counter', 'storekeeper', 'dispatcher']::staff_role[]);
  return query
    select u.serial, u.made_on, u.received_on from serial_units u
    where u.product_id = p_product and u.location_id = p_location and u.status = 'in_stock'
      and not exists (select 1 from shipment_serials h where h.serial_id = u.id)
    order by coalesce(u.made_on, u.received_on), u.received_on, u.serial limit least(p_count, 20);
end $$;

-- The CRM list: newest activity first, with what each customer owes and what is due today.
create function crm_customers(p_query text default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter', 'dispatcher', 'accountant']::staff_role[]);
  v_q text := nullif(trim(coalesce(p_query, '')), '');
  v_digits text := nullif(regexp_replace(coalesce(p_query, ''), '\D', '', 'g'), '');
begin
  if length(coalesce(v_q, '')) > 80 then raise exception 'bad_query'; end if;
  if v_digits like '0%' then v_digits := substr(v_digits, 2); end if;
  return jsonb_build_object(
    'customers', (select coalesce(jsonb_agg(x.j order by x.last_at desc nulls last), '[]') from (
      select greatest(a.last_order, a.last_note, c.created_at) last_at, jsonb_build_object(
        'id', c.id, 'name', c.name, 'phone', c.phone, 'kind', c.kind,
        'orders', a.orders, 'spent', a.spent, 'owes', i_customer_owes(c.id), 'last_order_at', a.last_order,
        'open_follow_ups', (select count(*) from follow_ups f where f.customer_id = c.id and f.done_at is null),
        'next_due', (select min(f.due_on) from follow_ups f where f.customer_id = c.id and f.done_at is null)) j
      from customers c
      cross join lateral (select count(o.id) orders, coalesce(sum(o.billed_kobo), 0) spent, max(o.created_at) last_order,
          (select max(n.at) from customer_notes n where n.customer_id = c.id) last_note
        from orders o where o.customer_id = c.id and o.goods_status <> 'cancelled') a
      where v_q is null or c.name ilike '%' || v_q || '%' or (v_digits is not null and length(v_digits) >= 4 and c.phone like '%' || v_digits || '%')
      order by 1 desc nulls last limit 60) x),
    'due', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'customer_id', f.customer_id, 'customer', c.name, 'phone', c.phone,
        'what', f.what, 'due_on', f.due_on, 'assigned_to', st.name, 'mine', f.assigned_to = me) order by f.due_on, f.created_at), '[]')
      from follow_ups f join customers c on c.id = f.customer_id join staff st on st.id = f.assigned_to
      where f.done_at is null and f.due_on <= shop_today()),
    'team', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'me', id = me) order by name), '[]')
      from staff where active and role in ('owner', 'counter', 'dispatcher', 'accountant')));
end $$;

create function crm_customer(p_customer uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter', 'dispatcher', 'accountant']::staff_role[]);
  c customers;
begin
  select * into c from customers where id = p_customer;
  if not found then raise exception 'no_such_customer'; end if;
  return jsonb_build_object(
    'id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email, 'kind', c.kind, 'since', c.created_at,
    'owes', i_customer_owes(c.id), 'credit_limit', c.credit_limit_kobo,
    'orders', (select coalesce(jsonb_agg(jsonb_build_object('order_id', o.id, 'invoice_no', o.invoice_no, 'created_at', o.created_at,
        'total', o.total_kobo, 'paid', o.paid_kobo, 'stage', o.stage, 'token', o.receipt_token) order by o.created_at desc), '[]')
      from (select x.*, i_order_stage(x) stage from orders x where x.customer_id = c.id and not x.is_opening order by x.created_at desc limit 20) o),
    'notes', (select coalesce(jsonb_agg(jsonb_build_object('kind', n.kind, 'body', n.body, 'at', n.at, 'by', st.name) order by n.at desc), '[]')
      from (select * from customer_notes where customer_id = c.id order by at desc limit 50) n left join staff st on st.id = n.actor),
    'follow_ups', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'what', f.what, 'due_on', f.due_on, 'assigned_to', st.name,
        'done_at', f.done_at) order by f.done_at is not null, f.due_on), '[]')
      from (select * from follow_ups where customer_id = c.id and (done_at is null or done_at > now() - interval '30 days')) f
      join staff st on st.id = f.assigned_to));
end $$;

create function add_customer_note(p_key text, p_customer uuid, p_kind text, p_body text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter', 'dispatcher', 'accountant']::staff_role[]);
  n customer_notes;
begin
  perform i_require_key(p_key);
  select * into n from customer_notes where client_key = p_key;
  if found then
    if n.customer_id <> p_customer then raise exception 'key_reused'; end if;
    return n.id;
  end if;
  perform 1 from customers where id = p_customer;
  if not found then raise exception 'no_such_customer'; end if;
  if p_kind is null or p_kind not in ('call', 'whatsapp', 'visit', 'note') then raise exception 'bad_choice'; end if;
  if trim(coalesce(p_body, '')) = '' then raise exception 'note_required'; end if;
  if length(p_body) > 500 then raise exception 'note_too_long'; end if;
  insert into customer_notes (client_key, customer_id, kind, body, actor) values (p_key, p_customer, p_kind, trim(p_body), me) returning * into n;
  return n.id;
end $$;

create function add_follow_up(p_key text, p_customer uuid, p_what text, p_due_on date, p_assignee uuid default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter', 'dispatcher', 'accountant']::staff_role[]);
  f follow_ups;
  v_to uuid := coalesce(p_assignee, me);
begin
  perform i_require_key(p_key);
  select * into f from follow_ups where client_key = p_key;
  if found then
    if f.customer_id <> p_customer then raise exception 'key_reused'; end if;
    return f.id;
  end if;
  perform 1 from customers where id = p_customer;
  if not found then raise exception 'no_such_customer'; end if;
  if trim(coalesce(p_what, '')) = '' then raise exception 'note_required'; end if;
  if length(p_what) > 300 then raise exception 'note_too_long'; end if;
  if p_due_on is null or p_due_on < shop_today() or p_due_on > shop_today() + 366 then raise exception 'bad_due_day'; end if;
  perform 1 from staff where id = v_to and active and role in ('owner', 'counter', 'dispatcher', 'accountant');
  if not found then raise exception 'bad_choice'; end if;
  insert into follow_ups (client_key, customer_id, what, due_on, assigned_to, created_by)
  values (p_key, p_customer, trim(p_what), p_due_on, v_to, me) returning * into f;
  return f.id;
end $$;

create function close_follow_up(p_follow_up uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter', 'dispatcher', 'accountant']::staff_role[]);
begin
  perform 1 from follow_ups where id = p_follow_up for update;
  if not found then raise exception 'no_such_follow_up'; end if;
  update follow_ups set done_at = now(), done_by = me where id = p_follow_up and done_at is null;
end $$;

grant execute on function book_delivery(uuid, text, date, text, text, text, text, double precision, double precision) to authenticated;
grant execute on function set_drop_pin(uuid, double precision, double precision, text) to anon, authenticated;
grant execute on function dispatch_order(text, uuid, uuid, jsonb) to authenticated;
grant execute on function confirm_drop(text, uuid, text, text) to authenticated;
grant execute on function fail_drop(text, uuid, text, date) to authenticated;
grant execute on function share_position(double precision, double precision) to authenticated;
grant execute on function my_drops() to authenticated;
grant execute on function track_order(uuid) to anon, authenticated;
grant execute on function orders_board() to authenticated;
grant execute on function crm_customers(text) to authenticated;
grant execute on function crm_customer(uuid) to authenticated;
grant execute on function add_customer_note(text, uuid, text, text) to authenticated;
grant execute on function add_follow_up(text, uuid, text, date, uuid) to authenticated;
grant execute on function close_follow_up(uuid) to authenticated;
