begin;

create table if not exists public.acompanhamento_records (
  id uuid primary key default gen_random_uuid(),
  module_slug text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  specialist_id uuid references auth.users(id) on delete set null,
  property_id uuid references public.acompanhamento_properties(id) on delete set null,
  title text not null,
  record_date date,
  status text,
  amount numeric(14,2),
  attachments jsonb not null default '[]'::jsonb,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists acompanhamento_records_module_idx on public.acompanhamento_records(module_slug);
create index if not exists acompanhamento_records_owner_idx on public.acompanhamento_records(owner_id);
create index if not exists acompanhamento_records_property_idx on public.acompanhamento_records(property_id);
create index if not exists acompanhamento_records_created_idx on public.acompanhamento_records(created_at desc);

alter table public.acompanhamento_records enable row level security;

create policy "acompanhamento_records_staff_read"
on public.acompanhamento_records
for select
using (
  auth.uid() = owner_id
  or auth.uid() = specialist_id
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','specialist') and coalesce(p.status,'active')='active')
);

create policy "acompanhamento_records_staff_insert"
on public.acompanhamento_records
for insert
with check (
  auth.uid() = owner_id
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','specialist') and coalesce(p.status,'active')='active')
);

create policy "acompanhamento_records_staff_update"
on public.acompanhamento_records
for update
using (
  auth.uid() = owner_id
  or auth.uid() = specialist_id
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','specialist') and coalesce(p.status,'active')='active')
)
with check (
  auth.uid() = owner_id
  or auth.uid() = specialist_id
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','specialist') and coalesce(p.status,'active')='active')
);

create policy "acompanhamento_records_staff_delete"
on public.acompanhamento_records
for delete
using (
  auth.uid() = owner_id
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role='admin' and coalesce(p.status,'active')='active')
);

commit;
