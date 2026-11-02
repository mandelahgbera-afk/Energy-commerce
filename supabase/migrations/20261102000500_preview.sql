-- Power Store (2026-11-02): the counter's price preview.
-- The counter used to work out prices itself, and got them wrong. It looked up phone numbers in the
-- wrong format, applied trade prices to retail customers, and so could show and collect a different
-- total from the one the books recorded. Now the database works the sale out by exactly the rules
-- i_create_order uses, and the screen only displays it. A test in sim/edge.mjs keeps the two in step.

-- p_lines: [{"product_id": "...", "qty": 2}]. p_discount_pct comes off each line's price.
-- Returns the unit prices to send with the sale, so what is shown is what is charged.
create function preview_sale(p_lines jsonb, p_location uuid default null, p_phone text default null, p_discount_pct numeric default 0) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter']::staff_role[]);
  v_role staff_role;
  v_limit_pct numeric;
  v_phone text;
  v_customer customers;
  l jsonb;
  pr products;
  q numeric;
  v_trade bigint;
  v_list bigint;
  v_price bigint;
  v_line_total bigint;
  v_line_vat bigint;
  v_free numeric;
  v_over boolean;
  v_lines jsonb := '[]';
  v_total bigint := 0;
  v_vat bigint := 0;
  v_list_total bigint := 0;
  v_needs_approval boolean := false;
begin
  if p_discount_pct is null or p_discount_pct = 'NaN'::numeric or p_discount_pct < 0 or p_discount_pct > 100 then
    raise exception 'bad_discount';
  end if;
  select role, discount_limit_pct into v_role, v_limit_pct from staff where id = me;
  -- A half-typed number is just "no customer yet", not an error.
  if coalesce(trim(p_phone), '') <> '' then
    begin
      v_phone := normalize_phone(p_phone);
    exception when others then
      v_phone := null;
    end;
    if v_phone is not null then
      select * into v_customer from customers where phone = v_phone;
    end if;
  end if;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    select * into pr from products where id = (l ->> 'product_id')::uuid and status = 'active';
    if not found then raise exception 'no_such_product'; end if;
    q := (l ->> 'qty')::numeric;
    perform i_check_qty(pr.unit, q);
    -- The same pricing as i_create_order: trade price only for installer and business customers.
    v_trade := null;
    if v_customer.kind in ('installer', 'business') then
      select trade_price_kobo into v_trade from product_trade_prices where product_id = pr.id;
    end if;
    v_list := coalesce(v_trade, pr.price_kobo);
    v_price := round(v_list * (100 - p_discount_pct) / 100)::bigint;
    v_over := v_role is distinct from 'owner' and v_price < v_list and (v_list - v_price) * 100.0 / v_list > coalesce(v_limit_pct, 0);
    v_line_total := round(v_price * q)::bigint;
    v_line_vat := round(v_line_total * pr.vat_rate_bp::numeric / (10000 + pr.vat_rate_bp))::bigint;
    select coalesce(sum(b.qty - b.reserved), 0) into v_free from stock_balances b
      where b.product_id = pr.id and (p_location is null or b.location_id = p_location);
    v_lines := v_lines || jsonb_build_object(
      'product_id', pr.id, 'qty', q, 'list_price', v_list, 'unit_price', v_price, 'trade', v_trade is not null,
      'line_total', v_line_total, 'line_vat', v_line_vat, 'enough_stock', coalesce(v_free, 0) >= q, 'over_limit', v_over);
    v_total := v_total + v_line_total;
    v_vat := v_vat + v_line_vat;
    v_list_total := v_list_total + round(v_list * q)::bigint;
    v_needs_approval := v_needs_approval or v_over;
  end loop;
  return jsonb_build_object(
    'customer', case when v_customer.id is null then null else jsonb_build_object(
      'id', v_customer.id, 'name', v_customer.name, 'kind', v_customer.kind,
      'trade', v_customer.kind in ('installer', 'business'), 'credit_limit', v_customer.credit_limit_kobo
    ) || customer_balance(v_customer.id) end,
    'lines', v_lines, 'total', v_total, 'vat', v_vat, 'list_total', v_list_total, 'needs_approval', v_needs_approval,
    'discount_limit_pct', coalesce(case when v_role = 'owner' then 100 end, v_limit_pct, 0));
end $$;

grant execute on function preview_sale(jsonb, uuid, text, numeric) to authenticated;
