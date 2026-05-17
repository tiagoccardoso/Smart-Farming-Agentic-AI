-- Operational logs for the hybrid agronomic AI layer.

create table if not exists public.ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  provider text not null check (provider in ('openai', 'gemini', 'local')),
  model text not null,
  prompt_type text not null,
  tokens_input integer not null default 0 check (tokens_input >= 0),
  tokens_output integer not null default 0 check (tokens_output >= 0),
  estimated_cost numeric(12, 6) not null default 0 check (estimated_cost >= 0),
  response_time_ms integer not null default 0 check (response_time_ms >= 0),
  success boolean not null default true,
  fallback_used boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_logs_created_at_idx
  on public.ai_usage_logs (created_at desc);

create index if not exists ai_usage_logs_user_id_idx
  on public.ai_usage_logs (user_id, created_at desc);

create index if not exists ai_usage_logs_provider_idx
  on public.ai_usage_logs (provider, model, created_at desc);

alter table public.ai_usage_logs enable row level security;

drop policy if exists "Users can read own AI usage logs" on public.ai_usage_logs;
create policy "Users can read own AI usage logs"
  on public.ai_usage_logs
  for select
  using (auth.uid() = user_id);

drop policy if exists "Admins can read all AI usage logs" on public.ai_usage_logs;
create policy "Admins can read all AI usage logs"
  on public.ai_usage_logs
  for select
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );
