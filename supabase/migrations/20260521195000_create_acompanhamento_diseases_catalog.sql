begin;

create table if not exists public.acompanhamento_diseases (
  id uuid primary key default gen_random_uuid(),
  common_name text not null,
  scientific_name text,
  causal_agent text,
  disease_type text,
  symptoms text,
  favorable_conditions text,
  crop_stage text,
  severity_level text,
  management_recommendations text,
  preventive_control text,
  curative_control text,
  technical_notes text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists acompanhamento_diseases_name_unique on public.acompanhamento_diseases (lower(common_name));
alter table public.acompanhamento_diseases enable row level security;
create policy "acompanhamento_diseases_staff_read" on public.acompanhamento_diseases for select using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','specialist') and coalesce(p.status,'active')='active'));
create policy "acompanhamento_diseases_staff_write" on public.acompanhamento_diseases for all using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','specialist') and coalesce(p.status,'active')='active')) with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','specialist') and coalesce(p.status,'active')='active'));

commit;
