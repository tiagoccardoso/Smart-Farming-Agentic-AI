-- Operational consulting workspace support for /consultoria-ia.
-- Adds soft delete and auditable case activity logs with RLS scoped to case ownership.

alter table public.agronomic_cases
  add column if not exists deleted_at timestamptz;

create table if not exists public.case_activity_logs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.agronomic_cases(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists agronomic_cases_deleted_at_idx on public.agronomic_cases(deleted_at);
create index if not exists case_activity_logs_case_id_created_at_idx on public.case_activity_logs(case_id, created_at);
create index if not exists case_activity_logs_user_id_idx on public.case_activity_logs(user_id);

alter table public.case_activity_logs enable row level security;

drop policy if exists "Users can read own case activity logs" on public.case_activity_logs;
create policy "Users can read own case activity logs"
on public.case_activity_logs
for select
to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1
    from public.agronomic_cases c
    where c.id = case_activity_logs.case_id
      and c.user_id = auth.uid()
  )
);

drop policy if exists "Users can insert own case activity logs" on public.case_activity_logs;
create policy "Users can insert own case activity logs"
on public.case_activity_logs
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.agronomic_cases c
    where c.id = case_activity_logs.case_id
      and c.user_id = auth.uid()
  )
);

drop policy if exists "Specialists can read review case activity logs" on public.case_activity_logs;
create policy "Specialists can read review case activity logs"
on public.case_activity_logs
for select
to authenticated
using (
  public.is_specialist_or_admin(auth.uid())
  and exists (
    select 1
    from public.agronomic_cases c
    where c.id = case_activity_logs.case_id
      and c.human_review_requested = true
  )
);
