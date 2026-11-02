-- Power Store, new work (2026-11-02): returns and credit notes.
-- Goods that left can come back. Stock and money reverse exactly, at the original cost,
-- and a credit note (doc CN) records what the customer is owed. Paying money out stays refund_order.

create table returns (
  id uuid primary key default gen_random_uuid(),
  client_key text not null unique,
  client_hash text,
  order_id uuid not null references orders(id),
  location_id uuid references locations(id),
  returned_on date not null,
  billed_kobo bigint not null default 0,
  credit_no text unique,
  txn_id uuid references ledger_txns(id),
  reason text,
  actor uuid,
  created_at timestamptz not null default now()
);
create index returns_order on returns (order_id);

alter table returns enable row level security;
revoke all on returns from public, anon, authenticated, service_role;
grant select on returns to authenticated;
create policy returns_read on returns for select to authenticated using (
  has_staff_role(array['counter', 'accountant']::staff_role[])
  or order_id in (select id from orders where customer_id in (select id from customers where user_id = auth.uid()))
);

-- A returned serial goes back on the shelf and can be sold again. Its order_line_serials pairing
-- is the unit's current sale, not its history (stock_movements keeps that), so return_goods removes
-- the pairing when the unit comes back and i_deliver adds a fresh one on every sale.

-- p_lines: [{"product_id": "...", "qty": 1, "serials": ["AB12"]}].
-- p_location: where the goods come back to; null means the order's location.
-- Returns stock at the cost it left at, and reverses sale and VAT by the same running-total
-- rounding that billed them, so part returns add up exactly. What the customer is now owed
-- lands in customers_owe/goods_owed; paying it out is refund_order's job.
create function return_goods(p_key text, p_order uuid, p_lines jsonb, p_reason text, p_location uuid default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter', 'accountant']::staff_role[]);
  o orders;
  v_id uuid;
  v_seen returns;
  v_hash text := md5(coalesce(p_lines::text, '') || coalesce(p_location::text, ''));
  v_location uuid;
  li order_lines;
  pr products;
  req jsonb;
  q numeric;
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
  v_txn uuid;
begin
  perform i_require_key(p_key);
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'no_such_order'; end if;
  select * into v_seen from returns where client_key = p_key;
  if found then
    if v_seen.order_id <> p_order or v_seen.client_hash is distinct from v_hash then raise exception 'key_reused'; end if;
    return v_seen.id;
  end if;
  if o.goods_status = 'cancelled' then raise exception 'order_cancelled'; end if;
  if o.goods_status = 'waiting' then raise exception 'nothing_to_return'; end if;
  v_location := coalesce(p_location, o.location_id);
  perform 1 from locations where id = v_location;
  if not found then raise exception 'no_such_location'; end if;
  insert into returns (client_key, client_hash, order_id, location_id, returned_on, reason, actor)
  values (p_key, v_hash, p_order, v_location, shop_today(), p_reason, me) returning id into v_id;
  for li in select * from order_lines where order_id = p_order and delivered_qty > 0 order by product_id loop
    req := null;
    select value into req from jsonb_array_elements(p_lines) where (value ->> 'product_id')::uuid = li.product_id limit 1;
    if req is null then continue; end if;
    q := (req ->> 'qty')::numeric;
    select * into pr from products where id = li.product_id;
    perform i_check_qty(pr.unit, q);
    if q > li.delivered_qty then raise exception 'more_than_delivered'; end if;
    -- Lock the shelf before the units, the same order delivery uses: stock before serial.
    perform 1 from stock_balances where product_id = li.product_id and location_id = v_location for update;
    if pr.tracking = 'serial' then
      if jsonb_typeof(req -> 'serials') <> 'array' or jsonb_array_length(req -> 'serials') <> q then
        raise exception 'serial_required: %', pr.sku;
      end if;
      for v_serial in select upper(trim(value)) from jsonb_array_elements_text(req -> 'serials') order by 1 loop
        select * into u from serial_units where serial = v_serial for update;
        if not found or not exists (select 1 from order_line_serials ols where ols.serial_id = u.id and ols.line_id = li.id) then
          raise exception 'serial_not_on_line: %', v_serial;
        end if;
        if u.status <> 'sold' then raise exception 'serial_already_back: %', v_serial; end if;
        -- The pairing goes with the unit, or a unit re-sold on another order could still be
        -- "returned" against this line and take that sale's stock.
        delete from order_line_serials where serial_id = u.id and line_id = li.id;
        update serial_units set status = 'in_stock', location_id = v_location, sold_on = null, customer_id = null, warranty_ends_on = null
        where id = u.id;
        insert into stock_movements (product_id, to_location, qty, serial_id, reason, ref_type, ref_id, actor)
        values (li.product_id, v_location, 1, u.id, 'returned', 'return', v_id, me);
      end loop;
    else
      if jsonb_typeof(req -> 'serials') = 'array' and jsonb_array_length(req -> 'serials') > 0 then
        raise exception 'serials_not_tracked: %', pr.sku;
      end if;
      insert into stock_movements (product_id, to_location, qty, reason, ref_type, ref_id, actor)
      values (li.product_id, v_location, q, 'returned', 'return', v_id, me);
    end if;
    if q = li.delivered_qty then
      v_cost := (select cost_kobo from order_line_costs where line_id = li.id);
    else
      v_cost := round((select cost_kobo from order_line_costs where line_id = li.id) * q / li.delivered_qty)::bigint;
    end if;
    perform i_add_value(li.product_id, q, v_cost);
    update order_line_costs set cost_kobo = cost_kobo - v_cost where line_id = li.id;
    v_line_after := round(li.line_total_kobo * (li.delivered_qty - q) / li.qty)::bigint;
    v_vat_after := round(li.line_vat_kobo * (li.delivered_qty - q) / li.qty)::bigint;
    v_total := v_total + li.billed_kobo - v_line_after;
    v_vat := v_vat + li.billed_vat_kobo - v_vat_after;
    v_costs := v_costs + v_cost;
    v_done := v_done + 1;
    update order_lines set delivered_qty = delivered_qty - q, billed_kobo = v_line_after, billed_vat_kobo = v_vat_after
    where id = li.id;
  end loop;
  if v_done = 0 then raise exception 'nothing_to_return'; end if;
  if jsonb_array_length(p_lines) <> v_done then raise exception 'line_not_on_order'; end if;
  v_billed := o.billed_kobo - v_total;
  if v_total <> 0 or v_costs <> 0 then
    v_txn := i_post_txn('return', 'Goods returned: ' || o.invoice_no, shop_today(),
      jsonb_build_array(
        jsonb_build_object('account', 'sales', 'amount', v_total - v_vat),
        jsonb_build_object('account', 'vat_payable', 'amount', v_vat),
        jsonb_build_object('account', 'cogs', 'amount', -v_costs),
        jsonb_build_object('account', 'stock', 'amount', v_costs)
      ) || i_balance_lines(o, o.paid_kobo, v_billed),
      'return', v_id, 'return:' || v_id, me);
  end if;
  update returns set billed_kobo = v_total, txn_id = v_txn, credit_no = i_next_doc('CN', shop_today()) where id = v_id;
  update orders set billed_kobo = v_billed,
    goods_status = case
      when exists (select 1 from order_lines where order_id = p_order and delivered_qty > 0)
       and exists (select 1 from order_lines where order_id = p_order and delivered_qty < qty) then 'part_delivered'::goods_status
      when exists (select 1 from order_lines where order_id = p_order and delivered_qty > 0) then 'delivered'::goods_status
      else 'waiting'::goods_status end
  where id = p_order;
  perform i_audit(me, 'return_goods', 'order', p_order::text, jsonb_build_object('return', v_id, 'billed', v_total, 'reason', p_reason));
  return v_id;
end $$;

grant execute on function return_goods(text, uuid, jsonb, text, uuid) to authenticated;
