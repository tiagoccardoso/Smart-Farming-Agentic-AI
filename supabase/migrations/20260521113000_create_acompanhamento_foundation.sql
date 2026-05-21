begin;

create table if not exists public.acompanhamento_properties (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  specialist_id uuid references auth.users(id) on delete set null,
  name text not null,
  owner_name text,
  location_gps text,
  total_area_ha numeric(12,2),
  sectors jsonb not null default '[]'::jsonb,
  soil_type text,
  altitude_m integer,
  area_history text,
  photo_urls jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists acompanhamento_properties_owner_idx on public.acompanhamento_properties(owner_id);
create index if not exists acompanhamento_properties_specialist_idx on public.acompanhamento_properties(specialist_id);

create table if not exists public.acompanhamento_disease_library (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  symptoms text,
  description text,
  image_urls jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

insert into public.acompanhamento_disease_library (slug, name, symptoms, description)
values
  ('antracnose', 'Antracnose', 'Lesões necróticas e escurecidas em folhas/frutos.', 'Doença fúngica com avanço rápido em alta umidade.'),
  ('ferrugem', 'Ferrugem', 'Pústulas alaranjadas a castanhas nas folhas.', 'Favorecida por umidade e temperaturas amenas.'),
  ('requeima', 'Requeima', 'Manchas escuras com borda encharcada e avanço agressivo.', 'Pode causar perda rápida em condições de alta umidade.'),
  ('greening', 'Greening', 'Amarelecimento irregular e frutos deformados.', 'Doença bacteriana severa em citrus.'),
  ('mofo-branco', 'Mofo-branco', 'Micélio branco e estruturas esclerociais.', 'Associada a ambientes úmidos e adensamento.')
on conflict (slug) do update set
  name = excluded.name,
  symptoms = excluded.symptoms,
  description = excluded.description;

alter table public.acompanhamento_properties enable row level security;
alter table public.acompanhamento_disease_library enable row level security;

create policy "acompanhamento_properties_owner_or_staff_read"
  on public.acompanhamento_properties
  for select
  using (
    auth.uid() = owner_id
    or auth.uid() = specialist_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'specialist') and coalesce(p.status, 'active') = 'active')
  );

create policy "acompanhamento_properties_owner_create"
  on public.acompanhamento_properties
  for insert
  with check (auth.uid() = owner_id);

create policy "acompanhamento_properties_owner_or_staff_update"
  on public.acompanhamento_properties
  for update
  using (
    auth.uid() = owner_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'specialist') and coalesce(p.status, 'active') = 'active')
  )
  with check (
    auth.uid() = owner_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'specialist') and coalesce(p.status, 'active') = 'active')
  );

create policy "acompanhamento_properties_owner_or_staff_delete"
  on public.acompanhamento_properties
  for delete
  using (
    auth.uid() = owner_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and coalesce(p.status, 'active') = 'active')
  );

create policy "acompanhamento_disease_library_staff_read"
  on public.acompanhamento_disease_library
  for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'specialist') and coalesce(p.status, 'active') = 'active'));

commit;
