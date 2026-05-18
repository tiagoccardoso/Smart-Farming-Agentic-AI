-- Progressive, multimodal chat for agronomic case consultations.
-- Adds durable message metadata and a per-case queue of missing questions.

alter table public.case_chat_messages
  add column if not exists message_type text not null default 'text',
  add column if not exists file_url text;

alter table public.case_chat_messages
  drop constraint if exists case_chat_messages_message_type_check;

alter table public.case_chat_messages
  add constraint case_chat_messages_message_type_check
  check (message_type in ('text', 'image', 'audio', 'transcription'));

create index if not exists case_chat_messages_case_type_created_idx
  on public.case_chat_messages(case_id, message_type, created_at);

create table if not exists public.case_pending_questions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.agronomic_cases(id) on delete cascade,
  question text not null,
  answer text,
  status text not null default 'pending',
  order_index integer not null default 0,
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  constraint case_pending_questions_question_check check (length(trim(question)) > 0),
  constraint case_pending_questions_status_check check (status in ('pending', 'answered', 'skipped')),
  constraint case_pending_questions_answered_at_check check (
    (status = 'answered' and answered_at is not null)
    or (status <> 'answered')
  )
);

create unique index if not exists case_pending_questions_case_order_idx
  on public.case_pending_questions(case_id, order_index);

create index if not exists case_pending_questions_case_status_order_idx
  on public.case_pending_questions(case_id, status, order_index);

alter table public.case_pending_questions enable row level security;

drop policy if exists "Users can view own case pending questions" on public.case_pending_questions;
create policy "Users can view own case pending questions"
  on public.case_pending_questions for select
  to authenticated
  using (
    exists (
      select 1 from public.agronomic_cases c
      where c.id = case_pending_questions.case_id
        and c.user_id = auth.uid()
    )
    or public.is_specialist_or_admin()
  );

drop policy if exists "Users can insert own case pending questions" on public.case_pending_questions;
create policy "Users can insert own case pending questions"
  on public.case_pending_questions for insert
  to authenticated
  with check (
    exists (
      select 1 from public.agronomic_cases c
      where c.id = case_pending_questions.case_id
        and c.user_id = auth.uid()
    )
  );

drop policy if exists "Users can update own case pending questions" on public.case_pending_questions;
create policy "Users can update own case pending questions"
  on public.case_pending_questions for update
  to authenticated
  using (
    exists (
      select 1 from public.agronomic_cases c
      where c.id = case_pending_questions.case_id
        and c.user_id = auth.uid()
    )
    or public.is_specialist_or_admin()
  )
  with check (
    exists (
      select 1 from public.agronomic_cases c
      where c.id = case_pending_questions.case_id
        and c.user_id = auth.uid()
    )
    or public.is_specialist_or_admin()
  );

drop policy if exists "Users can delete own case pending questions" on public.case_pending_questions;
create policy "Users can delete own case pending questions"
  on public.case_pending_questions for delete
  to authenticated
  using (
    exists (
      select 1 from public.agronomic_cases c
      where c.id = case_pending_questions.case_id
        and c.user_id = auth.uid()
    )
    or public.is_specialist_or_admin()
  );

-- Allow chat audio files in the existing authenticated bucket.
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'audio/webm', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav'],
    file_size_limit = greatest(coalesce(file_size_limit, 0), 26214400)
where id = 'agronomic-cases';
