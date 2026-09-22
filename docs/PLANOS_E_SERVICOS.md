# PlantaSa — Nova estrutura de Planos e Serviços

Relatório da implementação. Data: 2026-09-22.

Base analisada antes de qualquer alteração: Next.js 14 (App Router) + Supabase
(Auth, PostgREST, RLS) + Stripe via REST (`fetch`, sem SDK). Nada foi recriado:
a implementação reaproveita `plans`, `subscriptions`, `one_time_orders`,
`usage_events`, `plan_page_settings`, `plan_page_services`,
`specialist_visit_requests` e o webhook já existentes.

---

## 1. Arquivos criados

### Migrations
- `supabase/migrations/20260922140000_plantasa_commercial_structure.sql`
- `supabase/migrations/20260922141000_plantasa_commercial_functions.sql`
- `supabase/migrations/20260922142000_subscription_billing_state.sql`

### Camada de regras (`frontend/lib`)
- `lib/billing/entitlements.ts` — direitos dos planos e resolução do acesso do usuário
- `lib/billing/subscription-state.ts` — mapeamento Stripe → estado interno
- `lib/billing/billing-cycle.ts` — ciclos mensais (calendário e assinatura)
- `lib/billing/technical-opinions.ts` — pareceres técnicos e créditos avulsos
- `lib/stripe/signature.ts` — validação da assinatura do webhook
- `lib/stripe/webhook-events.ts` — idempotência por `event.id`
- `lib/server/supabaseAdmin.ts` — cliente service role centralizado
- `lib/server/request-auth.ts` — autenticação/autorização das rotas
- `lib/service-quotes.ts` — tipos de serviço presencial

### Rotas de API
- `app/api/stripe/change-subscription/route.ts` — upgrade/downgrade
- `app/api/stripe/customer-portal/route.ts` — Stripe Customer Portal
- `app/api/stripe/create-technical-opinion-checkout/route.ts` — parecer avulso
- `app/api/subscription/me/route.ts` — dados de "Minha assinatura"
- `app/api/technical-opinions/route.ts` — listar / abrir demanda
- `app/api/technical-opinions/[opinionId]/route.ts` — detalhe / status
- `app/api/technical-opinions/[opinionId]/messages/route.ts` — mensagens
- `app/api/service-quotes/route.ts` — solicitação de orçamento
- `app/api/admin/service-quotes/route.ts` — acompanhamento administrativo

### Páginas
- `app/minha-assinatura/page.tsx`
- `app/pareceres/page.tsx` e `app/pareceres/[opinionId]/page.tsx`
- `app/solicitar-orcamento/page.tsx`
- `app/checkout/sucesso/page.tsx` e `app/checkout/cancelado/page.tsx` *(antes o
  Stripe redirecionava para uma rota inexistente — 404)*
- `app/admin/orcamentos/page.tsx`

### Testes
- `frontend/tests/` — 47 testes (`npm test`), com `tsconfig.test.json`,
  `tests/helpers/http-mock.ts` e `tests/helpers/fixtures.ts`

---

## 2. Arquivos alterados

| Arquivo | Alteração |
|---|---|
| `lib/billing/check-plan-limits.ts` | Deixou de ter `PLAN_RULES` hardcoded; agora traduz evento de uso → entitlement. API pública preservada (todas as rotas que a usam continuam funcionando). |
| `lib/stripe/subscription.ts` | Customer Portal, `updateSubscriptionPlan` com proration, uso de `stripe_product_id`, gravação de estado interno/período/cancelamento. |
| `lib/stripe/humanReview.ts` | Novo serviço `technical_opinion_single`, suporte a Price/Product ID, reuso do cliente admin central. |
| `app/api/stripe/webhook/route.ts` | Reescrito: idempotência, mais eventos, liberação do parecer avulso, tolerância de horário na assinatura. |
| `app/api/stripe/create-subscription-checkout/route.ts` | Planos vindos do banco, bloqueio de cobrança duplicada, `internal_status`. |
| `app/api/plans/route.ts` | Não expõe mais IDs Stripe nem entitlements na rota pública. |
| `app/api/admin/plans-page/route.ts` | Edição de entitlements e IDs Stripe, com validação de formato. |
| `components/AdminPlansPage.tsx` | Editor de direitos, IDs Stripe e blocos novos da página. |
| `app/planos/PlansPageClient.tsx` | Página reformulada. |
| `lib/plans-page.ts` | Tipos novos e formatação de preço ("Sob consulta"). |
| `middleware.ts` | Protege `/minha-assinatura`, `/pareceres`, `/admin/orcamentos`. |
| `app/configuracoes/page.tsx` | Link para as solicitações de orçamento. |
| `frontend/.env.example`, `package.json`, `.gitignore` | Variáveis Stripe, scripts `typecheck`/`test`, ignore de `.test-build`. |

> Observação: `git status` mostra praticamente todo o repositório como
> modificado. Isso é anterior a este trabalho (diferença de fim de linha
> CRLF/LF no clone), não reflete alterações de conteúdo.

---

## 3. Migrations criadas

1. **`20260922140000`** — estrutura comercial
2. **`20260922141000`** — funções (`create_technical_opinion`, `update_plans_page`)
3. **`20260922142000`** — estado completo da assinatura

Todas foram executadas contra um PostgreSQL 16 limpo, na ordem completa da pasta
`supabase/migrations`, sem erros.

---

## 4. Tabelas e colunas alteradas

### Novas tabelas
- `technical_opinions` — demandas técnicas (`id`, `user_id`, `property_id`,
  `subscription_id`, `case_id`, `credit_id`, `origin`, `title`, `description`,
  `status`, `assigned_specialist_id`, `billing_cycle_reference`, `cycle_start`,
  `cycle_end`, `created_at`, `updated_at`, `closed_at`)
- `technical_opinion_messages` — mensagens/anexos da demanda
- `technical_opinion_credits` — créditos de parecer avulso pago
- `stripe_webhook_events` — idempotência dos webhooks

### Colunas adicionadas
- `plans`: `stripe_product_id`, `plan_kind`, `is_legacy`,
  `legacy_entitlement_code`, `entitlements` (jsonb)
- `subscriptions`: `stripe_price_id`, `current_period_start`,
  `cancel_at_period_end`, `internal_status`, `canceled_at`,
  `last_payment_status`, `last_payment_at`, `updated_at`
- `plan_page_services`: `stripe_product_id`, `stripe_price_id`; constraint
  ampliada para `technical_opinion_single`
- `plan_page_settings`: `onetime_title`, `onetime_description`,
  `onetime_button_label`, `quote_button_label`, `quote_services`
- `specialist_visit_requests`: `user_id`, `property_id`, `service_type`,
  `notes`, `source`

**Nada foi removido nem teve o tipo alterado.** `plans.slug` continua sendo o
`code` do plano — não foi criada uma segunda chave para não duplicar a chave de
integração já usada pelo Stripe e pelo checkout.

---

## 5. Variáveis de ambiente necessárias

| Variável | Uso | Situação |
|---|---|---|
| `STRIPE_SECRET_KEY` | Servidor. Checkout, portal, assinaturas. | **Obrigatória** |
| `STRIPE_WEBHOOK_SECRET` | Servidor. Validação do webhook. | **Obrigatória** |
| `NEXT_PUBLIC_SUPABASE_URL` | Já existia | — |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Já existia | — |
| `SUPABASE_SERVICE_ROLE_KEY` | Já existia | — |
| `NEXT_PUBLIC_SITE_URL` | URLs de retorno do Stripe | Já existia |

Nenhum `price_id` em variável de ambiente: os IDs ficam no banco, editáveis pela
área administrativa. Chave secreta e webhook secret nunca chegam ao frontend.

---

## 6, 7. Produtos e preços Stripe necessários

**Não foram inventados IDs.** Os campos estão vazios no banco e devem ser
preenchidos com os IDs reais em `/painel-doutora/site-pages/planos`.

| Produto a criar no Stripe | Preço | Recorrência | Onde informar o ID |
|---|---|---|---|
| PlantaSa IA Profissional | R$ 97,00 BRL | Mensal | Plano `ia-profissional` |
| PlantaSa Consultoria Agronômica | R$ 497,00 BRL | Mensal | Plano `consultoria-agronomica` |
| PlantaSa — Parecer Técnico Avulso | a definir | Pagamento único | Serviço `technical_opinion_single` |

Enquanto o `Price ID` não for informado, o Checkout de assinatura funciona com
`price_data` inline (comportamento que já existia). **A troca de plano com
proration exige o `Price ID` real** e retorna uma mensagem explicativa até lá.

---

## 8. Webhooks utilizados

Endpoint: `POST /api/stripe/webhook`

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

A assinatura do webhook é validada com HMAC-SHA256, comparação em tempo
constante e tolerância de 5 minutos (anti-replay). O retorno do navegador após o
Checkout **não libera nada** — apenas o webhook libera.

---

## 9. Regras de permissão implementadas

- Toda validação de plano acontece no servidor. Esconder um botão no React nunca
  é suficiente: `POST /api/technical-opinions` verifica Consultoria ativa ou
  crédito avulso antes de criar qualquer registro.
- `/api/admin/plans-page` e `/api/admin/service-quotes`: apenas `admin`
  (e `specialist` nas cotações), verificado no servidor.
- `update_plans_page` é `security definer` com `is_admin()` no início e
  `execute` concedido só a `authenticated` — um usuário comum recebe
  "Acesso negado".
- `create_technical_opinion` só pode ser executada pela `service_role`.
- RLS ativo nas quatro tabelas novas. `stripe_webhook_events` não tem policy:
  só a service role acessa.
- Perfil inativo é bloqueado antes de qualquer consumo.

---

## 10. Como funciona o limite de 3 consultas gratuitas

- O limite vem de `plans.entitlements.AI_MONTHLY_LIMIT` do plano `gratuito` (3).
- O consumo é contado em `usage_events` por ciclo de calendário (mês UTC), que é
  o "ciclo mensal definido pelo sistema" já usado pela plataforma — o histórico
  existente continua válido. O contador reinicia sozinho no dia 1.
- Ao atingir o limite a API responde **402** com mensagem explicativa
  ("Seu plano PlantaSa Gratuito inclui 3 consultas à IA por mês. Você já
  utilizou as 3 consultas deste ciclo.") e CTA **Conhecer IA Profissional**
  → `/planos`.
- O plano Gratuito **não cria assinatura paga no Stripe** (`plan_kind = 'free'`,
  botão vai para `/register`).

---

## 11. Como funciona o limite de 3 pareceres

- Limite em `plans.entitlements.TECHNICAL_OPINIONS_MONTHLY` (3 na Consultoria).
- **1 parecer = 1 demanda técnica.** O parecer é consumido na criação da demanda.
  Mensagens, perguntas complementares, fotos, documentos, análises e respostas
  vinculadas à mesma demanda **não consomem novo parecer** — são registradas em
  `technical_opinion_messages`.
- O ciclo é o da assinatura (`current_period_start`/`end`), gravado em
  `billing_cycle_reference`. Sem assinatura, cai no ciclo de calendário.
- Contagem e baixa acontecem dentro de `create_technical_opinion` (PL/pgSQL, com
  `FOR UPDATE SKIP LOCKED`): duas requisições simultâneas não abrem a quarta
  demanda nem consomem o mesmo crédito duas vezes.
- Interface: "Pareceres utilizados neste ciclo: 1 de 3" e "Você possui 2
  pareceres disponíveis neste ciclo."
- No limite, a quarta demanda é bloqueada com as opções **Aguardar o próximo
  ciclo** e **Solicitar parecer avulso**.
- Demandas canceladas não consomem franquia; o cancelamento pelo cliente só é
  permitido enquanto a demanda estiver `aberto`.

---

## 12. Como funciona o parecer avulso

1. O administrador define preço e IDs Stripe do serviço
   `technical_opinion_single` e o ativa. Sem preço configurado, o serviço não
   aparece na página e a API responde 503 com explicação.
2. `POST /api/stripe/create-technical-opinion-checkout` cria um
   `one_time_orders` e uma Checkout Session em modo `payment`.
3. O webhook confirma o pagamento e chama `grantTechnicalOpinionCredit`, que
   libera **exatamente 1** crédito.
4. O crédito é consumido na abertura da próxima demanda, que pode ter quantas
   mensagens, imagens e documentos forem necessários sobre o mesmo problema.

**Idempotência (tripla):** `stripe_webhook_events` descarta `event.id`
repetido; índices únicos em `technical_opinion_credits.stripe_checkout_session_id`
e `.one_time_order_id`; e a colisão de índice único é tratada como sucesso
silencioso. Verificado em banco real: a segunda inserção da mesma sessão é
recusada.

---

## 13. Como funciona upgrade/downgrade

| Transição | Caminho |
|---|---|
| Gratuito → IA Profissional | Checkout Session (`subscription`) |
| Gratuito → Consultoria Agronômica | Checkout Session (`subscription`) |
| IA Profissional → Consultoria Agronômica | `POST /api/stripe/change-subscription` |
| Consultoria Agronômica → IA Profissional | `POST /api/stripe/change-subscription` |
| Plano pago → Gratuito | Cancelamento no Customer Portal; ao encerrar, a resolução de direitos volta ao Gratuito |

**Regra de proration adotada, explícita:** `proration_behavior=create_prorations`
(padrão do Stripe). O período não utilizado do plano atual vira crédito e a
diferença proporcional entra na próxima fatura. O texto é exibido na tela
"Minha assinatura" antes da troca. Nenhum comportamento financeiro implícito.

Se já existe assinatura ativa, o checkout recusa (409) e direciona para a troca
de plano — evitando cobrança duplicada.

---

## 14. Como as assinaturas antigas foram preservadas

Nenhuma assinatura Stripe foi alterada, cancelada ou recobrada.

| Plano antigo | Preço cobrado | Situação | Direitos |
|---|---|---|---|
| `ia-basica` (IA Básica) | R$ 39,00 — **inalterado** | `active = false`, `is_legacy = true` (sai da vitrine) | Passa a ter os direitos de IA Profissional |
| `ia-revisao-humana` (IA + Revisão Humana) | R$ 397,00 — **inalterado** | `active = false`, `is_legacy = true` | Passa a ter os direitos de Consultoria Agronômica, incluindo 3 pareceres/mês |

A resolução de acesso segue `legacy_entitlement_code`: o assinante antigo
continua vendo o nome e o valor do plano contratado, mas ganha os recursos
equivalentes na nova estrutura. A tela "Minha assinatura" explica isso.

Os 4 serviços avulsos que já existiam continuam ativos e inalterados.

---

## 15. Testes realizados

`npm test` — **47 testes, 47 aprovados** (runner nativo do Node; o `npm install`
de uma dependência nova falha no diretório montado, então não foi adicionada
nenhuma dependência de teste).

Cobertura por cenário do escopo:

| # | Cenário | Onde |
|---|---|---|
| 1–4 | Gratuito: 1ª, 3ª e bloqueio da 4ª consulta, com mensagem e CTA | `tests/plan-limits.test.ts` |
| 5,7 | Planos assináveis e limites do plano pago | `tests/entitlements.test.ts`, `plan-limits` |
| 6 | Confirmação por webhook / idempotência | `tests/webhook-idempotency.test.ts` |
| 8–10 | 1º, 3º parecer e bloqueio do 4º | `tests/technical-opinions.test.ts` |
| 11,12 | Pagamento e liberação do parecer avulso | `tests/technical-opinions.test.ts` |
| 13 | Webhook duplicado não libera segundo parecer | `tests/technical-opinions.test.ts` |
| 14,15 | Cancelamento e falha de pagamento (estados) | `tests/subscription-state.test.ts` |
| 16,17 | Upgrade/downgrade (estados e direitos resultantes) | `tests/entitlements.test.ts` |
| 18 | Acesso direto pela API sem permissão | `tests/plan-limits.test.ts`, `technical-opinions.test.ts` |
| — | Assinatura do webhook e anti-replay | `tests/stripe-signature.test.ts` |
| — | Ciclos mensais | `tests/billing-cycle.test.ts` |
| — | "Sob consulta" sem preço fictício | `tests/plans-page.test.ts` |

Além disso, em **PostgreSQL 16 real**: toda a cadeia de migrations aplicada sem
erro; 3 pareceres criados, 4º recusado com `TECHNICAL_OPINION_LIMIT_REACHED`,
crédito avulso liberando exatamente 1 demanda `one_time`, sessão Stripe
duplicada recusada pelo índice único, e `update_plans_page` negando acesso a
não-administrador.

Verificação final: `npm run typecheck` sem erros, `eslint` sem erros e
`next build` concluído com sucesso (todas as rotas novas presentes no output).
Layout revisado para telas pequenas (grids `1 → 2 → 4` colunas, botões e
formulários em coluna no mobile).

---

## 16. Pendências que exigem configuração manual no Stripe

Estas etapas **não podem ser feitas pelo sistema** e ficam aguardando os IDs reais:

1. Criar o produto **PlantaSa IA Profissional** com preço recorrente mensal de
   **R$ 97,00 BRL**. Informar `prod_...` e `price_...` no plano
   `ia-profissional`.
2. Criar o produto **PlantaSa Consultoria Agronômica** com preço recorrente
   mensal de **R$ 497,00 BRL**. Informar `prod_...` e `price_...` no plano
   `consultoria-agronomica`.
3. Definir o preço do **PlantaSa — Parecer Técnico Avulso**, criar o produto
   (pagamento único), informar `prod_...`/`price_...` e **ativar** o serviço.
   Enquanto estiver inativo ou com preço zero, o bloco "Precisa de atendimento
   pontual?" mostra aviso em vez do botão de pagamento.
4. Configurar o endpoint de webhook apontando para
   `https://<dominio>/api/stripe/webhook`, assinando os 8 eventos listados na
   seção 8, e copiar o **signing secret** para `STRIPE_WEBHOOK_SECRET`.
5. Habilitar o **Customer Portal** no Stripe (Billing → Customer portal) para
   que o botão "Gerenciar assinatura" funcione.
6. Publicar `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` no ambiente de
   produção (Vercel).
7. Aplicar as três migrations no Supabase.

### Observação fora do escopo, encontrada na auditoria
`app/api/human-review/checkout/route.ts` é uma rota antiga que duplica
`app/api/stripe/create-human-review-checkout/route.ts` e depende de um
`STRIPE_HUMAN_REVIEW_PRICE_ID` em variável de ambiente. Não foi alterada para
não mexer em fluxo existente, mas convém removê-la em uma limpeza futura.
