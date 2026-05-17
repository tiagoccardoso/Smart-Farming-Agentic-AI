-- Harden safety and responsibility boundaries for the hybrid AI + human review workflow.
-- Specialists/admins may only read or mutate cases that are actually in the paid
-- human-review workflow; report generation is limited to reviewed/requested cases.

alter table public.agronomic_cases enable row level security;
alter table public.case_images enable row level security;
alter table public.human_reviews enable row level security;
alter table public.reports enable row level security;

-- Replace broad specialist case access (previously any human_review_requested=true)
-- with explicit paid/review statuses used by the specialist dashboard.
drop policy if exists "Users can view own cases" on public.agronomic_cases;
create policy "Users can view own cases"
  on public.agronomic_cases for select
  to authenticated
  using (
    user_id = auth.uid()
    or (
      public.is_specialist_or_admin()
      and human_review_requested = true
      and human_review_status in ('waiting_review', 'in_review', 'reviewed', 'completed')
    )
  );


-- Owners can keep normal case data current, but cannot self-promote a case into
-- specialist-only reviewed/final states or the paid specialist queue.
drop policy if exists "Users can update own cases" on public.agronomic_cases;
create policy "Users can update own cases"
  on public.agronomic_cases for update
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and status in ('draft', 'submitted', 'ai_analyzed', 'waiting_human_review')
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

drop policy if exists "Specialists can update human review cases" on public.agronomic_cases;
create policy "Specialists can update active human review cases"
  on public.agronomic_cases for update
  to authenticated
  using (
    public.is_specialist_or_admin()
    and human_review_requested = true
    and human_review_status in ('waiting_review', 'in_review', 'reviewed', 'completed')
  )
  with check (
    public.is_specialist_or_admin()
    and human_review_requested = true
    and human_review_status in ('waiting_review', 'in_review', 'reviewed', 'completed')
  );

-- Case images follow the same specialist visibility boundary as cases.
drop policy if exists "Users can view own case images" on public.case_images;
create policy "Users can view own case images"
  on public.case_images for select
  to authenticated
  using (
    user_id = auth.uid()
    or (
      public.is_specialist_or_admin()
      and exists (
        select 1
        from public.agronomic_cases c
        where c.id = case_images.case_id
          and c.human_review_requested = true
          and c.human_review_status in ('waiting_review', 'in_review', 'reviewed', 'completed')
      )
    )
  );

-- Human reviews remain readable by owners; specialists/admins only see reviews tied
-- to active/reviewed human-review cases.
drop policy if exists "Users can view reviews for own cases" on public.human_reviews;
create policy "Users can view reviews for own cases"
  on public.human_reviews for select
  to authenticated
  using (
    exists (
      select 1
      from public.agronomic_cases c
      where c.id = human_reviews.case_id
        and c.user_id = auth.uid()
    )
    or (
      public.is_specialist_or_admin()
      and exists (
        select 1
        from public.agronomic_cases c
        where c.id = human_reviews.case_id
          and c.human_review_requested = true
          and c.human_review_status in ('waiting_review', 'in_review', 'reviewed', 'completed')
      )
    )
  );

drop policy if exists "Specialists can insert reviews for requested cases" on public.human_reviews;
create policy "Specialists can insert reviews for active human review cases"
  on public.human_reviews for insert
  to authenticated
  with check (
    public.is_specialist_or_admin()
    and (specialist_id = auth.uid() or public.is_admin())
    and exists (
      select 1
      from public.agronomic_cases c
      where c.id = human_reviews.case_id
        and c.human_review_requested = true
        and c.human_review_status in ('waiting_review', 'in_review')
    )
  );

drop policy if exists "Specialists can update their reviews" on public.human_reviews;
create policy "Specialists can update their active human reviews"
  on public.human_reviews for update
  to authenticated
  using (
    (public.is_admin() or specialist_id = auth.uid())
    and exists (
      select 1
      from public.agronomic_cases c
      where c.id = human_reviews.case_id
        and c.human_review_requested = true
        and c.human_review_status in ('waiting_review', 'in_review', 'reviewed', 'completed')
    )
  )
  with check (
    (public.is_admin() or specialist_id = auth.uid())
    and exists (
      select 1
      from public.agronomic_cases c
      where c.id = human_reviews.case_id
        and c.human_review_requested = true
        and c.human_review_status in ('waiting_review', 'in_review', 'reviewed', 'completed')
    )
  );

-- Report visibility/generation remains owner + specialist-only, and specialists can
-- create final reports only for cases that have entered the paid review workflow.
drop policy if exists "Specialists can view reports for requested cases" on public.reports;
create policy "Specialists can view reports for active human review cases"
  on public.reports for select
  to authenticated
  using (
    public.is_specialist_or_admin()
    and exists (
      select 1
      from public.agronomic_cases c
      where c.id = reports.case_id
        and c.human_review_requested = true
        and c.human_review_status in ('waiting_review', 'in_review', 'reviewed', 'completed')
    )
  );

drop policy if exists "Specialists can insert reports for requested cases" on public.reports;
create policy "Specialists can insert reports for reviewed human cases"
  on public.reports for insert
  to authenticated
  with check (
    public.is_specialist_or_admin()
    and report_type = 'human_review_final'
    and exists (
      select 1
      from public.agronomic_cases c
      where c.id = reports.case_id
        and c.user_id = reports.user_id
        and c.human_review_requested = true
        and c.human_review_status in ('waiting_review', 'in_review', 'reviewed', 'completed')
    )
  );

-- Keep farm access for the Painel da Doutora aligned with the same paid queue.
drop policy if exists "Specialists can view farms for human review cases" on public.farms;
create policy "Specialists can view farms for active human review cases"
  on public.farms for select
  to authenticated
  using (
    public.is_specialist_or_admin()
    and exists (
      select 1
      from public.agronomic_cases c
      where c.farm_id = farms.id
        and c.human_review_requested = true
        and c.human_review_status in ('waiting_review', 'in_review', 'reviewed', 'completed')
    )
  );
