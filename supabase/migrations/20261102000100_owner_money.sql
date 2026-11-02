-- Power Store, new work (2026-11-02): the owner's money and the safe.
-- The owner puts money in or takes it out, always against owner_money (equity), never a running cost,
-- and never through a till: a till count must only ever show the till's own difference.
-- The safe is counted like a shelf: blind for whoever counts, decided by the owner, and the
-- difference lands in the books against a new safe_differences expense account.

insert into ledger_accounts (code, name, kind, holds_money) values
  ('safe_differences', 'Safe differences', 'expense', false)
on conflict (code) do nothing;

-- The cash that should be in open tills right now: float plus confirmed cash payments minus paid-outs.
-- The same sum close_till uses, so the safe's expected figure and a till's expected figure never disagree.
create function i_tills_expected() returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(s.float_kobo
      + coalesce((select sum(case when p.kind = 'payment' then p.amount_kobo else -p.amount_kobo end)
                  from payments p where p.till_session_id = s.id and p.method = 'cash' and p.status = 'confirmed'), 0)
      - coalesce((select sum(t.amount_kobo) from till_paid_outs t where t.session_id = s.id), 0)), 0)
  from till_sessions s where s.status = 'open'
$$;

create table safe_counts (
  id uuid primary key default gen_random_uuid(),
  client_key text not null unique,
  client_hash text,
  counted_on date not null default shop_today(),
  counted_at timestamptz not null,
  counted_kobo bigint not null check (counted_kobo >= 0),
  status count_status not null default 'submitted',
  counted_by uuid,
  expected_kobo bigint,
  difference_kobo bigint,
  decided_by uuid,
  reason text,
  txn_id uuid references ledger_txns(id),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

-- Only the owner and accountant read this: the person counting must never see the expected figure.
alter table safe_counts enable row level security;
revoke all on safe_counts from public, anon, authenticated, service_role;
grant select on safe_counts to authenticated;
create policy safe_counts_read on safe_counts for select to authenticated
  using (has_staff_role(array['accountant']::staff_role[]));

-- Money the owner puts into the shop, against the owner's own money. Reversible like any journal entry.
create function owner_money_in(p_key text, p_account text, p_amount bigint, p_what text, p_on date default shop_today()) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['accountant']::staff_role[]);
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

-- Money the owner takes out for themselves. Still equity, never a cost, so profit is untouched.
create function owner_money_out(p_key text, p_account text, p_amount bigint, p_what text, p_on date default shop_today()) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['accountant']::staff_role[]);
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

-- A blind count of the safe. Nothing comes back but the id, and counters cannot read the table.
-- p_counted_at is when the cash was actually counted: a count is judged from that moment, so a
-- withdrawal between counting and tapping in cannot hide behind a later submission time.
-- The share lock on shop_settings keeps the count out of a month close in flight, and out of an approval in flight.
create function submit_safe_count(p_key text, p_counted bigint, p_counted_at timestamptz) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter', 'accountant']::staff_role[]);
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

-- A typed 100000 instead of 10000 must be refusable, or it could only be approved or block the month close for ever.
create function reject_safe_count(p_count uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array[]::staff_role[]);
  c safe_counts;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  select * into c from safe_counts where id = p_count for update;
  if not found then raise exception 'no_such_count'; end if;
  if c.status <> 'submitted' then raise exception 'count_already_decided'; end if;
  update safe_counts set status = 'rejected', decided_by = me, decided_at = now(), reason = p_reason where id = p_count;
  perform i_audit(me, 'reject_safe_count', 'safe_count', p_count::text, jsonb_build_object('reason', p_reason));
end $$;

-- The expected figure is worked out now, not when the count was taken, and the count goes stale if any
-- cash moved or any till opened or closed since it was counted: an old count must never take today's
-- money twice, and a count taken before a drawer was opened cannot be blamed for the float leaving the safe.
-- The shop_settings lock excludes every posting (each takes a share of the row on its way in) and every
-- till open or close, so the check and the figures all see one consistent moment.
create function approve_safe_count(p_count uuid, p_on date default shop_today()) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array[]::staff_role[]);
  c safe_counts;
  v_cash bigint;
  v_expected bigint;
  v_diff bigint;
  v_txn uuid;
begin
  select * into c from safe_counts where id = p_count for update;
  if not found then raise exception 'no_such_count'; end if;
  if c.status <> 'submitted' then raise exception 'count_already_decided'; end if;
  perform 1 from shop_settings for update;
  -- The caller's clock reports milliseconds, so anything within the same millisecond as the count
  -- is treated as before it, not after: a posting that landed 0.4ms before the count must not
  -- make the count look old.
  if exists (select 1 from ledger_txns t join ledger_entries e on e.txn_id = t.id
             where e.account_code = 'cash' and t.created_at > c.counted_at + interval '999 microseconds')
     or exists (select 1 from till_sessions s where s.opened_at > c.counted_at + interval '999 microseconds'
                or s.closed_at > c.counted_at + interval '999 microseconds') then
    raise exception 'count_out_of_date: recount the safe';
  end if;
  select coalesce(sum(amount_kobo), 0) into v_cash from ledger_entries where account_code = 'cash';
  v_expected := v_cash - i_tills_expected();
  v_diff := c.counted_kobo - v_expected;
  if v_diff <> 0 then
    v_txn := i_post_txn('safe_count', 'Safe count difference', p_on,
      jsonb_build_array(jsonb_build_object('account', 'cash', 'amount', v_diff),
        jsonb_build_object('account', 'safe_differences', 'amount', -v_diff)),
      'safe_count', p_count, 'safe:' || p_count, me);
  end if;
  update safe_counts set status = 'approved', expected_kobo = v_expected, difference_kobo = v_diff,
    decided_by = me, decided_at = now(), txn_id = v_txn where id = p_count;
  perform i_audit(me, 'approve_safe_count', 'safe_count', p_count::text, jsonb_build_object('difference', v_diff));
  return v_diff;
end $$;

-- The one-line answer to "does the ledger cash equal the tills plus the safe?": ledger cash,
-- what open tills should hold, what that leaves for the safe, and the last decided count.
create function cash_position() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['accountant']::staff_role[]);
  v_cash bigint;
  v_last jsonb;
begin
  select coalesce(sum(amount_kobo), 0) into v_cash from ledger_entries where account_code = 'cash';
  select coalesce(jsonb_build_object('id', id, 'counted', counted_kobo, 'difference', difference_kobo, 'on', counted_on), '{}'::jsonb)
    into v_last from safe_counts where status = 'approved' order by decided_at desc limit 1;
  return jsonb_build_object('ledger_cash', v_cash, 'in_open_tills', i_tills_expected(), 'implied_safe', v_cash - i_tills_expected(), 'last_safe_count', v_last);
end $$;

-- The same close_month, with one new stop: a safe count that was taken but not decided keeps the
-- month open, like a stock count does.
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
  if exists (select 1 from payments where status = 'pending' and recorded_on < v_end) then problems := problems || 'a transfer is waiting to be confirmed'::text; end if;
  select coalesce(sum(e.amount_kobo), 0) into v_bank from ledger_entries e join ledger_txns t on t.id = e.txn_id
    where e.account_code = 'bank' and t.occurred_on < v_end;
  if v_bank <> p_statement_balance then problems := problems || format('bank differs from the statement by %s', v_bank - p_statement_balance); end if;
  if cardinality(problems) > 0 then raise exception 'month_not_ready: %', array_to_string(problems, '; '); end if;
  select count(*) into v_txns from ledger_txns where occurred_on >= p_month and occurred_on < v_end;
  insert into closed_periods (month, closed_by) values (p_month, me) on conflict do nothing;
  perform i_audit(me, 'close_month', 'period', p_month::text, jsonb_build_object('statement_balance', p_statement_balance, 'txns_in_month', v_txns));
end $$;

-- The owner's list gains one entry: safe counts waiting for a decision, so a stale count can't
-- quietly block the month close for ever.
create or replace function owner_exceptions() returns jsonb
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
    'approvals', (select count(*) from approvals where status = 'pending'),
    'safe_counts_waiting', (select count(*) from safe_counts where status = 'submitted')
  );
end $$;

-- Till open and close now take a share of shop_settings, so a safe count being approved (which holds
-- that row alone) sees one consistent set of tills: a drawer opened or closed mid-approval waits.
create or replace function open_till(p_float bigint) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter', 'accountant']::staff_role[]);
  v_id uuid;
begin
  if p_float < 0 then raise exception 'bad_amount'; end if;
  select id into v_id from till_sessions where staff_id = me and status = 'open';
  if found then raise exception 'till_already_open'; end if;
  perform 1 from shop_settings for share;
  insert into till_sessions (staff_id, float_kobo) values (me, p_float) returning id into v_id;
  return v_id;
end $$;

create or replace function close_till(p_counted bigint, p_session uuid default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter', 'accountant']::staff_role[]);
  s till_sessions;
  v_expected bigint;
  v_diff bigint;
  v_txn uuid;
begin
  if p_counted is null or p_counted < 0 then raise exception 'bad_amount'; end if;
  perform 1 from shop_settings for share;
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

grant execute on function owner_money_in(text, text, bigint, text, date) to authenticated;
grant execute on function owner_money_out(text, text, bigint, text, date) to authenticated;
grant execute on function submit_safe_count(text, bigint, timestamptz) to authenticated;
grant execute on function approve_safe_count(uuid, date) to authenticated;
grant execute on function reject_safe_count(uuid, text) to authenticated;
grant execute on function cash_position() to authenticated;
