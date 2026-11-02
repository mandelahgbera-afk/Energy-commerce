-- Power Store (2026-11-02): what the stock room works from.
-- Storekeepers have no shelf figures (so counts stay blind) and no costs. These two lists give them
-- the work itself: what to pack, and what to count, and nothing they could count to match.

-- Orders whose money covers the goods, oldest first, with the oldest units to pick for serial lines.
-- Covered means the same as at delivery: confirmed money plus card taps still waiting for the bank,
-- or the order is on credit. A transfer still waiting for the bank is not money, so it waits.
-- Only the customer's name is shown: the stock room has no business with phone numbers.
create function pack_list() returns jsonb
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
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'order_id', t.id, 'invoice_no', t.invoice_no, 'customer', c.name, 'channel', t.channel, 'created_on', t.created_on,
      'location_id', t.location_id, 'on_credit', t.on_credit,
      'lines', (select jsonb_agg(jsonb_build_object(
          'product_id', l.product_id, 'sku', p.sku, 'name', p.name, 'unit', p.unit, 'tracking', p.tracking,
          'remaining', l.qty - l.delivered_qty,
          'oldest', case when p.tracking = 'serial' then (
            select coalesce(jsonb_agg(u.serial order by coalesce(u.made_on, u.received_on), u.received_on, u.serial), '[]'::jsonb)
            from (select s.serial, s.made_on, s.received_on from serial_units s
                  where s.product_id = l.product_id and s.location_id = t.location_id and s.status = 'in_stock'
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
  return jsonb_build_object('ready', v_ready, 'waiting_for_money', v_waiting);
end $$;

-- What to count at a shelf: never-counted parts first, then the ones that moved most recently.
-- No quantities, so the count stays blind. Serial-tracked units are counted another way, later.
create function count_list(p_location uuid, p_limit int default 10) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['storekeeper']::staff_role[]);
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then raise exception 'bad_limit'; end if;
  perform 1 from locations where id = p_location;
  if not found then raise exception 'no_such_location'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('product_id', x.id, 'sku', x.sku, 'name', x.name, 'unit', x.unit, 'last_counted_on', x.last_counted)
      order by x.last_counted nulls first, x.moved desc nulls last, x.name), '[]'::jsonb)
    from (
      select p.id, p.sku, p.name, p.unit,
        (select max(sc.counted_on) from stock_count_lines cl join stock_counts sc on sc.id = cl.count_id
          where cl.product_id = p.id and sc.location_id = p_location and sc.status = 'approved') as last_counted,
        (select max(m.at) from stock_movements m where m.product_id = p.id and (m.from_location = p_location or m.to_location = p_location)) as moved
      from products p
      where p.status = 'active' and p.tracking = 'count'
        and exists (select 1 from stock_balances b where b.product_id = p.id and b.location_id = p_location)
      order by 5 nulls first, 6 desc nulls last, p.name
      limit p_limit
    ) x
  );
end $$;

grant execute on function pack_list() to authenticated;
grant execute on function count_list(uuid, int) to authenticated;
