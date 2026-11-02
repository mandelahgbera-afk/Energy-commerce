-- Power Store core, part 4: selling and money.
-- An order runs on two separate tracks: money taken (paid_kobo) and goods handed over (billed_kobo).
-- Money ahead of goods is a debt to the customer ("goods we owe"). It only becomes a sale when goods leave.
-- Goods ahead of money is a debt from the customer, allowed only on credit.
-- Prices include VAT, because the customer pays the price they were told.
-- Lock order everywhere: order, payment, customer, stock by product id, then document numbers. It stops sellers deadlocking.

-- Small setup functions, so even these writes are role-checked and audited.
create function save_staff(p_user uuid, p_name text, p_role staff_role, p_discount_limit numeric default 0, p_active boolean default true) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array[]::staff_role[]);
begin
  if p_user = me and (p_role <> 'owner' or not p_active) then raise exception 'cannot_remove_own_access'; end if;
  insert into staff (id, name, role, discount_limit_pct, active) values (p_user, p_name, p_role, p_discount_limit, p_active)
  on conflict (id) do update set name = excluded.name, role = excluded.role, discount_limit_pct = excluded.discount_limit_pct, active = excluded.active;
  perform i_audit(me, 'save_staff', 'staff', p_user::text, jsonb_build_object('role', p_role, 'discount_limit', p_discount_limit, 'active', p_active));
end $$;

create function save_location(p_name text, p_kind location_kind default 'shop') returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array[]::staff_role[]);
  v_id uuid;
begin
  insert into locations (name, kind) values (p_name, p_kind)
  on conflict (name) do update set kind = excluded.kind returning id into v_id;
  return v_id;
end $$;

create function save_supplier(p_name text, p_phone text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['accountant', 'storekeeper']::staff_role[]);
  v_id uuid;
begin
  insert into suppliers (name, phone) values (p_name, p_phone)
  on conflict (name) do update set phone = coalesce(excluded.phone, suppliers.phone) returning id into v_id;
  return v_id;
end $$;

create function save_customer(p_phone text, p_name text default null, p_email text default null, p_reminders_ok boolean default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter', 'dispatcher', 'accountant']::staff_role[]);
  v_id uuid;
begin
  insert into customers (phone, name, email, reminders_ok)
  values (normalize_phone(p_phone), p_name, lower(p_email), coalesce(p_reminders_ok, false))
  on conflict (phone) do update set name = coalesce(excluded.name, customers.name), email = coalesce(excluded.email, customers.email),
    reminders_ok = coalesce(p_reminders_ok, customers.reminders_ok)
  returning id into v_id;
  return v_id;
end $$;

-- Trade pricing and credit are the owner's decisions, so counter staff can't grant them to a friend.
create function set_customer_terms(p_customer uuid, p_kind customer_kind, p_credit_limit bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array[]::staff_role[]);
begin
  if p_credit_limit < 0 then raise exception 'bad_amount'; end if;
  update customers set kind = p_kind, credit_limit_kobo = p_credit_limit where id = p_customer;
  if not found then raise exception 'no_such_customer'; end if;
  perform i_audit(me, 'set_customer_terms', 'customer', p_customer::text, jsonb_build_object('kind', p_kind, 'credit_limit', p_credit_limit));
end $$;

create function i_customer_owes(p_customer uuid) returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(amount_kobo), 0)::bigint from ledger_entries where account_code = 'customers_owe' and customer_id = p_customer;
$$;

-- Tills. The counted figure is typed in blind, and the expected figure is never returned to the person counting.
create type till_status as enum ('open', 'closed');

create table till_sessions (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff(id),
  opened_on date not null default shop_today(),
  opened_at timestamptz not null default now(),
  float_kobo bigint not null check (float_kobo >= 0),
  status till_status not null default 'open',
  expected_kobo bigint,
  counted_kobo bigint,
  difference_kobo bigint,
  closed_at timestamptz,
  closed_by uuid,
  txn_id uuid references ledger_txns(id)
);
create unique index one_open_till on till_sessions (staff_id) where status = 'open';

create table till_paid_outs (
  id uuid primary key default gen_random_uuid(),
  client_key text not null unique,
  session_id uuid not null references till_sessions(id),
  account_code text not null references ledger_accounts(code),
  amount_kobo bigint not null check (amount_kobo > 0),
  what text not null,
  txn_id uuid not null references ledger_txns(id),
  actor uuid,
  created_at timestamptz not null default now()
);
create index till_paid_outs_session on till_paid_outs (session_id);

create type order_channel as enum ('counter', 'phone', 'online');
create type goods_status as enum ('waiting', 'part_delivered', 'delivered', 'cancelled');

create table orders (
  id uuid primary key default gen_random_uuid(),
  client_key text not null unique,
  client_hash text,
  is_opening boolean not null default false,
  invoice_no text unique,
  receipt_token uuid not null default gen_random_uuid() unique,
  customer_id uuid references customers(id),
  location_id uuid references locations(id),
  channel order_channel not null default 'counter',
  on_credit boolean not null default false,
  list_total_kobo bigint not null default 0,
  total_kobo bigint not null default 0 check (total_kobo >= 0),
  vat_kobo bigint not null default 0,
  paid_kobo bigint not null default 0 check (paid_kobo >= 0),
  billed_kobo bigint not null default 0 check (billed_kobo >= 0),
  money_status text generated always as (
    case when paid_kobo = 0 then 'unpaid' when paid_kobo < total_kobo then 'part_paid' when paid_kobo = total_kobo then 'paid' else 'overpaid' end
  ) stored,
  goods_status goods_status not null default 'waiting',
  needs_approval boolean not null default false,
  credit_approved_by uuid,
  hold_until timestamptz,
  hold_lapsed boolean not null default false,
  note text,
  created_by uuid,
  created_on date not null,
  created_at timestamptz not null default now(),
  check (billed_kobo <= total_kobo),
  check (not on_credit or customer_id is not null)
);
create index orders_customer on orders (customer_id) where customer_id is not null;
create index orders_holds on orders (hold_until) where hold_until is not null;
create index orders_open on orders (created_on) where goods_status in ('waiting', 'part_delivered');
create index orders_debts on orders (customer_id) where billed_kobo > paid_kobo;

create table order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  product_id uuid not null references products(id),
  qty numeric(14,3) not null check (qty > 0),
  list_price_kobo bigint not null,
  unit_price_kobo bigint not null check (unit_price_kobo >= 0),
  vat_rate_bp int not null,
  line_total_kobo bigint not null,
  line_vat_kobo bigint not null,
  delivered_qty numeric(14,3) not null default 0,
  reserved_qty numeric(14,3) not null default 0 check (reserved_qty >= 0),
  billed_kobo bigint not null default 0,
  billed_vat_kobo bigint not null default 0,
  unique (order_id, product_id),
  check (delivered_qty + reserved_qty <= qty)
);
create index order_lines_product on order_lines (product_id);

-- Kept apart from order_lines so that a counter login cannot read profit on a sale.
create table order_line_costs (
  line_id uuid primary key references order_lines(id),
  cost_kobo bigint not null default 0
);

create table deliveries (
  id uuid primary key default gen_random_uuid(),
  client_key text not null unique,
  client_hash text,
  order_id uuid not null references orders(id),
  delivered_on date not null,
  billed_kobo bigint not null default 0,
  txn_id uuid references ledger_txns(id),
  actor uuid,
  created_at timestamptz not null default now()
);
create index deliveries_order on deliveries (order_id);

create table order_line_serials (
  serial_id uuid primary key references serial_units(id),
  line_id uuid not null references order_lines(id)
);
create index order_line_serials_line on order_line_serials (line_id);

create table bank_lines (
  id uuid primary key default gen_random_uuid(),
  client_key text not null unique,
  occurred_on date not null,
  amount_kobo bigint not null check (amount_kobo > 0),
  matched_kobo bigint not null default 0,
  reference text,
  narration text,
  added_by uuid,
  created_at timestamptz not null default now(),
  check (matched_kobo between 0 and amount_kobo)
);

create type payment_method as enum ('cash', 'pos', 'transfer', 'gateway');
create type payment_status as enum ('pending', 'confirmed', 'rejected', 'reversed');
create type payment_kind as enum ('payment', 'refund');

create table payments (
  id uuid primary key default gen_random_uuid(),
  client_key text not null unique,
  order_id uuid not null references orders(id),
  kind payment_kind not null default 'payment',
  method payment_method not null,
  amount_kobo bigint not null check (amount_kobo > 0),
  status payment_status not null default 'pending',
  reference text,
  receipt_no text unique,
  till_session_id uuid references till_sessions(id),
  bank_line_id uuid references bank_lines(id),
  recorded_on date not null,
  recorded_by uuid,
  decided_by uuid,
  decided_at timestamptz,
  reason text,
  txn_id uuid references ledger_txns(id),
  created_at timestamptz not null default now()
);
create index payments_order on payments (order_id);
create index payments_till on payments (till_session_id) where till_session_id is not null;
create index payments_pending on payments (recorded_on) where status = 'pending';
-- The same transfer alert can't be claimed twice.
create unique index payments_reference_once on payments (reference, amount_kobo)
  where method = 'transfer' and kind = 'payment' and reference is not null and status in ('pending', 'confirmed');

create type approval_kind as enum ('discount', 'credit');
create type approval_status as enum ('pending', 'approved', 'rejected');

create table approvals (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  kind approval_kind not null,
  asked_by uuid,
  detail jsonb not null default '{}',
  status approval_status not null default 'pending',
  decided_by uuid,
  decided_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  unique (order_id, kind)
);
create index approvals_pending on approvals (created_at) where status = 'pending';

-- What the customers_owe and goods_owed accounts must move by when an order's paid or billed figure changes.
create function i_balance_lines(o orders, p_paid bigint, p_billed bigint) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select jsonb_build_array(
    jsonb_build_object('account', 'customers_owe', 'customer_id', o.customer_id,
      'amount', greatest(p_billed - p_paid, 0) - greatest(o.billed_kobo - o.paid_kobo, 0)),
    jsonb_build_object('account', 'goods_owed', 'customer_id', o.customer_id,
      'amount', greatest(o.paid_kobo - o.billed_kobo, 0) - greatest(p_paid - p_billed, 0)));
$$;

create function i_release_holds(p_order uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  li order_lines;
  v_location uuid;
begin
  select location_id into v_location from orders where id = p_order;
  for li in select * from order_lines where order_id = p_order and reserved_qty > 0 order by product_id loop
    perform i_unreserve(li.product_id, v_location, li.reserved_qty);
    update order_lines set reserved_qty = 0 where id = li.id;
  end loop;
end $$;

create function i_cancel_order(p_actor uuid, p_order uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform i_release_holds(p_order);
  update orders set goods_status = 'cancelled', needs_approval = false, hold_until = null, hold_lapsed = false where id = p_order;
  update approvals set status = 'rejected', decided_by = p_actor, decided_at = now(), note = coalesce(note, p_reason)
    where order_id = p_order and status = 'pending';
  perform i_audit(p_actor, 'cancel_order', 'order', p_order::text, jsonb_build_object('reason', p_reason));
end $$;

-- p_lines: [{"product_id": "...", "qty": 2, "unit_price": 1500000}]. Leave unit_price out to use the customer's normal price.
create function i_create_order(
  p_actor uuid, p_key text, p_customer uuid, p_location uuid, p_channel order_channel, p_lines jsonb,
  p_on_credit boolean, p_backorder boolean, p_note text, p_on date
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order uuid;
  cfg shop_settings;
  v_customer customers;
  l jsonb;
  pr products;
  q numeric;
  v_list bigint;
  v_price bigint;
  v_line_total bigint;
  v_line_vat bigint;
  v_held numeric;
  v_line uuid;
  v_last uuid;
  v_list_total bigint := 0;
  v_total bigint := 0;
  v_vat bigint := 0;
  v_role staff_role;
  v_limit_pct numeric;
  v_ask_discount boolean := false;
  v_ask_credit boolean := false;
  v_credit_by uuid;
  v_trade bigint;
  v_hash text := md5(jsonb_build_object('customer', p_customer, 'location', p_location, 'credit', p_on_credit, 'back', p_backorder, 'lines', p_lines)::text);
  v_seen text;
begin
  if p_on_credit and p_customer is null then raise exception 'credit_needs_customer'; end if;
  if p_location is null then raise exception 'bad_location'; end if;
  perform i_require_key(p_key);
  insert into orders (client_key, client_hash, customer_id, location_id, channel, on_credit, note, created_by, created_on)
  values (p_key, v_hash, p_customer, p_location, p_channel, p_on_credit, p_note, p_actor, p_on)
  on conflict (client_key) do nothing returning id into v_order;
  if v_order is null then
    select id, client_hash into v_order, v_seen from orders where client_key = p_key;
    if v_seen is distinct from v_hash then raise exception 'key_reused'; end if;
    return v_order;
  end if;
  if coalesce(jsonb_array_length(p_lines), 0) = 0 then raise exception 'empty_order'; end if;
  select * into cfg from shop_settings;
  select * into v_customer from customers where id = p_customer;
  select role, discount_limit_pct into v_role, v_limit_pct from staff where id = p_actor;
  for l in select * from jsonb_array_elements(p_lines) order by (value ->> 'product_id')::uuid loop
    select * into pr from products where id = (l ->> 'product_id')::uuid and status = 'active';
    if not found then raise exception 'no_such_product'; end if;
    if pr.id = v_last then raise exception 'duplicate_product: %', pr.sku; end if;
    v_last := pr.id;
    q := (l ->> 'qty')::numeric;
    perform i_check_qty(pr.unit, q);
    v_trade := null;
    if v_customer.kind in ('installer', 'business') then
      select trade_price_kobo into v_trade from product_trade_prices where product_id = pr.id;
    end if;
    v_list := coalesce(v_trade, pr.price_kobo);
    v_price := coalesce((l ->> 'unit_price')::bigint, v_list);
    if v_price < 0 then raise exception 'bad_price'; end if;
    -- Judged line by line: an overpriced line must not be able to hide a give-away on another.
    if v_role is distinct from 'owner' and v_price < v_list and (v_list - v_price) * 100.0 / v_list > coalesce(v_limit_pct, 0) then
      v_ask_discount := true;
    end if;
    v_line_total := round(v_price * q)::bigint;
    v_line_vat := round(v_line_total * pr.vat_rate_bp::numeric / (10000 + pr.vat_rate_bp))::bigint;
    v_held := i_reserve_up_to(pr.id, p_location, q);
    if v_held < q and not coalesce(p_backorder, false) then raise exception 'insufficient_stock: %', pr.sku; end if;
    insert into order_lines (order_id, product_id, qty, list_price_kobo, unit_price_kobo, vat_rate_bp, line_total_kobo, line_vat_kobo, reserved_qty)
    values (v_order, pr.id, q, v_list, v_price, pr.vat_rate_bp, v_line_total, v_line_vat, v_held)
    returning id into v_line;
    insert into order_line_costs (line_id) values (v_line);
    v_list_total := v_list_total + round(v_list * q)::bigint;
    v_total := v_total + v_line_total;
    v_vat := v_vat + v_line_vat;
  end loop;
  if v_ask_discount then
    insert into approvals (order_id, kind, asked_by, detail)
    values (v_order, 'discount', p_actor, jsonb_build_object('list_total', v_list_total, 'asked_total', v_total));
  end if;
  if p_on_credit then
    if v_role = 'owner' then
      v_credit_by := p_actor;
    elsif i_customer_owes(p_customer) + v_total > v_customer.credit_limit_kobo then
      v_ask_credit := true;
      insert into approvals (order_id, kind, asked_by, detail)
      values (v_order, 'credit', p_actor, jsonb_build_object('owes', i_customer_owes(p_customer), 'limit', v_customer.credit_limit_kobo, 'asked_total', v_total));
    end if;
  end if;
  update orders set list_total_kobo = v_list_total, total_kobo = v_total, vat_kobo = v_vat,
    needs_approval = v_ask_discount or v_ask_credit, credit_approved_by = v_credit_by,
    hold_until = now() + make_interval(hours => cfg.hold_unpaid_hours),
    invoice_no = i_next_doc('INV', p_on)
  where id = v_order;
  perform i_audit(p_actor, 'create_order', 'order', v_order::text, jsonb_build_object('total', v_total, 'list_total', v_list_total));
  return v_order;
end $$;

-- Turns a payment that is already on file into money in the books.
create function i_apply_payment(p_actor uuid, p_payment uuid, p_on date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pay payments;
  o orders;
  cfg shop_settings;
  v_paid bigint;
  v_txn uuid;
begin
  select * into pay from payments where id = p_payment;
  select * into o from orders where id = pay.order_id;
  select * into cfg from shop_settings;
  v_paid := o.paid_kobo + pay.amount_kobo;
  v_txn := i_post_txn('payment', 'Payment for ' || o.invoice_no, p_on,
    jsonb_build_array(jsonb_build_object('account', case when pay.method = 'cash' then 'cash' else 'bank' end, 'amount', pay.amount_kobo))
      || i_balance_lines(o, v_paid, o.billed_kobo),
    'payment', pay.id, 'payment:' || pay.id, p_actor);
  update orders set paid_kobo = v_paid,
    hold_until = case when hold_until is null then null else greatest(hold_until, now() + make_interval(days => cfg.hold_deposit_days)) end
  where id = o.id;
  update payments set status = 'confirmed', decided_by = p_actor, decided_at = now(), txn_id = v_txn, receipt_no = i_next_doc('RCT', p_on)
  where id = pay.id;
end $$;

create function i_take_payment(p_actor uuid, p_key text, p_order uuid, p_method payment_method, p_amount bigint, p_reference text, p_on date) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o orders;
  v_id uuid;
  v_till uuid;
  v_seen payments;
  v_ref text := nullif(upper(trim(p_reference)), '');
begin
  perform i_require_key(p_key);
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'no_such_order'; end if;
  select * into v_seen from payments where client_key = p_key;
  if found then
    if v_seen.order_id <> p_order or v_seen.kind <> 'payment' or v_seen.method is distinct from p_method or v_seen.amount_kobo is distinct from p_amount then
      raise exception 'key_reused';
    end if;
    return v_seen.id;
  end if;
  if o.goods_status = 'cancelled' then raise exception 'order_cancelled'; end if;
  if o.needs_approval then raise exception 'awaiting_approval'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'bad_amount'; end if;
  if p_method = 'gateway' then raise exception 'gateway_not_connected'; end if;
  -- Cash and card can't overpay: the extra is change. A transfer can, because the money has already arrived.
  if p_method in ('cash', 'pos') and p_amount > o.total_kobo - o.paid_kobo then raise exception 'more_than_owed'; end if;
  if p_method = 'cash' then
    select id into v_till from till_sessions where staff_id = p_actor and status = 'open' for share;
    if not found then raise exception 'till_not_open'; end if;
  end if;
  if p_method = 'transfer' and v_ref is not null and exists (
    select 1 from payments where method = 'transfer' and kind = 'payment' and reference = v_ref and amount_kobo = p_amount and status in ('pending', 'confirmed')
  ) then
    raise exception 'reference_already_used: %', v_ref;
  end if;
  insert into payments (client_key, order_id, method, amount_kobo, reference, till_session_id, recorded_on, recorded_by)
  values (p_key, p_order, p_method, p_amount, v_ref, v_till, p_on, p_actor)
  returning id into v_id;
  -- A transfer stays pending until someone sees the money in the bank. An alert on a phone proves nothing.
  if p_method <> 'transfer' then perform i_apply_payment(p_actor, v_id, p_on); end if;
  return v_id;
end $$;

-- p_lines: [{"product_id": "...", "qty": 1, "serials": ["AB12"]}]. Null means everything left, for goods without serial numbers.
create function i_deliver(p_actor uuid, p_key text, p_order uuid, p_lines jsonb, p_on date) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o orders;
  v_delivery uuid;
  li order_lines;
  pr products;
  req jsonb;
  q numeric;
  v_from_hold numeric;
  v_serial text;
  u serial_units;
  v_cost bigint;
  v_line_after bigint;
  v_vat_after bigint;
  v_total bigint := 0;
  v_vat bigint := 0;
  v_costs bigint := 0;
  v_done int := 0;
  v_billed bigint;
  v_limit bigint;
  v_txn uuid;
  v_seen deliveries;
  v_hash text := md5(coalesce(p_lines::text, ''));
begin
  perform i_require_key(p_key);
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'no_such_order'; end if;
  select * into v_seen from deliveries where client_key = p_key;
  if found then
    if v_seen.order_id <> p_order or v_seen.client_hash is distinct from v_hash then raise exception 'key_reused'; end if;
    return v_seen.id;
  end if;
  if o.goods_status = 'cancelled' then raise exception 'order_cancelled'; end if;
  if o.needs_approval then raise exception 'awaiting_approval'; end if;
  -- Two credit deliveries for one customer wait for each other, so together they can't pass the limit.
  -- This lock is the kind that lets ordinary sales to the same customer carry on.
  if o.on_credit then
    perform 1 from customers where id = o.customer_id for no key update;
  end if;
  insert into deliveries (client_key, client_hash, order_id, delivered_on, actor) values (p_key, v_hash, p_order, p_on, p_actor) returning id into v_delivery;
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
    perform 1 from stock_balances where product_id = li.product_id and location_id = o.location_id for update;
    v_from_hold := least(li.reserved_qty, q);
    if v_from_hold > 0 then perform i_unreserve(li.product_id, o.location_id, v_from_hold); end if;
    if pr.tracking = 'serial' then
      if coalesce(jsonb_array_length(req -> 'serials'), 0) <> q then raise exception 'serial_required: %', pr.sku; end if;
      for v_serial in select upper(trim(value)) from jsonb_array_elements_text(req -> 'serials') order by 1 loop
        select * into u from serial_units where serial = v_serial and product_id = li.product_id for update;
        if not found or u.status <> 'in_stock' or u.location_id is distinct from o.location_id then
          raise exception 'serial_not_available: %', v_serial;
        end if;
        update serial_units set status = 'sold', location_id = null, sold_on = p_on, customer_id = o.customer_id,
          warranty_ends_on = case when pr.warranty_months > 0 then (p_on + make_interval(months => pr.warranty_months))::date end
        where id = u.id;
        insert into stock_movements (product_id, from_location, qty, serial_id, reason, ref_type, ref_id, actor)
        values (li.product_id, o.location_id, 1, u.id, 'sold', 'delivery', v_delivery, p_actor);
        insert into order_line_serials (serial_id, line_id) values (u.id, li.id);
      end loop;
    else
      insert into stock_movements (product_id, from_location, qty, reason, ref_type, ref_id, actor)
      values (li.product_id, o.location_id, q, 'sold', 'delivery', v_delivery, p_actor);
    end if;
    v_cost := i_take_value(li.product_id, q);
    update order_line_costs set cost_kobo = cost_kobo + v_cost where line_id = li.id;
    -- Part deliveries bill by running total, so three deliveries of a third still add up to the exact line price.
    v_line_after := round(li.line_total_kobo * (li.delivered_qty + q) / li.qty)::bigint;
    v_vat_after := round(li.line_vat_kobo * (li.delivered_qty + q) / li.qty)::bigint;
    v_total := v_total + v_line_after - li.billed_kobo;
    v_vat := v_vat + v_vat_after - li.billed_vat_kobo;
    v_costs := v_costs + v_cost;
    v_done := v_done + 1;
    update order_lines set delivered_qty = delivered_qty + q, reserved_qty = reserved_qty - v_from_hold,
      billed_kobo = v_line_after, billed_vat_kobo = v_vat_after
    where id = li.id;
  end loop;
  if v_done = 0 then raise exception 'nothing_to_deliver'; end if;
  if p_lines is not null and jsonb_array_length(p_lines) <> v_done then raise exception 'line_not_on_order'; end if;
  v_billed := o.billed_kobo + v_total;
  if v_billed > o.paid_kobo then
    if not o.on_credit then raise exception 'payment_required: % short', v_billed - o.paid_kobo; end if;
    if o.credit_approved_by is null then
      select credit_limit_kobo into v_limit from customers where id = o.customer_id;
      if i_customer_owes(o.customer_id) + (v_billed - o.paid_kobo) - greatest(o.billed_kobo - o.paid_kobo, 0) > v_limit then
        raise exception 'over_credit_limit';
      end if;
    end if;
  end if;
  if v_total <> 0 or v_costs <> 0 then
    v_txn := i_post_txn('sale', 'Goods delivered: ' || o.invoice_no, p_on,
      jsonb_build_array(
        jsonb_build_object('account', 'sales', 'amount', -(v_total - v_vat)),
        jsonb_build_object('account', 'vat_payable', 'amount', -v_vat),
        jsonb_build_object('account', 'cogs', 'amount', v_costs),
        jsonb_build_object('account', 'stock', 'amount', -v_costs)
      ) || i_balance_lines(o, o.paid_kobo, v_billed),
      'delivery', v_delivery, 'delivery:' || v_delivery, p_actor);
  end if;
  update deliveries set billed_kobo = v_total, txn_id = v_txn where id = v_delivery;
  update orders set billed_kobo = v_billed,
    goods_status = case when exists (select 1 from order_lines where order_id = p_order and delivered_qty < qty) then 'part_delivered'::goods_status else 'delivered'::goods_status end
  where id = p_order;
  update orders set hold_until = null where id = p_order and goods_status = 'delivered';
  perform i_audit(p_actor, 'deliver', 'order', p_order::text, jsonb_build_object('delivery', v_delivery, 'billed', v_total));
  return v_delivery;
end $$;

-- The screens call these.
create function create_order(
  p_key text, p_location uuid, p_lines jsonb, p_phone text default null, p_name text default null,
  p_channel order_channel default 'counter', p_on_credit boolean default false, p_backorder boolean default false, p_note text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter']::staff_role[]);
  v_customer uuid;
begin
  if p_phone is not null then v_customer := i_customer_for_phone(p_phone, p_name); end if;
  return i_create_order(me, p_key, v_customer, p_location, p_channel, p_lines, p_on_credit, p_backorder, p_note, shop_today());
end $$;

create function take_payment(p_key text, p_order uuid, p_method payment_method, p_amount bigint, p_reference text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter', 'accountant']::staff_role[]);
begin
  return i_take_payment(me, p_key, p_order, p_method, p_amount, p_reference, shop_today());
end $$;

create function deliver_order(p_key text, p_order uuid, p_lines jsonb default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter', 'storekeeper', 'dispatcher']::staff_role[]);
begin
  return i_deliver(me, p_key, p_order, p_lines, shop_today());
end $$;

-- The whole walk-in sale as one tap. It all happens or none of it does, and retrying with the same key changes nothing.
create function counter_sale(
  p_key text, p_location uuid, p_lines jsonb, p_method payment_method default 'cash',
  p_phone text default null, p_name text default null, p_reference text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter']::staff_role[]);
  v_customer uuid;
  v_order uuid;
  o orders;
  v_state text := 'done';
begin
  if p_phone is not null then v_customer := i_customer_for_phone(p_phone, p_name); end if;
  v_order := i_create_order(me, p_key, v_customer, p_location, 'counter', p_lines, false, false, null, shop_today());
  select * into o from orders where id = v_order;
  if o.needs_approval then
    v_state := 'awaiting_approval';
  else
    if o.total_kobo > 0 then perform i_take_payment(me, p_key || ':pay', v_order, p_method, o.total_kobo, p_reference, shop_today()); end if;
    if p_method = 'transfer' then
      v_state := 'awaiting_transfer';
    else
      perform i_deliver(me, p_key || ':go', v_order, p_lines, shop_today());
    end if;
  end if;
  return jsonb_build_object('order_id', v_order, 'invoice_no', o.invoice_no, 'total', o.total_kobo, 'state', v_state);
end $$;

create function add_bank_line(p_key text, p_on date, p_amount bigint, p_reference text default null, p_narration text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['accountant']::staff_role[]);
  v_id uuid;
  v_seen bank_lines;
begin
  insert into bank_lines (client_key, occurred_on, amount_kobo, reference, narration, added_by)
  values (p_key, p_on, p_amount, p_reference, p_narration, me)
  on conflict (client_key) do nothing returning id into v_id;
  if v_id is null then
    select * into v_seen from bank_lines where client_key = p_key;
    if v_seen.amount_kobo is distinct from p_amount or v_seen.occurred_on is distinct from p_on then raise exception 'key_reused'; end if;
    return v_seen.id;
  end if;
  return v_id;
end $$;

-- A second person confirms a transfer against the statement. Only the owner may vouch for one without a statement line.
create function confirm_payment(p_payment uuid, p_bank_line uuid default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['accountant']::staff_role[]);
  v_order uuid;
  pay payments;
  bl bank_lines;
  v_role staff_role;
begin
  select order_id into v_order from payments where id = p_payment;
  if not found then raise exception 'no_such_payment'; end if;
  perform 1 from orders where id = v_order for update;
  select * into pay from payments where id = p_payment for update;
  if pay.status <> 'pending' then raise exception 'payment_already_decided'; end if;
  select role into v_role from staff where id = me;
  if pay.recorded_by = me and v_role <> 'owner' then raise exception 'cannot_confirm_own_payment'; end if;
  if p_bank_line is null then
    if v_role <> 'owner' then raise exception 'bank_line_required'; end if;
  else
    select * into bl from bank_lines where id = p_bank_line for update;
    if not found then raise exception 'no_such_bank_line'; end if;
    if bl.matched_kobo + pay.amount_kobo > bl.amount_kobo then raise exception 'bank_line_used_up'; end if;
    update bank_lines set matched_kobo = matched_kobo + pay.amount_kobo where id = p_bank_line;
    update payments set bank_line_id = p_bank_line where id = p_payment;
  end if;
  perform i_apply_payment(me, p_payment, coalesce(bl.occurred_on, shop_today()));
  perform i_audit(me, 'confirm_payment', 'payment', p_payment::text, jsonb_build_object('bank_line', p_bank_line));
end $$;

create function reject_payment(p_payment uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['accountant']::staff_role[]);
  v_order uuid;
  pay payments;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  select order_id into v_order from payments where id = p_payment;
  if not found then raise exception 'no_such_payment'; end if;
  perform 1 from orders where id = v_order for update;
  select * into pay from payments where id = p_payment for update;
  if pay.status <> 'pending' then raise exception 'payment_already_decided'; end if;
  update payments set status = 'rejected', decided_by = me, decided_at = now(), reason = p_reason where id = p_payment;
  perform i_audit(me, 'reject_payment', 'payment', p_payment::text, jsonb_build_object('reason', p_reason));
end $$;

-- Bounced or wrongly confirmed money comes back out. If the goods have gone, the customer now owes it.
create function reverse_payment(p_payment uuid, p_reason text, p_on date default shop_today()) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array[]::staff_role[]);
  v_order uuid;
  pay payments;
  o orders;
  v_paid bigint;
  v_txn uuid;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  select order_id into v_order from payments where id = p_payment;
  if not found then raise exception 'no_such_payment'; end if;
  select * into o from orders where id = v_order for update;
  select * into pay from payments where id = p_payment for update;
  if pay.kind <> 'payment' or pay.status <> 'confirmed' then raise exception 'cannot_reverse_this_payment'; end if;
  if p_on < pay.recorded_on then raise exception 'bad_date'; end if;
  if o.paid_kobo < pay.amount_kobo then raise exception 'already_refunded'; end if;
  v_paid := o.paid_kobo - pay.amount_kobo;
  v_txn := i_post_txn('payment_reversal', 'Reversal of payment for ' || o.invoice_no, p_on,
    jsonb_build_array(jsonb_build_object('account', case when pay.method = 'cash' then 'cash' else 'bank' end, 'amount', -pay.amount_kobo))
      || i_balance_lines(o, v_paid, o.billed_kobo),
    'payment', pay.id, 'payment_reversal:' || pay.id, me, pay.txn_id, p_reason);
  update orders set paid_kobo = v_paid where id = o.id;
  update payments set status = 'reversed', reason = p_reason where id = pay.id;
  if pay.bank_line_id is not null then
    update bank_lines set matched_kobo = matched_kobo - pay.amount_kobo where id = pay.bank_line_id;
  end if;
  perform i_audit(me, 'reverse_payment', 'payment', p_payment::text, jsonb_build_object('reason', p_reason, 'amount', pay.amount_kobo));
  return v_txn;
end $$;

-- Only money we still hold for goods not yet handed over can be refunded here. Returned goods are a later step.
create function refund_order(p_key text, p_order uuid, p_amount bigint, p_method payment_method, p_reason text, p_on date default shop_today()) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['accountant']::staff_role[]);
  o orders;
  v_id uuid;
  v_paid bigint;
  v_till uuid;
  v_txn uuid;
  v_seen payments;
begin
  perform i_require_key(p_key);
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'no_such_order'; end if;
  select * into v_seen from payments where client_key = p_key;
  if found then
    if v_seen.order_id <> p_order or v_seen.kind <> 'refund' or v_seen.method is distinct from p_method or v_seen.amount_kobo is distinct from p_amount then
      raise exception 'key_reused';
    end if;
    return v_seen.id;
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'bad_amount'; end if;
  if p_method not in ('cash', 'transfer') then raise exception 'bad_refund_method'; end if;
  if p_on < o.created_on then raise exception 'bad_date'; end if;
  if p_amount > o.paid_kobo - o.billed_kobo then raise exception 'refund_more_than_held'; end if;
  -- Cash leaves a drawer someone is counting, or that drawer's count comes up short for no reason.
  if p_method = 'cash' then
    select id into v_till from till_sessions where staff_id = me and status = 'open' for share;
    if not found then raise exception 'till_not_open'; end if;
  end if;
  v_paid := o.paid_kobo - p_amount;
  insert into payments (client_key, order_id, kind, method, amount_kobo, status, till_session_id, recorded_on, recorded_by, decided_by, decided_at, reason)
  values (p_key, p_order, 'refund', p_method, p_amount, 'confirmed', v_till, p_on, me, me, now(), p_reason)
  returning id into v_id;
  v_txn := i_post_txn('refund', 'Refund for ' || o.invoice_no, p_on,
    jsonb_build_array(jsonb_build_object('account', case when p_method = 'cash' then 'cash' else 'bank' end, 'amount', -p_amount))
      || i_balance_lines(o, v_paid, o.billed_kobo),
    'payment', v_id, 'refund:' || v_id, me, null, p_reason);
  update orders set paid_kobo = v_paid where id = o.id;
  update payments set txn_id = v_txn, receipt_no = i_next_doc('RFD', p_on) where id = v_id;
  perform i_audit(me, 'refund_order', 'order', p_order::text, jsonb_build_object('amount', p_amount, 'reason', p_reason));
  return v_id;
end $$;

create function cancel_order(p_order uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter', 'accountant']::staff_role[]);
  o orders;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'no_such_order'; end if;
  if o.goods_status = 'cancelled' then return; end if;
  if o.billed_kobo > 0 or o.goods_status <> 'waiting' then raise exception 'goods_already_left'; end if;
  if o.paid_kobo > 0 then raise exception 'refund_first'; end if;
  if exists (select 1 from payments where order_id = p_order and status = 'pending') then raise exception 'payment_pending'; end if;
  perform i_cancel_order(me, p_order, p_reason);
end $$;

-- Hold stock again after a hold ran out, or once a back-order's goods arrive. Says whether everything is now held.
create function reserve_order(p_order uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter', 'storekeeper', 'dispatcher']::staff_role[]);
  o orders;
  cfg shop_settings;
  li order_lines;
  v_need numeric;
  v_held numeric;
  v_complete boolean := true;
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'no_such_order'; end if;
  if o.goods_status not in ('waiting', 'part_delivered') then raise exception 'order_not_open'; end if;
  select * into cfg from shop_settings;
  for li in select * from order_lines where order_id = p_order order by product_id loop
    v_need := li.qty - li.delivered_qty - li.reserved_qty;
    if v_need > 0 then
      v_held := i_reserve_up_to(li.product_id, o.location_id, v_need);
      if v_held > 0 then update order_lines set reserved_qty = reserved_qty + v_held where id = li.id; end if;
      if v_held < v_need then v_complete := false; end if;
    end if;
  end loop;
  -- Staff can't hold stock for weeks for someone who hasn't paid: an unpaid order only gets the short hold.
  update orders set hold_lapsed = false,
    hold_until = now() + case when o.paid_kobo > 0 then make_interval(days => cfg.hold_deposit_days) else make_interval(hours => cfg.hold_unpaid_hours) end
  where id = p_order;
  return v_complete;
end $$;

-- Runs on a schedule. Unpaid orders are cancelled. Orders with money stay open, but their goods go back on sale and staff are told.
create function expire_holds() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o orders;
  v_n int := 0;
begin
  for o in select * from orders where hold_until < now() and goods_status in ('waiting', 'part_delivered')
           order by hold_until for update skip locked loop
    if exists (select 1 from payments where order_id = o.id and status = 'pending') then
      continue;
    end if;
    -- Only an order with nothing delivered and no money can be cancelled. That includes one whose deposit has since been refunded.
    if o.goods_status = 'waiting' and o.paid_kobo = 0 and o.billed_kobo = 0 then
      perform i_cancel_order(null, o.id, 'Hold ran out');
      v_n := v_n + 1;
    elsif not o.hold_lapsed then
      perform i_release_holds(o.id);
      update orders set hold_lapsed = true where id = o.id;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

create function decide_approval(p_approval uuid, p_yes boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array[]::staff_role[]);
  v_order uuid;
  a approvals;
  cfg shop_settings;
begin
  if p_yes is null then raise exception 'bad_choice'; end if;
  select * into cfg from shop_settings;
  select order_id into v_order from approvals where id = p_approval;
  if not found then raise exception 'no_such_approval'; end if;
  perform 1 from orders where id = v_order for update;
  select * into a from approvals where id = p_approval for update;
  if a.status <> 'pending' then raise exception 'approval_already_decided'; end if;
  update approvals set status = case when p_yes then 'approved'::approval_status else 'rejected'::approval_status end,
    decided_by = me, decided_at = now(), note = p_note
  where id = p_approval;
  if p_yes then
    if a.kind = 'credit' then update orders set credit_approved_by = me where id = v_order; end if;
    -- The customer gets a fresh hold, or a yes given after the hold ran out would be undone by the next expiry run.
    if not exists (select 1 from approvals where order_id = v_order and status = 'pending') then
      update orders set needs_approval = false,
        hold_until = greatest(hold_until, now() + make_interval(hours => cfg.hold_unpaid_hours))
      where id = v_order;
    end if;
  else
    perform i_cancel_order(me, v_order, coalesce(p_note, 'Approval refused'));
  end if;
  perform i_audit(me, 'decide_approval', 'approval', p_approval::text, jsonb_build_object('yes', p_yes, 'note', p_note));
end $$;

create function open_till(p_float bigint) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter', 'accountant']::staff_role[]);
  v_id uuid;
begin
  if p_float < 0 then raise exception 'bad_amount'; end if;
  select id into v_id from till_sessions where staff_id = me and status = 'open';
  if found then raise exception 'till_already_open'; end if;
  insert into till_sessions (staff_id, float_kobo) values (me, p_float) returning id into v_id;
  return v_id;
end $$;

create function my_till() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter', 'accountant']::staff_role[]);
begin
  return (select jsonb_build_object('id', id, 'opened_at', opened_at, 'float', float_kobo) from till_sessions where staff_id = me and status = 'open');
end $$;

-- Cash leaving the drawer during the day, for a running cost or to go to the bank.
create function till_paid_out(p_key text, p_account text, p_amount bigint, p_what text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter', 'accountant']::staff_role[]);
  v_till uuid;
  v_id uuid;
  v_txn uuid;
  v_seen till_paid_outs;
  v_limit bigint;
begin
  perform i_require_key(p_key);
  -- Looked up before the till, so a retry after the till has closed still gets its first answer.
  select * into v_seen from till_paid_outs where client_key = p_key;
  if found then
    if v_seen.amount_kobo is distinct from p_amount or v_seen.account_code is distinct from p_account then raise exception 'key_reused'; end if;
    return v_seen.id;
  end if;
  select id into v_till from till_sessions where staff_id = me and status = 'open' for share;
  if not found then raise exception 'till_not_open'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'bad_amount'; end if;
  if coalesce(trim(p_what), '') = '' then raise exception 'reason_required'; end if;
  if p_account is null or p_account not in ('fuel_delivery', 'other_costs', 'bank') then raise exception 'bad_account'; end if;
  select till_paid_out_limit_kobo into v_limit from shop_settings;
  if p_amount > v_limit and not has_staff_role(array['accountant']::staff_role[]) then raise exception 'over_paid_out_limit'; end if;
  v_txn := i_post_txn('till_paid_out', p_what, shop_today(),
    jsonb_build_array(jsonb_build_object('account', p_account, 'amount', p_amount), jsonb_build_object('account', 'cash', 'amount', -p_amount)),
    'till', v_till, 'paid_out:' || p_key, me);
  insert into till_paid_outs (client_key, session_id, account_code, amount_kobo, what, txn_id, actor)
  values (p_key, v_till, p_account, p_amount, p_what, v_txn, me) returning id into v_id;
  perform i_audit(me, 'till_paid_out', 'till', v_till::text, jsonb_build_object('amount', p_amount, 'what', p_what));
  return v_id;
end $$;

-- The owner or accountant may close someone else's till. Nobody learns the expected figure from this.
create function close_till(p_counted bigint, p_session uuid default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter', 'accountant']::staff_role[]);
  s till_sessions;
  v_expected bigint;
  v_diff bigint;
  v_txn uuid;
begin
  if p_counted is null or p_counted < 0 then raise exception 'bad_amount'; end if;
  if p_session is null then
    select * into s from till_sessions where staff_id = me and status = 'open' for update;
    if not found then raise exception 'till_not_open'; end if;
  else
    if not has_staff_role(array['accountant']::staff_role[]) then raise exception 'not_allowed'; end if;
    select * into s from till_sessions where id = p_session and status = 'open' for update;
    if not found then raise exception 'till_not_open'; end if;
  end if;
  select s.float_kobo
    + coalesce((select sum(case when p.kind = 'payment' then p.amount_kobo else -p.amount_kobo end) from payments p
                where p.till_session_id = s.id and p.method = 'cash' and p.status = 'confirmed'), 0)
    - coalesce((select sum(t.amount_kobo) from till_paid_outs t where t.session_id = s.id), 0)
  into v_expected;
  v_diff := p_counted - v_expected;
  if v_diff <> 0 then
    v_txn := i_post_txn('till_difference', 'Till difference', shop_today(),
      jsonb_build_array(jsonb_build_object('account', 'cash', 'amount', v_diff), jsonb_build_object('account', 'till_differences', 'amount', -v_diff)),
      'till', s.id, 'till:' || s.id, me);
  end if;
  update till_sessions set status = 'closed', expected_kobo = v_expected, counted_kobo = p_counted, difference_kobo = v_diff,
    closed_at = now(), closed_by = me, txn_id = v_txn
  where id = s.id;
  perform i_audit(me, 'close_till', 'till', s.id::text, jsonb_build_object('difference', v_diff));
end $$;

-- A customer's debt from before go-live. It is an order with no lines, so paying it off works like any other order.
create function post_opening_debt(p_key text, p_customer uuid, p_amount bigint, p_on date) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array[]::staff_role[]);
  v_id uuid;
  v_seen orders;
begin
  perform i_require_key(p_key);
  if p_amount is null or p_amount <= 0 then raise exception 'bad_amount'; end if;
  insert into orders (client_key, is_opening, customer_id, on_credit, list_total_kobo, total_kobo, billed_kobo, goods_status, note, created_by, created_on)
  values ('opening_debt:' || p_key, true, p_customer, true, p_amount, p_amount, p_amount, 'delivered', 'Opening balance', me, p_on)
  on conflict (client_key) do nothing returning id into v_id;
  if v_id is null then
    select * into v_seen from orders where client_key = 'opening_debt:' || p_key;
    if v_seen.customer_id is distinct from p_customer or v_seen.total_kobo <> p_amount then raise exception 'key_reused'; end if;
    return v_seen.id;
  end if;
  perform i_require_go_live();
  update orders set invoice_no = i_next_doc('OPN', p_on) where id = v_id;
  perform i_post_txn('opening', 'Opening debt', p_on,
    jsonb_build_array(jsonb_build_object('account', 'customers_owe', 'amount', p_amount, 'customer_id', p_customer),
      jsonb_build_object('account', 'owner_money', 'amount', -p_amount)),
    'order', v_id, 'opening_debt:' || v_id, me);
  return v_id;
end $$;

-- For an opening debt typed wrongly. Nothing paid against it yet, so it can come off cleanly, and the order record moves with the money.
create function void_opening_debt(p_order uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array[]::staff_role[]);
  o orders;
  v_first uuid;
  v_txn uuid;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  select * into o from orders where id = p_order for update;
  if not found or not o.is_opening or o.goods_status = 'cancelled' then raise exception 'not_an_opening_debt'; end if;
  if o.paid_kobo > 0 then raise exception 'payments_exist'; end if;
  select id into v_first from ledger_txns where ref_type = 'order' and ref_id = p_order and reversal_of is null limit 1;
  v_txn := i_post_txn('reversal', 'Opening debt cancelled', shop_today(),
    jsonb_build_array(jsonb_build_object('account', 'customers_owe', 'amount', -o.total_kobo, 'customer_id', o.customer_id),
      jsonb_build_object('account', 'owner_money', 'amount', o.total_kobo)),
    'order', p_order, 'opening_debt_void:' || p_order, me, v_first, p_reason);
  update orders set billed_kobo = 0, total_kobo = 0, list_total_kobo = 0, goods_status = 'cancelled' where id = p_order;
  perform i_audit(me, 'void_opening_debt', 'order', p_order::text, jsonb_build_object('reason', p_reason, 'amount', o.total_kobo));
  return v_txn;
end $$;

create function customer_balance(p_customer uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform require_staff(array['counter', 'accountant']::staff_role[]);
  return (
    select jsonb_build_object('owes', coalesce(sum(greatest(billed_kobo - paid_kobo, 0)), 0), 'holds', coalesce(sum(greatest(paid_kobo - billed_kobo, 0)), 0))
    from orders where customer_id = p_customer and goods_status <> 'cancelled'
  );
end $$;

create function debtors() returns table (customer_id uuid, customer_name text, phone text, owed_kobo bigint, oldest_on date)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform require_staff(array['counter', 'accountant']::staff_role[]);
  return query
    -- A left join, so a walk-in with no name whose payment bounced still shows as money owed.
    select c.id, c.name, c.phone, sum(o.billed_kobo - o.paid_kobo)::bigint, min(o.created_on)
    from orders o left join customers c on c.id = o.customer_id
    where o.billed_kobo > o.paid_kobo
    group by c.id, c.name, c.phone
    order by 4 desc;
end $$;

-- Compares every book against its own detail. Any drift between money, stock and orders shows up here by name.
create function i_books_check() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  problems text[] := '{}';
  a bigint;
  b bigint;
  n bigint;
begin
  select coalesce(sum(amount_kobo), 0) into a from ledger_entries;
  if a <> 0 then problems := problems || format('ledger is off by %s', a); end if;

  select count(*) into n from (select 1 from ledger_entries group by txn_id having sum(amount_kobo) <> 0) x;
  if n > 0 then problems := problems || format('%s unbalanced transactions', n); end if;

  select coalesce(sum(amount_kobo), 0) into a from ledger_entries where account_code = 'stock';
  select coalesce(sum(value_kobo), 0) into b from product_costs;
  if a <> b then problems := problems || format('stock account %s, stock value %s', a, b); end if;

  select count(*) into n from product_costs c
    left join (select product_id, sum(qty) q from stock_balances group by product_id) s using (product_id)
    where c.on_hand <> coalesce(s.q, 0);
  if n > 0 then problems := problems || format('%s products where value quantity and shelves disagree', n); end if;

  select count(*) into n from (
    select product_id, location_id, sum(d) q from (
      select product_id, to_location location_id, qty d from stock_movements where to_location is not null
      union all
      select product_id, from_location, -qty from stock_movements where from_location is not null
    ) m group by 1, 2
  ) moved full join stock_balances b using (product_id, location_id)
  where coalesce(moved.q, 0) <> coalesce(b.qty, 0);
  if n > 0 then problems := problems || format('%s shelves that disagree with their movements', n); end if;

  select count(*) into n from stock_balances b join products p on p.id = b.product_id
    where p.tracking = 'serial' and b.qty <> (select count(*) from serial_units u where u.product_id = b.product_id and u.location_id = b.location_id and u.status = 'in_stock');
  if n > 0 then problems := problems || format('%s shelves that disagree with their serial numbers', n); end if;

  select count(*) into n from stock_balances b
    left join (select l.product_id, o.location_id, sum(l.reserved_qty) q from order_lines l join orders o on o.id = l.order_id group by 1, 2) r using (product_id, location_id)
    where b.reserved <> coalesce(r.q, 0);
  if n > 0 then problems := problems || format('%s shelves whose holds disagree with orders', n); end if;

  select -coalesce(sum(amount_kobo), 0) into a from ledger_entries where account_code = 'goods_owed';
  select coalesce(sum(greatest(paid_kobo - billed_kobo, 0)), 0) into b from orders;
  if a <> b then problems := problems || format('goods owed account %s, orders say %s', a, b); end if;

  select coalesce(sum(amount_kobo), 0) into a from ledger_entries where account_code = 'customers_owe';
  select coalesce(sum(greatest(billed_kobo - paid_kobo, 0)), 0) into b from orders;
  if a <> b then problems := problems || format('customers owe account %s, orders say %s', a, b); end if;

  select count(*) into n from orders o
    where (not o.is_opening and o.billed_kobo <> (select coalesce(sum(billed_kobo), 0) from order_lines l where l.order_id = o.id))
       or o.paid_kobo <> (select coalesce(sum(case when p.kind = 'payment' then p.amount_kobo else -p.amount_kobo end), 0)
                          from payments p where p.order_id = o.id and p.status = 'confirmed');
  if n > 0 then problems := problems || format('%s orders that disagree with their lines or payments', n); end if;

  return jsonb_build_object('ok', cardinality(problems) = 0, 'problems', to_jsonb(problems));
end $$;

create function books_check() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform require_staff(array['accountant']::staff_role[]);
  return i_books_check();
end $$;

-- A month can close only when the books agree, the tills are in, the counts are decided, transfers are settled and the bank statement matches.
create function close_month(p_month date, p_statement_balance bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array[]::staff_role[]);
  v_end date;
  problems text[] := '{}';
  v_check jsonb;
  v_bank bigint;
  v_txns bigint;
begin
  if p_month is null or p_month <> date_trunc('month', p_month)::date then raise exception 'not_a_month_start'; end if;
  if exists (select 1 from closed_periods where month = p_month) then return; end if;
  if p_statement_balance is null then raise exception 'statement_required'; end if;
  v_end := (p_month + interval '1 month')::date;
  if v_end > shop_today() then raise exception 'month_not_finished'; end if;
  -- Every posting holds a share of this row, so holding it alone means nothing is in flight.
  -- It doesn't wait: queueing behind a posting while others queue behind this could freeze the shop.
  begin
    perform 1 from shop_settings for update nowait;
  exception when lock_not_available then
    raise exception 'shop_busy_try_again';
  end;
  if exists (select 1 from ledger_txns t where t.occurred_on < p_month
             and not exists (select 1 from closed_periods c where c.month = date_trunc('month', t.occurred_on)::date)) then
    problems := problems || 'an earlier month is still open'::text;
  end if;
  v_check := i_books_check();
  if not (v_check ->> 'ok')::boolean then problems := problems || 'books disagree'::text; end if;
  if exists (select 1 from till_sessions where status = 'open' and opened_on < v_end) then problems := problems || 'a till is still open'::text; end if;
  if exists (select 1 from stock_counts where status = 'submitted' and counted_on < v_end) then problems := problems || 'a stock count is waiting for a decision'::text; end if;
  if exists (select 1 from payments where status = 'pending' and recorded_on < v_end) then problems := problems || 'a transfer is waiting to be confirmed'::text; end if;
  select coalesce(sum(e.amount_kobo), 0) into v_bank from ledger_entries e join ledger_txns t on t.id = e.txn_id
    where e.account_code = 'bank' and t.occurred_on < v_end;
  if v_bank <> p_statement_balance then problems := problems || format('bank differs from the statement by %s', v_bank - p_statement_balance); end if;
  if cardinality(problems) > 0 then raise exception 'month_not_ready: %', array_to_string(problems, '; '); end if;
  select count(*) into v_txns from ledger_txns where occurred_on >= p_month and occurred_on < v_end;
  insert into closed_periods (month, closed_by) values (p_month, me) on conflict do nothing;
  perform i_audit(me, 'close_month', 'period', p_month::text, jsonb_build_object('statement_balance', p_statement_balance, 'txns_in_month', v_txns));
end $$;

-- What the owner should look at today. Things are listed here rather than blocked, so the counter keeps moving.
create function owner_exceptions() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform require_staff(array['accountant']::staff_role[]);
  return jsonb_build_object(
    'below_cost', (select coalesce(jsonb_agg(jsonb_build_object('invoice_no', o.invoice_no, 'product', p.name, 'sold_for', l.billed_kobo - l.billed_vat_kobo, 'cost', c.cost_kobo)), '[]')
      from order_line_costs c join order_lines l on l.id = c.line_id join orders o on o.id = l.order_id join products p on p.id = l.product_id
      where l.delivered_qty > 0 and c.cost_kobo > l.billed_kobo - l.billed_vat_kobo and o.created_on >= shop_today() - 7),
    'old_transfers', (select coalesce(jsonb_agg(jsonb_build_object('payment', id, 'amount', amount_kobo, 'recorded_on', recorded_on)), '[]')
      from payments where status = 'pending' and created_at < now() - interval '4 hours'),
    'holds_lapsed', (select coalesce(jsonb_agg(jsonb_build_object('invoice_no', invoice_no, 'holds', paid_kobo - billed_kobo)), '[]')
      from orders where hold_lapsed and goods_status in ('waiting', 'part_delivered')),
    'till_differences', (select coalesce(jsonb_agg(jsonb_build_object('staff', staff_id, 'difference', difference_kobo, 'on', opened_on)), '[]')
      from till_sessions where status = 'closed' and difference_kobo <> 0 and opened_on >= shop_today() - 7),
    'low_stock', (select coalesce(jsonb_agg(jsonb_build_object('sku', p.sku, 'name', p.name, 'free', s.free)), '[]')
      from products p join (select product_id, sum(qty - reserved) free from stock_balances group by product_id) s on s.product_id = p.id
      where p.status = 'active' and p.low_stock_at > 0 and s.free <= p.low_stock_at),
    'approvals', (select count(*) from approvals where status = 'pending')
  );
end $$;

-- A private link on a customer's receipt. It shows that one order, and never anything about cost.
create function receipt_by_token(p_token uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'invoice_no', o.invoice_no, 'date', o.created_on, 'customer', c.name, 'total', o.total_kobo, 'vat', o.vat_kobo, 'paid', o.paid_kobo,
    'balance', o.total_kobo - o.paid_kobo, 'money_status', o.money_status, 'goods_status', o.goods_status,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('product', p.name, 'qty', l.qty, 'unit_price', l.unit_price_kobo, 'total', l.line_total_kobo, 'delivered', l.delivered_qty,
        'serials', (select coalesce(jsonb_agg(jsonb_build_object('serial', u.serial, 'warranty_ends_on', u.warranty_ends_on)), '[]')
                    from order_line_serials ls join serial_units u on u.id = ls.serial_id where ls.line_id = l.id))), '[]')
      from order_lines l join products p on p.id = l.product_id where l.order_id = o.id),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('method', pay.method, 'amount', pay.amount_kobo, 'kind', pay.kind, 'receipt_no', pay.receipt_no)), '[]')
      from payments pay where pay.order_id = o.id and pay.status = 'confirmed'))
  from orders o left join customers c on c.id = o.customer_id
  where o.receipt_token = p_token;
$$;

-- What the public store shows: in, low or out, never exact counts.
create function availability(p_products uuid[]) returns table (product_id uuid, state text)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id,
    case when coalesce(s.free, 0) <= 0 then 'out' when coalesce(s.free, 0) <= p.low_stock_at then 'low' else 'in' end
  from products p
  left join (select b.product_id, sum(b.qty - b.reserved) free from stock_balances b where b.product_id = any (p_products) group by b.product_id) s on s.product_id = p.id
  where p.id = any (p_products) and p.status = 'active';
$$;
