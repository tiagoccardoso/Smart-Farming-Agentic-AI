# PlantaSa — Parecer agronômico humano como benefício dos planos

Data: 2026-09-22. Complementa `docs/PLANOS_E_SERVICOS.md`.

Regra comercial final:

| Plano | Identificação | Parecer agronômico humano |
|---|---|---|
| PlantaSa IA Profissional | Plano recomendado | **1 por mês** |
| PlantaSa Consultoria Agronômica (R$ 497,00/mês) | Acompanhamento especializado | **Até 3 por mês** |
| Gratuito, Presencial & Projetos, sem assinatura, assinatura inativa/expirada | — | Sem acesso |

Atendimento pontual (visitas, presencial, projetos especiais, orçamento) → página de Contato (`/contact`).
Não existe mais cobrança avulsa.

---

## 1. Fluxo anterior encontrado

- **Consultorias avulsas / Especializadas**: 4 serviços em `plan_page_services`
  (revisão humana R$ 197, interpretação de solo R$ 250, relatório técnico a partir de R$ 497,
  acompanhamento mensal a partir de R$ 997). O botão "Solicitar análise" levava a `/enviar-caso`.
- **`/enviar-caso`**: criava um `agronomic_cases` e redirecionava para a Consultoria IA. Qualquer
  usuário logado podia enviar; não havia vínculo com plano.
- **Cobrança**: revisão humana pedida em `/consultoria-ia` ou `/revisao-humana` → pedido
  `one_time_orders` pendente → checkout Stripe (`create-human-review-checkout`, e uma rota
  duplicada `human-review/checkout` com `STRIPE_HUMAN_REVIEW_PRICE_ID`) → webhook marcava pago e
  colocava o caso em `waiting_review`.
- **Assinatura**: `subscriptions` espelhada pelo webhook; direitos em `plans.entitlements`
  (`TECHNICAL_OPINIONS_MONTHLY`: IA Profissional = 0, Consultoria = 3). O saldo de "pareceres" só
  valia para `/pareceres` (demandas sem caso, que a especialista não recebe em painel nenhum).

## 2. Causa das inconsistências

- O parecer humano era vendido avulso e desacoplado do plano; IA Profissional tinha 0 pareceres.
- `/enviar-caso` não verificava plano nem saldo.
- `create_technical_opinion` contava e inseria sem lock (duas requisições simultâneas passavam do
  limite) e, pelos *default privileges* do Supabase, podia ser executada por `authenticated`
  informando o próprio limite.
- Bug crítico no working tree: `CONSULTING_PLAN_CODE = "consultoria-agronômica"` (com acento),
  diferente do slug real `consultoria-agronomica` — a troca de plano e a tela Minha assinatura
  não reconheciam a Consultoria. Corrigido (também nos testes que tinham sido ajustados para o erro).
- O ciclo usava `billing_cycle_reference` com o id da linha da assinatura; na API nova do Stripe
  (2025-03+) `current_period_*` fica no item da assinatura e o sistema caía silenciosamente no mês
  calendário.

## 3. Arquivos alterados

| Arquivo | Propósito |
|---|---|
| `supabase/migrations/20260922150000_human_opinion_plan_benefit.sql` (novo) | Benefícios dos planos, atendimento pontual → Contato, desativação dos serviços avulsos, colunas de auditoria/idempotência, índices, função atômica `request_case_human_opinion`, `create_technical_opinion` com lock, trigger de status, revoke de EXECUTE para clientes |
| `supabase/tests/human_opinion_benefit.sql` (novo) | Verificação SQL (roda em transação com ROLLBACK) |
| `frontend/lib/billing/human-opinions.ts` (novo) | Elegibilidade, saldo, ciclo, renovação e consumo |
| `frontend/lib/server/human-opinion-request.ts` (novo) | Solicitação de parecer para caso existente |
| `frontend/lib/server/legacy-one-time-checkout.ts` (novo) | Resposta 410 dos checkouts avulsos |
| `frontend/app/api/human-opinions/status/route.ts` (novo) | `GET` saldo do usuário |
| `frontend/app/api/agronomic-cases/route.ts` | `POST` com `requestHumanOpinion`: valida antes de gravar, consome depois de persistir, descarta caso em falha |
| `frontend/app/api/agronomic-cases/request-human-review/route.ts`, `[caseId]/human-review/route.ts` | Pedido de parecer consome o benefício (sem pedido/checkout); cancelamento não apaga pedidos antigos |
| `frontend/app/api/stripe/create-human-review-checkout`, `api/human-review/checkout`, `api/stripe/create-technical-opinion-checkout` | 410 — sem novas contratações avulsas |
| `frontend/app/api/technical-opinions/route.ts` | `GET` inclui o saldo; `POST` (demanda sem caso) encerrado → `/enviar-caso` |
| `frontend/app/api/technical-opinions/[opinionId]/route.ts` | Cliente não cancela parecer vinculado a caso (evita devolver franquia com o caso na fila) |
| `frontend/lib/billing/technical-opinions.ts` | Contagem pela janela do ciclo (mesma do Postgres) |
| `frontend/lib/billing/entitlements.ts` | Slug da Consultoria corrigido; fallback IA Profissional = 1 parecer |
| `frontend/lib/stripe/webhook-events.ts`, `app/api/stripe/webhook/route.ts`, `lib/stripe/subscription.ts` | Evento em processamento não roda em paralelo (409 → Stripe reenvia); eventos de assinatura gravam o estado atual (fora de ordem); período lido da assinatura ou do item |
| `frontend/app/planos/PlansPageClient.tsx` | Remove checkout avulso e "Disponibilidade em breve"; CTA funcional para Contato |
| `frontend/app/enviar-caso/page.tsx` | Estados carregando/elegível/sem plano/limite/enviando/sucesso/erro; saldo do servidor; idempotência; modo `?destino=consultoria-ia` preserva o fluxo só-IA |
| `frontend/app/revisao-humana/page.tsx`, `app/consultoria-ia/page.tsx`, `app/pareceres/page.tsx`, `app/minha-assinatura/page.tsx` | Sem "Continuar pagamento"/"Contratar avulsa"; textos e CTAs do novo modelo |
| `frontend/components/AdminPlansPage.tsx` | Campo "Pareceres agronômicos humanos por mês"; serviços avulsos recolhidos como histórico |
| `frontend/app/api/admin/opportunities/route.ts`, `app/admin/oportunidades/page.tsx` | Ofertas sugeridas do novo modelo |
| `frontend/lib/api.ts` | `getHumanOpinionStatus`; erro carrega o payload (saldo em 402) |
| `frontend/tests/*` | 22 testes novos; fixtures corrigidas |

## 4. Página de Planos

- Removidas: seção "Consultorias Especializadas/avulsas" (já retirada do JSX; agora os 4 serviços
  também ficam `active = false` no banco) e o botão de pagamento do parecer avulso.
- Benefícios (fonte: `plans.features`, editável no admin, mesmo visual dos demais itens):
  IA Profissional → "1 parecer agronômico humano por mês" (1º item);
  Consultoria → "Até 3 pareceres agronômicos humanos por mês" (substitui "Até 3 pareceres técnicos por mês").
- Eyebrows: "Plano recomendado" / "Acompanhamento especializado". Preço da Consultoria mantido (49700).
- "Precisa de atendimento pontual?" → botão "Falar com a equipe" → `/contact?requestType=consultoria_geral`.
  Texto em `plan_page_settings.onetime_*`. "Disponibilidade em breve..." removido.

## 5. Envio de parecer

- **Plano**: `resolveUserAccess` lê `subscriptions` + `plans` pelo servidor (service role). Só estados
  `active`, `trialing` e `scheduled_cancellation` com período não expirado dão direito. Planos legados
  usam `legacy_entitlement_code`. Nada do navegador é lido (nem plano, limite, saldo ou priceId).
- **Limite**: `plans.entitlements.TECHNICAL_OPINIONS_MONTHLY` (1 / 3 / 0).
- **Saldo**: `limite − pareceres de franquia não cancelados criados em [início, fim) do ciclo`.
- **Autorização**: checagem rápida na API + checagem definitiva dentro de `request_case_human_opinion`.

## 6. Controle de consumo

- **Onde**: `technical_opinions` (ledger já existente) com `case_id`, `subscription_id`, `plan_code`,
  `billing_cycle_reference`, `cycle_start/end`, `idempotency_key`, `status`, `created_at`.
  Auditoria extra em `case_activity_logs`.
- **Ciclo**: período vigente da assinatura (`current_period_start/end` vindo do Stripe). Sem período
  conhecido: mês UTC. Sem contador para "zerar": o consumo é recalculado pela janela.
- **Quando consome**: na criação do registro, dentro da mesma transação que coloca o caso em
  `waiting_review` e na fila `human_reviews`. Falha antes disso = nada consumido (e o caso criado
  na requisição é descartado com soft delete).

| Status | Consome? |
|---|---|
| aberto (na fila), em_analise, aguardando_informacoes, respondido, concluido | Sim |
| cancelado (retirado antes da análise, recusado `rejected` ou `cancelled` pela especialista) | Não — devolve a unidade |

  Exclusão definitiva do caso pelo cliente **não** devolve (o ledger fica com `case_id = null`).
- **Duplicidade**: advisory lock por usuário + recontagem; índice único `(user_id, idempotency_key)`;
  índice único de parecer ativo por caso; chave gerada por tentativa no navegador e reutilizada em
  duplo clique/retry/falha de rede. Testado em Postgres 16 com 10 requisições simultâneas: limite 3 →
  exatamente 3 criadas; mesma chave ×10 → 1 criada, 9 replays.

## 7. Upgrade, downgrade e cancelamento

- **Upgrade** (IA Pro → Consultoria): `change-subscription` troca o price com proration e mantém o
  período (billing anchor). Mesmo ciclo, novo limite: usou 1 → restam 2. Sem franquia duplicada.
- **Downgrade**: vale quando o Stripe efetiva a troca (imediata pela API; agendada pelo Portal
  entra no próximo período). Com 3 usados, IA Profissional fica 0 de 1.
- **Cancelamento**: `cancel_at_period_end` mantém o benefício até o fim do período (sem prometer
  renovação); encerrada/expirada/inadimplente → sem acesso.

## 8. Stripe

- Produtos/prices dos planos: lidos de `plans.stripe_product_id` / `plans.stripe_price_id`
  (planos `ia-profissional` e `consultoria-agronomica`), com fallback `price_data` inline.
  **Os IDs reais não estão no repositório nem foram consultados** (sem acesso à chave).
- Alterações: nenhuma criação/exclusão no Stripe. Webhook: estado atual da assinatura, compatível
  com período no item, e proteção contra entrega concorrente do mesmo evento.
- Webhooks revisados: `checkout.session.completed/async_payment_succeeded`,
  `customer.subscription.created/updated/deleted`, `invoice.paid/payment_succeeded/payment_failed`.
- Produtos antigos: os checkouts avulsos usavam `price_data` + `product_data` (produtos criados
  on-the-fly com os nomes dos serviços) ou `STRIPE_HUMAN_REVIEW_PRICE_ID`. Não foram excluídos;
  sessões antigas pagas continuam sendo processadas pelo webhook.

## 9. Banco de dados

- Migration `20260922150000` — aditiva e idempotente (aplicada 2× sem erro sobre toda a cadeia).
- Colunas novas (nullable): `technical_opinions.idempotency_key`, `technical_opinions.plan_code`.
- Índices: `technical_opinions_user_idempotency_key` (único parcial),
  `technical_opinions_case_active_key` (único parcial), `technical_opinions_user_origin_created_idx`.
- Funções: `request_case_human_opinion` (nova), `create_technical_opinion` (com lock), trigger
  `sync_case_human_opinion_status`. EXECUTE só para `service_role`.
- Dados: `plans` (features/entitlements/eyebrow), `plan_page_settings.onetime_*`,
  `plan_page_services.active = false`. Nenhum pedido, pagamento, crédito ou caso é apagado.
- Rollback: ver cabeçalho da migration.

## 10. Segurança

Autenticação por token (header/cookie) em todas as rotas; ownership do caso conferido na API e
dentro da função (`CASE_NOT_FOUND`); limite/plano apenas do banco; funções de consumo sem EXECUTE
para `anon`/`authenticated`; RLS existente mantida (`technical_opinions` sem policy de INSERT);
erros ao usuário são amigáveis e o detalhe fica no log do servidor, sem tokens ou chaves.

## 11. Pendências externas

1. Aplicar `20260922150000_human_opinion_plan_benefit.sql` no Supabase de produção (depois das 3
   migrations de 2026-09-22 anteriores, se ainda não aplicadas). Opcional: rodar
   `supabase/tests/human_opinion_benefit.sql` em um banco de desenvolvimento.
2. Informar os `prod_`/`price_` reais dos planos no admin (necessário para upgrade/downgrade).
3. No Stripe: arquivar (não excluir) produtos/preços avulsos antigos, se existirem; conferir que o
   endpoint do webhook assina os 8 eventos acima.
4. `STRIPE_HUMAN_REVIEW_PRICE_ID` deixou de ser usado e pode ser removido da Vercel quando conveniente.
5. Casos antigos em "Pagamento pendente" podem ser enviados pelo benefício do plano (botão
   "Solicitar parecer agronômico").
