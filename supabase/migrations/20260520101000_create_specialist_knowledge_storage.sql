-- Storage bucket for specialist knowledge file attachments.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'specialist-knowledge',
  'specialist-knowledge',
  true,
  15728640,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'text/plain',
    'text/markdown',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Specialists and admins can upload specialist knowledge files" on storage.objects;
drop policy if exists "Specialists and admins can view specialist knowledge files" on storage.objects;
drop policy if exists "Specialists and admins can update specialist knowledge files" on storage.objects;
drop policy if exists "Specialists and admins can delete specialist knowledge files" on storage.objects;

create policy "Specialists and admins can upload specialist knowledge files"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'specialist-knowledge'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role in ('specialist', 'admin')
    )
  );

create policy "Specialists and admins can view specialist knowledge files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'specialist-knowledge'
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role in ('specialist', 'admin')
    )
  );

create policy "Specialists and admins can update specialist knowledge files"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'specialist-knowledge'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role in ('specialist', 'admin')
    )
  )
  with check (
    bucket_id = 'specialist-knowledge'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role in ('specialist', 'admin')
    )
  );

create policy "Specialists and admins can delete specialist knowledge files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'specialist-knowledge'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role in ('specialist', 'admin')
    )
  );
