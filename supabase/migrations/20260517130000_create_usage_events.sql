-- Track monthly feature usage by plan-limited event type.
create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  count integer not null default 1,
  period_start timestamptz not null,
  period_end timestamptz not null,
  created_at timestamptz not null default now(),
  constraint usage_events_event_type_check check (
    event_type in ('ai_question', 'case_analysis', 'image_triage', 'pdf_report', 'human_review')
  ),
  constraint usage_events_count_check check (count > 0),
  constraint usage_events_period_check check (period_end > period_start)
);

create index if not exists usage_events_user_period_event_idx
  on public.usage_events(user_id, period_start, period_end, event_type);

create index if not exists usage_events_created_at_idx
  on public.usage_events(created_at desc);

alter table public.usage_events enable row level security;

create policy "Users can view own usage events"
  on public.usage_events for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy "Admins can manage usage events"
  on public.usage_events for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
