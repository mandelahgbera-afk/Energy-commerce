-- Power Store core, part 2: double-entry ledger. A positive amount is a debit, a negative amount is a credit.
-- Every transaction sums to zero or it cannot commit. Entries are never edited: a mistake gets a reversal.

create type account_kind as enum ('asset', 'liability', 'equity', 'income', 'expense');

create table ledger_accounts (
  code text primary key,
  name text not null,
  kind account_kind not null,
  holds_money boolean not null default false
);

insert into ledger_accounts (code, name, kind, holds_money) values
  ('bank', 'Bank', 'asset', true),
  ('cash', 'Cash in tills', 'asset', true),
  ('stock', 'Stock at cost', 'asset', false),
  ('customers_owe', 'Customers owe us', 'asset', false),
  ('suppliers_owed', 'We owe suppliers', 'liability', false),
  ('goods_owed', 'Goods we owe customers', 'liability', false),
  ('vat_payable', 'VAT to pay', 'liability', false),
  ('owner_money', 'Owner''s money', 'equity', false),
  ('sales', 'Sales', 'income', false),
  ('cogs', 'Cost of goods sold', 'expense', false),
  ('rent', 'Rent', 'expense', false),
  ('salaries', 'Salaries', 'expense', false),
  ('fuel_delivery', 'Fuel and delivery', 'expense', false),
  ('bank_charges', 'Bank charges', 'expense', false),
  ('stock_differences', 'Stock differences', 'expense', false),
  ('till_differences', 'Till differences', 'expense', false),
  ('other_costs', 'Other running costs', 'expense', false);

create table closed_periods (
  month date primary key check (month = date_trunc('month', month)::date),
  closed_at timestamptz not null default now(),
  closed_by uuid
);

create table ledger_txns (
  id uuid primary key default gen_random_uuid(),
  occurred_on date not null,
  kind text not null,
  what text not null,
  ref_type text,
  ref_id uuid,
  idempotency_key text unique,
  request_hash text,
  reversal_of uuid unique references ledger_txns(id),
  reason text,
  actor uuid,
  created_at timestamptz not null default now()
);
create index ledger_txns_on on ledger_txns (occurred_on);
create index ledger_txns_ref on ledger_txns (ref_type, ref_id);

create table ledger_entries (
  id bigint generated always as identity primary key,
  txn_id uuid not null references ledger_txns(id),
  account_code text not null references ledger_accounts(code),
  amount_kobo bigint not null check (amount_kobo <> 0),
  customer_id uuid references customers(id),
  supplier_id uuid references suppliers(id)
);
create index ledger_entries_txn on ledger_entries (txn_id);
create index ledger_entries_account on ledger_entries (account_code);
create index ledger_entries_customer on ledger_entries (customer_id) where customer_id is not null;
create index ledger_entries_supplier on ledger_entries (supplier_id) where supplier_id is not null;

create trigger ledger_txns_append_only before update or delete on ledger_txns
  for each row execute function forbid_change();
create trigger ledger_entries_append_only before update or delete on ledger_entries
  for each row execute function forbid_change();
create trigger ledger_txns_no_truncate before truncate on ledger_txns
  for each statement execute function forbid_change();
create trigger ledger_entries_no_truncate before truncate on ledger_entries
  for each statement execute function forbid_change();

create function ledger_txn_balanced() returns trigger
language plpgsql as $$
declare
  s bigint;
begin
  select coalesce(sum(amount_kobo), 0) into s from ledger_entries where txn_id = new.txn_id;
  if s <> 0 then
    raise exception 'ledger_unbalanced: txn % is off by %', new.txn_id, s;
  end if;
  return null;
end $$;

create constraint trigger ledger_balanced after insert on ledger_entries
  deferrable initially deferred for each row execute function ledger_txn_balanced();

-- A transaction's entries must arrive with it. Later additions could quietly change history, even if they balance.
create function ledger_entry_same_txn() returns trigger
language plpgsql as $$
declare
  born timestamptz;
begin
  select created_at into born from ledger_txns where id = new.txn_id;
  if born is distinct from now() then
    raise exception 'ledger_txn_sealed: txn % is already finished', new.txn_id;
  end if;
  return new;
end $$;

create trigger ledger_entries_sealed before insert on ledger_entries
  for each row execute function ledger_entry_same_txn();

create function ledger_period_open() returns trigger
language plpgsql as $$
begin
  -- close_month takes this row for itself, so nothing can land in a month while that month is being closed.
  perform 1 from shop_settings for share;
  -- A typo like 2062 or 1999 would sit outside every month's report.
  if new.occurred_on > shop_today() + 1 then
    raise exception 'future_date: %', new.occurred_on;
  end if;
  if new.occurred_on < shop_today() - 400 then
    raise exception 'too_old: %', new.occurred_on;
  end if;
  -- On or before the latest closed month, not just inside a closed month: an old entry would change every closed month's closing balance.
  if new.occurred_on < (select max(month) + interval '1 month' from closed_periods) then
    raise exception 'period_closed: % is closed', to_char(new.occurred_on, 'Mon YYYY');
  end if;
  return new;
end $$;

create trigger ledger_txns_period before insert on ledger_txns
  for each row execute function ledger_period_open();

-- p_lines: [{"account": "bank", "amount": 100, "customer_id": null, "supplier_id": null}, ...]
-- With a key, posting the same thing twice returns the first transaction. The same key on something different is refused.
-- Screens never choose these keys directly: each function prefixes the client's key, so it can't collide with an internal one.
create function i_post_txn(
  p_kind text, p_what text, p_on date, p_lines jsonb,
  p_ref_type text default null, p_ref_id uuid default null, p_key text default null,
  p_actor uuid default null, p_reversal_of uuid default null, p_reason text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t uuid;
  l jsonb;
  n int := 0;
  v_hash text := md5(p_kind || coalesce(p_lines::text, ''));
  v_seen text;
begin
  -- Looked up first, so a retry after the month has closed still gets its first answer.
  if p_key is not null then
    select id, request_hash into t, v_seen from ledger_txns where idempotency_key = p_key;
    if found then
      if v_seen is distinct from v_hash then raise exception 'key_reused'; end if;
      return t;
    end if;
  end if;
  insert into ledger_txns (occurred_on, kind, what, ref_type, ref_id, idempotency_key, request_hash, reversal_of, reason, actor)
  values (p_on, p_kind, p_what, p_ref_type, p_ref_id, p_key, v_hash, p_reversal_of, p_reason, p_actor)
  on conflict (idempotency_key) do nothing
  returning id into t;
  if t is null then
    select id, request_hash into t, v_seen from ledger_txns where idempotency_key = p_key;
    if v_seen is distinct from v_hash then raise exception 'key_reused'; end if;
    return t;
  end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    if coalesce((l ->> 'amount')::bigint, 0) <> 0 then
      insert into ledger_entries (txn_id, account_code, amount_kobo, customer_id, supplier_id)
      values (t, l ->> 'account', (l ->> 'amount')::bigint, (l ->> 'customer_id')::uuid, (l ->> 'supplier_id')::uuid);
      n := n + 1;
    end if;
  end loop;
  if n = 0 then raise exception 'ledger_empty: nothing to post'; end if;
  return t;
end $$;

-- Reverses a manual entry. Sales, payments and stock have their own functions, so stock and customer records move with the money.
create function reverse_txn(p_txn uuid, p_reason text, p_on date default shop_today()) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['accountant']::staff_role[]);
  t ledger_txns;
  lines jsonb;
  r uuid;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  select * into t from ledger_txns where id = p_txn;
  if not found then raise exception 'no_such_txn'; end if;
  if t.reversal_of is not null then raise exception 'cannot_reverse_a_reversal'; end if;
  if t.ref_type is not null and t.ref_type <> 'expense' and t.ref_type <> 'journal' then
    raise exception 'use_domain_function: reverse this through its %', t.ref_type;
  end if;
  if exists (select 1 from ledger_txns where reversal_of = p_txn) then raise exception 'already_reversed'; end if;
  select jsonb_agg(jsonb_build_object('account', account_code, 'amount', -amount_kobo, 'customer_id', customer_id, 'supplier_id', supplier_id))
    into lines from ledger_entries where txn_id = p_txn;
  r := i_post_txn('reversal', 'Reversal of: ' || t.what, p_on, lines, t.ref_type, t.ref_id, null, me, p_txn, p_reason);
  perform i_audit(me, 'reverse_txn', 'ledger_txn', p_txn::text, jsonb_build_object('reason', p_reason, 'reversal', r));
  return r;
end $$;

-- Opening entries move money against the owner's own, so they are only for the go-live period and only for the owner.
-- Otherwise a shortfall at the bank could be quietly written off against the owner's money.
create function i_require_go_live() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from closed_periods) then raise exception 'books_already_running'; end if;
end $$;

-- Money and supplier balances on the go-live day. Stock and customer debts have their own opening functions, so their records move with the money.
-- The amount is always positive: what the shop holds, or what it owes that supplier.
create function post_opening_balance(p_key text, p_account text, p_amount bigint, p_on date, p_supplier uuid default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array[]::staff_role[]);
  v_signed bigint;
begin
  perform i_require_key(p_key);
  perform i_require_go_live();
  if p_amount is null or p_amount <= 0 then raise exception 'bad_amount'; end if;
  if p_account not in ('bank', 'cash', 'suppliers_owed') then raise exception 'use_domain_function: %', p_account; end if;
  if (p_account = 'suppliers_owed') <> (p_supplier is not null) then raise exception 'supplier_required'; end if;
  v_signed := case when p_account = 'suppliers_owed' then -p_amount else p_amount end;
  return i_post_txn('opening', 'Opening balance: ' || p_account, p_on,
    jsonb_build_array(
      jsonb_build_object('account', p_account, 'amount', v_signed, 'supplier_id', p_supplier),
      jsonb_build_object('account', 'owner_money', 'amount', -v_signed)),
    'journal', null, 'opening:' || p_key, me);
end $$;

create function record_expense(p_key text, p_account text, p_amount bigint, p_paid_from text, p_what text, p_on date default shop_today()) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['accountant']::staff_role[]);
begin
  perform i_require_key(p_key);
  if p_amount is null or p_amount <= 0 then raise exception 'bad_amount'; end if;
  if not exists (select 1 from ledger_accounts where code = p_account and kind = 'expense') then raise exception 'not_an_expense_account'; end if;
  if not exists (select 1 from ledger_accounts where code = p_paid_from and holds_money) then raise exception 'not_a_money_account'; end if;
  return i_post_txn('expense', p_what, p_on,
    jsonb_build_array(jsonb_build_object('account', p_account, 'amount', p_amount), jsonb_build_object('account', p_paid_from, 'amount', -p_amount)),
    'expense', null, 'expense:' || p_key, me);
end $$;

create function move_money(p_key text, p_from text, p_to text, p_amount bigint, p_on date default shop_today()) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['accountant']::staff_role[]);
begin
  perform i_require_key(p_key);
  if p_amount is null or p_amount <= 0 then raise exception 'bad_amount'; end if;
  if p_from = p_to or not exists (select 1 from ledger_accounts where code = p_from and holds_money)
     or not exists (select 1 from ledger_accounts where code = p_to and holds_money) then
    raise exception 'not_a_money_account';
  end if;
  return i_post_txn('transfer', 'Moved ' || p_from || ' to ' || p_to, p_on,
    jsonb_build_array(jsonb_build_object('account', p_to, 'amount', p_amount), jsonb_build_object('account', p_from, 'amount', -p_amount)),
    'journal', null, 'move:' || p_key, me);
end $$;

create function pay_supplier(p_key text, p_supplier uuid, p_amount bigint, p_from text default 'bank', p_on date default shop_today()) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['accountant']::staff_role[]);
  nm text;
begin
  perform i_require_key(p_key);
  if p_amount is null or p_amount <= 0 then raise exception 'bad_amount'; end if;
  if not exists (select 1 from ledger_accounts where code = p_from and holds_money) then raise exception 'not_a_money_account'; end if;
  select name into nm from suppliers where id = p_supplier;
  if not found then raise exception 'no_such_supplier'; end if;
  return i_post_txn('supplier_payment', 'Paid ' || nm, p_on,
    jsonb_build_array(jsonb_build_object('account', 'suppliers_owed', 'amount', p_amount, 'supplier_id', p_supplier), jsonb_build_object('account', p_from, 'amount', -p_amount)),
    'journal', null, 'supplier:' || p_key, me);
end $$;

-- Profit for a month and balances at its end, all worked out from the entries.
create function month_report(p_month date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['accountant']::staff_role[]);
  lines jsonb;
  bal jsonb;
  income bigint;
  costs bigint;
begin
  select coalesce(jsonb_object_agg(code, amt), '{}'), coalesce(sum(amt) filter (where kind = 'income'), 0), coalesce(sum(amt) filter (where kind = 'expense'), 0)
    into lines, income, costs
  from (
    select a.code, a.kind, case when a.kind = 'income' then -sum(e.amount_kobo) else sum(e.amount_kobo) end as amt
    from ledger_entries e
    join ledger_txns t on t.id = e.txn_id
    join ledger_accounts a on a.code = e.account_code
    where a.kind in ('income', 'expense') and date_trunc('month', t.occurred_on)::date = p_month
    group by a.code, a.kind
  ) x;
  select coalesce(jsonb_object_agg(code, amt), '{}') into bal
  from (
    select a.code, case when a.kind = 'asset' then sum(e.amount_kobo) else -sum(e.amount_kobo) end as amt
    from ledger_entries e
    join ledger_txns t on t.id = e.txn_id
    join ledger_accounts a on a.code = e.account_code
    where a.kind in ('asset', 'liability', 'equity') and t.occurred_on < (p_month + interval '1 month')::date
    group by a.code, a.kind
  ) y;
  return jsonb_build_object('month', p_month, 'lines', lines, 'income', income, 'costs', costs, 'profit', income - costs, 'balances', bal);
end $$;
