-- Storage bucket and access policies for agronomic case attachments.
-- Run this SQL in Supabase if the agronomic-cases bucket does not exist yet.
-- Files are stored as: userId/caseId/nome-do-arquivo.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'agronomic-cases',
  'agronomic-cases',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can upload own agronomic case files" on storage.objects;
drop policy if exists "Users can view own agronomic case files" on storage.objects;
drop policy if exists "Users can update own agronomic case files" on storage.objects;
drop policy if exists "Users can delete own agronomic case files" on storage.objects;

create policy "Users can upload own agronomic case files"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'agronomic-cases'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can view own agronomic case files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'agronomic-cases'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can update own agronomic case files"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'agronomic-cases'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'agronomic-cases'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete own agronomic case files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'agronomic-cases'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
