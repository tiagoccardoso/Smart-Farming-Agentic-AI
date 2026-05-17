-- Add administrative access controls to user profiles.

alter table public.profiles
  add column if not exists status text not null default 'active',
  add column if not exists unlimited_access boolean not null default false;

alter table public.profiles
  drop constraint if exists profiles_status_check;

alter table public.profiles
  add constraint profiles_status_check check (status in ('active', 'inactive'));

create index if not exists profiles_status_idx on public.profiles(status);
create index if not exists profiles_unlimited_access_idx on public.profiles(unlimited_access) where unlimited_access = true;

create or replace function public.is_active_user(user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = user_id
      and coalesce(status, 'active') = 'active'
  );
$$;

create or replace function public.is_admin(user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = user_id
      and role = 'admin'
      and coalesce(status, 'active') = 'active'
  );
$$;

create or replace function public.is_specialist_or_admin(user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = user_id
      and role in ('specialist', 'admin')
      and coalesce(status, 'active') = 'active'
  );
$$;
