# PlantaSa — Claude Code

Plataforma de consultoria agronômica: triagem de doenças por imagem, recomendação de culturas, casos agronômicos com análise e chat de IA, revisão humana e pareceres técnicos por especialista ("Painel da Doutora"), acompanhamento técnico de propriedades, base de conhecimento e planos pagos. Site: https://www.plantasa.com.br · Repositório: https://github.com/tiagoccardoso/Smart-Farming-Agentic-AI

As regras gerais de orquestração estão em `~/.claude/CLAUDE.md`; este arquivo traz só o que é específico do projeto.

## Stack verificada (22/11/2026)

- **Aplicação principal em `frontend/`**: Next.js 14.2.5 (App Router), React 18.3, TypeScript 5.4, Tailwind 3.4, ESLint 8. Frontend e backend (Route Handlers em `frontend/app/api`). Rode todos os comandos de Node dentro de `frontend/`.
- Banco, autenticação e storage: **Supabase**, acessado por REST/`fetch` (sem SDK): `lib/server/supabase-rest.ts`, `lib/server/supabaseAdmin.ts` (service role, só no servidor), `lib/supabaseAuth.ts`. Migrations SQL em `supabase/migrations` (49 arquivos, com RLS); testes SQL em `supabase/tests`.
- IA: OpenAI como provedor principal e Gemini como fallback (`frontend/src/lib/ai/providers`, `lib/agronomic/case-chat-providers.ts`); modelos definidos por env (`OPENAI_CHAT_MODEL`, `OPENAI_COMPLEX_MODEL`, `OPENAI_EMBEDDING_MODEL`, `GEMINI_MODEL`). Embeddings em `lib/ai/embeddings.ts`.
- Pagamentos: Stripe via API (assinatura mensal, revisão humana, parecer técnico, portal do cliente; webhook em `app/api/stripe/webhook`).
- Deploy: Vercel.
- **Legado**: backend Python na raiz (`app.py`, `src/`, `models/`, `requirements.txt` com FastAPI, TensorFlow, PyTorch, LangChain, FAISS). Não é necessário para a versão principal; não o altere nem o use como referência de comportamento atual sem pedido explícito.

## Estrutura (`frontend/`)

- `app/` — páginas públicas (home, planos, doenças, culturas, contato), área do cliente (`dashboard`, `enviar-caso`, `consultoria-ia`, `revisao-humana`, `pareceres`, `meus-relatorios`, `minha-assinatura`, `acompanhamento`, `perfil`), área do especialista (`painel-doutora`, `especialista`) e `admin`.
- `app/api/` — `agronomic-cases` (casos, anexos, chat, revisão humana), `agronomic-ai/analyze-case`, `disease/triage`, `technical-opinions`, `specialist/*`, `admin/*` (inclui `ai-usage`), `stripe/*`, `auth/*`, `acompanhamento/*`, `public-requests`.
- `lib/agronomic` (casos, análise, chat, revisão), `lib/billing` (limites de plano, entitlements, ciclo, pareceres), `lib/disease`, `lib/crop`, `lib/server` (serviços de servidor e jobs de análise), `lib/auth.ts`.
- `middleware.ts` — rotas protegidas por sessão, rotas de especialista e de admin. Papéis: `client`, `specialist`/`especialista`, `admin`.
- `tests/` — testes `node:test` compilados com `tsconfig.test.json`; fakes em `tests/*-fakes.ts` e `fake-supabase.mjs`.
- `docs/` (raiz) — casos, chat IA, parecer humano, planos e serviços.

## Regras de negócio prioritárias

- **Separação entre análise automatizada e parecer profissional**: respostas de IA são orientação inicial e devem ser rotuladas como tal; parecer técnico e revisão humana são do especialista e nunca são gerados ou alterados por IA sem a validação dele.
- **Rastreabilidade**: cada análise registra caso, anexos, modelo/provedor usado e histórico (timeline). Não apague histórico de casos ou pareceres.
- **Qualidade das respostas de IA**: prompts e formatação em `lib/agronomic`; preserve o contexto do especialista e a base de conhecimento; trate falhas e timeout do provedor com mensagem clara.
- **Custo dos modelos**: respeite limites de plano (`lib/billing/check-plan-limits.ts`), orçamento de análise e o fallback OpenAI → Gemini; não troque modelos por outros mais caros sem aprovação; registre uso em `admin/ai-usage`.
- **Imagens**: valide tipo e tamanho, comprima no cliente (`lib/mobile-image-upload.ts`) e armazene com acesso restrito ao dono do caso e ao especialista.
- **Segurança de dados**: RLS ativa nas tabelas; a service role do Supabase só existe no servidor; nunca envie dados pessoais a provedores de IA além do necessário.
- **Cobrança**: webhook Stripe verificado e idempotente (há testes `stripe-signature` e `webhook-idempotency`); mudanças de planos/preços só com aprovação.

## Interface (Impeccable)

Para qualquer mudança de UI, use a Skill `/impeccable` (instalada em `.claude/skills/impeccable`, v4.10.0), respeitando o padrão Tailwind existente em `frontend/`. Os hooks em `.claude/settings.local.json` rodam o detector após cada edição e uma checagem completa ao final da sessão. Priorize as jornadas do cliente (envio de caso com fotos pelo celular, leitura da análise de IA, pedido de revisão humana, parecer) e do especialista (Painel da Doutora), deixando visualmente claro o que é orientação automática e o que é parecer profissional. Ainda não há `PRODUCT.md`/`DESIGN.md` do Impeccable; rode `/impeccable init` antes do primeiro trabalho grande de design.

## Comandos (em `frontend/`)

- `npm run dev` · `npm run build` · `npm run lint` · `npm run typecheck` · `npm test` (compila e roda `node --test`).
- Banco: nova migration em `supabase/migrations`; aplicar no Supabase de produção só com aprovação. Não há MCP Supabase conectado no Claude Code.

## Critérios de aceitação

Funcionalidade implementada sem regressão; `lint`, `typecheck`, `npm test` e `build` executados quando pertinentes; separação IA × parecer humano preservada; RLS e escopo por papel mantidos; sem aumento não aprovado de custo de IA; nenhuma credencial exposta; riscos documentados.

## Documentação (Obsidian)

Notas em `C:\Users\TIAGO\Meu Drive\Obsidian\01 - Projetos\PlantaSa` (`PlantaSa.md`, `PlantaSa - Arquitetura.md`). Leia antes de escrever, atualize em vez de duplicar e use `[[links internos]]`; conceitos agronômicos ficam em `03 - Conhecimento\Agronomia`.
