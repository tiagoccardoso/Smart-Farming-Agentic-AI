-- PlantaSa: desvincula os preços Stripe dos planos legados.
--
-- Planos: ia-basica (IA Básica, R$ 39) e ia-revisao-humana (IA + Revisão Humana, R$ 397).
-- Decisão: não há assinaturas ativas nesses planos, então o banco deixa de
-- apontar para os Product/Price IDs antigos do Stripe.
--
-- O que NÃO muda:
--   * As linhas de `plans` continuam existindo (inativas, is_legacy = true):
--     `subscriptions.plan_id` e o histórico de pagamentos seguem íntegros.
--   * `subscriptions.stripe_price_id` (histórico de cada assinatura) é mantido.
--   * Nada é excluído no Stripe. Arquivar os preços/produtos antigos é feito no
--     painel do Stripe.
--
-- Trava de segurança: se existir QUALQUER assinatura ainda com direito
-- (active, trialing, scheduled_cancellation, past_due, payment_pending) em um
-- desses planos, a migration aborta sem alterar nada.
--
-- Rollback: reinformar os IDs pelo admin (/painel-doutora/site-pages/planos)
-- ou `update public.plans set stripe_price_id = '<price_...>' where slug = ...`.

begin;

do $$
declare
  live_count integer;
begin
  select count(*)
    into live_count
  from public.subscriptions s
  join public.plans p on p.id = s.plan_id
  where p.slug in ('ia-basica', 'ia-revisao-humana')
    and (
      coalesce(s.internal_status, '') in ('active', 'trialing', 'scheduled_cancellation', 'past_due', 'payment_pending')
      or (s.internal_status is null and coalesce(s.status, '') in ('active', 'trialing', 'past_due', 'unpaid', 'paused'))
    );

  if live_count > 0 then
    raise exception 'Existem % assinatura(s) ainda vigente(s) em planos legados. Nenhum preço foi removido.', live_count
      using errcode = 'P0001';
  end if;
end;
$$;

update public.plans
set stripe_price_id = null,
    stripe_product_id = null,
    active = false,
    highlighted = false,
    updated_at = now()
where slug in ('ia-basica', 'ia-revisao-humana')
  and (stripe_price_id is not null or stripe_product_id is not null or active);

commit;
