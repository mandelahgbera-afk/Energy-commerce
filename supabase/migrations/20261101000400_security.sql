-- Power Store core, part 5: who may see and do what. This runs after everything else, and starts from "nobody, nothing".
-- API roles never write to a table. Every change goes through a role-checked function that runs with its owner's rights.
-- Cost lives only in product_costs, order_line_costs, goods_receipts and the ledger, which only the owner and accountant can read.

do $$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from public, anon, authenticated, service_role', t);
  end loop;
end $$;

revoke all on all sequences in schema public from public, anon, authenticated, service_role;
revoke all on all functions in schema public from public, anon, authenticated, service_role;

-- New objects start closed too. Postgres can't remove its default "anyone can run a function" per schema, only everywhere.
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges in schema public revoke all on functions from anon, authenticated, service_role;

do $$
declare
  f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proconfig is null loop
    execute format('alter function %s set search_path = public, pg_temp', f);
  end loop;
end $$;

-- Reading. Row-level security decides which rows; a table with no policy here shows nothing to API roles.
grant select on products to anon, authenticated;
create policy products_public on products for select to anon using (status = 'active');
create policy products_read on products for select to authenticated using (status = 'active' or is_staff());

grant select on staff, customers, suppliers, audit_log, ledger_accounts, ledger_txns, ledger_entries, closed_periods,
  product_costs, product_trade_prices, locations, stock_balances, lots, serial_units, stock_movements, goods_receipts, stock_counts, stock_count_lines,
  shop_settings, till_sessions, till_paid_outs, orders, order_lines, order_line_costs, deliveries, order_line_serials,
  bank_lines, payments, approvals
to authenticated;

create policy staff_read on staff for select to authenticated using (id = auth.uid() or has_staff_role(array[]::staff_role[]));
create policy audit_read on audit_log for select to authenticated using (has_staff_role(array[]::staff_role[]));

create policy customers_read on customers for select to authenticated
  using (user_id = auth.uid() or has_staff_role(array['counter', 'dispatcher', 'accountant']::staff_role[]));
create policy suppliers_read on suppliers for select to authenticated using (has_staff_role(array['accountant', 'storekeeper']::staff_role[]));

create policy ledger_accounts_read on ledger_accounts for select to authenticated using (has_staff_role(array['accountant']::staff_role[]));
create policy ledger_txns_read on ledger_txns for select to authenticated using (has_staff_role(array['accountant']::staff_role[]));
create policy ledger_entries_read on ledger_entries for select to authenticated using (has_staff_role(array['accountant']::staff_role[]));
create policy closed_periods_read on closed_periods for select to authenticated using (has_staff_role(array['accountant']::staff_role[]));

create policy product_costs_read on product_costs for select to authenticated using (has_staff_role(array['accountant']::staff_role[]));
create policy order_line_costs_read on order_line_costs for select to authenticated using (has_staff_role(array['accountant']::staff_role[]));
create policy goods_receipts_read on goods_receipts for select to authenticated using (has_staff_role(array['accountant']::staff_role[]));

create policy product_trade_prices_read on product_trade_prices for select to authenticated using (
  is_staff() or exists (select 1 from customers c where c.user_id = auth.uid() and c.kind in ('installer', 'business'))
);

create policy locations_read on locations for select to authenticated using (is_staff());
create policy shop_settings_read on shop_settings for select to authenticated using (is_staff());
create policy lots_read on lots for select to authenticated using (has_staff_role(array['accountant', 'storekeeper']::staff_role[]));

-- The person counting must not be able to look up the expected figure, so storekeepers get no shelf numbers.
-- They receive, pack and count from what a screen asks them to do. If the shop visit shows they need more, this is the place to change.
create policy stock_balances_read on stock_balances for select to authenticated using (has_staff_role(array['counter', 'dispatcher', 'accountant']::staff_role[]));
create policy serial_units_read on serial_units for select to authenticated using (has_staff_role(array['counter', 'dispatcher', 'accountant']::staff_role[]));
create policy stock_movements_read on stock_movements for select to authenticated using (has_staff_role(array['accountant']::staff_role[]));
create policy stock_counts_read on stock_counts for select to authenticated using (has_staff_role(array['accountant']::staff_role[]));
create policy stock_count_lines_read on stock_count_lines for select to authenticated using (has_staff_role(array['accountant']::staff_role[]));
create policy till_sessions_read on till_sessions for select to authenticated using (has_staff_role(array['accountant']::staff_role[]));
create policy till_paid_outs_read on till_paid_outs for select to authenticated using (has_staff_role(array['accountant']::staff_role[]));
create policy bank_lines_read on bank_lines for select to authenticated using (has_staff_role(array['accountant']::staff_role[]));

-- Customers see their own orders, once they have an account.
create policy orders_read on orders for select to authenticated using (
  has_staff_role(array['counter', 'storekeeper', 'dispatcher', 'accountant']::staff_role[])
  or customer_id in (select id from customers where user_id = auth.uid())
);
create policy order_lines_read on order_lines for select to authenticated using (order_id in (select id from orders));
create policy deliveries_read on deliveries for select to authenticated using (order_id in (select id from orders));
create policy order_line_serials_read on order_line_serials for select to authenticated using (line_id in (select id from order_lines));
create policy payments_read on payments for select to authenticated using (
  has_staff_role(array['counter', 'accountant']::staff_role[])
  or order_id in (select id from orders where customer_id in (select id from customers where user_id = auth.uid()))
);
create policy approvals_read on approvals for select to authenticated using (asked_by = auth.uid() or has_staff_role(array[]::staff_role[]));

-- Doing. Each of these checks the caller's role itself.
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function shop_today() to anon, authenticated, service_role;
grant execute on function has_staff_role(staff_role[]) to anon, authenticated;
grant execute on function is_staff() to anon, authenticated;

grant execute on function receipt_by_token(uuid) to anon, authenticated;
grant execute on function availability(uuid[]) to anon, authenticated;
grant execute on function check_serial(text) to anon, authenticated;

grant execute on function
  reverse_txn(uuid, text, date),
  post_opening_balance(text, text, bigint, date, uuid),
  record_expense(text, text, bigint, text, text, date),
  move_money(text, text, text, bigint, date),
  pay_supplier(text, uuid, bigint, text, date),
  month_report(date),
  save_product(text, text, bigint, bigint, product_tracking, product_unit, int, int, text, int, int, jsonb, numeric),
  set_last_cost(uuid, bigint),
  receive_goods(text, uuid, uuid, jsonb, date),
  transfer_stock(uuid, uuid, uuid, numeric, text[]),
  oldest_serials(uuid, uuid, int),
  submit_stock_count(text, uuid, jsonb),
  reject_stock_count(uuid, text),
  approve_stock_count(uuid, date),
  save_staff(uuid, text, staff_role, numeric, boolean),
  save_location(text, location_kind),
  save_supplier(text, text),
  save_customer(text, text, text, boolean),
  set_customer_terms(uuid, customer_kind, bigint),
  create_order(text, uuid, jsonb, text, text, order_channel, boolean, boolean, text),
  take_payment(text, uuid, payment_method, bigint, text),
  deliver_order(text, uuid, jsonb),
  counter_sale(text, uuid, jsonb, payment_method, text, text, text),
  add_bank_line(text, date, bigint, text, text),
  confirm_payment(uuid, uuid),
  reject_payment(uuid, text),
  reverse_payment(uuid, text, date),
  refund_order(text, uuid, bigint, payment_method, text, date),
  cancel_order(uuid, text),
  reserve_order(uuid),
  decide_approval(uuid, boolean, text),
  open_till(bigint),
  my_till(),
  till_paid_out(text, text, bigint, text),
  close_till(bigint, uuid),
  post_opening_debt(text, uuid, bigint, date),
  void_opening_debt(uuid, text),
  customer_balance(uuid),
  debtors(),
  books_check(),
  close_month(date, bigint),
  owner_exceptions()
to authenticated;

-- Scheduled jobs on the server.
grant execute on function expire_holds() to service_role;
grant execute on function i_books_check() to service_role;
