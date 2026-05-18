-- Keep human-review dashboard records persistent and queryable until the owner manually deletes the case.

create index if not exists agronomic_cases_user_human_review_requested_idx
  on public.agronomic_cases(user_id, human_review_requested, updated_at desc)
  where deleted_at is null;

create index if not exists agronomic_cases_user_ai_analyzed_idx
  on public.agronomic_cases(user_id, status, updated_at desc)
  where deleted_at is null;

create index if not exists one_time_orders_user_case_service_payment_idx
  on public.one_time_orders(user_id, case_id, service_type, payment_status, created_at desc);

-- Owners must be able to read their one-time order status in the dashboard;
-- writes continue to be validated by the backend routes and Stripe webhooks.
alter table public.one_time_orders enable row level security;

drop policy if exists "Users can view own one time orders" on public.one_time_orders;
create policy "Users can view own one time orders"
on public.one_time_orders
for select
to authenticated
using (user_id = auth.uid());

-- A pending human-review request remains visible even if the payment is cancelled/expired.
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
