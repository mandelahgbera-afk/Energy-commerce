-- Power Store (2026-11-26): a Barcode column in the price list import.
-- Until now a maker's barcode could only be taught one scan at a time. Now the list can carry them:
-- one or more per line (split by commas, semicolons, slashes or bars), linked through the same
-- link_barcode the counter uses. Codes are only ever added; the owner takes a wrong one off in
-- Tools, Price check. The preview names a code that is too short or long, on two lines, or already
-- another product's, and the import saves every line or none, as before.

-- Copied from 20261103000100_import.sql, with the barcode column added.
-- p_rows: [{sku, name, family, unit, price, trade, cost, part, bore, outside, width, warranty, tracking, low, barcode}]
-- with money in whole kobo. p_apply false only previews and needs no key.
create or replace function import_products(p_key text, p_rows jsonb, p_apply boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array[]::staff_role[]);
  v_seen product_imports;
  v_hash text;
  r jsonb;
  v_line int := 0;
  v_skus text[] := '{}';
  v_rows jsonb := '[]';
  v_plan jsonb := '[]';
  v_new int := 0;
  v_upd int := 0;
  v_same int := 0;
  v_bad int := 0;
  v_sku text; v_name text; v_family text; v_unit text; v_track text; v_part text;
  v_price numeric; v_trade numeric; v_cost numeric; v_bore numeric; v_outside numeric; v_width numeric; v_warranty numeric; v_low numeric;
  v_codes text[];
  v_all_codes text[] := '{}';
  v_taken text;
  v_add int;
  p products;
  s product_sizes;
  v_old_trade bigint;
  v_old_cost bigint;
  v_problem text;
  v_action text;
  v_id uuid;
  v_result jsonb;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 2000 then raise exception 'bad_import'; end if;
  if p_apply then
    perform i_require_key(p_key);
    v_hash := md5(p_rows::text);
    select * into v_seen from product_imports where client_key = p_key;
    if found then
      if v_seen.client_hash <> v_hash then raise exception 'key_reused'; end if;
      return v_seen.result;
    end if;
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    v_line := v_line + 1;
    if jsonb_typeof(r) is distinct from 'object' then raise exception 'bad_import'; end if;
    v_problem := null;
    v_sku := nullif(trim(coalesce(r ->> 'sku', '')), '');
    v_name := nullif(trim(coalesce(r ->> 'name', '')), '');
    v_family := lower(nullif(trim(coalesce(r ->> 'family', '')), ''));
    v_unit := lower(nullif(trim(coalesce(r ->> 'unit', '')), ''));
    v_track := lower(nullif(trim(coalesce(r ->> 'tracking', '')), ''));
    v_part := nullif(trim(coalesce(r ->> 'part', '')), '');
    v_price := i_import_num(r, 'price');
    v_trade := i_import_num(r, 'trade');
    v_cost := i_import_num(r, 'cost');
    v_bore := i_import_num(r, 'bore');
    v_outside := i_import_num(r, 'outside');
    v_width := i_import_num(r, 'width');
    v_warranty := i_import_num(r, 'warranty');
    v_low := i_import_num(r, 'low');
    v_unit := case when v_unit is null then null when v_unit in ('each', 'pc', 'pcs', 'piece', 'pieces', 'unit', 'units') then 'each'
                   when v_unit in ('metre', 'meter', 'metres', 'meters', 'm') then 'metre' else '?' end;
    v_track := case when v_track is null then null when v_track in ('serial', 'serials', 'yes', 'y') then 'serial'
                    when v_track in ('count', 'no', 'n') then 'count' else '?' end;
    -- Spaces inside a printed barcode are ignored, as at the scanner.
    v_codes := coalesce((select array_agg(distinct c) from (select i_norm_part(x) c from regexp_split_to_table(coalesce(r ->> 'barcode', ''), '[,;/|]+') x) y
      where coalesce(c, '') <> ''), '{}');
    p := null;
    if v_sku is not null then select * into p from products where sku = v_sku; end if;
    -- A code that is another product's barcode, shop code or part number would ring up the wrong item.
    v_taken := (select c from unnest(v_codes) c
      where exists (select 1 from product_barcodes b where b.code = c and b.product_id is distinct from p.id)
         or exists (select 1 from products o where o.id is distinct from p.id and (o.search_code = c or o.part_number_norm = c))
      order by c limit 1);

    v_problem := case
      when v_sku is null then 'The SKU is missing.'
      when length(v_sku) > 40 then 'The SKU is longer than 40 characters.'
      when upper(v_sku) = any (v_skus) then 'This SKU is already on an earlier line.'
      when v_name is null then 'The name is missing.'
      when length(v_name) > 120 then 'The name is longer than 120 characters.'
      when length(v_family) > 60 then 'The kind of goods is longer than 60 characters.'
      when length(v_part) > 40 then 'The part number is longer than 40 characters.'
      when v_price is null then 'The price is missing.'
      when v_price = 'NaN' or v_price < 0 or v_price <> floor(v_price) or v_price > 100000000000 then 'The price is not a usable amount.'
      when v_price = 0 then 'The price is zero.'
      when v_trade = 'NaN' or v_trade < 0 or v_trade <> floor(v_trade) then 'The trade price is not a usable amount.'
      when v_trade > v_price then 'The trade price is above the shelf price.'
      when v_cost = 'NaN' or v_cost < 0 or v_cost <> floor(v_cost) or v_cost > 100000000000 then 'The cost is not a usable amount.'
      when v_unit = '?' then 'The unit must be each or metre.'
      when v_track = '?' then 'Serial numbers must be yes or no.'
      when v_warranty = 'NaN' or v_warranty < 0 or v_warranty > 240 or v_warranty <> floor(v_warranty) then 'Warranty must be whole months, up to 240.'
      when v_low = 'NaN' or v_low < 0 then 'The low-stock level is not a number.'
      when v_bore = 'NaN' or v_outside = 'NaN' or v_width = 'NaN' or v_bore <= 0 or v_outside <= 0 or v_width <= 0 then 'Sizes must be numbers in mm.'
      when p.id is not null and ((v_unit is not null and v_unit <> p.unit::text) or (v_track is not null and v_track <> p.tracking::text)) then 'The unit or serial numbers cannot change on a product that already exists.'
      when cardinality(v_codes) > 20 then 'Up to 20 barcodes on a line.'
      when exists (select 1 from unnest(v_codes) c where length(c) not between 4 and 64) then 'A barcode must be 4 to 64 letters or digits.'
      when v_codes && v_all_codes then 'A barcode on this line is already on an earlier line.'
      when v_taken is not null then 'Barcode ' || v_taken || ' already belongs to another product.'
    end;
    if v_sku is not null then v_skus := v_skus || upper(v_sku); end if;
    v_all_codes := v_all_codes || v_codes;
    v_add := (select count(*) from unnest(v_codes) c
      where p.id is null or not exists (select 1 from product_barcodes b where b.code = c and b.product_id = p.id));

    v_old_trade := null;
    if v_problem is not null then
      v_action := 'error';
      v_bad := v_bad + 1;
    elsif p.id is null then
      v_action := 'new';
      v_new := v_new + 1;
    else
      select trade_price_kobo into v_old_trade from product_trade_prices where product_id = p.id;
      select last_cost_kobo into v_old_cost from product_costs where product_id = p.id;
      select * into s from product_sizes where product_id = p.id;
      if v_name is distinct from p.name or v_price <> p.price_kobo
         or (v_trade is not null and v_trade is distinct from v_old_trade)
         or (v_cost is not null and v_cost is distinct from v_old_cost)
         or (v_family is not null and v_family <> p.family)
         or (v_warranty is not null and v_warranty <> p.warranty_months)
         or (v_low is not null and v_low <> p.low_stock_at)
         or (v_part is not null and v_part is distinct from p.part_number)
         or (v_bore is not null and v_bore is distinct from s.bore_mm)
         or (v_outside is not null and v_outside is distinct from s.outside_mm)
         or (v_width is not null and v_width is distinct from s.width_mm)
         or v_add > 0 then
        v_action := 'update';
        v_upd := v_upd + 1;
      else
        v_action := 'same';
        v_same := v_same + 1;
      end if;
    end if;

    v_rows := v_rows || jsonb_build_object('line', v_line, 'sku', v_sku, 'name', coalesce(v_name, p.name), 'action', v_action, 'problem', v_problem,
      'price_before', case when v_action = 'update' then p.price_kobo end, 'price', v_price,
      'trade_before', case when v_action = 'update' then v_old_trade end, 'trade', coalesce(v_trade, v_old_trade),
      'barcodes', case when v_action in ('new', 'update') then v_add else 0 end);
    if v_action in ('new', 'update') then
      v_plan := v_plan || jsonb_build_object('action', v_action, 'id', p.id, 'sku', v_sku, 'name', v_name, 'family', coalesce(v_family, p.family, 'general'),
        'unit', coalesce(v_unit, p.unit::text, 'each'), 'tracking', coalesce(v_track, p.tracking::text, 'count'),
        'price', v_price, 'trade', coalesce(v_trade, v_old_trade), 'cost', v_cost, 'part', v_part, 'bore', v_bore, 'outside', v_outside, 'width', v_width,
        'warranty', coalesce(v_warranty, p.warranty_months, 0), 'low', coalesce(v_low, p.low_stock_at, 0),
        'vat', coalesce(p.vat_rate_bp, 0), 'weight', coalesce(p.weight_grams, 0), 'length', coalesce(p.length_mm, 0), 'attributes', coalesce(p.attributes, '{}'),
        'barcodes', to_jsonb(v_codes));
    end if;
  end loop;

  v_result := jsonb_build_object('counts', jsonb_build_object('new', v_new, 'update', v_upd, 'same', v_same, 'error', v_bad));
  if not p_apply then return v_result || jsonb_build_object('rows', v_rows); end if;

  if v_bad > 0 then raise exception 'import_has_errors: %', v_bad; end if;
  for r in select value from jsonb_array_elements(v_plan) loop
    v_id := save_product(r ->> 'sku', r ->> 'name', (r ->> 'price')::bigint, (r ->> 'trade')::bigint, (r ->> 'tracking')::product_tracking,
      (r ->> 'unit')::product_unit, (r ->> 'warranty')::int, (r ->> 'vat')::int, r ->> 'family', (r ->> 'weight')::int, (r ->> 'length')::int,
      r -> 'attributes', (r ->> 'low')::numeric);
    if r ->> 'cost' is not null then perform set_last_cost(v_id, (r ->> 'cost')::bigint); end if;
    if coalesce(r ->> 'part', r ->> 'bore', r ->> 'outside', r ->> 'width') is not null then
      perform save_part_details(v_id, r ->> 'part', (r ->> 'bore')::numeric, (r ->> 'outside')::numeric, (r ->> 'width')::numeric);
    end if;
    -- Already linked to this product is a no-op inside link_barcode, so only new codes are audited.
    perform link_barcode(v_id, c) from jsonb_array_elements_text(r -> 'barcodes') c;
  end loop;
  v_result := v_result || jsonb_build_object('applied', true);
  insert into product_imports (client_key, client_hash, result, created_by) values (p_key, v_hash, v_result, me);
  perform i_audit(me, 'import_products', 'import', p_key, v_result -> 'counts');
  return v_result;
end $$;
