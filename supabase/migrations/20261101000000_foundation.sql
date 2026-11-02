-- Power Store core, part 1: staff, customers, suppliers, audit.
-- Rules for the whole schema:
--  * Money is bigint kobo. Nothing is ever stored in floats.
--  * History tables are append-only. Mistakes are reversed, never edited.
--  * Every write goes through a function. API roles get no direct write access (see the security migration).
--  * Functions named i_* are internal and take the actor as an argument. Only the role-checked wrappers are exposed.

-- The shop's calendar day. Supabase runs on UTC, so 11:30pm in Lagos would otherwise be tomorrow's sale.
create function shop_today() returns date
language sql stable as $$ select (now() at time zone 'Africa/Lagos')::date $$;

-- One row of shop-wide settings. These defaults are guesses until the shop visit confirms them.
create table shop_settings (
  id boolean primary key default true check (id),
  hold_unpaid_hours int not null default 24 check (hold_unpaid_hours > 0),
  hold_deposit_days int not null default 14 check (hold_deposit_days > 0),
  till_paid_out_limit_kobo bigint not null default 5000000 check (till_paid_out_limit_kobo >= 0)
);
insert into shop_settings default values;

-- A retry is only safe if the caller sent a key.
create function i_require_key(p_key text) returns void
language plpgsql immutable as $$
begin
  if coalesce(trim(p_key), '') = '' then raise exception 'key_required'; end if;
end $$;

create type staff_role as enum ('owner', 'counter', 'storekeeper', 'dispatcher', 'driver', 'accountant');

create table staff (
  id uuid primary key references auth.users(id) on delete restrict,
  name text not null,
  role staff_role not null,
  discount_limit_pct numeric(5,2) not null default 0 check (discount_limit_pct between 0 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Who is calling, and may they do this? The owner may do anything a staff role may.
create function require_staff(p_allowed staff_role[]) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me uuid := auth.uid();
  r staff_role;
begin
  select role into r from staff where id = me and active;
  if r is null or not (r = 'owner' or r = any (p_allowed)) then
    raise exception 'not_allowed';
  end if;
  return me;
end $$;

-- Used by row-level security policies, which must not raise.
create function has_staff_role(p_allowed staff_role[]) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from staff where id = auth.uid() and active and (role = 'owner' or role = any (p_allowed)));
$$;

create function is_staff() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from staff where id = auth.uid() and active);
$$;

create function forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception 'append_only: % cannot be changed', tg_table_name;
end $$;

create table audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  action text not null,
  entity text,
  entity_id text,
  detail jsonb not null default '{}'
);
create index audit_log_entity on audit_log (entity, entity_id);
create trigger audit_log_append_only before update or delete on audit_log
  for each row execute function forbid_change();
create trigger audit_log_no_truncate before truncate on audit_log
  for each statement execute function forbid_change();

create function i_audit(p_actor uuid, p_action text, p_entity text, p_entity_id text, p_detail jsonb default '{}') returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into audit_log (actor, action, entity, entity_id, detail) values (p_actor, p_action, p_entity, p_entity_id, coalesce(p_detail, '{}'));
$$;

-- Customers are known by phone. Email is optional, because many trade customers don't use it.
create type customer_kind as enum ('retail', 'installer', 'business');

create function normalize_phone(p text) returns text
language plpgsql immutable as $$
declare
  d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if d ~ '^0[0-9]{10}$' then return '234' || substr(d, 2); end if;
  if d ~ '^234[0-9]{10}$' then return d; end if;
  raise exception 'bad_phone: %', p;
end $$;

create table customers (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique check (phone ~ '^234[0-9]{10}$'),
  name text,
  email text check (email = lower(email)),
  kind customer_kind not null default 'retail',
  credit_limit_kobo bigint not null default 0 check (credit_limit_kobo >= 0),
  reminders_ok boolean not null default false,
  user_id uuid unique references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create function i_customer_for_phone(p_phone text, p_name text default null) returns uuid
language sql security definer set search_path = public, pg_temp as $$
  insert into customers (phone, name) values (normalize_phone(p_phone), p_name)
  on conflict (phone) do update set name = coalesce(customers.name, excluded.name)
  returning id;
$$;

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  phone text,
  created_at timestamptz not null default now()
);

-- Sequential numbers with no gaps. The row lock is held to commit, and a rollback gives the number back.
create table document_numbers (
  kind text not null,
  year int not null,
  last_no bigint not null,
  primary key (kind, year)
);

create function i_next_doc(p_kind text, p_on date) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  y int := extract(year from p_on)::int;
  n bigint;
begin
  insert into document_numbers (kind, year, last_no) values (p_kind, y, 1)
  on conflict (kind, year) do update set last_no = document_numbers.last_no + 1
  returning last_no into n;
  return p_kind || '-' || y || '-' || lpad(n::text, 6, '0');
end $$;
