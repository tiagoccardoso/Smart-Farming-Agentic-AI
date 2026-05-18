-- Complete the paid human-review request flow and hard-delete cleanup.
-- Cases requested for human review must wait for payment before entering the specialist queue.

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
      'in_review',
      'reviewed',
      'completed',
      'rejected'
    )
  );

-- Let owners place and cancel cases in the pre-payment state, without granting
-- access to specialist-only final/review states.
drop policy if exists "Users can update own cases" on public.agronomic_cases;
create policy "Users can update own cases"
on public.agronomic_cases
for update
to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and status in ('draft', 'submitted', 'ai_analyzed', 'waiting_payment_human_review')
  and human_review_status in ('not_requested', 'pending_payment', 'pending')
  and (
    farm_id is null
    or exists (
      select 1
      from public.farms f
      where f.id = agronomic_cases.farm_id
        and f.user_id = auth.uid()
    )
  )
);

-- User-created review rows are bookkeeping while payment is pending. Specialists
-- still only see cases after Stripe moves the case to waiting_review.
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
      and c.human_review_status in ('pending_payment', 'waiting_review', 'pending')
  )
);

-- Full case deletion should remove payment/review bookkeeping rather than leaving
-- orphaned orders with case_id = null.
alter table public.one_time_orders
  drop constraint if exists one_time_orders_case_id_fkey;

alter table public.one_time_orders
  add constraint one_time_orders_case_id_fkey
  foreign key (case_id) references public.agronomic_cases(id) on delete cascade;

create index if not exists one_time_orders_case_payment_idx
  on public.one_time_orders(case_id, payment_status);
