-- PlantaSa: funcoes de apoio a nova estrutura comercial.
--   * update_plans_page: passa a gravar entitlements e identificadores Stripe.
--   * create_technical_opinion: abertura atomica de demanda tecnica, respeitando
--     o limite do ciclo e consumindo credito avulso quando necessario.

begin;

-- ---------------------------------------------------------------------------
-- Abertura atomica de parecer tecnico
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

  -- Conta somente as demandas que consumiram a franquia da assinatura no ciclo.
  -- Demandas canceladas nao consomem franquia.
  select count(*)
    into used_in_cycle
  from public.technical_opinions o
  where o.user_id = p_user_id
    and o.origin = 'subscription'
    and o.status <> 'cancelado'
    and (
      (p_cycle_reference is not null and o.billing_cycle_reference = p_cycle_reference)
      or (
        p_cycle_reference is null
        and p_cycle_start is not null
        and p_cycle_end is not null
        and o.created_at >= p_cycle_start
        and o.created_at < p_cycle_end
      )
    );

  if coalesce(p_monthly_limit, 0) <= used_in_cycle then
    -- Sem franquia disponivel: tenta consumir um credito avulso pago.
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
grant execute on function public.create_technical_opinion(uuid, text, text, uuid, uuid, uuid, integer, text, timestamptz, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Configuracao administrativa da pagina de planos (agora com Stripe + direitos)
-- ---------------------------------------------------------------------------

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
    raise exception 'Payload de configuracao invalido.' using errcode = '22023';
  end if;

  insert into public.plan_page_settings (
    id, eyebrow, title, subtitle, intro, value_phrases, strategy_label,
    strategy_title, strategy_items, legal_notice, free_plan_notice,
    comparison_label, comparison_description, consulting_eyebrow,
    consulting_title, consulting_description, consulting_notice,
    onetime_title, onetime_description, onetime_button_label,
    quote_button_label, quote_services, updated_by, updated_at
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
    coalesce(settings_payload ->> 'onetime_title', 'Precisa de atendimento pontual?'),
    coalesce(settings_payload ->> 'onetime_description', ''),
    coalesce(settings_payload ->> 'onetime_button_label', 'Solicitar parecer tecnico'),
    coalesce(settings_payload ->> 'quote_button_label', 'Solicitar orcamento'),
    coalesce(settings_payload -> 'quote_services', '[]'::jsonb),
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
    onetime_title = excluded.onetime_title,
    onetime_description = excluded.onetime_description,
    onetime_button_label = excluded.onetime_button_label,
    quote_button_label = excluded.quote_button_label,
    quote_services = excluded.quote_services,
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
        entitlements = coalesce(plan_payload -> 'entitlements', plans.entitlements),
        stripe_product_id = nullif(btrim(coalesce(plan_payload ->> 'stripe_product_id', '')), ''),
        stripe_price_id = nullif(btrim(coalesce(plan_payload ->> 'stripe_price_id', '')), ''),
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
        stripe_product_id = nullif(btrim(coalesce(service_payload ->> 'stripe_product_id', '')), ''),
        stripe_price_id = nullif(btrim(coalesce(service_payload ->> 'stripe_price_id', '')), ''),
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

commit;
