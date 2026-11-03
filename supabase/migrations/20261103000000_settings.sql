-- Power Store (2026-11-03): the owner's settings, and the shop's own details for the public shop.
-- Hold times, the drawer limit and battery life were defaults only a developer could change. The
-- owner now sets them on screen on the day the shop confirms them, and every change is audited
-- with the values before and after. The shop's name, phone, address and hours are public.

alter table shop_settings
  add column shop_name text check (shop_name is null or length(shop_name) between 1 and 80),
  add column shop_phone text check (shop_phone is null or shop_phone ~ '^234[0-9]{10}$'),
  add column shop_address text check (shop_address is null or length(shop_address) <= 200),
  add column shop_hours text check (shop_hours is null or length(shop_hours) <= 120);

-- p_till_paid_out_limit is kobo. Empty details are stored as nothing, so the public shop hides them.
create function save_settings(p_hold_unpaid_hours int, p_hold_deposit_days int, p_till_paid_out_limit bigint, p_battery_life_months int,
  p_shop_name text default null, p_shop_phone text default null, p_shop_address text default null, p_shop_hours text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := require_staff(array[]::staff_role[]);
  was shop_settings;
  v_name text := nullif(trim(coalesce(p_shop_name, '')), '');
  v_address text := nullif(trim(coalesce(p_shop_address, '')), '');
  v_hours text := nullif(trim(coalesce(p_shop_hours, '')), '');
  v_phone text;
begin
  if p_hold_unpaid_hours is null or p_hold_unpaid_hours not between 1 and 720 then raise exception 'bad_setting: hold_unpaid_hours'; end if;
  if p_hold_deposit_days is null or p_hold_deposit_days not between 1 and 365 then raise exception 'bad_setting: hold_deposit_days'; end if;
  if p_till_paid_out_limit is null or p_till_paid_out_limit not between 0 and 100000000000 then raise exception 'bad_setting: till_paid_out_limit'; end if;
  if p_battery_life_months is null or p_battery_life_months not between 6 and 120 then raise exception 'bad_setting: battery_life_months'; end if;
  if length(v_name) > 80 or length(v_address) > 200 or length(v_hours) > 120 then raise exception 'bad_setting: too_long'; end if;
  if nullif(trim(coalesce(p_shop_phone, '')), '') is not null then v_phone := normalize_phone(p_shop_phone); end if;
  select * into was from shop_settings where id for update;
  update shop_settings set hold_unpaid_hours = p_hold_unpaid_hours, hold_deposit_days = p_hold_deposit_days,
    till_paid_out_limit_kobo = p_till_paid_out_limit, battery_life_months = p_battery_life_months,
    shop_name = v_name, shop_phone = v_phone, shop_address = v_address, shop_hours = v_hours
  where id;
  perform i_audit(me, 'save_settings', 'shop_settings', 'shop', jsonb_build_object('before', to_jsonb(was), 'after', (select to_jsonb(s) from shop_settings s where id)));
end $$;

-- What the public may know about the shop: how to reach it. Never limits or hold times.
create function shop_details() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('name', shop_name, 'phone', shop_phone, 'address', shop_address, 'hours', shop_hours) from shop_settings where id
$$;

grant execute on function save_settings(int, int, bigint, int, text, text, text, text) to authenticated;
grant execute on function shop_details() to anon, authenticated;
