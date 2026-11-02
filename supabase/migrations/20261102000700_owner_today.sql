-- Power Store (2026-11-02): the owner's "today" screen, in one call.
-- Every figure is worked out here from the records, so the screen never adds anything up itself.
-- Owner and accountant only, because it shows profit and what things cost.

-- How long a battery usually lasts before the customer needs another. 24 months is a guess until
-- the shop says what their customers really get.
alter table shop_settings add column if not exists battery_life_months int not null default 24 check (battery_life_months between 1 and 240);

-- p_days is the period for the tiles and the money graph: 7, 30 or 90 days, ending today.
create function owner_today(p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['accountant']::staff_role[]);
  v_today date := shop_today();
  v_from date;
  v_prev date;
  v_life int;
  v_queue jsonb;
  v_in_today jsonb;
  v_tiles jsonb;
  v_series jsonb;
  v_money_in bigint;
  v_prev_money_in bigint;
  v_money_out bigint;
  v_prev_money_out bigint;
  v_debts jsonb;
  v_running jsonb;
  v_batteries jsonb;
begin
  if p_days is null or p_days not in (7, 30, 90) then raise exception 'bad_period'; end if;
  v_from := v_today - (p_days - 1);
  v_prev := v_from - p_days;
  select battery_life_months into v_life from shop_settings;

  -- 1. What is waiting on the owner, oldest first. Each kind already has its own yes and no.
  select coalesce(jsonb_agg(item order by at), '[]') into v_queue from (
    select a.created_at as at, jsonb_build_object(
      'type', 'approval', 'id', a.id, 'kind', a.kind, 'order_id', o.id, 'invoice_no', o.invoice_no,
      'customer', c.name, 'asked_by', s.name, 'detail', a.detail, 'total', o.total_kobo,
      -- What a yes would leave: the price without VAT, less what the goods cost on the shelf now.
      'profit', (o.total_kobo - o.vat_kobo) - coalesce((
        select sum(round(case when pc.on_hand > 0 then pc.value_kobo * l.qty / pc.on_hand else pc.last_cost_kobo * l.qty end))::bigint
        from order_lines l join product_costs pc on pc.product_id = l.product_id where l.order_id = o.id), 0)) as item
    from approvals a join orders o on o.id = a.order_id
    left join customers c on c.id = o.customer_id left join staff s on s.id = a.asked_by
    where a.status = 'pending'
    union all
    select p.created_at, jsonb_build_object('type', 'payment', 'id', p.id, 'method', p.method, 'amount', p.amount_kobo,
      'invoice_no', o.invoice_no, 'customer', c.name, 'recorded_on', p.recorded_on, 'reference', p.reference)
    from payments p join orders o on o.id = p.order_id left join customers c on c.id = o.customer_id
    where p.status = 'pending'
    union all
    select sc.created_at, jsonb_build_object('type', 'stock_count', 'id', sc.id, 'counted_on', sc.counted_on, 'location', loc.name,
      'lines', (select count(*) from stock_count_lines x where x.count_id = sc.id),
      'differences', (select count(*) from stock_count_lines x where x.count_id = sc.id and x.counted <> x.expected),
      'value_change', (select coalesce(sum(round(case when pc.on_hand > 0 then pc.value_kobo * (x.counted - x.expected) / pc.on_hand
                                                  else pc.last_cost_kobo * (x.counted - x.expected) end)), 0)::bigint
                       from stock_count_lines x join product_costs pc on pc.product_id = x.product_id where x.count_id = sc.id))
    from stock_counts sc join locations loc on loc.id = sc.location_id
    where sc.status = 'submitted'
    union all
    select k.created_at, jsonb_build_object('type', 'safe_count', 'id', k.id, 'counted_on', k.counted_on, 'counted', k.counted_kobo)
    from safe_counts k where k.status = 'submitted'
    union all
    select o.created_at, jsonb_build_object('type', 'hold_lapsed', 'id', o.id, 'invoice_no', o.invoice_no, 'customer', c.name,
      'holds', o.paid_kobo - o.billed_kobo)
    from orders o left join customers c on c.id = o.customer_id
    where o.hold_lapsed and o.goods_status in ('waiting', 'part_delivered')
  ) q;

  -- 2. Money in today, by how it came: confirmed money only, less refunds.
  select coalesce(jsonb_object_agg(method, amount), '{}') into v_in_today from (
    select p.method::text as method, sum(case when p.kind = 'payment' then p.amount_kobo else -p.amount_kobo end)::bigint as amount
    from payments p join ledger_txns t on t.id = p.txn_id
    where p.status = 'confirmed' and t.occurred_on = v_today
    group by p.method
  ) x;

  -- 3 and 4. Money in and out, and the tiles, this period and the one before. Money is judged per
  -- transaction, so cash banked or moved between accounts is neither in nor out. Opening balances are not money in.
  with m as (
    select t.occurred_on d, sum(e.amount_kobo) net
    from ledger_entries e join ledger_txns t on t.id = e.txn_id join ledger_accounts la on la.code = e.account_code
    where la.holds_money and t.kind <> 'opening' and t.occurred_on between v_prev and v_today
    group by t.id, t.occurred_on
  ), days as (
    select d, sum(greatest(net, 0))::bigint as money_in, sum(greatest(-net, 0))::bigint as money_out from m group by d
  )
  select jsonb_agg(jsonb_build_object('date', g.d::date, 'in', coalesce(days.money_in, 0), 'out', coalesce(days.money_out, 0)) order by g.d),
    (select coalesce(sum(money_in), 0) from days where d >= v_from),
    (select coalesce(sum(money_in), 0) from days where d < v_from),
    (select coalesce(sum(money_out), 0) from days where d >= v_from),
    (select coalesce(sum(money_out), 0) from days where d < v_from)
    into v_series, v_money_in, v_prev_money_in, v_money_out, v_prev_money_out
    from generate_series(v_from, v_today, interval '1 day') g(d)
    left join days on days.d = g.d::date;

  select jsonb_build_object(
    'sales', -coalesce(sum(e.amount_kobo) filter (where e.account_code = 'sales' and t.occurred_on >= v_from), 0),
    'profit', -coalesce(sum(e.amount_kobo) filter (where e.account_code in ('sales', 'cogs') and t.occurred_on >= v_from), 0),
    'prev_sales', -coalesce(sum(e.amount_kobo) filter (where e.account_code = 'sales' and t.occurred_on < v_from), 0),
    'prev_profit', -coalesce(sum(e.amount_kobo) filter (where e.account_code in ('sales', 'cogs') and t.occurred_on < v_from), 0),
    'money_in', v_money_in, 'prev_money_in', v_prev_money_in, 'money_out', v_money_out, 'prev_money_out', v_prev_money_out)
    into v_tiles
    from ledger_entries e join ledger_txns t on t.id = e.txn_id
    where e.account_code in ('sales', 'cogs') and t.occurred_on between v_prev and v_today;

  -- 5. Who owes us, by how long since the goods left. Every band is listed, even an empty one.
  with owed as (
    select o.customer_id, o.billed_kobo - o.paid_kobo as amount,
      v_today - coalesce((select min(dv.delivered_on) from deliveries dv where dv.order_id = o.id), o.created_on) as age
    from orders o where o.billed_kobo > o.paid_kobo
  ), banded as (
    select customer_id, amount, age, case when age <= 30 then 0 when age <= 60 then 1 when age <= 90 then 2 else 3 end as band from owed
  ), people as (
    select b.band, b.customer_id, sum(b.amount) as amount, max(b.age) as oldest from banded b group by b.band, b.customer_id
  )
  select jsonb_agg(jsonb_build_object(
      'band', g.band, 'label', (array['Up to 30 days', '31 to 60 days', '61 to 90 days', 'Over 90 days'])[g.band + 1],
      'total', coalesce((select sum(amount) from banded where band = g.band), 0),
      'customers', coalesce((select jsonb_agg(jsonb_build_object('customer_id', p.customer_id, 'name', c.name, 'phone', c.phone,
          'reminders_ok', c.reminders_ok, 'owes', p.amount, 'oldest_days', p.oldest) order by p.amount desc)
        from (select * from people where band = g.band order by amount desc limit 8) p left join customers c on c.id = p.customer_id), '[]'))
    order by g.band)
    into v_debts
    from generate_series(0, 3) g(band);

  -- 6. What is running out: days of stock left at the last 30 days' pace, against the supplier's wait.
  with free as (
    select product_id, sum(qty - reserved) as free from stock_balances group by product_id
  ), sold as (
    select product_id, sum(qty) as sold from stock_movements where reason = 'sold' and at >= now() - interval '30 days' group by product_id
  ), rows as (
    select p.id, p.sku, p.name, coalesce(f.free, 0) as free, p.lead_days, p.low_stock_at,
      case when coalesce(s.sold, 0) > 0 then round(coalesce(f.free, 0) / (s.sold / 30.0), 1) end as days_left
    from products p left join free f on f.product_id = p.id left join sold s on s.product_id = p.id
    where p.status = 'active'
  )
  select coalesce(jsonb_agg(jsonb_build_object('product_id', id, 'sku', sku, 'name', name, 'free', free, 'days_left', days_left,
      'lead_days', lead_days, 'low_stock_at', low_stock_at) order by coalesce(days_left, case when free <= 0 then 0 else 999 end), name), '[]')
    into v_running
    from (select * from rows
          where (low_stock_at > 0 and free <= low_stock_at) or (days_left is not null and days_left <= lead_days + 7)
          order by coalesce(days_left, case when free <= 0 then 0 else 999 end), name limit 12) r;

  -- 7. Who is due for a new battery: units that reach their usual age this month or in the next five.
  select jsonb_agg(jsonb_build_object('month', g.m::date, 'units', coalesce(x.units, 0), 'customers', coalesce(x.customers, '[]')) order by g.m)
    into v_batteries
    from generate_series(date_trunc('month', v_today), date_trunc('month', v_today) + interval '5 months', interval '1 month') g(m)
    left join (
      select date_trunc('month', u.sold_on + make_interval(months => v_life)) as m, count(*) as units,
        jsonb_agg(distinct jsonb_build_object('customer_id', c.id, 'name', c.name, 'phone', c.phone, 'reminders_ok', c.reminders_ok))
          filter (where c.id is not null) as customers
      from serial_units u join products p on p.id = u.product_id left join customers c on c.id = u.customer_id
      -- Families are free text until the catalogue is set up with the shop, so the name counts too.
      where u.status = 'sold' and (p.family ilike '%batter%' or p.name ilike '%batter%')
      group by 1
    ) x on x.m = g.m;

  return jsonb_build_object(
    'today', v_today, 'period_days', p_days, 'queue', v_queue, 'money_in_today', v_in_today, 'tiles', v_tiles,
    'series', coalesce(v_series, '[]'), 'debts', v_debts, 'running_out', v_running, 'batteries_due', v_batteries,
    'battery_life_months', v_life, 'exceptions', owner_exceptions());
end $$;

grant execute on function owner_today(int) to authenticated;
