-- Power Store core, part 3: catalogue and stock.
-- Stock never changes without a movement row saying who and why. Balances follow the movements.
-- Stock value is tracked exactly in kobo, so the ledger's stock account always equals it.

create type product_tracking as enum ('count', 'serial');
create type product_unit as enum ('each', 'metre');
create type product_status as enum ('draft', 'active', 'archived');

create table products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  search_code text generated always as (upper(regexp_replace(sku, '[^a-zA-Z0-9]', '', 'g'))) stored,
  name text not null,
  family text not null default 'general',
  unit product_unit not null default 'each',
  tracking product_tracking not null default 'count',
  price_kobo bigint not null check (price_kobo >= 0),
  vat_rate_bp int not null default 0 check (vat_rate_bp between 0 and 10000),
  warranty_months int not null default 0 check (warranty_months >= 0),
  weight_grams int not null default 0 check (weight_grams >= 0),
  length_mm int not null default 0 check (length_mm >= 0),
  low_stock_at numeric(14,3) not null default 0,
  lead_days int not null default 0,
  attributes jsonb not null default '{}',
  status product_status not null default 'active',
  created_at timestamptz not null default now(),
  check (tracking = 'count' or unit = 'each')
);
create index products_search_code on products (search_code);

-- Apart from products, which the public can read: an installer's price is not for the street.
create table product_trade_prices (
  product_id uuid primary key references products(id),
  trade_price_kobo bigint not null check (trade_price_kobo >= 0)
);

-- Every quantity entering the system passes through here. NaN, fractions of a bearing and absurd sizes stop at the door.
create function i_check_qty(p_unit product_unit, p_qty numeric, p_allow_zero boolean default false) returns void
language plpgsql immutable as $$
begin
  if p_qty is null or p_qty = 'NaN'::numeric or p_qty < 0 or (p_qty = 0 and not p_allow_zero)
     or p_qty > 1000000 or p_qty <> round(p_qty, 3) or (p_unit = 'each' and p_qty <> trunc(p_qty)) then
    raise exception 'bad_qty';
  end if;
end $$;

-- Kept apart from products so that a login without permission cannot read what things cost.
create table product_costs (
  product_id uuid primary key references products(id),
  on_hand numeric(14,3) not null default 0 check (on_hand >= 0),
  value_kobo bigint not null default 0 check (value_kobo >= 0),
  last_cost_kobo bigint not null default 0 check (last_cost_kobo >= 0),
  check (on_hand > 0 or value_kobo = 0)
);

create type location_kind as enum ('shop', 'warehouse', 'van', 'repair', 'scrap');

create table locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind location_kind not null default 'shop'
);

create table stock_balances (
  product_id uuid not null references products(id),
  location_id uuid not null references locations(id),
  qty numeric(14,3) not null default 0 check (qty >= 0),
  reserved numeric(14,3) not null default 0 check (reserved >= 0),
  primary key (product_id, location_id),
  check (reserved <= qty)
);

create type stock_reason as enum ('received', 'sold', 'returned', 'transfer', 'count_gain', 'count_loss', 'written_off');

create table lots (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  supplier_id uuid references suppliers(id),
  code text,
  made_on date,
  received_on date not null,
  created_at timestamptz not null default now()
);
create index lots_product on lots (product_id);

-- Reservations hold a quantity, not a particular unit. The packer scans which unit actually leaves.
create type serial_status as enum ('in_stock', 'sold', 'written_off');

create table serial_units (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  serial text not null unique check (serial = upper(serial)),
  lot_id uuid references lots(id),
  status serial_status not null default 'in_stock',
  location_id uuid references locations(id),
  received_on date not null,
  made_on date,
  sold_on date,
  warranty_ends_on date,
  customer_id uuid references customers(id),
  -- A unit is on a shelf or it has left. It is never both, and never in two places.
  check ((status = 'in_stock') = (location_id is not null))
);
create index serial_units_pick on serial_units (product_id, location_id, status, made_on, received_on);
create index serial_units_customer on serial_units (customer_id) where customer_id is not null;

create table stock_movements (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  product_id uuid not null references products(id),
  from_location uuid references locations(id),
  to_location uuid references locations(id),
  qty numeric(14,3) not null check (qty > 0),
  serial_id uuid references serial_units(id),
  reason stock_reason not null,
  ref_type text,
  ref_id uuid,
  actor uuid,
  note text,
  check (from_location is not null or to_location is not null),
  check (serial_id is null or qty = 1)
);
create index stock_movements_product on stock_movements (product_id, at);
create trigger stock_movements_append_only before update or delete on stock_movements
  for each row execute function forbid_change();
create trigger stock_movements_no_truncate before truncate on stock_movements
  for each statement execute function forbid_change();

-- Balances follow movements. Only stock that isn't reserved can leave.
create function on_stock_movement() returns trigger
language plpgsql as $$
declare
  free numeric;
begin
  if new.from_location is not null then
    select qty - reserved into free from stock_balances
      where product_id = new.product_id and location_id = new.from_location for update;
    if free is null or free < new.qty then
      raise exception 'insufficient_stock: product %', new.product_id;
    end if;
    update stock_balances set qty = qty - new.qty where product_id = new.product_id and location_id = new.from_location;
  end if;
  if new.to_location is not null then
    insert into stock_balances (product_id, location_id, qty) values (new.product_id, new.to_location, new.qty)
    on conflict (product_id, location_id) do update set qty = stock_balances.qty + excluded.qty;
  end if;
  return new;
end $$;

create trigger stock_movements_apply after insert on stock_movements
  for each row execute function on_stock_movement();

-- Holds as much as is free, up to p_qty, and says how much that was.
create function i_reserve_up_to(p_product uuid, p_location uuid, p_qty numeric) returns numeric
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  free numeric;
  held numeric;
begin
  select qty - reserved into free from stock_balances where product_id = p_product and location_id = p_location for update;
  held := least(coalesce(free, 0), p_qty);
  if held > 0 then
    update stock_balances set reserved = reserved + held where product_id = p_product and location_id = p_location;
  end if;
  return held;
end $$;

create function i_unreserve(p_product uuid, p_location uuid, p_qty numeric) returns void
language sql security definer set search_path = public, pg_temp as $$
  update stock_balances set reserved = reserved - p_qty where product_id = p_product and location_id = p_location;
$$;

-- Adds value to stock. Average cost is value divided by quantity, always worked out from these two.
-- Errors are replaced here, so Postgres can never quote a cost row back to whoever made the call.
create function i_add_value(p_product uuid, p_qty numeric, p_value bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into product_costs (product_id, on_hand, value_kobo) values (p_product, p_qty, p_value)
  on conflict (product_id) do update set on_hand = product_costs.on_hand + excluded.on_hand, value_kobo = product_costs.value_kobo + excluded.value_kobo;
exception when check_violation or numeric_value_out_of_range then
  raise exception 'stock_value_error';
end $$;

-- Takes value out in proportion. The last unit takes whatever is left, so rounding can't leave value stranded.
create function i_take_value(p_product uuid, p_qty numeric) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c product_costs;
  v bigint;
begin
  select * into c from product_costs where product_id = p_product for update;
  if not found or c.on_hand < p_qty then raise exception 'insufficient_stock: product %', p_product; end if;
  v := case when c.on_hand = p_qty then c.value_kobo else round(c.value_kobo * p_qty / c.on_hand)::bigint end;
  update product_costs set on_hand = on_hand - p_qty, value_kobo = value_kobo - v where product_id = p_product;
  return v;
exception when check_violation or numeric_value_out_of_range then
  raise exception 'stock_value_error';
end $$;

create function save_product(
  p_sku text, p_name text, p_price bigint, p_trade bigint default null, p_tracking product_tracking default 'count',
  p_unit product_unit default 'each', p_warranty_months int default 0, p_vat_bp int default 0, p_family text default 'general',
  p_weight_grams int default 0, p_length_mm int default 0, p_attributes jsonb default '{}', p_low_stock_at numeric default 0
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array[]::staff_role[]);
  id_out uuid;
begin
  insert into products (sku, name, price_kobo, tracking, unit, warranty_months, vat_rate_bp, family, weight_grams, length_mm, attributes, low_stock_at)
  values (p_sku, p_name, p_price, p_tracking, p_unit, p_warranty_months, p_vat_bp, p_family, p_weight_grams, p_length_mm, p_attributes, p_low_stock_at)
  on conflict (sku) do update set name = excluded.name, price_kobo = excluded.price_kobo,
    warranty_months = excluded.warranty_months, vat_rate_bp = excluded.vat_rate_bp, family = excluded.family,
    weight_grams = excluded.weight_grams, length_mm = excluded.length_mm, attributes = excluded.attributes, low_stock_at = excluded.low_stock_at
  returning id into id_out;
  insert into product_costs (product_id) values (id_out) on conflict do nothing;
  if p_trade is null then
    delete from product_trade_prices where product_id = id_out;
  else
    insert into product_trade_prices (product_id, trade_price_kobo) values (id_out, p_trade)
    on conflict (product_id) do update set trade_price_kobo = excluded.trade_price_kobo;
  end if;
  perform i_audit(me, 'save_product', 'product', id_out::text, jsonb_build_object('price', p_price));
  return id_out;
end $$;

create function set_last_cost(p_product uuid, p_cost bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['accountant']::staff_role[]);
begin
  if p_cost < 0 then raise exception 'bad_amount'; end if;
  insert into product_costs (product_id, last_cost_kobo) values (p_product, p_cost)
  on conflict (product_id) do update set last_cost_kobo = excluded.last_cost_kobo;
  perform i_audit(me, 'set_last_cost', 'product', p_product::text, jsonb_build_object('cost', p_cost));
end $$;

create table goods_receipts (
  id uuid primary key default gen_random_uuid(),
  client_key text not null unique,
  client_hash text,
  supplier_id uuid references suppliers(id),
  location_id uuid not null references locations(id),
  received_on date not null,
  total_value_kobo bigint not null,
  txn_id uuid references ledger_txns(id),
  actor uuid,
  created_at timestamptz not null default now()
);

-- p_lines: [{"product_id": "...", "qty": 4, "serials": ["A", "B"], "lot": "L1", "made_on": "2026-01-10"}]
-- Cost comes from product_costs.last_cost_kobo, which the owner sets, so a storekeeper never handles cost.
-- No supplier means opening stock on the go-live day, which only the owner may enter and which comes from the owner's money.
create function receive_goods(p_key text, p_supplier uuid, p_location uuid, p_lines jsonb, p_on date default shop_today()) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['storekeeper', 'accountant']::staff_role[]);
  rid uuid;
  l jsonb;
  p products;
  q numeric;
  cost bigint;
  val bigint;
  total bigint := 0;
  lot_id uuid;
  s text;
  sid uuid;
  n int;
  t uuid;
  who text;
  v_hash text := md5(coalesce(p_supplier::text, '') || coalesce(p_location::text, '') || coalesce(p_lines::text, ''));
  v_seen text;
begin
  perform i_require_key(p_key);
  if p_supplier is null then
    perform require_staff(array[]::staff_role[]);
    perform i_require_go_live();
  end if;
  -- The storekeeper receives goods today. Only the accountant or owner may date a delivery earlier.
  if p_on <> shop_today() and not has_staff_role(array['accountant']::staff_role[]) then raise exception 'date_not_allowed'; end if;
  insert into goods_receipts (client_key, client_hash, supplier_id, location_id, received_on, total_value_kobo, actor)
  values (p_key, v_hash, p_supplier, p_location, p_on, 0, me)
  on conflict (client_key) do nothing returning id into rid;
  if rid is null then
    select id, client_hash into rid, v_seen from goods_receipts where client_key = p_key;
    if v_seen is distinct from v_hash then raise exception 'key_reused'; end if;
    return rid;
  end if;
  for l in select * from jsonb_array_elements(p_lines) order by (value ->> 'product_id')::uuid loop
    select * into p from products where id = (l ->> 'product_id')::uuid;
    if not found then raise exception 'no_such_product'; end if;
    q := (l ->> 'qty')::numeric;
    -- Checked before cost is touched, so nobody can use a failed sum to work out what a thing cost.
    perform i_check_qty(p.unit, q);
    select last_cost_kobo into cost from product_costs where product_id = p.id;
    if coalesce(cost, 0) = 0 then raise exception 'cost_not_set: %', p.sku; end if;
    val := round(cost * q)::bigint;
    insert into lots (product_id, supplier_id, code, made_on, received_on)
    values (p.id, p_supplier, l ->> 'lot', (l ->> 'made_on')::date, p_on) returning id into lot_id;
    if p.tracking = 'serial' then
      n := coalesce(jsonb_array_length(l -> 'serials'), 0);
      if n <> q then raise exception 'serial_count_mismatch: % units, % serials', q, n; end if;
      for s in select upper(trim(value)) from jsonb_array_elements_text(l -> 'serials') loop
        begin
          insert into serial_units (product_id, serial, lot_id, location_id, received_on, made_on)
          values (p.id, s, lot_id, p_location, p_on, (l ->> 'made_on')::date) returning id into sid;
        exception when unique_violation then
          raise exception 'serial_exists: %', s;
        end;
        insert into stock_movements (product_id, to_location, qty, serial_id, reason, ref_type, ref_id, actor)
        values (p.id, p_location, 1, sid, 'received', 'goods_receipt', rid, me);
      end loop;
    else
      insert into stock_movements (product_id, to_location, qty, reason, ref_type, ref_id, actor)
      values (p.id, p_location, q, 'received', 'goods_receipt', rid, me);
    end if;
    perform i_add_value(p.id, q, val);
    total := total + val;
  end loop;
  if total = 0 then raise exception 'nothing_received'; end if;
  select name into who from suppliers where id = p_supplier;
  t := i_post_txn('goods_received', coalesce('Goods received from ' || who, 'Opening stock'), p_on,
    jsonb_build_array(jsonb_build_object('account', 'stock', 'amount', total),
      case when p_supplier is null then jsonb_build_object('account', 'owner_money', 'amount', -total)
      else jsonb_build_object('account', 'suppliers_owed', 'amount', -total, 'supplier_id', p_supplier) end),
    'goods_receipt', rid, 'receipt:' || rid, me);
  -- The receipt header is the one row here that gets finished after its lines.
  update goods_receipts set total_value_kobo = total, txn_id = t where id = rid;
  perform i_audit(me, 'receive_goods', 'goods_receipt', rid::text, jsonb_build_object('value', total));
  return rid;
end $$;

create function transfer_stock(p_product uuid, p_from uuid, p_to uuid, p_qty numeric, p_serials text[] default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['storekeeper', 'dispatcher']::staff_role[]);
  p products;
  s text;
  u serial_units;
begin
  -- With no "from", the shelf would grow with nothing taken from anywhere.
  if p_from is null or p_to is null then raise exception 'bad_location'; end if;
  if p_from = p_to then raise exception 'same_location'; end if;
  select * into p from products where id = p_product;
  if not found then raise exception 'no_such_product'; end if;
  perform i_check_qty(p.unit, p_qty);
  -- Both shelves, in the same order every time, so transfers in opposite directions can't freeze each other.
  insert into stock_balances (product_id, location_id, qty) values (p_product, p_to, 0) on conflict do nothing;
  perform 1 from stock_balances where product_id = p_product and location_id in (p_from, p_to) order by location_id for update;
  if p.tracking = 'serial' then
    if coalesce(array_length(p_serials, 1), 0) <> p_qty then raise exception 'serial_required'; end if;
    foreach s in array p_serials loop
      select * into u from serial_units where serial = upper(trim(s)) and product_id = p_product for update;
      if not found or u.status <> 'in_stock' or u.location_id <> p_from then raise exception 'serial_not_here: %', s; end if;
      update serial_units set location_id = p_to where id = u.id;
      insert into stock_movements (product_id, from_location, to_location, qty, serial_id, reason, actor)
      values (p_product, p_from, p_to, 1, u.id, 'transfer', me);
    end loop;
  else
    insert into stock_movements (product_id, from_location, to_location, qty, reason, actor)
    values (p_product, p_from, p_to, p_qty, 'transfer', me);
  end if;
end $$;

-- Tells the person packing which units to take: oldest first, so shelf stock never goes flat.
create function oldest_serials(p_product uuid, p_location uuid, p_count int) returns table (serial text, made_on date, received_on date)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform require_staff(array['counter', 'storekeeper', 'dispatcher']::staff_role[]);
  return query
    select u.serial, u.made_on, u.received_on from serial_units u
    where u.product_id = p_product and u.location_id = p_location and u.status = 'in_stock'
    order by coalesce(u.made_on, u.received_on), u.received_on, u.serial limit least(p_count, 20);
end $$;

-- Anyone may check a serial. It says nothing about who owns the unit.
create function check_serial(p_serial text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select jsonb_build_object('found', true, 'product', p.name, 'sold_on', u.sold_on, 'warranty_ends_on', u.warranty_ends_on, 'sold', u.status = 'sold')
    from serial_units u join products p on p.id = u.product_id
    where u.serial = upper(trim(p_serial))
  ), jsonb_build_object('found', false));
$$;

-- Blind counts: the expected number is saved beside the count, and only an owner decision changes stock.
create type count_status as enum ('submitted', 'approved', 'rejected');

create table stock_counts (
  id uuid primary key default gen_random_uuid(),
  client_key text not null unique,
  client_hash text,
  location_id uuid not null references locations(id),
  counted_on date not null default shop_today(),
  status count_status not null default 'submitted',
  counted_by uuid,
  decided_by uuid,
  reason text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table stock_count_lines (
  count_id uuid not null references stock_counts(id),
  product_id uuid not null references products(id),
  expected numeric(14,3) not null,
  counted numeric(14,3) not null check (counted >= 0),
  primary key (count_id, product_id)
);

create function submit_stock_count(p_key text, p_location uuid, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['storekeeper']::staff_role[]);
  c uuid;
  l jsonb;
  pr products;
  v_expected numeric;
  v_counted numeric;
  v_hash text := md5(coalesce(p_location::text, '') || coalesce(p_lines::text, ''));
  v_seen text;
begin
  perform i_require_key(p_key);
  insert into stock_counts (client_key, client_hash, location_id, counted_by) values (p_key, v_hash, p_location, me)
  on conflict (client_key) do nothing returning id into c;
  if c is null then
    select id, client_hash into c, v_seen from stock_counts where client_key = p_key;
    if v_seen is distinct from v_hash then raise exception 'key_reused'; end if;
    return c;
  end if;
  for l in select * from jsonb_array_elements(p_lines) order by (value ->> 'product_id')::uuid loop
    select * into pr from products where id = (l ->> 'product_id')::uuid;
    if not found then raise exception 'no_such_product'; end if;
    if pr.tracking = 'serial' then raise exception 'serial_count_not_supported_yet: %', pr.sku; end if;
    -- Checked before the row is built, so a refusal can't quote the expected figure back to the person counting.
    v_counted := (l ->> 'counted')::numeric;
    perform i_check_qty(pr.unit, v_counted, true);
    select coalesce(qty, 0) into v_expected from stock_balances where product_id = pr.id and location_id = p_location for share;
    insert into stock_count_lines (count_id, product_id, expected, counted) values (c, pr.id, coalesce(v_expected, 0), v_counted);
  end loop;
  return c;
end $$;

-- A typed 1000 instead of 10 must be refusable, or it could only be approved or block the month close for ever.
create function reject_stock_count(p_count uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array[]::staff_role[]);
  c stock_counts;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  select * into c from stock_counts where id = p_count for update;
  if not found then raise exception 'no_such_count'; end if;
  if c.status <> 'submitted' then raise exception 'count_already_decided'; end if;
  update stock_counts set status = 'rejected', decided_by = me, decided_at = now(), reason = p_reason where id = p_count;
  perform i_audit(me, 'reject_stock_count', 'stock_count', p_count::text, jsonb_build_object('reason', p_reason));
end $$;

create function approve_stock_count(p_count uuid, p_on date default shop_today()) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array[]::staff_role[]);
  c stock_counts;
  l record;
  d numeric;
  v bigint;
  net bigint := 0;
  cc product_costs;
begin
  select * into c from stock_counts where id = p_count for update;
  if not found then raise exception 'no_such_count'; end if;
  if c.status <> 'submitted' then raise exception 'count_already_decided'; end if;
  for l in select cl.*, p.tracking from stock_count_lines cl join products p on p.id = cl.product_id
           where cl.count_id = p_count and cl.counted <> cl.expected order by cl.product_id loop
    if l.tracking = 'serial' then raise exception 'serial_count_not_supported_yet'; end if;
    -- Two counts of the same shelf taken before either was approved would take the same loss twice.
    if exists (select 1 from stock_count_lines x join stock_counts sc on sc.id = x.count_id
               where x.product_id = l.product_id and sc.location_id = c.location_id and sc.status = 'approved'
                 and sc.decided_at >= c.created_at and x.counted <> x.expected) then
      raise exception 'count_out_of_date: recount this shelf';
    end if;
    d := l.counted - l.expected;
    if d < 0 then
      insert into stock_movements (product_id, from_location, qty, reason, ref_type, ref_id, actor)
      values (l.product_id, c.location_id, -d, 'count_loss', 'stock_count', p_count, me);
      v := i_take_value(l.product_id, -d);
      net := net - v;
    else
      insert into stock_movements (product_id, to_location, qty, reason, ref_type, ref_id, actor)
      values (l.product_id, c.location_id, d, 'count_gain', 'stock_count', p_count, me);
      select * into cc from product_costs where product_id = l.product_id for update;
      v := round(case when cc.on_hand > 0 then cc.value_kobo * d / cc.on_hand else coalesce(cc.last_cost_kobo, 0) * d end)::bigint;
      perform i_add_value(l.product_id, d, v);
      net := net + v;
    end if;
  end loop;
  update stock_counts set status = 'approved', decided_by = me, decided_at = now() where id = p_count;
  if net <> 0 then
    perform i_post_txn('stock_count', 'Stock count difference', p_on,
      jsonb_build_array(jsonb_build_object('account', 'stock', 'amount', net), jsonb_build_object('account', 'stock_differences', 'amount', -net)),
      'stock_count', p_count, 'count:' || p_count, me);
  end if;
  perform i_audit(me, 'approve_stock_count', 'stock_count', p_count::text, jsonb_build_object('value_change', net));
  return net;
end $$;
