-- Support monthly Stripe subscriptions for the paid commercial plans.

create unique index if not exists subscriptions_stripe_subscription_id_key
  on public.subscriptions (stripe_subscription_id)
  where stripe_subscription_id is not null;

create index if not exists subscriptions_stripe_customer_id_idx
  on public.subscriptions (stripe_customer_id)
  where stripe_customer_id is not null;

create index if not exists subscriptions_status_idx
  on public.subscriptions (status);

-- Seed initial monthly paid plans used by /api/stripe/create-subscription-checkout.
-- stripe_price_id remains nullable so the application can create inline monthly
-- price_data in Stripe, or operators can later set a dashboard-managed Price ID.
insert into public.plans (name, slug, price_cents, billing_type, stripe_price_id, features, active)
values
  (
    'IA Básica',
    'ia-basica',
    3900,
    'monthly',
    null,
    '["perguntas agrícolas com IA", "histórico simples", "recomendações iniciais", "triagem básica de sintomas", "limite mensal controlado", "orientação inicial com IA"]'::jsonb,
    true
  ),
  (
    'IA Profissional',
    'ia-profissional',
    9700,
    'monthly',
    null,
    '["limite alto de análises", "upload de fotos", "upload de análise de solo", "relatórios PDF", "histórico por propriedade", "análises mais completas", "recomendações organizadas", "prioridade de processamento", "suporte prioritário", "anual equivalente a R$ 79/mês"]'::jsonb,
    true
  ),
  (
    'IA + Revisão Humana',
    'ia-revisao-humana',
    39700,
    'monthly',
    null,
    '["tudo do IA Profissional", "1 revisão humana mensal incluída", "análise revisada por especialista", "relatório revisado", "suporte prioritário", "acompanhamento mais próximo", "revisões extras podem ser contratadas separadamente"]'::jsonb,
    true
  )
on conflict (slug) do update set
  name = excluded.name,
  price_cents = excluded.price_cents,
  billing_type = excluded.billing_type,
  stripe_price_id = coalesce(public.plans.stripe_price_id, excluded.stripe_price_id),
  features = excluded.features,
  active = excluded.active;
