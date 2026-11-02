-- Power Store (2026-11-02): what the Books screen reads. Owner and accountant only.
-- The month close and its preview share one list of checks, so the screen can never promise a
-- close that the close then refuses.

-- Each check a month must pass to close. `problem` is the wording close_month has always used.
create function i_close_checks(p_month date, p_statement_balance bigint) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_end date := (p_month + interval '1 month')::date;
  v_bank bigint;
  v_books jsonb := i_books_check();
  v_checks jsonb := '[]';
  ok boolean;
begin
  select coalesce(sum(e.amount_kobo), 0) into v_bank from ledger_entries e join ledger_txns t on t.id = e.txn_id
    where e.account_code = 'bank' and t.occurred_on < v_end;
  ok := not exists (select 1 from ledger_txns t where t.occurred_on < p_month
                    and not exists (select 1 from closed_periods c where c.month = date_trunc('month', t.occurred_on)::date));
  v_checks := v_checks || jsonb_build_object('name', 'Earlier months are closed', 'ok', ok, 'problem', 'an earlier month is still open');
  v_checks := v_checks || jsonb_build_object('name', 'The books agree with themselves', 'ok', (v_books ->> 'ok')::boolean, 'problem', 'books disagree',
    'detail', v_books -> 'problems');
  ok := not exists (select 1 from till_sessions where status = 'open' and opened_on < v_end);
  v_checks := v_checks || jsonb_build_object('name', 'Every till is closed', 'ok', ok, 'problem', 'a till is still open');
  ok := not exists (select 1 from stock_counts where status = 'submitted' and counted_on < v_end);
  v_checks := v_checks || jsonb_build_object('name', 'Stock counts are decided', 'ok', ok, 'problem', 'a stock count is waiting for a decision');
  ok := not exists (select 1 from safe_counts where status = 'submitted' and counted_on < v_end);
  v_checks := v_checks || jsonb_build_object('name', 'Safe counts are decided', 'ok', ok, 'problem', 'a safe count is waiting for a decision');
  ok := not exists (select 1 from payments where status = 'pending' and recorded_on < v_end);
  v_checks := v_checks || jsonb_build_object('name', 'Transfers and card taps are confirmed', 'ok', ok, 'problem', 'a payment is waiting to be confirmed');
  v_checks := v_checks || jsonb_build_object('name', 'The bank matches the statement', 'ok', p_statement_balance is not null and v_bank = p_statement_balance,
    'problem', case when p_statement_balance is null then 'no statement balance given' else format('bank differs from the statement by %s', v_bank - p_statement_balance) end,
    'books_bank', v_bank, 'difference', case when p_statement_balance is null then null else v_bank - p_statement_balance end);
  return v_checks;
end $$;

-- The same close as before, now reading its checks from i_close_checks.
create or replace function close_month(p_month date, p_statement_balance bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array[]::staff_role[]);
  v_end date;
  problems text[];
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
  select coalesce(array_agg(c ->> 'problem'), '{}') into problems
    from jsonb_array_elements(i_close_checks(p_month, p_statement_balance)) c where not (c ->> 'ok')::boolean;
  if cardinality(problems) > 0 then raise exception 'month_not_ready: %', array_to_string(problems, '; '); end if;
  select count(*) into v_txns from ledger_txns where occurred_on >= p_month and occurred_on < v_end;
  insert into closed_periods (month, closed_by) values (p_month, me) on conflict do nothing;
  perform i_audit(me, 'close_month', 'period', p_month::text, jsonb_build_object('statement_balance', p_statement_balance, 'txns_in_month', v_txns));
end $$;

-- What the Close tab shows before anyone presses Close.
create function month_close_checks(p_month date, p_statement_balance bigint default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['accountant']::staff_role[]);
begin
  if p_month is null or p_month <> date_trunc('month', p_month)::date then raise exception 'not_a_month_start'; end if;
  return jsonb_build_object('month', p_month,
    'closed', exists (select 1 from closed_periods where month = p_month),
    'finished', (p_month + interval '1 month')::date <= shop_today(),
    'checks', i_close_checks(p_month, p_statement_balance));
end $$;

-- How a month went, and what the shop owns and owes at its end, in the owner's words.
-- Owner's money includes every profit and loss so far, so "own = owe + owner" holds whenever the books balance.
create function books_month(p_month date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['accountant']::staff_role[]);
  v_end date;
  v_lines jsonb;
  v_sheet jsonb;
  v_own bigint;
  v_owe bigint;
  v_owner bigint;
  v_income bigint;
  v_costs bigint;
begin
  if p_month is null or p_month <> date_trunc('month', p_month)::date then raise exception 'not_a_month_start'; end if;
  v_end := (p_month + interval '1 month')::date;
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'kind', kind, 'amount', amount) order by kind desc, amount desc), '[]'),
         coalesce(sum(amount) filter (where kind = 'income'), 0), coalesce(sum(amount) filter (where kind = 'expense'), 0)
    into v_lines, v_income, v_costs
    from (select a.code, a.name, a.kind, (case when a.kind = 'income' then -1 else 1 end) * sum(e.amount_kobo) as amount
          from ledger_entries e join ledger_txns t on t.id = e.txn_id join ledger_accounts a on a.code = e.account_code
          where a.kind in ('income', 'expense') and t.occurred_on >= p_month and t.occurred_on < v_end
          group by a.code, a.name, a.kind having sum(e.amount_kobo) <> 0) x;
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'kind', kind, 'amount', amount) order by kind, amount desc), '[]'),
         coalesce(sum(amount) filter (where kind = 'asset'), 0), coalesce(sum(amount) filter (where kind = 'liability'), 0)
    into v_sheet, v_own, v_owe
    from (select a.code, a.name, a.kind, (case when a.kind = 'asset' then 1 else -1 end) * sum(e.amount_kobo) as amount
          from ledger_entries e join ledger_txns t on t.id = e.txn_id join ledger_accounts a on a.code = e.account_code
          where a.kind in ('asset', 'liability', 'equity') and t.occurred_on < v_end
          group by a.code, a.name, a.kind having sum(e.amount_kobo) <> 0) y;
  -- The owner's share: money they put in or took out, plus every profit and loss to the month's end.
  select -coalesce(sum(e.amount_kobo), 0) into v_owner
    from ledger_entries e join ledger_txns t on t.id = e.txn_id join ledger_accounts a on a.code = e.account_code
    where a.kind in ('equity', 'income', 'expense') and t.occurred_on < v_end;
  return jsonb_build_object('month', p_month, 'closed', exists (select 1 from closed_periods where month = p_month),
    'lines', v_lines, 'income', v_income, 'costs', v_costs, 'profit', v_income - v_costs,
    'sheet', v_sheet, 'own', v_own, 'owe', v_owe, 'owner', v_owner, 'balanced', v_own = v_owe + v_owner,
    'months', (select coalesce(jsonb_agg(m order by m desc), '[]') from (select distinct date_trunc('month', occurred_on)::date m from ledger_txns) z));
end $$;

-- Transfers and card taps waiting for the bank, each with the statement lines that could be its
-- money: exact amount first, then the nearest date. Only an exact line is a plain match. A bigger
-- line is shown too, because one transfer can pay for two orders, but it is how a fake alert gets
-- matched against someone else's real money, so a payment with no exact line, older than four
-- hours, is flagged: a screenshot of an alert is not money.
create function bank_matches() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['accountant']::staff_role[]);
begin
  return jsonb_build_object(
    'books_bank', (select coalesce(sum(amount_kobo), 0) from ledger_entries where account_code = 'bank'),
    'waiting', (select coalesce(jsonb_agg(jsonb_build_object(
        'payment_id', p.id, 'method', p.method, 'amount', p.amount_kobo, 'reference', p.reference, 'recorded_on', p.recorded_on,
        'invoice_no', o.invoice_no, 'customer', c.name,
        'no_money_seen', p.created_at < now() - interval '4 hours' and not exists (
          select 1 from bank_lines b where b.amount_kobo - b.matched_kobo = p.amount_kobo),
        'candidates', (select coalesce(jsonb_agg(jsonb_build_object('bank_line_id', b.id, 'occurred_on', b.occurred_on, 'amount', b.amount_kobo,
              'left', b.amount_kobo - b.matched_kobo, 'reference', b.reference, 'narration', b.narration, 'exact', b.amount_kobo - b.matched_kobo = p.amount_kobo)
              order by (b.amount_kobo - b.matched_kobo = p.amount_kobo) desc, abs(b.occurred_on - p.recorded_on), b.occurred_on), '[]')
            from (select * from bank_lines b where b.amount_kobo - b.matched_kobo >= p.amount_kobo
                  order by (b.amount_kobo - b.matched_kobo = p.amount_kobo) desc, abs(b.occurred_on - p.recorded_on) limit 3) b))
        order by p.created_at), '[]')
      from payments p join orders o on o.id = p.order_id left join customers c on c.id = o.customer_id
      where p.status = 'pending' and p.method in ('transfer', 'pos')),
    'unmatched', (select coalesce(jsonb_agg(jsonb_build_object('bank_line_id', b.id, 'occurred_on', b.occurred_on, 'amount', b.amount_kobo,
        'left', b.amount_kobo - b.matched_kobo, 'reference', b.reference, 'narration', b.narration) order by b.occurred_on desc), '[]')
      from bank_lines b where b.matched_kobo < b.amount_kobo));
end $$;

grant execute on function month_close_checks(date, bigint) to authenticated;
grant execute on function books_month(date) to authenticated;
grant execute on function bank_matches() to authenticated;
