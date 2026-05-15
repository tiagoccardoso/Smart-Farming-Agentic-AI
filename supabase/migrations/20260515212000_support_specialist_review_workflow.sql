-- Support the specialist dashboard workflow for paid human reviews.

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

alter table public.human_reviews
  add column if not exists final_observations text;

create policy "Specialists can view farms for human review cases"
  on public.farms for select
  to authenticated
  using (
    public.is_specialist_or_admin()
    and exists (
      select 1
      from public.agronomic_cases c
      where c.farm_id = farms.id
        and c.human_review_requested = true
    )
  );
