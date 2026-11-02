-- Power Store, new work (2026-11-02): POS settlement.
-- A card tap at the counter hands over the goods but is not money until a second person matches it
-- against the bank statement, exactly like a transfer. The books stay honest at every step: the goods
-- leave against customers_owe, and the confirm later posts bank and clears the debt. A fake tap stays
-- a debt the owner can see, never money.

-- Only cash is money the moment it lands in the drawer. A card tap is judged against what other
-- waiting card taps on the same order leave uncovered, so a double tap can't quietly over-cover it.
create or replace function i_take_payment(p_actor uuid, p_key text, p_order uuid, p_method payment_method, p_amount bigint, p_reference text, p_on date) returns uuid
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
  -- Both are judged against what waiting card taps on the order leave uncovered, so a customer who
  -- tapped a card cannot be charged cash on top of it.
  if p_method = 'cash' and p_amount > o.total_kobo - o.paid_kobo
      - coalesce((select sum(x.amount_kobo) from payments x
                  where x.order_id = o.id and x.method = 'pos' and x.kind = 'payment' and x.status = 'pending'), 0) then
    raise exception 'more_than_owed';
  end if;
  if p_method = 'pos' and p_amount > o.total_kobo - o.paid_kobo
      - coalesce((select sum(x.amount_kobo) from payments x
                  where x.order_id = o.id and x.method = 'pos' and x.kind = 'payment' and x.status = 'pending'), 0) then
    raise exception 'more_than_owed';
  end if;
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
  -- Cash is money the moment it lands in the drawer. A transfer and a card tap are promises until a
  -- second person matches them against the bank statement, so they stay pending.
  if p_method = 'cash' then perform i_apply_payment(p_actor, v_id, p_on); end if;
  return v_id;
end $$;

-- A non-credit order may deliver when its waiting card taps cover the shortfall: the customer tapped
-- and the goods left, and the bank line is matched by a second person later. Credit rules are untouched.
create or replace function i_deliver(p_actor uuid, p_key text, p_order uuid, p_lines jsonb, p_on date) returns uuid
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
    if o.on_credit then
      if o.credit_approved_by is null then
        select credit_limit_kobo into v_limit from customers where id = o.customer_id;
        if i_customer_owes(o.customer_id) + (v_billed - o.paid_kobo) - greatest(o.billed_kobo - o.paid_kobo, 0) > v_limit then
          raise exception 'over_credit_limit';
        end if;
      end if;
    elsif v_billed > o.paid_kobo + coalesce((select sum(x.amount_kobo) from payments x
        where x.order_id = o.id and x.method = 'pos' and x.kind = 'payment' and x.status = 'pending'), 0) then
      raise exception 'payment_required: % short', v_billed - o.paid_kobo;
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

-- The same close_month, with one honest word: a card tap and a transfer are both "a payment" until confirmed.
create or replace function close_month(p_month date, p_statement_balance bigint) returns void
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
  if exists (select 1 from safe_counts where status = 'submitted' and counted_on < v_end) then problems := problems || 'a safe count is waiting for a decision'::text; end if;
  if exists (select 1 from payments where status = 'pending' and recorded_on < v_end) then problems := problems || 'a payment is waiting to be confirmed'::text; end if;
  select coalesce(sum(e.amount_kobo), 0) into v_bank from ledger_entries e join ledger_txns t on t.id = e.txn_id
    where e.account_code = 'bank' and t.occurred_on < v_end;
  if v_bank <> p_statement_balance then problems := problems || format('bank differs from the statement by %s', v_bank - p_statement_balance); end if;
  if cardinality(problems) > 0 then raise exception 'month_not_ready: %', array_to_string(problems, '; '); end if;
  select count(*) into v_txns from ledger_txns where occurred_on >= p_month and occurred_on < v_end;
  insert into closed_periods (month, closed_by) values (p_month, me) on conflict do nothing;
  perform i_audit(me, 'close_month', 'period', p_month::text, jsonb_build_object('statement_balance', p_statement_balance, 'txns_in_month', v_txns));
end $$;

-- The owner's list says which kind of payment is waiting, so a card and a transfer are told apart.
create or replace function owner_exceptions() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform require_staff(array['accountant']::staff_role[]);
  return jsonb_build_object(
    'below_cost', (select coalesce(jsonb_agg(jsonb_build_object('invoice_no', o.invoice_no, 'product', p.name, 'sold_for', l.billed_kobo - l.billed_vat_kobo, 'cost', c.cost_kobo)), '[]')
      from order_line_costs c join order_lines l on l.id = c.line_id join orders o on o.id = l.order_id join products p on p.id = l.product_id
      where l.delivered_qty > 0 and c.cost_kobo > l.billed_kobo - l.billed_vat_kobo and o.created_on >= shop_today() - 7),
    'old_transfers', (select coalesce(jsonb_agg(jsonb_build_object('payment', id, 'method', method, 'amount', amount_kobo, 'recorded_on', recorded_on)), '[]')
      from payments where status = 'pending' and created_at < now() - interval '4 hours'),
    'holds_lapsed', (select coalesce(jsonb_agg(jsonb_build_object('invoice_no', invoice_no, 'holds', paid_kobo - billed_kobo)), '[]')
      from orders where hold_lapsed and goods_status in ('waiting', 'part_delivered')),
    'till_differences', (select coalesce(jsonb_agg(jsonb_build_object('staff', staff_id, 'difference', difference_kobo, 'on', opened_on)), '[]')
      from till_sessions where status = 'closed' and difference_kobo <> 0 and opened_on >= shop_today() - 7),
    'low_stock', (select coalesce(jsonb_agg(jsonb_build_object('sku', p.sku, 'name', p.name, 'free', s.free)), '[]')
      from products p join (select product_id, sum(qty - reserved) free from stock_balances group by product_id) s on s.product_id = p.id
      where p.status = 'active' and p.low_stock_at > 0 and s.free <= p.low_stock_at),
    'approvals', (select count(*) from approvals where status = 'pending'),
    'safe_counts_waiting', (select count(*) from safe_counts where status = 'submitted')
  );
end $$;
