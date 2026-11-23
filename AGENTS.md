# PlantaSa — Instruções Codex

Repositório: PlantaSa / Smart-Farming-Agentic-AI. A aplicação principal é Next.js 14 em `frontend/` com Supabase (REST), Stripe, OpenAI e Gemini. Stack, estrutura, regras de negócio e comandos estão em `CLAUDE.md` — leia-o antes de trabalhar; este arquivo traz as regras de atuação do Codex.

## Arquitetura e convenções (resumo)

- Toda alteração de produto acontece em `frontend/`; rode os comandos de Node a partir dessa pasta. O backend Python na raiz é legado: não altere sem pedido explícito.
- Route Handlers em `frontend/app/api`; regras de domínio em `frontend/lib` (`agronomic`, `billing`, `disease`, `crop`, `server`).
- Acesso ao Supabase por REST (`lib/server/supabase-rest.ts`); a service role (`lib/server/supabaseAdmin.ts`) só pode ser usada no servidor.
- Provedores de IA em `frontend/src/lib/ai/providers` (OpenAI principal, Gemini fallback). Reutilize-os em vez de chamar APIs diretamente.
- Migrations em `supabase/migrations` com RLS. Testes `node:test` em `frontend/tests`.
- UI: use a Skill Impeccable em `.agents/skills/impeccable`; os hooks em `.codex/hooks.json` checam as alterações de interface.
- Antes de criar branch, considere que já há muitas branches `codex/*` antigas no remoto; use nomes descritivos e não reaproveite branches abandonadas.

## Política de alterações

Implemente apenas a tarefa autorizada, sem reestruturações oportunistas nem dependências novas sem justificativa. Nunca execute deploy, migration em produção, push na `main`, merge de PR, mudança de planos/preços Stripe, troca de modelos de IA por opções mais caras ou exclusão de dados sem autorização explícita. Não leia nem imprima valores de `.env*`.

Verificações (em `frontend/`): `npm run lint`, `npm run typecheck`, `npm test` e `npm run build` quando aplicável. Relate arquivos modificados, testes executados, riscos e pendências; não afirme testes que não executou.

## Modo auditor independente (revisão solicitada pelo Claude Code)

Opere em **somente leitura**: não edite, crie ou apague arquivos, não faça commit, push ou deploy e não use conectores ou MCPs que alterem estado (Vercel, GitHub, Supabase, Stripe), salvo autorização explícita. Ao terminar, apenas relate; quem corrige é o executor. Procure falhas ativamente no diff indicado. Avalie:

1. Bugs e regressões.
2. Segurança: sessão e cookies, uso da service role, RLS, validação de upload de imagens, injeção, segredos.
3. Autorização por papel (`client`, `specialist`, `admin`) e acesso a casos, anexos e pareceres de terceiros.
4. Separação entre análise automatizada e parecer profissional; rastreabilidade de análises.
5. Qualidade e robustez das chamadas de IA: prompts, tratamento de erro/timeout, fallback, formatação.
6. Custo de IA e limites de plano.
7. Pagamentos: assinatura e idempotência do webhook Stripe, liberação de serviços só após pagamento.
8. Performance, duplicação e manutenção; cobertura de testes.
9. UX das jornadas cliente → caso → IA → revisão humana → parecer.

Formato de cada achado: **severidade** (Crítico, Alto, Médio, Baixo) · arquivo:linha · evidência · impacto · recomendação. Indique as categorias sem achados e o que não foi possível verificar.
