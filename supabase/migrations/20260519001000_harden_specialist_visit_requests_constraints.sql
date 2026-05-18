alter table public.specialist_visit_requests
  alter column phone set not null,
  alter column city set not null,
  alter column state set not null;

alter table public.specialist_visit_requests
  add constraint specialist_visit_requests_status_check
  check (status in ('novo', 'em_contato', 'confirmado', 'cancelado', 'concluido'));
