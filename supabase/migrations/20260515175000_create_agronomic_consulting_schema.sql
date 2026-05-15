-- Base schema for the hybrid agronomic consulting platform.
-- This migration creates the core tables, constraints, helper functions,
-- updated_at automation, indexes, and basic Supabase RLS policies.

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'client',
  phone text,
  created_at timestamptz not null default now(),
  constraint profiles_role_check check (role in ('client', 'specialist', 'admin'))
);

create table if not exists public.farms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text,
  city text,
  state text,
  area_hectares numeric,
  soil_type text,
  created_at timestamptz not null default now()
);

create table if not exists public.agronomic_cases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  farm_id uuid references public.farms(id) on delete set null,
  crop text,
  growth_stage text,
  symptoms text,
  history text,
  soil_analysis_url text,
  status text not null default 'draft',
  risk_level text,
  ai_summary text,
  ai_recommendation text,
  human_review_requested boolean not null default false,
  human_review_status text not null default 'not_requested',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agronomic_cases_status_check check (
    status in (
      'draft',
      'submitted',
      'ai_analyzed',
      'waiting_human_review',
      'human_reviewed',
      'completed'
    )
  ),
  constraint agronomic_cases_risk_level_check check (
    risk_level is null or risk_level in ('low', 'medium', 'high')
  ),
  constraint agronomic_cases_human_review_status_check check (
    human_review_status in ('not_requested', 'pending', 'in_review', 'completed', 'rejected')
  )
);

create table if not exists public.case_images (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.agronomic_cases(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  image_url text,
  image_type text,
  created_at timestamptz not null default now()
);

create table if not exists public.human_reviews (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.agronomic_cases(id) on delete cascade,
  specialist_id uuid references auth.users(id) on delete set null,
  review_text text,
  technical_recommendation text,
  status text not null default 'pending',
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint human_reviews_status_check check (status in ('pending', 'in_review', 'completed', 'rejected'))
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.agronomic_cases(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  report_url text,
  report_type text,
  created_at timestamptz not null default now()
);

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  name text,
  slug text unique,
  price_cents integer,
  billing_type text,
  stripe_price_id text,
  features jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid references public.plans(id) on delete set null,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text,
  current_period_end timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.one_time_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  case_id uuid references public.agronomic_cases(id) on delete set null,
  service_type text,
  price_cents integer,
  stripe_checkout_session_id text,
  payment_status text not null default 'pending',
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Role helpers (created after profiles exists so Supabase/Postgres can resolve it)
-- -----------------------------------------------------------------------------

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
  );
$$;

create or replace function public.profile_role(user_id uuid default auth.uid())
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = user_id;
$$;

-- -----------------------------------------------------------------------------
-- Triggers and indexes
-- -----------------------------------------------------------------------------

drop trigger if exists set_agronomic_cases_updated_at on public.agronomic_cases;
create trigger set_agronomic_cases_updated_at
before update on public.agronomic_cases
for each row
execute function public.set_updated_at();

create index if not exists farms_user_id_idx on public.farms(user_id);
create index if not exists agronomic_cases_user_id_idx on public.agronomic_cases(user_id);
create index if not exists agronomic_cases_farm_id_idx on public.agronomic_cases(farm_id);
create index if not exists agronomic_cases_human_review_requested_idx on public.agronomic_cases(human_review_requested);
create index if not exists case_images_case_id_idx on public.case_images(case_id);
create index if not exists case_images_user_id_idx on public.case_images(user_id);
create index if not exists human_reviews_case_id_idx on public.human_reviews(case_id);
create index if not exists human_reviews_specialist_id_idx on public.human_reviews(specialist_id);
create index if not exists reports_case_id_idx on public.reports(case_id);
create index if not exists reports_user_id_idx on public.reports(user_id);
create index if not exists subscriptions_user_id_idx on public.subscriptions(user_id);
create index if not exists subscriptions_plan_id_idx on public.subscriptions(plan_id);
create index if not exists one_time_orders_user_id_idx on public.one_time_orders(user_id);
create index if not exists one_time_orders_case_id_idx on public.one_time_orders(case_id);

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.farms enable row level security;
alter table public.agronomic_cases enable row level security;
alter table public.case_images enable row level security;
alter table public.human_reviews enable row level security;
alter table public.reports enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.one_time_orders enable row level security;

-- profiles: users maintain their own profile; admins may read profiles for support.
create policy "Users can view own profile"
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or public.is_admin());

create policy "Users can insert own client profile"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid() and role = 'client');

create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = public.profile_role());

-- farms: users can only manage their own farms.
create policy "Users can view own farms"
  on public.farms for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can insert own farms"
  on public.farms for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Users can update own farms"
  on public.farms for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users can delete own farms"
  on public.farms for delete
  to authenticated
  using (user_id = auth.uid());

-- agronomic_cases: owners manage their cases; specialists/admins can view cases that requested human review.
create policy "Users can view own cases"
  on public.agronomic_cases for select
  to authenticated
  using (
    user_id = auth.uid()
    or (human_review_requested = true and public.is_specialist_or_admin())
  );

create policy "Users can insert own cases"
  on public.agronomic_cases for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and (
      farm_id is null
      or exists (
        select 1
        from public.farms f
        where f.id = agronomic_cases.farm_id
          and f.user_id = auth.uid()
      )
    )
  );

create policy "Users can update own cases"
  on public.agronomic_cases for update
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (
      farm_id is null
      or exists (
        select 1
        from public.farms f
        where f.id = agronomic_cases.farm_id
          and f.user_id = auth.uid()
      )
    )
  );

create policy "Specialists can update human review cases"
  on public.agronomic_cases for update
  to authenticated
  using (human_review_requested = true and public.is_specialist_or_admin())
  with check (human_review_requested = true and public.is_specialist_or_admin());

create policy "Users can delete own draft cases"
  on public.agronomic_cases for delete
  to authenticated
  using (user_id = auth.uid() and status = 'draft');

-- case_images: owners manage images; specialists/admins view images for cases under human review.
create policy "Users can view own case images"
  on public.case_images for select
  to authenticated
  using (
    user_id = auth.uid()
    or (
      public.is_specialist_or_admin()
      and exists (
        select 1
        from public.agronomic_cases c
        where c.id = case_images.case_id
          and c.human_review_requested = true
      )
    )
  );

create policy "Users can insert own case images"
  on public.case_images for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.agronomic_cases c
      where c.id = case_images.case_id
        and c.user_id = auth.uid()
    )
  );

create policy "Users can update own case images"
  on public.case_images for update
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.agronomic_cases c
      where c.id = case_images.case_id
        and c.user_id = auth.uid()
    )
  );

create policy "Users can delete own case images"
  on public.case_images for delete
  to authenticated
  using (user_id = auth.uid());

-- human_reviews: users can read reviews for their own cases; specialists/admins manage reviews for requested cases.
create policy "Users can view reviews for own cases"
  on public.human_reviews for select
  to authenticated
  using (
    exists (
      select 1
      from public.agronomic_cases c
      where c.id = human_reviews.case_id
        and c.user_id = auth.uid()
    )
    or (
      public.is_specialist_or_admin()
      and exists (
        select 1
        from public.agronomic_cases c
        where c.id = human_reviews.case_id
          and c.human_review_requested = true
      )
    )
  );

create policy "Specialists can insert reviews for requested cases"
  on public.human_reviews for insert
  to authenticated
  with check (
    public.is_specialist_or_admin()
    and (specialist_id = auth.uid() or public.is_admin())
    and exists (
      select 1
      from public.agronomic_cases c
      where c.id = human_reviews.case_id
        and c.human_review_requested = true
    )
  );

create policy "Specialists can update their reviews"
  on public.human_reviews for update
  to authenticated
  using (public.is_admin() or specialist_id = auth.uid())
  with check (public.is_admin() or specialist_id = auth.uid());

-- reports: users see their own reports; specialists/admins can create reports for requested cases.
create policy "Users can view own reports"
  on public.reports for select
  to authenticated
  using (user_id = auth.uid());

create policy "Specialists can view reports for requested cases"
  on public.reports for select
  to authenticated
  using (
    public.is_specialist_or_admin()
    and exists (
      select 1
      from public.agronomic_cases c
      where c.id = reports.case_id
        and c.human_review_requested = true
    )
  );

create policy "Specialists can insert reports for requested cases"
  on public.reports for insert
  to authenticated
  with check (
    public.is_specialist_or_admin()
    and exists (
      select 1
      from public.agronomic_cases c
      where c.id = reports.case_id
        and c.user_id = reports.user_id
        and c.human_review_requested = true
    )
  );

-- plans: authenticated users can read active plans; admins manage all plans.
create policy "Users can view active plans"
  on public.plans for select
  to authenticated
  using (active = true or public.is_admin());

create policy "Admins can insert plans"
  on public.plans for insert
  to authenticated
  with check (public.is_admin());

create policy "Admins can update plans"
  on public.plans for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins can delete plans"
  on public.plans for delete
  to authenticated
  using (public.is_admin());

-- subscriptions: users can only view their own subscriptions.
create policy "Users can view own subscriptions"
  on public.subscriptions for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can insert own subscriptions"
  on public.subscriptions for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Users can update own subscriptions"
  on public.subscriptions for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- one_time_orders: users can only manage their own one-time orders.
create policy "Users can view own one-time orders"
  on public.one_time_orders for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can insert own one-time orders"
  on public.one_time_orders for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and (
      case_id is null
      or exists (
        select 1
        from public.agronomic_cases c
        where c.id = one_time_orders.case_id
          and c.user_id = auth.uid()
      )
    )
  );

create policy "Users can update own one-time orders"
  on public.one_time_orders for update
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (
      case_id is null
      or exists (
        select 1
        from public.agronomic_cases c
        where c.id = one_time_orders.case_id
          and c.user_id = auth.uid()
      )
    )
  );
