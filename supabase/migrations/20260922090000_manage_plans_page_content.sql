-- Store the public plans page as editable commercial content.
-- Existing plan slugs and payment identifiers remain stable because Stripe and
-- subscriptions use them as integration keys.

alter table public.plans
  add column if not exists eyebrow text not null default '',
  add column if not exists audience text not null default '',
  add column if not exists description text not null default '',
  add column if not exists exclusions jsonb not null default '[]'::jsonb,
  add column if not exists price_prefix text not null default '',
  add column if not exists price_period text not null default '',
  add column if not exists price_note text not null default '',
  add column if not exists button_label text not null default 'Assinar',
  add column if not exists highlighted boolean not null default false,
  add column if not exists badge text,
  add column if not exists display_order integer not null default 0,
  add column if not exists updated_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table public.plans
  drop constraint if exists plans_price_cents_nonnegative;

alter table public.plans
  add constraint plans_price_cents_nonnegative check (price_cents is null or price_cents >= 0);

create table if not exists public.plan_page_settings (
  id boolean primary key default true check (id = true),
  eyebrow text not null,
  title text not null,
  subtitle text not null,
  intro text not null,
  value_phrases jsonb not null default '[]'::jsonb,
  strategy_label text not null,
  strategy_title text not null,
  strategy_items jsonb not null default '[]'::jsonb,
  legal_notice text not null,
  free_plan_notice text not null,
  comparison_label text not null,
  comparison_description text not null,
  consulting_eyebrow text not null,
  consulting_title text not null,
  consulting_description text not null,
  consulting_notice text not null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plan_page_services (
  service_type text primary key,
  name text not null,
  price_cents integer not null,
  price_prefix text not null default '',
  price_period text not null default '',
  description text not null,
  button_label text not null default 'Solicitar análise',
  active boolean not null default true,
  display_order integer not null default 0,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_page_services_price_cents_nonnegative check (price_cents >= 0),
  constraint plan_page_services_type_check check (
    service_type in (
      'human_case_review',
      'soil_analysis_review',
      'technical_report',
      'monthly_farm_followup'
    )
  )
);

alter table public.plan_page_settings enable row level security;
alter table public.plan_page_services enable row level security;

drop policy if exists "Users can view active plans" on public.plans;
create policy "Anyone can view active plans"
  on public.plans for select
  to anon, authenticated
  using (active = true or public.is_admin());

drop policy if exists "Public can view plan page settings" on public.plan_page_settings;
create policy "Public can view plan page settings"
  on public.plan_page_settings for select
  to anon, authenticated
  using (id = true);

drop policy if exists "Admins can manage plan page settings" on public.plan_page_settings;
create policy "Admins can manage plan page settings"
  on public.plan_page_settings for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Public can view active plan page services" on public.plan_page_services;
create policy "Public can view active plan page services"
  on public.plan_page_services for select
  to anon, authenticated
  using (active = true or public.is_admin());

drop policy if exists "Admins can manage plan page services" on public.plan_page_services;
create policy "Admins can manage plan page services"
  on public.plan_page_services for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.plans to anon, authenticated;
grant select on public.plan_page_settings to anon, authenticated;
grant select on public.plan_page_services to anon, authenticated;
grant insert, update, delete on public.plans to authenticated;
grant insert, update, delete on public.plan_page_settings to authenticated;
grant insert, update, delete on public.plan_page_services to authenticated;

-- Atomic administrative save. The function accepts only the editable fields
-- and derives updated_by from auth.uid(), so clients cannot impersonate an editor.
create or replace function public.update_plans_page(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  settings_payload jsonb := p_payload -> 'settings';
  plan_payload jsonb;
  service_payload jsonb;
begin
  if not public.is_admin() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if jsonb_typeof(settings_payload) <> 'object'
     or jsonb_typeof(p_payload -> 'plans') <> 'array'
     or jsonb_typeof(p_payload -> 'services') <> 'array' then
    raise exception 'Payload de configuração inválido.' using errcode = '22023';
  end if;

  insert into public.plan_page_settings (
    id, eyebrow, title, subtitle, intro, value_phrases, strategy_label,
    strategy_title, strategy_items, legal_notice, free_plan_notice,
    comparison_label, comparison_description, consulting_eyebrow,
    consulting_title, consulting_description, consulting_notice, updated_by,
    updated_at
  ) values (
    true,
    settings_payload ->> 'eyebrow',
    settings_payload ->> 'title',
    settings_payload ->> 'subtitle',
    settings_payload ->> 'intro',
    coalesce(settings_payload -> 'value_phrases', '[]'::jsonb),
    settings_payload ->> 'strategy_label',
    settings_payload ->> 'strategy_title',
    coalesce(settings_payload -> 'strategy_items', '[]'::jsonb),
    settings_payload ->> 'legal_notice',
    settings_payload ->> 'free_plan_notice',
    settings_payload ->> 'comparison_label',
    settings_payload ->> 'comparison_description',
    settings_payload ->> 'consulting_eyebrow',
    settings_payload ->> 'consulting_title',
    settings_payload ->> 'consulting_description',
    settings_payload ->> 'consulting_notice',
    auth.uid(),
    now()
  )
  on conflict (id) do update set
    eyebrow = excluded.eyebrow,
    title = excluded.title,
    subtitle = excluded.subtitle,
    intro = excluded.intro,
    value_phrases = excluded.value_phrases,
    strategy_label = excluded.strategy_label,
    strategy_title = excluded.strategy_title,
    strategy_items = excluded.strategy_items,
    legal_notice = excluded.legal_notice,
    free_plan_notice = excluded.free_plan_notice,
    comparison_label = excluded.comparison_label,
    comparison_description = excluded.comparison_description,
    consulting_eyebrow = excluded.consulting_eyebrow,
    consulting_title = excluded.consulting_title,
    consulting_description = excluded.consulting_description,
    consulting_notice = excluded.consulting_notice,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  for plan_payload in select value from jsonb_array_elements(p_payload -> 'plans') loop
    update public.plans
    set name = plan_payload ->> 'name',
        eyebrow = plan_payload ->> 'eyebrow',
        audience = plan_payload ->> 'audience',
        description = plan_payload ->> 'description',
        price_cents = (plan_payload ->> 'price_cents')::integer,
        price_prefix = coalesce(plan_payload ->> 'price_prefix', ''),
        price_period = coalesce(plan_payload ->> 'price_period', ''),
        price_note = coalesce(plan_payload ->> 'price_note', ''),
        features = coalesce(plan_payload -> 'features', '[]'::jsonb),
        exclusions = coalesce(plan_payload -> 'exclusions', '[]'::jsonb),
        button_label = plan_payload ->> 'button_label',
        highlighted = coalesce((plan_payload ->> 'highlighted')::boolean, false),
        badge = nullif(plan_payload ->> 'badge', ''),
        active = coalesce((plan_payload ->> 'active')::boolean, false),
        display_order = (plan_payload ->> 'display_order')::integer,
        updated_by = auth.uid(),
        updated_at = now()
    where id = (plan_payload ->> 'id')::uuid;
  end loop;

  for service_payload in select value from jsonb_array_elements(p_payload -> 'services') loop
    update public.plan_page_services
    set name = service_payload ->> 'name',
        price_cents = (service_payload ->> 'price_cents')::integer,
        price_prefix = coalesce(service_payload ->> 'price_prefix', ''),
        price_period = coalesce(service_payload ->> 'price_period', ''),
        description = service_payload ->> 'description',
        button_label = service_payload ->> 'button_label',
        active = coalesce((service_payload ->> 'active')::boolean, false),
        display_order = (service_payload ->> 'display_order')::integer,
        updated_by = auth.uid(),
        updated_at = now()
    where service_type = service_payload ->> 'service_type';
  end loop;
end;
$$;

revoke all on function public.update_plans_page(jsonb) from public;
grant execute on function public.update_plans_page(jsonb) to authenticated;

-- Backfill the current public page into the new single source of truth.
update public.plans set
  eyebrow = case slug
    when 'gratuito' then 'Demonstração'
    when 'ia-basica' then 'Orientação inicial'
    when 'ia-profissional' then 'Plano recomendado'
    when 'ia-revisao-humana' then 'Premium'
    else eyebrow
  end,
  audience = case slug
    when 'gratuito' then 'Para conhecer a plataforma e validar valor rapidamente.'
    when 'ia-basica' then 'Pequenos produtores, estudantes e técnicos agrícolas.'
    when 'ia-profissional' then 'Produtores e consultores que utilizarão o sistema com frequência.'
    when 'ia-revisao-humana' then 'Operações que precisam de validação especializada mensal e acompanhamento mais próximo.'
    else audience
  end,
  description = case slug
    when 'gratuito' then 'Uma entrada objetiva para testar a IA orientativa em dúvidas agrícolas pontuais.'
    when 'ia-basica' then 'Apoio recorrente para organizar dúvidas, recomendações iniciais e triagens simples.'
    when 'ia-profissional' then 'Sistema completo de decisão agronômica assistida por IA, com relatórios e histórico por propriedade.'
    when 'ia-revisao-humana' then 'Combina a velocidade da IA com uma revisão humana mensal feita por especialista.'
    else description
  end,
  price_prefix = '',
  price_period = case when slug = 'gratuito' then '' else 'mês' end,
  price_note = '',
  button_label = case slug
    when 'gratuito' then 'Começar grátis'
    when 'ia-basica' then 'Assinar IA Básica'
    when 'ia-profissional' then 'Assinar IA Profissional'
    when 'ia-revisao-humana' then 'Assinar Premium'
    else button_label
  end,
  highlighted = slug = 'ia-profissional',
  badge = case when slug = 'ia-profissional' then 'Mais escolhido' else null end,
  display_order = case slug
    when 'gratuito' then 10
    when 'ia-basica' then 20
    when 'ia-profissional' then 30
    when 'ia-revisao-humana' then 40
    else display_order
  end,
  features = case slug
    when 'gratuito' then '["3 perguntas agrícolas por mês", "1 triagem simples com imagem", "Recomendação agrícola básica", "Sem PDF", "Histórico das perguntas realizadas", "Sem análise de solo", "Sem revisão humana"]'::jsonb
    when 'ia-basica' then '["Perguntas agrícolas com IA", "Histórico simples", "Recomendações iniciais", "Triagem básica de sintomas", "Limite mensal controlado", "Orientação inicial com IA"]'::jsonb
    when 'ia-profissional' then '["Limite alto de análises", "Upload de fotos", "Upload de análise de solo", "Relatórios PDF", "Histórico por propriedade", "Análises mais completas", "Recomendações organizadas", "Prioridade de processamento", "Suporte prioritário"]'::jsonb
    when 'ia-revisao-humana' then '["Tudo do IA Profissional", "1 revisão humana mensal incluída", "Análise revisada por especialista", "Relatório revisado", "Suporte prioritário", "Acompanhamento mais próximo", "Revisões extras podem ser contratadas separadamente"]'::jsonb
    else features
  end,
  exclusions = case when slug = 'ia-basica' then '["Sem revisão humana", "Sem análise avançada de solo", "Sem relatórios técnicos completos"]'::jsonb else '[]'::jsonb end,
  updated_at = now()
where slug in ('gratuito', 'ia-basica', 'ia-profissional', 'ia-revisao-humana');

insert into public.plan_page_settings (
  id, eyebrow, title, subtitle, intro, value_phrases, strategy_label,
  strategy_title, strategy_items, legal_notice, free_plan_notice,
  comparison_label, comparison_description, consulting_eyebrow,
  consulting_title, consulting_description, consulting_notice
)
values (
  true,
  'Plataforma profissional de apoio à decisão agronômica',
  'Planos',
  'Decisão agronômica assistida por IA, com revisão humana opcional.',
  'Estruture informações da propriedade, imagens, análises e recomendações em um fluxo técnico organizado. A IA orientativa acelera a triagem e os especialistas podem revisar casos quando a decisão exigir validação profissional.',
  '["Decisões agrícolas mais seguras", "IA + suporte especializado", "Análises organizadas e históricas"]'::jsonb,
  'Estratégia híbrida',
  'IA orientativa + análise técnica organizada',
  '["Relatórios e histórico da propriedade", "Upload de fotos e análise de solo", "Suporte especializado e revisão humana opcional"]'::jsonb,
  'As análises geradas por IA são orientativas e não substituem consultoria profissional habilitada.',
  'As respostas geradas por IA são orientativas e não substituem avaliação profissional.',
  'Comparativo de planos',
  'Escolha conforme volume de análises, relatórios e necessidade de validação humana.',
  'Consultorias avulsas',
  'Consultorias Especializadas',
  'Contrate validações pontuais quando precisar de uma análise revisada, um relatório técnico ou acompanhamento próximo da propriedade.',
  'Solicitação com checkout seguro para cada serviço.'
)
on conflict (id) do nothing;

insert into public.plan_page_services (
  service_type, name, price_cents, price_prefix, price_period, description,
  button_label, display_order, active
)
values
  ('human_case_review', 'Revisão humana de caso', 19700, '', '', 'Validação especializada de um caso pontual já estruturado pela plataforma.', 'Solicitar análise', 10, true),
  ('soil_analysis_review', 'Interpretação de análise de solo', 25000, '', '', 'Leitura técnica dos indicadores de solo com recomendações organizadas.', 'Solicitar análise', 20, true),
  ('technical_report', 'Relatório técnico especializado', 49700, 'A partir de', '', 'Documento técnico revisado para decisões agronômicas mais sensíveis.', 'Solicitar análise', 30, true),
  ('monthly_farm_followup', 'Acompanhamento mensal de propriedade', 99700, 'A partir de', 'mês', 'Rotina de acompanhamento para histórico, prioridades e suporte especializado.', 'Solicitar análise', 40, true)
on conflict (service_type) do update set
  name = excluded.name,
  price_cents = excluded.price_cents,
  price_prefix = excluded.price_prefix,
  price_period = excluded.price_period,
  description = excluded.description,
  button_label = excluded.button_label,
  display_order = excluded.display_order,
  active = excluded.active,
  updated_at = now();
