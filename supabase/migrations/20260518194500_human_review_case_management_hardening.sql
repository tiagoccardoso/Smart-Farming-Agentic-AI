-- Harden the continuous human-review case-management workflow.
-- The frontend calls backend routes for destructive actions, but these constraints
-- guarantee the same ownership, cascade and persistence expectations at database level.

alter table public.agronomic_cases
  drop constraint if exists agronomic_cases_status_check;

alter table public.agronomic_cases
  add constraint agronomic_cases_status_check check (
    status in (
      'draft',
      'submitted',
      'ai_analyzed',
      'waiting_payment_human_review',
      'waiting_human_review',
      'human_reviewed',
      'completed',
      'cancelled',
      'deleted'
    )
  );

alter table public.agronomic_cases
  drop constraint if exists agronomic_cases_human_review_status_check;

alter table public.agronomic_cases
  add constraint agronomic_cases_human_review_status_check check (
    human_review_status in (
      'not_requested',
      'pending_payment',
      'pending',
      'waiting_review',
      'waiting_soil_review',
      'waiting_technical_report',
      'in_review',
      'reviewed',
      'completed',
      'cancelled',
      'rejected'
    )
  );

-- Keep all dependent tables removable with a single validated case deletion.
alter table public.case_images
  drop constraint if exists case_images_case_id_fkey;
alter table public.case_images
  add constraint case_images_case_id_fkey
  foreign key (case_id) references public.agronomic_cases(id) on delete cascade;

alter table public.human_reviews
  drop constraint if exists human_reviews_case_id_fkey;
alter table public.human_reviews
  add constraint human_reviews_case_id_fkey
  foreign key (case_id) references public.agronomic_cases(id) on delete cascade;

alter table public.reports
  drop constraint if exists reports_case_id_fkey;
alter table public.reports
  add constraint reports_case_id_fkey
  foreign key (case_id) references public.agronomic_cases(id) on delete cascade;

alter table public.one_time_orders
  drop constraint if exists one_time_orders_case_id_fkey;
alter table public.one_time_orders
  add constraint one_time_orders_case_id_fkey
  foreign key (case_id) references public.agronomic_cases(id) on delete cascade;

create index if not exists agronomic_cases_user_review_status_idx
  on public.agronomic_cases(user_id, human_review_status, updated_at desc)
  where deleted_at is null and human_review_requested = true;

create index if not exists agronomic_cases_user_ai_summary_idx
  on public.agronomic_cases(user_id, updated_at desc)
  where deleted_at is null and ai_summary is not null;

-- Owners may delete their own cases through authenticated APIs after explicit
-- confirmation. Storage cleanup remains in the backend route because Storage and
-- Postgres are separate systems.
drop policy if exists "Users can delete own draft cases" on public.agronomic_cases;
drop policy if exists "Users can delete own cases" on public.agronomic_cases;
create policy "Users can delete own cases"
on public.agronomic_cases
for delete
to authenticated
using (user_id = auth.uid());
