-- Power Store (2026-11-02): fixes from an outside review of the 2 Nov work. Each one has a scene in sim/edge.mjs.
-- These re-create whole functions, so read the latest version of each here, not in the earlier files.

-- 1. A serial-tracked unit could be "returned" without its serial: with no serials given, both sides of
-- the check were null, so it never fired. The customer kept the battery and got the credit.
-- The books check now also compares every serial line with the units paired to it.
create or replace function return_goods(p_key text, p_order uuid, p_lines jsonb, p_reason text, p_location uuid default null) returns uuid
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
      if coalesce(jsonb_typeof(req -> 'serials'), '') <> 'array' or coalesce(jsonb_array_length(req -> 'serials'), 0) <> q then
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

create or replace function i_books_check() returns jsonb
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

  -- Every serial-tracked unit counted as delivered on a line is a unit paired to that line and still sold.
  select count(*) into n from order_lines l join products p on p.id = l.product_id
    where p.tracking = 'serial'
      and l.delivered_qty <> (select count(*) from order_line_serials s join serial_units u on u.id = s.serial_id
                              where s.line_id = l.id and u.status = 'sold');
  if n > 0 then problems := problems || format('%s lines whose serial numbers disagree with what was delivered', n); end if;

  return jsonb_build_object('ok', cardinality(problems) = 0, 'problems', to_jsonb(problems));
end $$;

-- 2. Owner money and blind safe counts. An accountant could book missing cash as an owner drawing, or
-- read the expected safe figure and then count to match it. Owner money is the owner's own, like
-- opening balances, and the safe is counted by someone who can't see what it should hold.
create or replace function owner_money_in(p_key text, p_account text, p_amount bigint, p_what text, p_on date default shop_today()) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array[]::staff_role[]);
  v_txn uuid;
begin
  perform i_require_key(p_key);
  if p_amount is null or p_amount <= 0 then raise exception 'bad_amount'; end if;
  if coalesce(trim(p_what), '') = '' then raise exception 'reason_required'; end if;
  if p_account is null or p_account not in ('bank', 'cash') then raise exception 'bad_account'; end if;
  v_txn := i_post_txn('owner_in', p_what, p_on,
    jsonb_build_array(jsonb_build_object('account', p_account, 'amount', p_amount),
      jsonb_build_object('account', 'owner_money', 'amount', -p_amount)),
    'journal', null, 'owner_in:' || p_key, me);
  perform i_audit(me, 'owner_money_in', 'ledger_txn', v_txn::text, jsonb_build_object('account', p_account, 'amount', p_amount, 'what', p_what));
  return v_txn;
end $$;

create or replace function owner_money_out(p_key text, p_account text, p_amount bigint, p_what text, p_on date default shop_today()) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array[]::staff_role[]);
  v_txn uuid;
begin
  perform i_require_key(p_key);
  if p_amount is null or p_amount <= 0 then raise exception 'bad_amount'; end if;
  if coalesce(trim(p_what), '') = '' then raise exception 'reason_required'; end if;
  if p_account is null or p_account not in ('bank', 'cash') then raise exception 'bad_account'; end if;
  v_txn := i_post_txn('owner_out', p_what, p_on,
    jsonb_build_array(jsonb_build_object('account', 'owner_money', 'amount', p_amount),
      jsonb_build_object('account', p_account, 'amount', -p_amount)),
    'journal', null, 'owner_out:' || p_key, me);
  perform i_audit(me, 'owner_money_out', 'ledger_txn', v_txn::text, jsonb_build_object('account', p_account, 'amount', p_amount, 'what', p_what));
  return v_txn;
end $$;

create or replace function submit_safe_count(p_key text, p_counted bigint, p_counted_at timestamptz) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter']::staff_role[]);
  c uuid;
  v_hash text := md5(coalesce(p_counted::text, '') || coalesce(p_counted_at::text, ''));
  v_seen text;
begin
  perform i_require_key(p_key);
  if p_counted is null or p_counted < 0 then raise exception 'bad_amount'; end if;
  if p_counted_at is null or p_counted_at > now() + interval '1 minute' then raise exception 'bad_time'; end if;
  perform 1 from shop_settings for share;
  insert into safe_counts (client_key, client_hash, counted_at, counted_kobo, counted_by)
  values (p_key, v_hash, p_counted_at, p_counted, me) on conflict (client_key) do nothing returning id into c;
  if c is null then
    select id, client_hash into c, v_seen from safe_counts where client_key = p_key;
    if v_seen is distinct from v_hash then raise exception 'key_reused'; end if;
    return c;
  end if;
  perform i_audit(me, 'submit_safe_count', 'safe_count', c::text);
  return c;
end $$;

-- 3. Any counter could block a quote by creating an order with its internal key first.
create or replace function create_order(
  p_key text, p_location uuid, p_lines jsonb, p_phone text default null, p_name text default null,
  p_channel order_channel default 'counter', p_on_credit boolean default false, p_backorder boolean default false, p_note text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter']::staff_role[]);
  v_customer uuid;
begin
  -- Keys the system makes for itself are not for screens to use, or anyone could block them in advance.
  if p_key like 'quote_accept:%' or p_key like 'opening_debt:%' then raise exception 'key_reserved'; end if;
  if p_phone is not null then v_customer := i_customer_for_phone(p_phone, p_name); end if;
  return i_create_order(me, p_key, v_customer, p_location, p_channel, p_lines, p_on_credit, p_backorder, p_note, shop_today());
end $$;

create or replace function counter_sale(
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
  -- Keys the system makes for itself are not for screens to use, or anyone could block them in advance.
  if p_key like 'quote_accept:%' or p_key like 'opening_debt:%' then raise exception 'key_reserved'; end if;
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
