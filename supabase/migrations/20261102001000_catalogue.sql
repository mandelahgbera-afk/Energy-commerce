-- Power Store (2026-11-02): the public catalogue and "request a quote".
-- Anyone may browse and ask for a quote without an account. Nothing here moves money or stock: a
-- request is a note for the counter, who turns it into a real quote at the day's prices.
-- The public sees shelf prices and in, low or out. Never trade prices, costs or exact counts.

-- p_query: a name, a part number in any spelling, or a size like 25 x 52 x 15. p_family narrows it.
create function catalogue(p_query text default null, p_family text default null, p_limit int default 48) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_q text := nullif(trim(coalesce(p_query, '')), '');
  v_like text;
  v_norm text := i_norm_part(coalesce(p_query, ''));
  v_nums numeric[] := coalesce((select array_agg(m[1]::numeric) from regexp_matches(coalesce(p_query, ''), '[0-9]+(?:\.[0-9]+)?', 'g') m), '{}'::numeric[]);
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'bad_limit'; end if;
  if length(coalesce(p_query, '')) > 80 or length(coalesce(p_family, '')) > 60 then raise exception 'bad_query'; end if;
  v_like := '%' || regexp_replace(coalesce(v_q, ''), '([%_\\])', '\\\1', 'g') || '%';
  return jsonb_build_object(
    'families', (select coalesce(jsonb_agg(jsonb_build_object('family', family, 'count', n) order by family), '[]'::jsonb)
                 from (select family, count(*) n from products where status = 'active' group by family) f),
    'items', (select coalesce(jsonb_agg(x.item order by x.rank, x.name), '[]'::jsonb) from (
      select jsonb_build_object('product', p.id, 'sku', p.sku, 'name', p.name, 'family', p.family, 'unit', p.unit,
          'part_number', p.part_number, 'price', p.price_kobo, 'warranty_months', p.warranty_months,
          'sizes', case when s.product_id is null then null else jsonb_build_object('bore', s.bore_mm, 'outside', s.outside_mm, 'width', s.width_mm) end,
          'state', (select case when coalesce(sum(b.qty - b.reserved), 0) <= 0 then 'out' when sum(b.qty - b.reserved) <= p.low_stock_at then 'low' else 'in' end
                    from stock_balances b where b.product_id = p.id)) as item,
        case when v_q is null then 5
             when v_norm <> '' and p.part_number_norm = v_norm then 1
             when length(v_norm) >= 3 and p.part_number_norm like v_norm || '%' then 2
             when cardinality(v_nums) >= 3 and s.bore_mm = v_nums[1] and s.outside_mm = v_nums[2] and s.width_mm = v_nums[3] then 3
             else 4 end as rank,
        p.name
      from products p left join product_sizes s on s.product_id = p.id
      where p.status = 'active' and (p_family is null or p.family = p_family)
        and (v_q is null
          or (v_norm <> '' and p.part_number_norm = v_norm)
          or (length(v_norm) >= 3 and p.part_number_norm like v_norm || '%')
          or (cardinality(v_nums) >= 3 and s.bore_mm = v_nums[1] and s.outside_mm = v_nums[2] and s.width_mm = v_nums[3])
          or p.name ilike v_like or p.sku ilike v_like)
      order by 2, p.name
      limit p_limit) x));
end $$;

create table quote_requests (
  id uuid primary key default gen_random_uuid(),
  client_key text not null unique,
  client_hash text,
  request_no text unique,
  name text not null check (length(name) between 1 and 80),
  phone text not null check (phone ~ '^234[0-9]{10}$'),
  email text check (email is null or (length(email) <= 120 and email = lower(email))),
  lines jsonb not null,
  note text check (note is null or length(note) <= 500),
  status text not null default 'new' check (status in ('new', 'quoted', 'closed')),
  quote_id uuid references quotes(id),
  reason text,
  handled_by uuid,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
create index quote_requests_open on quote_requests (created_at) where status = 'new';
create index quote_requests_phone on quote_requests (phone, created_at);
alter table quote_requests enable row level security;
revoke all on quote_requests from public, anon, authenticated, service_role;
grant select on quote_requests to authenticated;
create policy quote_requests_read on quote_requests for select to authenticated using (has_staff_role(array['counter', 'accountant']::staff_role[]));

-- A visitor asks for a quote. The lines are checked against the live catalogue and kept as
-- product and quantity only; prices are set when the counter makes the quote. A phone may ask
-- five times a day, and the shop takes at most 200 requests an hour, until bot protection is on.
create function request_quote(p_key text, p_name text, p_phone text, p_lines jsonb, p_note text default null, p_email text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_phone text;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_lines jsonb := '[]';
  v_hash text;
  v_seen quote_requests;
  v_id uuid;
  l jsonb;
  pr products;
  q numeric;
begin
  perform i_require_key(p_key);
  select * into v_seen from quote_requests where client_key = p_key;
  if v_name is null or length(v_name) > 80 then raise exception 'name_required'; end if;
  v_phone := normalize_phone(p_phone);
  if v_email is not null and (length(v_email) > 120 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'bad_email'; end if;
  if v_note is not null and length(v_note) > 500 then raise exception 'note_too_long'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 30 then raise exception 'bad_lines'; end if;
  for l in select * from jsonb_array_elements(p_lines) order by (value ->> 'product_id')::uuid loop
    select * into pr from products where id = (l ->> 'product_id')::uuid and status = 'active';
    if not found then raise exception 'no_such_product'; end if;
    if v_lines @> jsonb_build_array(jsonb_build_object('product_id', pr.id)) then raise exception 'duplicate_product: %', pr.sku; end if;
    q := (l ->> 'qty')::numeric;
    perform i_check_qty(pr.unit, q);
    v_lines := v_lines || jsonb_build_object('product_id', pr.id, 'qty', q);
  end loop;
  v_hash := md5(jsonb_build_object('name', v_name, 'phone', v_phone, 'lines', v_lines, 'note', v_note, 'email', v_email)::text);
  if v_seen.id is not null then
    if v_seen.client_hash is distinct from v_hash then raise exception 'key_reused'; end if;
    return jsonb_build_object('request_no', v_seen.request_no, 'lines', jsonb_array_length(v_seen.lines));
  end if;
  if (select count(*) from quote_requests where phone = v_phone and created_at > now() - interval '1 day') >= 5
     or (select count(*) from quote_requests where created_at > now() - interval '1 hour') >= 200 then
    raise exception 'too_many_requests';
  end if;
  insert into quote_requests (client_key, client_hash, name, phone, email, lines, note)
  values (p_key, v_hash, v_name, v_phone, v_email, v_lines, v_note)
  on conflict (client_key) do nothing returning id into v_id;
  if v_id is null then
    select * into v_seen from quote_requests where client_key = p_key;
    if v_seen.client_hash is distinct from v_hash then raise exception 'key_reused'; end if;
    return jsonb_build_object('request_no', v_seen.request_no, 'lines', jsonb_array_length(v_seen.lines));
  end if;
  update quote_requests set request_no = i_next_doc('RQ', shop_today()) where id = v_id;
  return jsonb_build_object('request_no', (select request_no from quote_requests where id = v_id), 'lines', jsonb_array_length(v_lines));
end $$;

-- Requests waiting for the counter, with today's shelf prices so they can quote at once.
create function open_quote_requests() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter', 'accountant']::staff_role[]);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'request_no', r.request_no, 'name', r.name, 'phone', r.phone, 'email', r.email,
      'note', r.note, 'created_at', r.created_at,
      'lines', (select jsonb_agg(jsonb_build_object('product_id', p.id, 'sku', p.sku, 'name', p.name, 'qty', (l ->> 'qty')::numeric, 'price', p.price_kobo,
          'active', p.status = 'active') order by p.name)
        from jsonb_array_elements(r.lines) l join products p on p.id = (l ->> 'product_id')::uuid))
      order by r.created_at), '[]'::jsonb)
    from quote_requests r where r.status = 'new');
end $$;

-- The counter turns a request into a real quote, for the customer found or added by phone.
-- create_quote does the pricing and its own role check, so the rules are the same as any quote.
create function quote_from_request(p_request uuid, p_location uuid, p_valid_days int default 7) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter', 'accountant']::staff_role[]);
  r quote_requests;
  v_customer uuid;
  v_quote uuid;
begin
  select * into r from quote_requests where id = p_request for update;
  if not found then raise exception 'no_such_request'; end if;
  if r.status <> 'new' then
    if r.status = 'quoted' then return r.quote_id; end if;
    raise exception 'request_not_open';
  end if;
  v_customer := i_customer_for_phone(r.phone, r.name);
  -- A fresh key each time: the row lock and status make this safe to retry, and nobody can take the key first.
  v_quote := create_quote('request:' || r.id || ':' || gen_random_uuid(), p_location, r.lines, v_customer, p_valid_days, 'From request ' || r.request_no);
  update quote_requests set status = 'quoted', quote_id = v_quote, handled_by = me, handled_at = now() where id = r.id;
  perform i_audit(me, 'quote_from_request', 'quote_request', r.id::text, jsonb_build_object('quote', v_quote));
  return v_quote;
end $$;

create function close_quote_request(p_request uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter', 'accountant']::staff_role[]);
  r quote_requests;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  select * into r from quote_requests where id = p_request for update;
  if not found then raise exception 'no_such_request'; end if;
  if r.status <> 'new' then raise exception 'request_not_open'; end if;
  update quote_requests set status = 'closed', reason = p_reason, handled_by = me, handled_at = now() where id = r.id;
  perform i_audit(me, 'close_quote_request', 'quote_request', r.id::text, jsonb_build_object('reason', p_reason));
end $$;

grant execute on function catalogue(text, text, int) to anon, authenticated;
grant execute on function request_quote(text, text, text, jsonb, text, text) to anon, authenticated;
grant execute on function open_quote_requests() to authenticated;
grant execute on function quote_from_request(uuid, uuid, int) to authenticated;
grant execute on function close_quote_request(uuid, text) to authenticated;
