-- PlantaSa: estado completo da assinatura espelhado do Stripe.
-- Aditivo: nenhuma coluna existente muda de tipo ou e removida, e nenhuma
-- assinatura atual e alterada.

begin;

alter table public.subscriptions
  add column if not exists stripe_price_id text,
  add column if not exists current_period_start timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists internal_status text,
  add column if not exists canceled_at timestamptz,
  add column if not exists last_payment_status text,
  add column if not exists last_payment_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists subscriptions_internal_status_idx
  on public.subscriptions (user_id, internal_status);

drop trigger if exists set_subscriptions_updated_at on public.subscriptions;
create trigger set_subscriptions_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

comment on column public.subscriptions.internal_status is
  'Estado interno PlantaSa derivado do Stripe: active, trialing, payment_pending, past_due, scheduled_cancellation, canceled, incomplete, ended.';

commit;
