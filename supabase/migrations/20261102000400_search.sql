-- Power Store, new work (2026-11-02): catalogue search and substitutes.
-- A part number written any way finds the part, and a size like 25 x 52 x 15 finds everything
-- that fits. "Same part" is told apart from "fits but differs".
--
-- Why no pg_trgm extension: PGlite (the fast test engine) cannot load it, and the real Postgres
-- can. So the similarity here is the same trigram algorithm in pure SQL, identical on both.
-- When the real price list makes a scan slow, one later migration swaps in pg_trgm and a GIN index.

alter table products add column if not exists part_number text;
alter table products add column if not exists part_number_norm text;
create index if not exists products_part_norm on products (part_number_norm);

create table product_sizes (
  product_id uuid primary key references products(id),
  bore_mm numeric(12,3),
  outside_mm numeric(12,3),
  width_mm numeric(12,3),
  check (bore_mm is not null or outside_mm is not null or width_mm is not null)
);

alter table product_sizes enable row level security;
revoke all on product_sizes from public, anon, authenticated, service_role;
grant select on product_sizes to authenticated;
create policy product_sizes_read on product_sizes for select to authenticated
  using (has_staff_role(array['counter', 'storekeeper', 'dispatcher', 'accountant']::staff_role[]));

-- "6205 2RS", "6205-2rs" and "62052RS" all become 62052RS.
create function i_norm_part(p_text text) returns text
language sql immutable strict set search_path = public, pg_temp as $$
  select upper(regexp_replace(p_text, '[^a-zA-Z0-9]', '', 'g'))
$$;

-- The same algorithm as pg_trgm's similarity: shared trigrams over all trigrams, with two spaces
-- prefixed and one suffixed as pg_trgm does. Pure SQL, so PGlite and real Postgres agree exactly.
create function part_similarity(p_a text, p_b text) returns real
language sql immutable strict set search_path = public, pg_temp as $$
  with a(t) as (select '  ' || $1 || ' '),
  b(t) as (select '  ' || $2 || ' '),
  tri(n) as (select generate_series(1, 1000)),
  ag(g) as (select distinct substr(t, n, 3) from a, tri where n <= length(t) - 2),
  bg(g) as (select distinct substr(t, n, 3) from b, tri where n <= length(t) - 2),
  inter(n) as (select count(*) from (select g from ag intersect select g from bg) x),
  uni(n) as (select count(*) from (select g from ag union select g from bg) x)
  select case when (select n from uni) = 0 then 0::real else (select n from inter)::real / (select n from uni)::real end
$$;

-- The catalogue entry the import will feed later: the number as printed on the box, and the sizes.
create function save_part_details(p_product uuid, p_part_number text default null, p_bore numeric default null, p_outside numeric default null, p_width numeric default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array[]::staff_role[]);
begin
  perform 1 from products where id = p_product;
  if not found then raise exception 'no_such_product'; end if;
  if p_part_number is not null then
    update products set part_number = nullif(p_part_number, ''),
      part_number_norm = nullif(i_norm_part(p_part_number), '') where id = p_product;
  end if;
  -- Only the sizes given change: a correction of one dimension keeps the others.
  if p_bore is not null or p_outside is not null or p_width is not null then
    insert into product_sizes (product_id, bore_mm, outside_mm, width_mm)
    values (p_product, p_bore, p_outside, p_width)
    on conflict (product_id) do update
      set bore_mm = coalesce(excluded.bore_mm, product_sizes.bore_mm),
          outside_mm = coalesce(excluded.outside_mm, product_sizes.outside_mm),
          width_mm = coalesce(excluded.width_mm, product_sizes.width_mm);
  end if;
  perform i_audit(me, 'save_part_details', 'product', p_product::text, jsonb_build_object('part', p_part_number));
end $$;

-- Finds a part however it is asked: exact number, prefix, exact sizes from numbers in the query,
-- or a close spelling. Each product appears once, under its best match. Never a count, never cost.
create function search_parts(p_query text, p_limit int default 20) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter', 'storekeeper', 'dispatcher', 'accountant']::staff_role[]);
  v_norm text := i_norm_part(p_query);
  v_nums numeric[] := coalesce((select array_agg(m[1]::numeric) from regexp_matches(coalesce(p_query, ''), '[0-9]+(?:\.[0-9]+)?', 'g') m), '{}'::numeric[]);
  v_size boolean := cardinality(v_nums) >= 3;
  v_out jsonb;
begin
  if coalesce(trim(p_query), '') = '' then raise exception 'query_required'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'bad_limit'; end if;
  select coalesce(jsonb_agg(x order by pri, sku), '[]'::jsonb) into v_out
  from (
    select x, pri, sku from (
      select distinct on (id)
        jsonb_build_object('product', id, 'sku', sku, 'name', name, 'part_number', part_number,
          'price', price_kobo, 'sizes', sizes, 'match', match, 'state', state) x, pri, sku
    from (
      select p.id, p.sku, p.name, p.part_number, p.price_kobo,
        (select jsonb_build_object('bore', s.bore_mm, 'outside', s.outside_mm, 'width', s.width_mm)
         from product_sizes s where s.product_id = p.id) sizes,
        (select case when coalesce(free, 0) <= 0 then 'out' when free <= p.low_stock_at then 'low' else 'in' end
         from (select coalesce(sum(qty - reserved), 0) free from stock_balances b where b.product_id = p.id) f) state,
        'part'::text match, 1 pri
      from products p
      where p.status = 'active' and p.part_number_norm = v_norm and v_norm <> ''
      union all
      select p.id, p.sku, p.name, p.part_number, p.price_kobo,
        (select jsonb_build_object('bore', s.bore_mm, 'outside', s.outside_mm, 'width', s.width_mm)
         from product_sizes s where s.product_id = p.id) sizes,
        (select case when coalesce(free, 0) <= 0 then 'out' when free <= p.low_stock_at then 'low' else 'in' end
         from (select coalesce(sum(qty - reserved), 0) free from stock_balances b where b.product_id = p.id) f) state,
        'part', 2
      from products p
      where p.status = 'active' and p.part_number_norm like v_norm || '%' and length(v_norm) >= 3
        and p.part_number_norm is distinct from v_norm and v_norm <> ''
      union all
      select p.id, p.sku, p.name, p.part_number, p.price_kobo,
        jsonb_build_object('bore', s.bore_mm, 'outside', s.outside_mm, 'width', s.width_mm),
        (select case when coalesce(free, 0) <= 0 then 'out' when free <= p.low_stock_at then 'low' else 'in' end
         from (select coalesce(sum(qty - reserved), 0) free from stock_balances b where b.product_id = p.id) f) state,
        'size', 3
      from products p join product_sizes s on s.product_id = p.id
      where p.status = 'active' and v_size and s.bore_mm = v_nums[1] and s.outside_mm = v_nums[2] and s.width_mm = v_nums[3]
      union all
      select p.id, p.sku, p.name, p.part_number, p.price_kobo,
        jsonb_build_object('bore', s.bore_mm, 'outside', s.outside_mm, 'width', s.width_mm),
        (select case when coalesce(free, 0) <= 0 then 'out' when free <= p.low_stock_at then 'low' else 'in' end
         from (select coalesce(sum(qty - reserved), 0) free from stock_balances b where b.product_id = p.id) f) state,
        'size', 3
      from products p join product_sizes s on s.product_id = p.id
      where p.status = 'active' and v_norm <> '' and p.part_number_norm is distinct from v_norm
        and s.bore_mm is not null and s.outside_mm is not null and s.width_mm is not null
        and exists (
          select 1 from products anchor join product_sizes az on az.product_id = anchor.id
          where anchor.part_number_norm = v_norm
            and az.bore_mm = s.bore_mm and az.outside_mm = s.outside_mm and az.width_mm = s.width_mm)
      union all
      select p.id, p.sku, p.name, p.part_number, p.price_kobo,
        (select jsonb_build_object('bore', s.bore_mm, 'outside', s.outside_mm, 'width', s.width_mm)
         from product_sizes s where s.product_id = p.id) sizes,
        (select case when coalesce(free, 0) <= 0 then 'out' when free <= p.low_stock_at then 'low' else 'in' end
         from (select coalesce(sum(qty - reserved), 0) free from stock_balances b where b.product_id = p.id) f) state,
        'similar', 4
      from products p
      where p.status = 'active' and p.part_number_norm is not null and v_norm <> '' and p.part_number_norm is distinct from v_norm
        and part_similarity(p.part_number_norm, v_norm) > 0.35
    ) hits
    order by id, pri
    ) best
    order by pri, sku
    limit p_limit
  ) t;
  return v_out;
end $$;

grant execute on function save_part_details(uuid, text, numeric, numeric, numeric) to authenticated;
grant execute on function search_parts(text, int) to authenticated;
