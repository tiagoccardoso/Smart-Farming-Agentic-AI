-- Fix /consultoria-ia actions: soft deletion status and user-owned human-review queue inserts.

alter table public.agronomic_cases
  add column if not exists deleted_at timestamptz;

alter table public.agronomic_cases
  drop constraint if exists agronomic_cases_status_check;

alter table public.agronomic_cases
  add constraint agronomic_cases_status_check check (
    status in (
      'draft',
      'submitted',
      'ai_analyzed',
      'waiting_human_review',
      'human_reviewed',
      'completed',
      'deleted'
    )
  );

create index if not exists agronomic_cases_deleted_at_idx on public.agronomic_cases(deleted_at);
create index if not exists agronomic_cases_waiting_human_review_idx
  on public.agronomic_cases(human_review_status)
  where human_review_requested = true and deleted_at is null;

drop policy if exists "Users can request human review for own cases" on public.human_reviews;
create policy "Users can request human review for own cases"
on public.human_reviews
for insert
to authenticated
with check (
  specialist_id is null
  and status = 'pending'
  and exists (
    select 1
    from public.agronomic_cases c
    where c.id = human_reviews.case_id
      and c.user_id = auth.uid()
      and c.deleted_at is null
      and c.human_review_requested = true
      and c.human_review_status in ('waiting_review', 'pending')
  )
);

drop policy if exists "Specialists can view waiting human review cases" on public.agronomic_cases;
create policy "Specialists can view waiting human review cases"
on public.agronomic_cases
for select
to authenticated
using (
  public.is_specialist_or_admin(auth.uid())
  and deleted_at is null
  and human_review_requested = true
  and human_review_status in ('waiting_review', 'in_review', 'reviewed', 'completed')
);
