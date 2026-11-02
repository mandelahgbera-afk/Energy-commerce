-- Power Store, new work (2026-11-02): quotes.
-- A quote is a price promise on paper: no money moves and no stock is held until it is accepted.
-- Each version is its own record with its own Q number; only the latest version can be accepted,
-- and only before it expires. Acceptance becomes an ordinary order through i_create_order, so
-- discount approvals, VAT rounding and stock rules all apply untouched.

create type quote_status as enum ('sent', 'accepted', 'cancelled');

create table quotes (
  id uuid primary key default gen_random_uuid(),
  root_id uuid references quotes(id),
  version int not null default 1 check (version >= 1),
  client_key text unique,
  client_hash text,
  quote_no text unique,
  customer_id uuid references customers(id),
  location_id uuid not null references locations(id),
  valid_until date not null,
  status quote_status not null default 'sent',
  note text,
  list_total_kobo bigint not null default 0,
  total_kobo bigint not null default 0,
  vat_kobo bigint not null default 0,
  accepted_order_id uuid references orders(id),
  created_by uuid,
  created_on date not null default shop_today(),
  accepted_by uuid,
  accepted_at timestamptz,
  decided_by uuid,
  decided_at timestamptz,
  reason text,
  created_at timestamptz not null default now()
);
create index quotes_customer on quotes (customer_id) where customer_id is not null;

create table quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id),
  product_id uuid not null references products(id),
  qty numeric(14,3) not null check (qty > 0),
  list_price_kobo bigint not null,
  unit_price_kobo bigint not null check (unit_price_kobo >= 0),
  vat_rate_bp int not null,
  line_total_kobo bigint not null,
  line_vat_kobo bigint not null,
  unique (quote_id, product_id)
);
create index quote_lines_quote on quote_lines (quote_id);

-- The people who sell and quote read them; nobody else does. No cost lives here.
alter table quotes enable row level security;
alter table quote_lines enable row level security;
revoke all on quotes from public, anon, authenticated, service_role;
revoke all on quote_lines from public, anon, authenticated, service_role;
grant select on quotes to authenticated;
grant select on quote_lines to authenticated;
create policy quotes_read on quotes for select to authenticated using (has_staff_role(array['counter', 'accountant']::staff_role[]));
create policy quote_lines_read on quote_lines for select to authenticated using (has_staff_role(array['counter', 'accountant']::staff_role[]));

-- p_lines: [{"product_id": "...", "qty": 1, "unit_price": 9500000}]. The same pricing as an order:
-- trade price for installer and business customers, unit price optional, line-by-line VAT rounding.
create function create_quote(p_key text, p_location uuid, p_lines jsonb, p_customer uuid default null, p_valid_days int default 7, p_note text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter', 'accountant']::staff_role[]);
  v_customer customers;
  v_id uuid;
  v_seen text;
  v_hash text := md5(jsonb_build_object('customer', p_customer, 'location', p_location, 'days', p_valid_days, 'note', p_note, 'lines', p_lines)::text);
  l jsonb;
  pr products;
  q numeric;
  v_list bigint;
  v_price bigint;
  v_trade bigint;
  v_last uuid;
  v_line_total bigint;
  v_line_vat bigint;
  v_list_total bigint := 0;
  v_total bigint := 0;
  v_vat bigint := 0;
begin
  perform i_require_key(p_key);
  if p_location is null then raise exception 'bad_location'; end if;
  if p_valid_days is null or p_valid_days < 1 or p_valid_days > 90 then raise exception 'bad_valid_days'; end if;
  insert into quotes (client_key, client_hash, customer_id, location_id, valid_until, note, created_by)
  values (p_key, v_hash, p_customer, p_location, shop_today() + p_valid_days, p_note, me)
  on conflict (client_key) do nothing returning id into v_id;
  if v_id is null then
    select id, client_hash into v_id, v_seen from quotes where client_key = p_key;
    if v_seen is distinct from v_hash then raise exception 'key_reused'; end if;
    return v_id;
  end if;
  if coalesce(jsonb_array_length(p_lines), 0) = 0 then raise exception 'empty_quote'; end if;
  select * into v_customer from customers where id = p_customer;
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
    v_line_total := round(v_price * q)::bigint;
    v_line_vat := round(v_line_total * pr.vat_rate_bp::numeric / (10000 + pr.vat_rate_bp))::bigint;
    insert into quote_lines (quote_id, product_id, qty, list_price_kobo, unit_price_kobo, vat_rate_bp, line_total_kobo, line_vat_kobo)
    values (v_id, pr.id, q, v_list, v_price, pr.vat_rate_bp, v_line_total, v_line_vat);
    v_list_total := v_list_total + round(v_list * q)::bigint;
    v_total := v_total + v_line_total;
    v_vat := v_vat + v_line_vat;
  end loop;
  update quotes set root_id = v_id, quote_no = i_next_doc('Q', shop_today()),
    list_total_kobo = v_list_total, total_kobo = v_total, vat_kobo = v_vat where id = v_id;
  perform i_audit(me, 'create_quote', 'quote', v_id::text, jsonb_build_object('total', v_total));
  return v_id;
end $$;

-- A new version of the latest version. The old one stays for history and can no longer be accepted.
-- The quote row is locked, so a revision and an acceptance cannot both win.
create function revise_quote(p_key text, p_quote uuid, p_lines jsonb, p_valid_days int default 7, p_note text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter', 'accountant']::staff_role[]);
  q quotes;
  v_id uuid;
  v_seen text;
  v_hash text := md5(jsonb_build_object('of', p_quote, 'days', p_valid_days, 'note', p_note, 'lines', p_lines)::text);
  l jsonb;
  pr products;
  qty numeric;
  v_list bigint;
  v_price bigint;
  v_trade bigint;
  v_last uuid;
  v_line_total bigint;
  v_line_vat bigint;
  v_list_total bigint := 0;
  v_total bigint := 0;
  v_vat bigint := 0;
begin
  perform i_require_key(p_key);
  if p_valid_days is null or p_valid_days < 1 or p_valid_days > 90 then raise exception 'bad_valid_days'; end if;
  select * into q from quotes where id = p_quote for update;
  if not found then raise exception 'no_such_quote'; end if;
  select id, client_hash into v_id, v_seen from quotes where client_key = p_key;
  if found then
    if v_seen is distinct from v_hash then raise exception 'key_reused'; end if;
    return v_id;
  end if;
  if q.status <> 'sent' then raise exception 'quote_not_active'; end if;
  if q.valid_until < shop_today() then raise exception 'quote_expired'; end if;
  if exists (select 1 from quotes x where x.root_id = q.root_id and x.version > q.version) then raise exception 'quote_superseded'; end if;
  if coalesce(jsonb_array_length(p_lines), 0) = 0 then raise exception 'empty_quote'; end if;
  insert into quotes (client_key, client_hash, root_id, version, customer_id, location_id, valid_until, note, created_by)
  values (p_key, v_hash, q.root_id, q.version + 1, q.customer_id, q.location_id, shop_today() + p_valid_days, coalesce(p_note, q.note), me)
  returning id into v_id;
  for l in select * from jsonb_array_elements(p_lines) order by (value ->> 'product_id')::uuid loop
    select * into pr from products where id = (l ->> 'product_id')::uuid and status = 'active';
    if not found then raise exception 'no_such_product'; end if;
    if pr.id = v_last then raise exception 'duplicate_product: %', pr.sku; end if;
    v_last := pr.id;
    qty := (l ->> 'qty')::numeric;
    perform i_check_qty(pr.unit, qty);
    select trade_price_kobo into v_trade from product_trade_prices
    where product_id = pr.id
      and exists (select 1 from customers c where c.id = q.customer_id and c.kind in ('installer', 'business'));
    v_list := coalesce(v_trade, pr.price_kobo);
    v_price := coalesce((l ->> 'unit_price')::bigint, v_list);
    if v_price < 0 then raise exception 'bad_price'; end if;
    v_line_total := round(v_price * qty)::bigint;
    v_line_vat := round(v_line_total * pr.vat_rate_bp::numeric / (10000 + pr.vat_rate_bp))::bigint;
    insert into quote_lines (quote_id, product_id, qty, list_price_kobo, unit_price_kobo, vat_rate_bp, line_total_kobo, line_vat_kobo)
    values (v_id, pr.id, qty, v_list, v_price, pr.vat_rate_bp, v_line_total, v_line_vat);
    v_list_total := v_list_total + round(v_list * qty)::bigint;
    v_total := v_total + v_line_total;
    v_vat := v_vat + v_line_vat;
  end loop;
  update quotes set quote_no = i_next_doc('Q', shop_today()),
    list_total_kobo = v_list_total, total_kobo = v_total, vat_kobo = v_vat where id = v_id;
  perform i_audit(me, 'revise_quote', 'quote', v_id::text, jsonb_build_object('of', p_quote, 'total', v_total));
  return v_id;
end $$;

-- Acceptance becomes an ordinary order at the quoted prices. A retry returns the first order.
create function accept_quote(p_quote uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter', 'accountant']::staff_role[]);
  q quotes;
  v_order uuid;
  v_lines jsonb;
begin
  select * into q from quotes where id = p_quote for update;
  if not found then raise exception 'no_such_quote'; end if;
  if q.accepted_order_id is not null then return q.accepted_order_id; end if;
  if q.status <> 'sent' then raise exception 'quote_not_active'; end if;
  if q.valid_until < shop_today() then raise exception 'quote_expired'; end if;
  if exists (select 1 from quotes x where x.root_id = q.root_id and x.version > q.version) then raise exception 'quote_superseded'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('product_id', product_id, 'qty', qty, 'unit_price', unit_price_kobo) order by product_id), '[]'::jsonb)
    into v_lines from quote_lines where quote_id = p_quote;
  v_order := i_create_order(me, 'quote_accept:' || q.id, q.customer_id, q.location_id, 'counter', v_lines, false, false, 'From quote ' || q.quote_no, shop_today());
  update quotes set status = 'accepted', accepted_order_id = v_order, accepted_by = me, accepted_at = now() where id = p_quote;
  perform i_audit(me, 'accept_quote', 'quote', p_quote::text, jsonb_build_object('order', v_order));
  return v_order;
end $$;

-- The customer walked away. History stays; the quote can never come back.
create function cancel_quote(p_quote uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter', 'accountant']::staff_role[]);
  q quotes;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  select * into q from quotes where id = p_quote for update;
  if not found then raise exception 'no_such_quote'; end if;
  if q.status <> 'sent' then raise exception 'quote_not_active'; end if;
  update quotes set status = 'cancelled', decided_by = me, decided_at = now(), reason = p_reason where id = p_quote;
  perform i_audit(me, 'cancel_quote', 'quote', p_quote::text, jsonb_build_object('reason', p_reason));
end $$;

grant execute on function create_quote(text, uuid, jsonb, uuid, int, text) to authenticated;
grant execute on function revise_quote(text, uuid, jsonb, int, text) to authenticated;
grant execute on function accept_quote(uuid) to authenticated;
grant execute on function cancel_quote(uuid, text) to authenticated;
