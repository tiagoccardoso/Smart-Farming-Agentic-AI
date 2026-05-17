-- Seed official commercial plans for the hybrid agronomic advisory platform.
insert into public.plans (name, slug, price_cents, billing_type, features, active)
values
  (
    'Plano Gratuito',
    'gratuito',
    0,
    'free',
    '["2 perguntas agrícolas por mês", "1 triagem simples com imagem", "recomendação agrícola básica", "sem PDF", "sem histórico", "sem análise de solo", "sem revisão humana"]'::jsonb,
    true
  ),
  (
    'IA Básica',
    'ia-basica',
    3900,
    'monthly',
    '["perguntas agrícolas com IA", "histórico simples", "recomendações iniciais", "triagem básica de sintomas", "limite mensal controlado", "orientação inicial com IA"]'::jsonb,
    true
  ),
  (
    'IA Profissional',
    'ia-profissional',
    9700,
    'monthly',
    '["limite alto de análises", "upload de fotos", "upload de análise de solo", "relatórios PDF", "histórico por propriedade", "análises mais completas", "recomendações organizadas", "prioridade de processamento", "suporte prioritário", "anual equivalente a R$ 79/mês"]'::jsonb,
    true
  ),
  (
    'IA + Revisão Humana',
    'ia-revisao-humana',
    39700,
    'monthly',
    '["tudo do IA Profissional", "1 revisão humana mensal incluída", "análise revisada por especialista", "relatório revisado", "suporte prioritário", "acompanhamento mais próximo", "revisões extras podem ser contratadas separadamente"]'::jsonb,
    true
  )
on conflict (slug) do update set
  name = excluded.name,
  price_cents = excluded.price_cents,
  billing_type = excluded.billing_type,
  features = excluded.features,
  active = excluded.active;
