-- Allow cases to enter a payment-pending state immediately after the
-- producer requests human review and before Stripe confirms payment.

alter table public.agronomic_cases
  drop constraint if exists agronomic_cases_human_review_status_check;

alter table public.agronomic_cases
  add constraint agronomic_cases_human_review_status_check check (
    human_review_status in (
      'not_requested',
      'pending_payment',
      'pending',
      'in_review',
      'completed',
      'rejected'
    )
  );
