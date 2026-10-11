-- Análise inicial de casos em processamento durável (status persistido).
--
-- Motivo: a análise com fotos pode levar mais que uma requisição permite. A
-- rota cria a resposta no provedor em modo background e registra aqui o
-- andamento; a tela consulta o status e o resultado é gravado no caso quando
-- fica pronto, mesmo que o usuário saia e volte depois.
--
-- Não destrutiva: só cria uma tabela nova. O código funciona sem esta
-- migration (volta ao fluxo síncrono de antes), mas o acompanhamento, a
-- retomada após sair da tela e o bloqueio entre instâncias dependem dela.

create table if not exists public.agronomic_analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.agronomic_cases(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'processing',
  provider text,
  model text,
  -- Identificador da resposta no provedor (ex.: resp_...). Não é segredo.
  provider_response_id text,
  -- Código de suporte mostrado ao usuário (correlaciona com os logs).
  request_id text,
  error_code text,
  -- Resumo das fotos enviadas (sem URLs) e contexto usado para normalizar a
  -- resposta (pesquisa externa e base interna da execução).
  image_summary jsonb,
  context jsonb,
  save_attempts integer not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agronomic_analysis_jobs_status_check
    check (status in ('processing', 'saving', 'completed', 'failed')),
  constraint agronomic_analysis_jobs_request_id_check
    check (request_id is null or length(request_id) <= 80)
);

-- No máximo UMA análise ativa por caso, entre todas as instâncias da função.
create unique index if not exists agronomic_analysis_jobs_active_uidx
  on public.agronomic_analysis_jobs(case_id)
  where status in ('processing', 'saving');

create index if not exists agronomic_analysis_jobs_case_created_idx
  on public.agronomic_analysis_jobs(case_id, created_at desc);

alter table public.agronomic_analysis_jobs enable row level security;

-- O dono do caso pode ler o andamento das próprias análises. Escritas são
-- feitas somente pelo servidor (service role), depois de validar sessão e
-- propriedade do caso.
drop policy if exists "Users can read own analysis jobs" on public.agronomic_analysis_jobs;
create policy "Users can read own analysis jobs"
  on public.agronomic_analysis_jobs
  for select
  to authenticated
  using (auth.uid() = user_id);

revoke insert, update, delete on public.agronomic_analysis_jobs from anon, authenticated;
grant select on public.agronomic_analysis_jobs to authenticated;
grant all on public.agronomic_analysis_jobs to service_role;
