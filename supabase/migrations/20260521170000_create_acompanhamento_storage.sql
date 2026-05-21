begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'acompanhamento-anexos',
  'acompanhamento-anexos',
  true,
  15728640,
  array['image/png','image/jpeg','image/webp','application/pdf']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "acompanhamento_anexos_staff_upload" on storage.objects;
create policy "acompanhamento_anexos_staff_upload"
on storage.objects
for insert
with check (
  bucket_id = 'acompanhamento-anexos'
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','specialist') and coalesce(p.status,'active')='active')
);

drop policy if exists "acompanhamento_anexos_staff_read" on storage.objects;
create policy "acompanhamento_anexos_staff_read"
on storage.objects
for select
using (
  bucket_id = 'acompanhamento-anexos'
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','specialist') and coalesce(p.status,'active')='active')
);

commit;
