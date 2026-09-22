-- PlantaSa: anexos (imagens/audio) e protecao contra abuso nos formularios
-- publicos de Contato (/contact) e Solicitacao de Orcamento (/solicitar-orcamento).
--
-- Principios:
--   * Aditiva e idempotente. Nenhuma tabela, coluna ou registro existente e
--     removido ou alterado. Nenhum DROP de tabela/coluna.
--   * As duas origens continuam na MESMA tabela (specialist_visit_requests),
--     diferenciadas pela coluna `source` ('agendamento' = Contato,
--     'orcamento' = Solicitacao de Orcamento). Os anexos ficam na propria
--     solicitacao (jsonb), sem tabela paralela.
--   * Arquivos ficam em um bucket PRIVADO. Nao ha policy para anon/authenticated:
--     somente o servidor (service role) grava e gera URLs assinadas de curta
--     duracao para a area administrativa.
--   * Rate limit persistente (funciona em ambiente serverless), consumido
--     apenas pelo servidor via funcao security definer.
--
-- Rollback (se necessario): remover a funcao consume_public_form_rate_limit,
-- a tabela public_form_rate_events e o bucket public-request-attachments
-- (apos esvaziar). A coluna attachments e opcional (default '[]') e pode
-- permanecer.

begin;

-- ---------------------------------------------------------------------------
-- 1. Anexos vinculados a solicitacao
-- ---------------------------------------------------------------------------
-- Formato de cada item:
--   { "kind": "image" | "audio", "path": "<caminho no bucket>",
--     "mime_type": "image/jpeg", "size_bytes": 12345,
--     "original_name": "foto.jpg", "duration_seconds": 42 | null }

alter table public.specialist_visit_requests
  add column if not exists attachments jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'specialist_visit_requests_attachments_check'
      and conrelid = 'public.specialist_visit_requests'::regclass
  ) then
    alter table public.specialist_visit_requests
      add constraint specialist_visit_requests_attachments_check
      check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 10);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Bucket privado para os anexos dos formularios publicos
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'public-request-attachments',
  'public-request-attachments',
  false,
  3145728, -- 3 MB (a aplicacao aplica limites menores por tipo)
  array[
    'image/jpeg', 'image/png', 'image/webp',
    'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'
  ]::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Nenhuma policy de storage.objects e criada para este bucket: com RLS ativo,
-- anon e authenticated nao conseguem listar, ler, gravar ou apagar arquivos.

-- ---------------------------------------------------------------------------
-- 3. Rate limit dos formularios publicos (envio e assistente de IA)
-- ---------------------------------------------------------------------------

create table if not exists public.public_form_rate_events (
  id bigserial primary key,
  bucket text not null,
  key_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists public_form_rate_events_lookup_idx
  on public.public_form_rate_events (bucket, key_hash, created_at desc);

create index if not exists public_form_rate_events_created_idx
  on public.public_form_rate_events (created_at);

alter table public.public_form_rate_events enable row level security;
revoke all on public.public_form_rate_events from anon, authenticated;

-- Retorna true quando o evento e permitido (e o registra); false quando o
-- limite da janela foi atingido. Atomico por chave (advisory lock).
create or replace function public.consume_public_form_rate_limit(
  p_bucket text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_bucket is null or p_key_hash is null or p_limit is null or p_limit < 1
     or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'invalid rate limit arguments';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_bucket || ':' || p_key_hash));

  select count(*) into v_count
  from public.public_form_rate_events
  where bucket = p_bucket
    and key_hash = p_key_hash
    and created_at > now() - make_interval(secs => p_window_seconds);

  if v_count >= p_limit then
    return false;
  end if;

  insert into public.public_form_rate_events (bucket, key_hash) values (p_bucket, p_key_hash);

  -- Limpeza incremental de eventos antigos (sem varrer a tabela inteira).
  delete from public.public_form_rate_events
  where id in (
    select id from public.public_form_rate_events
    where created_at < now() - interval '2 days'
    order by created_at
    limit 200
  );

  return true;
end;
$$;

revoke all on function public.consume_public_form_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_public_form_rate_limit(text, text, integer, integer) to service_role;

commit;
