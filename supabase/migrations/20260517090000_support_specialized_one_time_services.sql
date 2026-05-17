-- Support specialized one-time consulting services after Stripe payment.

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
      'rejected'
    )
  );
