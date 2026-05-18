create table if not exists public.specialist_visit_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  city text,
  state text,
  preferred_date date,
  preferred_time text,
  request_type text not null,
  message text,
  status text not null default 'novo',
  internal_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.specialist_visit_requests enable row level security;

drop policy if exists "public_can_insert_visit_requests" on public.specialist_visit_requests;
drop policy if exists "specialists_admins_can_read_visit_requests" on public.specialist_visit_requests;
drop policy if exists "specialists_admins_can_update_visit_requests" on public.specialist_visit_requests;

create policy "public_can_insert_visit_requests"
on public.specialist_visit_requests
for insert
to anon, authenticated
with check (true);

create policy "specialists_admins_can_read_visit_requests"
on public.specialist_visit_requests
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'specialist')
      and coalesce(p.status, 'active') = 'active'
  )
);

create policy "specialists_admins_can_update_visit_requests"
on public.specialist_visit_requests
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'specialist')
      and coalesce(p.status, 'active') = 'active'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'specialist')
      and coalesce(p.status, 'active') = 'active'
  )
);
