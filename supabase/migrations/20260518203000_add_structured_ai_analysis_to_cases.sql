alter table public.agronomic_cases
  add column if not exists ai_analysis_json jsonb;

comment on column public.agronomic_cases.ai_analysis_json is
  'Structured AI agronomic pre-analysis used by Consultoria IA to render detailed hypotheses, confidence, risks, recommendations and human-review rationale.';
