-- PlantaSa: parecer agronomico humano como beneficio mensal dos planos.
--
--   * PlantaSa IA Profissional ........ 1 parecer agronomico humano por mes
--   * PlantaSa Consultoria Agronomica . ate 3 pareceres agronomicos humanos por mes
--   * Demais planos ................... sem parecer humano
--
-- Principios:
--   * Aditiva e idempotente. Nenhuma tabela, coluna, pagamento, pedido
--     (one_time_orders), invoice, credito ou caso e removido.
--   * O consumo e contabilizado em `technical_opinions` (ledger ja existente),
--     agora tambem vinculado ao caso enviado por /enviar-caso.
--   * Consumo atomico: advisory lock por usuario + contagem + insercao na mesma
--     transacao. Idempotencia por (user_id, idempotency_key) e por caso.
--   * Os servicos avulsos antigos sao apenas DESATIVADOS (active = false):
--     deixam de ser vendidos, mas o historico continua integro.
--
-- Rollback: `drop function public.request_case_human_opinion(...)`,
-- `drop trigger sync_case_human_opinion_status on public.agronomic_cases`,
-- reaplicar 20260922141000 (versao anterior de create_technical_opinion) e
-- reativar os servicos desejados. As colunas novas sao opcionais (nullable) e
-- podem permanecer.

begin;

-- ---------------------------------------------------------------------------
-- 1. Beneficios dos planos (fonte de verdade: plans.entitlements / features)
-- ---------------------------------------------------------------------------

-- IA Profissional: 1 parecer humano por mes.
update public.plans
set entitlements = coalesce(entitlements, '{}'::jsonb)
      || '{"TECHNICAL_OPINIONS_MONTHLY": 1, "HUMAN_VALIDATION": true}'::jsonb,
    eyebrow = 'Plano recomendado',
    features = (
      select coalesce(jsonb_agg(item order by ord), '[]'::jsonb)
      from (
        select item, ord
        from jsonb_array_elements(coalesce(plans.features, '[]'::jsonb)) with ordinality as f(item, ord)
        where item #>> '{}' !~* 'parecer'
        union all
        select to_jsonb('1 parecer agronômico humano por mês'::text), 0
      ) ordered
    ),
    updated_at = now()
where slug = 'ia-profissional';

-- Consultoria Agronomica: ate 3 pareceres humanos por mes. Mantem os demais
-- beneficios; apenas substitui o texto antigo de pareceres.
update public.plans
set entitlements = coalesce(entitlements, '{}'::jsonb)
      || '{"TECHNICAL_OPINIONS_MONTHLY": 3, "HUMAN_VALIDATION": true}'::jsonb,
    eyebrow = 'Acompanhamento especializado',
    features = (
      select coalesce(jsonb_agg(item order by ord), '[]'::jsonb)
      from (
        select case
                 when item #>> '{}' ~* 'parecer' then to_jsonb('Até 3 pareceres agronômicos humanos por mês'::text)
                 else item
               end as item,
               ord
        from jsonb_array_elements(coalesce(plans.features, '[]'::jsonb)) with ordinality as f(item, ord)
        union all
        select to_jsonb('Até 3 pareceres agronômicos humanos por mês'::text), 2
        where not exists (
          select 1 from jsonb_array_elements(coalesce(plans.features, '[]'::jsonb)) e
          where e #>> '{}' ~* 'parecer'
        )
      ) ordered
    ),
    updated_at = now()
where slug = 'consultoria-agronomica';

-- Planos sem parecer humano: garante limite 0 (inclui Gratuito e sob consulta).
update public.plans
set entitlements = coalesce(entitlements, '{}'::jsonb) || '{"TECHNICAL_OPINIONS_MONTHLY": 0}'::jsonb,
    updated_at = now()
where slug in ('gratuito', 'presencial-projetos');

-- Fallback dos legados (usado apenas se legacy_entitlement_code nao resolver).
update public.plans
set entitlements = coalesce(entitlements, '{}'::jsonb)
      || '{"TECHNICAL_OPINIONS_MONTHLY": 1, "HUMAN_VALIDATION": true}'::jsonb
where slug = 'ia-basica';

-- ---------------------------------------------------------------------------
-- 2. Pagina de Planos: atendimento pontual vai para o Contato
-- ---------------------------------------------------------------------------

update public.plan_page_settings
set onetime_title = 'Precisa de atendimento pontual?',
    onetime_description = 'Visitas técnicas, atendimento presencial, projetos especiais ou demandas fora do escopo das assinaturas: fale com a nossa equipe e receba um orçamento personalizado.',
    onetime_button_label = 'Falar com a equipe',
    updated_at = now()
where id = true;

-- ---------------------------------------------------------------------------
-- 3. Fim da venda avulsa: servicos antigos apenas desativados
--    (pedidos, pagamentos e casos existentes permanecem intactos)
-- ---------------------------------------------------------------------------

update public.plan_page_services
set active = false,
    updated_at = now()
where service_type in (
  'human_case_review',
  'soil_analysis_review',
  'technical_report',
  'monthly_farm_followup',
  'technical_opinion_single'
)
and active = true;

-- ---------------------------------------------------------------------------
-- 4. Ledger de pareceres: auditoria + idempotencia
-- ---------------------------------------------------------------------------

alter table public.technical_opinions
  add column if not exists idempotency_key text,
  add column if not exists plan_code text;

comment on column public.technical_opinions.idempotency_key is
  'Chave enviada pelo cliente em cada tentativa de envio. A mesma chave nunca consome dois pareceres.';
comment on column public.technical_opinions.plan_code is
  'Plano (slug de direitos) vigente no momento do consumo. Auditoria.';

alter table public.technical_opinions drop constraint if exists technical_opinions_idempotency_key_check;
alter table public.technical_opinions
  add constraint technical_opinions_idempotency_key_check
  check (idempotency_key is null or char_length(idempotency_key) between 8 and 120);

create unique index if not exists technical_opinions_user_idempotency_key
  on public.technical_opinions (user_id, idempotency_key)
  where idempotency_key is not null;

-- Um caso consome no maximo um parecer ativo.
create unique index if not exists technical_opinions_case_active_key
  on public.technical_opinions (case_id)
  where case_id is not null and status <> 'cancelado';

-- Contagem por janela do ciclo.
create index if not exists technical_opinions_user_origin_created_idx
  on public.technical_opinions (user_id, origin, created_at);

-- ---------------------------------------------------------------------------
-- 5. Consumo atomico do parecer vinculado a um caso (/enviar-caso)
-- ---------------------------------------------------------------------------

create or replace function public.request_case_human_opinion(
  p_user_id uuid,
  p_case_id uuid,
  p_idempotency_key text,
  p_subscription_id uuid,
  p_plan_code text,
  p_monthly_limit integer,
  p_cycle_reference text,
  p_cycle_start timestamptz,
  p_cycle_end timestamptz,
  p_title text,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_case public.agronomic_cases%rowtype;
  existing public.technical_opinions%rowtype;
  created public.technical_opinions%rowtype;
  used_in_cycle integer := 0;
  review_id uuid;
  v_title text := left(btrim(coalesce(p_title, '')), 200);
  v_description text := btrim(coalesce(p_description, ''));
begin
  if p_user_id is null or p_case_id is null then
    raise exception 'INVALID_ARGUMENTS' using errcode = '22023';
  end if;

  if p_cycle_start is null or p_cycle_end is null or p_cycle_end <= p_cycle_start then
    raise exception 'INVALID_CYCLE' using errcode = '22023';
  end if;

  -- Respeita as constraints de technical_opinions sem rejeitar casos validos.
  if char_length(v_title) < 3 then
    v_title := 'Parecer agronômico';
  end if;
  if char_length(v_description) < 10 then
    v_description := btrim('Caso enviado para parecer agronômico humano. ' || v_description);
  end if;

  -- Serializa todos os consumos do mesmo usuario (duas abas, duplo clique,
  -- retries simultaneos). O lock e liberado no fim da transacao.
  perform pg_advisory_xact_lock(hashtextextended('technical_opinions:' || p_user_id::text, 0));

  -- Idempotencia 1: a mesma tentativa de envio ja foi registrada.
  if p_idempotency_key is not null then
    select * into existing
    from public.technical_opinions o
    where o.user_id = p_user_id and o.idempotency_key = p_idempotency_key
    limit 1;

    if found then
      return jsonb_build_object('opinion', to_jsonb(existing), 'replayed', true);
    end if;
  end if;

  select * into target_case
  from public.agronomic_cases c
  where c.id = p_case_id
  for update;

  if not found or target_case.user_id <> p_user_id then
    raise exception 'CASE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if target_case.deleted_at is not null or target_case.status in ('deleted', 'cancelled') then
    raise exception 'CASE_NOT_ELIGIBLE' using errcode = 'P0001';
  end if;

  -- Idempotencia 2: o caso ja tem um parecer ativo.
  select * into existing
  from public.technical_opinions o
  where o.case_id = p_case_id and o.status <> 'cancelado'
  limit 1;

  if found then
    return jsonb_build_object('opinion', to_jsonb(existing), 'replayed', true);
  end if;

  if target_case.status in ('human_reviewed', 'completed')
     or target_case.human_review_status in ('waiting_review', 'in_review', 'reviewed', 'completed') then
    raise exception 'CASE_ALREADY_IN_REVIEW' using errcode = 'P0001';
  end if;

  -- Consumo no ciclo: pareceres de franquia nao cancelados criados na janela.
  select count(*) into used_in_cycle
  from public.technical_opinions o
  where o.user_id = p_user_id
    and o.origin = 'subscription'
    and o.status <> 'cancelado'
    and o.created_at >= p_cycle_start
    and o.created_at < p_cycle_end;

  if coalesce(p_monthly_limit, 0) <= used_in_cycle then
    raise exception 'HUMAN_OPINION_LIMIT_REACHED' using errcode = 'P0001';
  end if;

  insert into public.technical_opinions (
    user_id, subscription_id, case_id, origin, title, description, status,
    billing_cycle_reference, cycle_start, cycle_end, idempotency_key, plan_code
  ) values (
    p_user_id, p_subscription_id, p_case_id, 'subscription',
    v_title,
    v_description,
    'aberto', p_cycle_reference, p_cycle_start, p_cycle_end, p_idempotency_key, p_plan_code
  )
  returning * into created;

  insert into public.technical_opinion_messages (opinion_id, author_id, author_role, body)
  values (created.id, p_user_id, 'client', created.description);

  update public.agronomic_cases
  set human_review_requested = true,
      human_review_status = 'waiting_review',
      status = 'waiting_human_review',
      updated_at = now()
  where id = p_case_id;

  -- Fila da especialista (mesma estrutura usada pelo painel).
  select h.id into review_id
  from public.human_reviews h
  where h.case_id = p_case_id
  order by h.created_at desc
  limit 1;

  if review_id is null then
    insert into public.human_reviews (case_id, status) values (p_case_id, 'pending');
  else
    update public.human_reviews
    set status = 'pending', specialist_id = null, reviewed_at = null
    where id = review_id and status <> 'completed';
  end if;

  insert into public.case_activity_logs (case_id, user_id, action, metadata)
  values (
    p_case_id, p_user_id, 'Parecer agronômico humano solicitado',
    jsonb_build_object(
      'source', 'plan_benefit',
      'opinion_id', created.id,
      'plan_code', p_plan_code,
      'cycle_reference', p_cycle_reference,
      'cycle_start', p_cycle_start,
      'cycle_end', p_cycle_end
    )
  );

  return jsonb_build_object('opinion', to_jsonb(created), 'replayed', false);
end;
$$;

revoke all on function public.request_case_human_opinion(uuid, uuid, text, uuid, text, integer, text, timestamptz, timestamptz, text, text) from public;
revoke all on function public.request_case_human_opinion(uuid, uuid, text, uuid, text, integer, text, timestamptz, timestamptz, text, text) from anon, authenticated;
grant execute on function public.request_case_human_opinion(uuid, uuid, text, uuid, text, integer, text, timestamptz, timestamptz, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. create_technical_opinion (/pareceres): mesma serializacao e mesma janela
--    de contagem, para que os dois pontos de entrada dividam a franquia sem
--    condicao de corrida. Assinatura da funcao inalterada.
-- ---------------------------------------------------------------------------

create or replace function public.create_technical_opinion(
  p_user_id uuid,
  p_title text,
  p_description text,
  p_property_id uuid default null,
  p_case_id uuid default null,
  p_subscription_id uuid default null,
  p_monthly_limit integer default 0,
  p_cycle_reference text default null,
  p_cycle_start timestamptz default null,
  p_cycle_end timestamptz default null
)
returns public.technical_opinions
language plpgsql
security definer
set search_path = public
as $$
declare
  used_in_cycle integer := 0;
  claimed_credit public.technical_opinion_credits%rowtype;
  created public.technical_opinions%rowtype;
  resolved_origin text := 'subscription';
  resolved_credit_id uuid := null;
begin
  if p_user_id is null then
    raise exception 'Usuario nao informado.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('technical_opinions:' || p_user_id::text, 0));

  select count(*)
    into used_in_cycle
  from public.technical_opinions o
  where o.user_id = p_user_id
    and o.origin = 'subscription'
    and o.status <> 'cancelado'
    and (
      (
        p_cycle_start is not null
        and p_cycle_end is not null
        and o.created_at >= p_cycle_start
        and o.created_at < p_cycle_end
      )
      or (
        (p_cycle_start is null or p_cycle_end is null)
        and p_cycle_reference is not null
        and o.billing_cycle_reference = p_cycle_reference
      )
    );

  if coalesce(p_monthly_limit, 0) <= used_in_cycle then
    -- Sem franquia: consome um credito avulso JA PAGO, se existir (historico).
    select *
      into claimed_credit
    from public.technical_opinion_credits c
    where c.user_id = p_user_id
      and c.status = 'available'
    order by c.created_at asc
    for update skip locked
    limit 1;

    if not found then
      raise exception 'TECHNICAL_OPINION_LIMIT_REACHED' using errcode = 'P0001';
    end if;

    resolved_origin := 'one_time';
    resolved_credit_id := claimed_credit.id;
  end if;

  insert into public.technical_opinions (
    user_id, property_id, subscription_id, case_id, credit_id, origin,
    title, description, status, billing_cycle_reference, cycle_start, cycle_end
  ) values (
    p_user_id, p_property_id,
    case when resolved_origin = 'subscription' then p_subscription_id else null end,
    p_case_id, resolved_credit_id, resolved_origin,
    btrim(p_title), btrim(p_description), 'aberto',
    case when resolved_origin = 'subscription' then p_cycle_reference else null end,
    case when resolved_origin = 'subscription' then p_cycle_start else null end,
    case when resolved_origin = 'subscription' then p_cycle_end else null end
  )
  returning * into created;

  if resolved_credit_id is not null then
    update public.technical_opinion_credits
    set status = 'consumed',
        consumed_at = now(),
        consumed_by_opinion_id = created.id
    where id = resolved_credit_id;
  end if;

  insert into public.technical_opinion_messages (opinion_id, author_id, author_role, body)
  values (created.id, p_user_id, 'client', btrim(p_description));

  return created;
end;
$$;

revoke all on function public.create_technical_opinion(uuid, text, text, uuid, uuid, uuid, integer, text, timestamptz, timestamptz) from public;
-- Supabase concede EXECUTE a anon/authenticated por default privileges: sem
-- este revoke um usuario poderia chamar a RPC direto informando o proprio limite.
revoke all on function public.create_technical_opinion(uuid, text, text, uuid, uuid, uuid, integer, text, timestamptz, timestamptz) from anon, authenticated;
grant execute on function public.create_technical_opinion(uuid, text, text, uuid, uuid, uuid, integer, text, timestamptz, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Status do parecer acompanha o fluxo da especialista no caso
--    in_review            -> em_analise  (continua consumido)
--    reviewed / completed -> concluido   (continua consumido)
--    rejected / cancelled -> cancelado   (devolve a franquia do ciclo)
--    solicitacao retirada antes da analise -> cancelado (devolve)
-- ---------------------------------------------------------------------------

create or replace function public.sync_case_human_opinion_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.human_review_status is not distinct from old.human_review_status
     and new.human_review_requested is not distinct from old.human_review_requested then
    return new;
  end if;

  if new.human_review_status = 'in_review' then
    update public.technical_opinions
    set status = 'em_analise'
    where case_id = new.id and status in ('aberto', 'aguardando_informacoes');
  elsif new.human_review_status in ('reviewed', 'completed') then
    update public.technical_opinions
    set status = 'concluido', closed_at = coalesce(closed_at, now())
    where case_id = new.id and status not in ('concluido', 'cancelado');
  elsif new.human_review_status in ('rejected', 'cancelled') then
    update public.technical_opinions
    set status = 'cancelado', closed_at = now()
    where case_id = new.id and status in ('aberto', 'em_analise', 'aguardando_informacoes');
  elsif coalesce(old.human_review_requested, false) and not coalesce(new.human_review_requested, false) then
    update public.technical_opinions
    set status = 'cancelado', closed_at = now()
    where case_id = new.id and status = 'aberto';
  end if;

  return new;
end;
$$;

revoke all on function public.sync_case_human_opinion_status() from public;
revoke all on function public.sync_case_human_opinion_status() from anon, authenticated;

drop trigger if exists sync_case_human_opinion_status on public.agronomic_cases;
create trigger sync_case_human_opinion_status
after update of human_review_status, human_review_requested on public.agronomic_cases
for each row execute function public.sync_case_human_opinion_status();

commit;
