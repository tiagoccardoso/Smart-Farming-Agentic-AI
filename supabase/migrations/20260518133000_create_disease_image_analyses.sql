-- Stores structured multimodal disease triage outputs linked to agronomic cases.

create table if not exists public.disease_image_analyses (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.agronomic_cases(id) on delete cascade,
  image_url text not null,
  ai_analysis jsonb not null,
  confidence_level text not null,
  risk_level text not null,
  created_at timestamptz not null default now(),
  constraint disease_image_analyses_confidence_level_check check (confidence_level in ('low', 'medium', 'high')),
  constraint disease_image_analyses_risk_level_check check (risk_level in ('low', 'medium', 'high')),
  constraint disease_image_analyses_image_url_check check (length(trim(image_url)) > 0)
);

create index if not exists disease_image_analyses_case_created_idx
  on public.disease_image_analyses(case_id, created_at desc);

create index if not exists disease_image_analyses_risk_created_idx
  on public.disease_image_analyses(risk_level, created_at desc);

alter table public.disease_image_analyses enable row level security;

drop policy if exists "Users can view own disease image analyses" on public.disease_image_analyses;
create policy "Users can view own disease image analyses"
  on public.disease_image_analyses for select
  to authenticated
  using (
    exists (
      select 1 from public.agronomic_cases c
      where c.id = disease_image_analyses.case_id
        and c.user_id = auth.uid()
    )
    or public.is_specialist_or_admin()
  );

drop policy if exists "Users can insert own disease image analyses" on public.disease_image_analyses;
create policy "Users can insert own disease image analyses"
  on public.disease_image_analyses for insert
  to authenticated
  with check (
    exists (
      select 1 from public.agronomic_cases c
      where c.id = disease_image_analyses.case_id
        and c.user_id = auth.uid()
    )
  );

drop policy if exists "Users can update own disease image analyses" on public.disease_image_analyses;
create policy "Users can update own disease image analyses"
  on public.disease_image_analyses for update
  to authenticated
  using (
    exists (
      select 1 from public.agronomic_cases c
      where c.id = disease_image_analyses.case_id
        and c.user_id = auth.uid()
    )
    or public.is_specialist_or_admin()
  )
  with check (
    exists (
      select 1 from public.agronomic_cases c
      where c.id = disease_image_analyses.case_id
        and c.user_id = auth.uid()
    )
    or public.is_specialist_or_admin()
  );
