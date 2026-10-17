-- Triagem pública de doenças:
-- - o visitante pode preencher e enviar fotos sem criar conta antes;
-- - o rascunho fica privado e só é recuperável pelo cookie HttpOnly;
-- - a promoção para agronomic_cases é idempotente pelo draft id.

begin;

alter table public.agronomic_cases
  add column if not exists source text not null default 'manual';

alter table public.agronomic_cases
  add column if not exists public_triage_draft_id uuid;

create unique index if not exists agronomic_cases_public_triage_draft_id_uidx
  on public.agronomic_cases(public_triage_draft_id)
  where public_triage_draft_id is not null;

create index if not exists agronomic_cases_source_idx
  on public.agronomic_cases(source);

create table if not exists public.public_disease_triage_drafts (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  submission_key text not null unique,
  user_id uuid references auth.users(id) on delete set null,
  form_data jsonb not null,
  attachments jsonb not null default '[]'::jsonb,
  status text not null default 'pending',
  case_id uuid references public.agronomic_cases(id) on delete set null,
  expires_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint public_disease_triage_drafts_status_check
    check (status in ('pending', 'processing', 'completed', 'expired')),
  constraint public_disease_triage_drafts_form_data_object_check
    check (jsonb_typeof(form_data) = 'object'),
  constraint public_disease_triage_drafts_attachments_array_check
    check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 4)
);

create index if not exists public_disease_triage_drafts_expiration_idx
  on public.public_disease_triage_drafts(status, expires_at);

create index if not exists public_disease_triage_drafts_user_idx
  on public.public_disease_triage_drafts(user_id, created_at desc);

drop trigger if exists set_public_disease_triage_drafts_updated_at on public.public_disease_triage_drafts;
create trigger set_public_disease_triage_drafts_updated_at
before update on public.public_disease_triage_drafts
for each row execute function public.set_updated_at();

alter table public.public_disease_triage_drafts enable row level security;
revoke all on public.public_disease_triage_drafts from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'public-disease-triage-drafts',
  'public-disease-triage-drafts',
  false,
  4194304,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Não há policy para anon/authenticated neste bucket. O servidor grava,
-- transfere e remove arquivos usando a service role depois de validar o fluxo.

commit;
