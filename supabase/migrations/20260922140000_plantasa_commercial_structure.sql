-- PlantaSa: nova estrutura comercial (Gratuito / IA Profissional / Consultoria Agronomica)
-- + Presencial & Projetos Especiais (sob consulta) + Parecer Tecnico Avulso.
--
-- Principios aplicados:
--   * Reutiliza as tabelas existentes (plans, subscriptions, one_time_orders,
--     usage_events, plan_page_settings, plan_page_services, specialist_visit_requests).
--   * Nao cancela nem altera assinaturas existentes. Planos antigos sao marcados
--     como legado (is_legacy) e deixam de ser vendidos, mas continuam valendo para
--     quem ja assina, atraves de legacy_entitlement_code.
--   * Regras comerciais deixam de ser hardcoded: ficam em plans.entitlements (jsonb).
--   * plans.slug continua sendo o "code" do plano (chave de integracao ja usada
--     pelo Stripe e pelo checkout); nao criamos uma segunda chave para nao duplicar.

begin;

-- ---------------------------------------------------------------------------
-- 1. Plans: entitlements centralizados + identificadores Stripe
-- ---------------------------------------------------------------------------

alter table public.plans
  add column if not exists stripe_product_id text,
  add column if not exists plan_kind text not null default 'subscription',
  add column if not exists is_legacy boolean not null default false,
  add column if not exists legacy_entitlement_code text,
  add column if not exists entitlements jsonb not null default '{}'::jsonb;

alter table public.plans drop constraint if exists plans_plan_kind_check;
alter table public.plans
  add constraint plans_plan_kind_check check (plan_kind in ('free', 'subscription', 'quote'));

comment on column public.plans.entitlements is
  'Direitos do plano. Chaves: AI_MONTHLY_LIMIT (int|null=ilimitado), AI_IMAGES, REPORTS, PROPERTY_HISTORY, TECHNICAL_OPINIONS_MONTHLY (int), HUMAN_VALIDATION, CASE_ANALYSIS_MONTHLY, IMAGE_TRIAGE_MONTHLY, SOIL_ANALYSIS_UPLOAD.';
comment on column public.plans.legacy_entitlement_code is
  'Para planos legados: slug do plano novo cujos direitos o assinante antigo passa a ter.';

-- ---------------------------------------------------------------------------
-- 2. Idempotencia de webhooks Stripe
-- ---------------------------------------------------------------------------

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  status text not null default 'processing',
  result jsonb,
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint stripe_webhook_events_status_check check (status in ('processing', 'processed', 'failed', 'ignored'))
);

create index if not exists stripe_webhook_events_received_at_idx
  on public.stripe_webhook_events (received_at desc);

alter table public.stripe_webhook_events enable row level security;
-- Sem policies: apenas a service role (que ignora RLS) grava/le. Nenhum cliente acessa.

-- ---------------------------------------------------------------------------
-- 3. Creditos de parecer tecnico avulso
-- ---------------------------------------------------------------------------

create table if not exists public.technical_opinion_credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'stripe_one_time',
  one_time_order_id uuid references public.one_time_orders(id) on delete set null,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  amount_cents integer,
  status text not null default 'available',
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint technical_opinion_credits_source_check check (source in ('stripe_one_time', 'manual_grant')),
  constraint technical_opinion_credits_status_check check (status in ('available', 'consumed', 'refunded', 'expired'))
);

-- Idempotencia dura: um mesmo pagamento Stripe nunca libera dois pareceres.
create unique index if not exists technical_opinion_credits_session_key
  on public.technical_opinion_credits (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create unique index if not exists technical_opinion_credits_order_key
  on public.technical_opinion_credits (one_time_order_id)
  where one_time_order_id is not null;

create index if not exists technical_opinion_credits_user_status_idx
  on public.technical_opinion_credits (user_id, status);

-- ---------------------------------------------------------------------------
-- 4. Pareceres tecnicos (demandas). 1 parecer = 1 demanda tecnica.
--    Mensagens, fotos e documentos da MESMA demanda nao consomem novo parecer.
-- ---------------------------------------------------------------------------

create table if not exists public.technical_opinions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid references public.acompanhamento_properties(id) on delete set null,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  case_id uuid references public.agronomic_cases(id) on delete set null,
  credit_id uuid references public.technical_opinion_credits(id) on delete set null,
  origin text not null default 'subscription',
  title text not null,
  description text not null,
  status text not null default 'aberto',
  assigned_specialist_id uuid references auth.users(id) on delete set null,
  billing_cycle_reference text,
  cycle_start timestamptz,
  cycle_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint technical_opinions_origin_check check (origin in ('subscription', 'one_time')),
  constraint technical_opinions_status_check check (
    status in ('aberto', 'em_analise', 'aguardando_informacoes', 'respondido', 'concluido', 'cancelado')
  ),
  constraint technical_opinions_title_check check (char_length(btrim(title)) between 3 and 200),
  constraint technical_opinions_description_check check (char_length(btrim(description)) >= 10)
);

alter table public.technical_opinion_credits
  drop constraint if exists technical_opinion_credits_opinion_fk;
alter table public.technical_opinion_credits
  add column if not exists consumed_by_opinion_id uuid;
alter table public.technical_opinion_credits
  add constraint technical_opinion_credits_opinion_fk
  foreign key (consumed_by_opinion_id) references public.technical_opinions(id) on delete set null;

create index if not exists technical_opinions_user_idx on public.technical_opinions (user_id, created_at desc);
create index if not exists technical_opinions_cycle_idx on public.technical_opinions (user_id, billing_cycle_reference);
create index if not exists technical_opinions_status_idx on public.technical_opinions (status);
create index if not exists technical_opinions_property_idx on public.technical_opinions (property_id);

create table if not exists public.technical_opinion_messages (
  id uuid primary key default gen_random_uuid(),
  opinion_id uuid not null references public.technical_opinions(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  author_role text not null default 'client',
  body text not null,
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint technical_opinion_messages_role_check check (author_role in ('client', 'specialist', 'admin', 'system')),
  constraint technical_opinion_messages_body_check check (char_length(btrim(body)) >= 1)
);

create index if not exists technical_opinion_messages_opinion_idx
  on public.technical_opinion_messages (opinion_id, created_at asc);

drop trigger if exists set_technical_opinions_updated_at on public.technical_opinions;
create trigger set_technical_opinions_updated_at
before update on public.technical_opinions
for each row execute function public.set_updated_at();

drop trigger if exists set_technical_opinion_credits_updated_at on public.technical_opinion_credits;
create trigger set_technical_opinion_credits_updated_at
before update on public.technical_opinion_credits
for each row execute function public.set_updated_at();

alter table public.technical_opinions enable row level security;
alter table public.technical_opinion_messages enable row level security;
alter table public.technical_opinion_credits enable row level security;

drop policy if exists "technical_opinions_owner_or_staff_read" on public.technical_opinions;
create policy "technical_opinions_owner_or_staff_read"
  on public.technical_opinions for select to authenticated
  using (user_id = auth.uid() or public.is_specialist_or_admin());

-- A criacao passa obrigatoriamente pela API (service role), que valida o saldo
-- de pareceres do ciclo. Clientes nao inserem diretamente.
drop policy if exists "technical_opinions_staff_update" on public.technical_opinions;
create policy "technical_opinions_staff_update"
  on public.technical_opinions for update to authenticated
  using (public.is_specialist_or_admin())
  with check (public.is_specialist_or_admin());

drop policy if exists "technical_opinion_messages_participants_read" on public.technical_opinion_messages;
create policy "technical_opinion_messages_participants_read"
  on public.technical_opinion_messages for select to authenticated
  using (
    public.is_specialist_or_admin()
    or exists (
      select 1 from public.technical_opinions o
      where o.id = technical_opinion_messages.opinion_id and o.user_id = auth.uid()
    )
  );

drop policy if exists "technical_opinion_credits_owner_read" on public.technical_opinion_credits;
create policy "technical_opinion_credits_owner_read"
  on public.technical_opinion_credits for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

grant select on public.technical_opinions to authenticated;
grant select on public.technical_opinion_messages to authenticated;
grant select on public.technical_opinion_credits to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Solicitacoes de orcamento (Presencial & Projetos Especiais)
--    Reutiliza specialist_visit_requests, ja usada pela area administrativa.
-- ---------------------------------------------------------------------------

alter table public.specialist_visit_requests
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists property_id uuid references public.acompanhamento_properties(id) on delete set null,
  add column if not exists service_type text,
  add column if not exists notes text,
  add column if not exists source text not null default 'agendamento';

create index if not exists specialist_visit_requests_user_idx
  on public.specialist_visit_requests (user_id);
create index if not exists specialist_visit_requests_source_idx
  on public.specialist_visit_requests (source, created_at desc);

drop policy if exists "users_can_read_own_visit_requests" on public.specialist_visit_requests;
create policy "users_can_read_own_visit_requests"
  on public.specialist_visit_requests for select to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 6. Servicos avulsos: parecer tecnico avulso + identificadores Stripe
-- ---------------------------------------------------------------------------

alter table public.plan_page_services
  add column if not exists stripe_product_id text,
  add column if not exists stripe_price_id text;

alter table public.plan_page_services drop constraint if exists plan_page_services_type_check;
alter table public.plan_page_services
  add constraint plan_page_services_type_check check (
    service_type in (
      'human_case_review',
      'soil_analysis_review',
      'technical_report',
      'monthly_farm_followup',
      'technical_opinion_single'
    )
  );

-- Inativo ate o administrador definir o preco e os IDs reais do Stripe.
insert into public.plan_page_services (
  service_type, name, price_cents, price_prefix, price_period, description,
  button_label, display_order, active
)
values (
  'technical_opinion_single',
  'Parecer Técnico Avulso',
  0,
  '',
  '',
  'Para quem não quer contratar a mensalidade da Consultoria Agronômica: um parecer técnico para uma demanda específica, com mensagens, imagens e documentos complementares sobre o mesmo problema.',
  'Solicitar parecer técnico',
  5,
  false
)
on conflict (service_type) do nothing;

-- ---------------------------------------------------------------------------
-- 7. Conteudo da pagina publica de planos
-- ---------------------------------------------------------------------------

alter table public.plan_page_settings
  add column if not exists onetime_title text not null default 'Precisa de atendimento pontual?',
  add column if not exists onetime_description text not null default 'Não quer contratar uma mensalidade? Solicite um parecer técnico avulso para uma demanda específica.',
  add column if not exists onetime_button_label text not null default 'Solicitar parecer técnico',
  add column if not exists quote_button_label text not null default 'Solicitar orçamento',
  add column if not exists quote_services jsonb not null default '[]'::jsonb;

update public.plan_page_settings set
  title = 'Escolha o plano ideal para sua propriedade 🌱',
  subtitle = 'Tenha tecnologia e conhecimento agronômico ao seu alcance para apoiar decisões melhores no campo.',
  onetime_title = 'Precisa de atendimento pontual?',
  onetime_description = 'Não quer contratar uma mensalidade? Solicite um parecer técnico avulso para uma demanda específica.',
  onetime_button_label = 'Solicitar parecer técnico',
  quote_button_label = 'Solicitar orçamento',
  quote_services = '["Visitas técnicas", "Diagnóstico de campo", "Avaliação da propriedade", "Projetos personalizados", "Planejamento e acompanhamento", "Conversão/transição para produção orgânica", "Outros projetos agronômicos presenciais"]'::jsonb,
  updated_at = now()
where id = true;

-- ---------------------------------------------------------------------------
-- 8. Planos da nova estrutura comercial
-- ---------------------------------------------------------------------------

insert into public.plans (
  name, slug, price_cents, billing_type, plan_kind, active, features, entitlements,
  eyebrow, audience, description, price_prefix, price_period, price_note,
  button_label, highlighted, badge, display_order, exclusions
)
values
  (
    'PlantaSa Gratuito', 'gratuito', 0, 'free', 'free', true,
    '["3 perguntas para IA por mês", "Acesso básico à plataforma", "Orientações iniciais", "Possibilidade de contratar um plano pago depois"]'::jsonb,
    '{"AI_MONTHLY_LIMIT": 3, "AI_IMAGES": false, "REPORTS": false, "PROPERTY_HISTORY": false, "TECHNICAL_OPINIONS_MONTHLY": 0, "HUMAN_VALIDATION": false, "CASE_ANALYSIS_MONTHLY": 1, "IMAGE_TRIAGE_MONTHLY": 0, "SOIL_ANALYSIS_UPLOAD": false}'::jsonb,
    'Comece por aqui', 'Para conhecer a plataforma e tirar as primeiras dúvidas.',
    'Experimente a IA agronômica com 3 consultas por mês, sem cartão de crédito.',
    '', '', '', 'Começar gratuitamente', false, null, 10, '[]'::jsonb
  ),
  (
    'PlantaSa IA Profissional', 'ia-profissional', 9700, 'monthly', 'subscription', true,
    '["Perguntas à IA conforme política de uso da plataforma", "Análise e interpretação de fotos", "Relatórios e recomendações", "Histórico das consultas", "Acompanhamento das informações da propriedade", "Atendimento automatizado pela IA"]'::jsonb,
    '{"AI_MONTHLY_LIMIT": 300, "AI_IMAGES": true, "REPORTS": true, "PROPERTY_HISTORY": true, "TECHNICAL_OPINIONS_MONTHLY": 0, "HUMAN_VALIDATION": false, "CASE_ANALYSIS_MONTHLY": 300, "IMAGE_TRIAGE_MONTHLY": 300, "SOIL_ANALYSIS_UPLOAD": true}'::jsonb,
    'Plano recomendado', 'Produtores e técnicos que usam a plataforma com frequência.',
    'Tecnologia agronômica assistida por IA, com análise de fotos, relatórios e histórico da propriedade.',
    '', 'mês', '', 'Assinar IA Profissional', false, null, 20, '[]'::jsonb
  ),
  (
    'PlantaSa Consultoria Agronômica', 'consultoria-agronomica', 49700, 'monthly', 'subscription', true,
    '["Tudo do IA Profissional", "Até 3 pareceres técnicos por mês", "Análise e validação por especialista", "Orientação personalizada", "Integração das informações da propriedade para análise agronômica"]'::jsonb,
    '{"AI_MONTHLY_LIMIT": 300, "AI_IMAGES": true, "REPORTS": true, "PROPERTY_HISTORY": true, "TECHNICAL_OPINIONS_MONTHLY": 3, "HUMAN_VALIDATION": true, "CASE_ANALYSIS_MONTHLY": 300, "IMAGE_TRIAGE_MONTHLY": 300, "SOIL_ANALYSIS_UPLOAD": true}'::jsonb,
    'Acompanhamento especializado', 'Operações que precisam de validação agronômica humana todo mês.',
    'Combina a IA da plataforma com pareceres técnicos validados por especialista.',
    '', 'mês', '', 'Quero Consultoria Agronômica', true, 'MAIS COMPLETO', 30, '[]'::jsonb
  ),
  (
    'Presencial & Projetos Especiais', 'presencial-projetos', 0, 'quote', 'quote', true,
    '["Visitas técnicas", "Diagnóstico de campo", "Avaliação da propriedade", "Projetos personalizados", "Planejamento e acompanhamento", "Conversão/transição para produção orgânica", "Outros projetos agronômicos presenciais"]'::jsonb,
    '{"AI_MONTHLY_LIMIT": 0, "AI_IMAGES": false, "REPORTS": false, "PROPERTY_HISTORY": false, "TECHNICAL_OPINIONS_MONTHLY": 0, "HUMAN_VALIDATION": false, "CASE_ANALYSIS_MONTHLY": 0, "IMAGE_TRIAGE_MONTHLY": 0, "SOIL_ANALYSIS_UPLOAD": false}'::jsonb,
    'Sob consulta', 'Serviços agronômicos presenciais e projetos personalizados.',
    'Escopo, prazo e valor definidos após o entendimento da necessidade da propriedade.',
    '', '', 'Sob consulta', 'Solicitar orçamento', false, null, 40, '[]'::jsonb
  )
on conflict (slug) do update set
  name = excluded.name,
  price_cents = excluded.price_cents,
  billing_type = excluded.billing_type,
  plan_kind = excluded.plan_kind,
  active = excluded.active,
  features = excluded.features,
  entitlements = excluded.entitlements,
  eyebrow = excluded.eyebrow,
  audience = excluded.audience,
  description = excluded.description,
  price_prefix = excluded.price_prefix,
  price_period = excluded.price_period,
  price_note = excluded.price_note,
  button_label = excluded.button_label,
  highlighted = excluded.highlighted,
  badge = excluded.badge,
  display_order = excluded.display_order,
  exclusions = excluded.exclusions,
  is_legacy = false,
  updated_at = now();

-- Planos legados: saem da vitrine, mas continuam valendo para quem ja assina.
-- Nenhuma assinatura Stripe e alterada ou cancelada por esta migration.
update public.plans set
  active = false,
  is_legacy = true,
  legacy_entitlement_code = 'ia-profissional',
  highlighted = false,
  badge = null,
  updated_at = now()
where slug = 'ia-basica';

update public.plans set
  active = false,
  is_legacy = true,
  legacy_entitlement_code = 'consultoria-agronomica',
  highlighted = false,
  badge = null,
  updated_at = now()
where slug = 'ia-revisao-humana';

-- Fallback de direitos para planos legados enquanto nao houver assinatura nova.
update public.plans set
  entitlements = '{"AI_MONTHLY_LIMIT": 300, "AI_IMAGES": true, "REPORTS": true, "PROPERTY_HISTORY": true, "TECHNICAL_OPINIONS_MONTHLY": 0, "HUMAN_VALIDATION": false, "CASE_ANALYSIS_MONTHLY": 300, "IMAGE_TRIAGE_MONTHLY": 300, "SOIL_ANALYSIS_UPLOAD": true}'::jsonb
where slug = 'ia-basica' and entitlements = '{}'::jsonb;

update public.plans set
  entitlements = '{"AI_MONTHLY_LIMIT": 300, "AI_IMAGES": true, "REPORTS": true, "PROPERTY_HISTORY": true, "TECHNICAL_OPINIONS_MONTHLY": 3, "HUMAN_VALIDATION": true, "CASE_ANALYSIS_MONTHLY": 300, "IMAGE_TRIAGE_MONTHLY": 300, "SOIL_ANALYSIS_UPLOAD": true}'::jsonb
where slug = 'ia-revisao-humana' and entitlements = '{}'::jsonb;

commit;
