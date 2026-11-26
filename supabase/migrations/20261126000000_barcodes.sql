-- Power Store (2026-11-26): scanning that finds the part.
-- Until now staff search matched only part numbers and sizes, so a scan of the shop's own code
-- (SP-450M) or of the maker's barcode (6923450012345) found nothing, and typing "200Ah" at the
-- counter found nothing either. Now:
--   * each product can carry any number of barcodes, taught once at the counter or stock room:
--     scan an unknown code, pick the part, and the next scan of it is instant;
--   * search finds, in this order: a taught barcode, the exact part number or shop code, a part
--     number prefix, a size, a close spelling, then every word of the query in the name.

create table product_barcodes (
  code text primary key check (code ~ '^[A-Z0-9]{4,64}$'),
  product_id uuid not null references products(id),
  added_by uuid not null,
  added_at timestamptz not null default now()
);
create index product_barcodes_product on product_barcodes (product_id);
alter table product_barcodes enable row level security;
revoke all on product_barcodes from public, anon, authenticated, service_role;

-- Teach a barcode. Saying the same thing twice is harmless, so a retry needs no key. A code
-- already on another part is refused: a wrong link would ring up the wrong item.
create or replace function link_barcode(p_product uuid, p_code text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter', 'storekeeper']::staff_role[]);
  v_code text := i_norm_part(p_code);
  v_on uuid;
begin
  if v_code is null or length(v_code) not between 4 and 64 then raise exception 'bad_barcode'; end if;
  perform 1 from products where id = p_product and status = 'active';
  if not found then raise exception 'no_such_product'; end if;
  -- A shop code or part number already finds its own part; as another part's barcode it would mislead.
  if exists (select 1 from products where id <> p_product and (search_code = v_code or part_number_norm = v_code)) then
    raise exception 'barcode_taken';
  end if;
  select product_id into v_on from product_barcodes where code = v_code for update;
  if found then
    if v_on = p_product then return; end if;
    raise exception 'barcode_taken';
  end if;
  insert into product_barcodes (code, product_id, added_by) values (v_code, p_product, me);
  perform i_audit(me, 'link_barcode', 'product', p_product::text, jsonb_build_object('code', v_code));
end $$;

-- The owner takes a wrongly taught code off, and it can then be taught to the right part.
create or replace function unlink_barcode(p_code text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array[]::staff_role[]);
  v_code text := i_norm_part(p_code);
  v_on uuid;
begin
  delete from product_barcodes where code = v_code returning product_id into v_on;
  if v_on is null then raise exception 'no_such_barcode'; end if;
  perform i_audit(me, 'unlink_barcode', 'product', v_on::text, jsonb_build_object('code', v_code));
end $$;

-- Copied from 20261102000400_search.sql, with the barcode, shop code and name matches added.
create or replace function search_parts(p_query text, p_limit int default 20) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array['counter', 'storekeeper', 'dispatcher', 'accountant']::staff_role[]);
  v_norm text := i_norm_part(p_query);
  v_nums numeric[] := coalesce((select array_agg(m[1]::numeric) from regexp_matches(coalesce(p_query, ''), '[0-9]+(?:\.[0-9]+)?', 'g') m), '{}'::numeric[]);
  v_size boolean := cardinality(v_nums) >= 3;
  v_words text[] := coalesce((select array_agg(w) from regexp_split_to_table(lower(trim(coalesce(p_query, ''))), '\s+') w where w <> ''), '{}'::text[]);
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
        'barcode'::text match, 0 pri
      from products p join product_barcodes c on c.product_id = p.id
      where p.status = 'active' and c.code = v_norm and v_norm <> ''
      union all
      select p.id, p.sku, p.name, p.part_number, p.price_kobo,
        (select jsonb_build_object('bore', s.bore_mm, 'outside', s.outside_mm, 'width', s.width_mm)
         from product_sizes s where s.product_id = p.id) sizes,
        (select case when coalesce(free, 0) <= 0 then 'out' when free <= p.low_stock_at then 'low' else 'in' end
         from (select coalesce(sum(qty - reserved), 0) free from stock_balances b where b.product_id = p.id) f) state,
        'part'::text match, 1 pri
      from products p
      where p.status = 'active' and (p.part_number_norm = v_norm or p.search_code = v_norm) and v_norm <> ''
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
      union all
      -- Every word of the query starts a word of the name: "550 w panel", "car battery", and "220ah"
      -- for "220 Ah" (spaces inside the typed word are optional). A loose "205" never finds a 6205.
      select p.id, p.sku, p.name, p.part_number, p.price_kobo,
        (select jsonb_build_object('bore', s.bore_mm, 'outside', s.outside_mm, 'width', s.width_mm)
         from product_sizes s where s.product_id = p.id) sizes,
        (select case when coalesce(free, 0) <= 0 then 'out' when free <= p.low_stock_at then 'low' else 'in' end
         from (select coalesce(sum(qty - reserved), 0) free from stock_balances b where b.product_id = p.id) f) state,
        'name', 5
      from products p
      where p.status = 'active' and cardinality(v_words) > 0 and length(v_norm) >= 2
        and not exists (select 1 from unnest(v_words) w
          where i_norm_part(w) <> ''
            and (' ' || regexp_replace(lower(p.name), '[^a-z0-9]+', ' ', 'g'))
              !~ (' ' || regexp_replace(lower(i_norm_part(w)), '(.)', '\1 ?', 'g')))
    ) hits
    order by id, pri
    ) best
    order by pri, sku
    limit p_limit
  ) t;
  return v_out;
end $$;

grant execute on function link_barcode(uuid, text) to authenticated;
grant execute on function unlink_barcode(text) to authenticated;
