-- Persist AI question history for all plans, including the free plan, while
-- usage_events remains the source of truth for monthly limits.
create table if not exists public.ai_question_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  case_id uuid references public.agronomic_cases(id) on delete cascade,
  source text not null default 'qa',
  question text not null,
  answer text,
  created_at timestamptz not null default now(),
  constraint ai_question_history_source_check check (source in ('qa', 'agronomic_case')),
  constraint ai_question_history_question_check check (length(btrim(question)) >= 3)
);

create index if not exists ai_question_history_user_created_at_idx
  on public.ai_question_history(user_id, created_at desc);

create index if not exists ai_question_history_case_created_at_idx
  on public.ai_question_history(case_id, created_at asc)
  where case_id is not null;

alter table public.ai_question_history enable row level security;

drop policy if exists "Users can view own AI question history" on public.ai_question_history;
create policy "Users can view own AI question history"
  on public.ai_question_history for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Admins can manage AI question history" on public.ai_question_history;
create policy "Admins can manage AI question history"
  on public.ai_question_history for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

update public.plans
set features = '["3 perguntas agrícolas por mês", "histórico das perguntas realizadas", "1 triagem simples por mês", "recomendação agrícola básica", "sem relatório PDF completo", "sem análise de solo", "sem revisão humana incluída"]'::jsonb
where slug = 'gratuito';
