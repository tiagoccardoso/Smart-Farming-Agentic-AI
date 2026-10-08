# Chat de IA por caso (Consultas de Casos) — correção de 08/10/2026

## Causa raiz
- O chat (`POST /api/agronomic-cases/[caseId]/chat`) não tinha inferência própria: cada mensagem reexecutava a **análise inicial completa** (`generateAgronomicPreAnalysis`, JSON de 6.500 tokens + pesquisa web) com a conversa inteira num campo "Pergunta complementar", e **regravava `ai_analysis_json`** a cada mensagem.
- Com a conversa acumulada (> 2.500 caracteres), o caso virava `heavy_multimodal` e ia para o Gemini `gemini-2.5-pro`; o "fallback" era o mesmo Gemini. O Google responde *"model gemini-2.5-pro is no longer available"* (logs de produção, 08/10 04:10–04:11, caso f71a5aa0…).
- Os dois falhavam → "triagem local segura" → `conversationalAnswer` **fixo** ("Sobre sua pergunta: a triagem deve combinar…") + próxima pergunta da fila. Toda pergunta recebia o mesmo texto.
- Agravantes: toda mensagem era gravada como resposta da pergunta pendente; a OpenAI recebia mensagens `assistant` com tipo `input_text` (inválido na Responses API); a busca web truncava a consulta antes da pergunta.

## Arquitetura nova
| Camada | Arquivo |
|---|---|
| Rota (upload, validação, plano, transcrição) | `frontend/app/api/agronomic-cases/[caseId]/chat/route.ts` |
| Serviço (gravar turno → contexto → IA → gravar resposta) | `frontend/lib/server/case-chat-service.ts` |
| Acesso a dados (Supabase, token do usuário + RLS) | `frontend/lib/server/case-chat-store.ts` |
| Contexto e prompt de sistema (puro) | `frontend/lib/agronomic/case-chat-context.ts` |
| Inferência, fallback, imagens, logs | `frontend/lib/agronomic/case-chat-ai.ts`, `case-chat-providers.ts` |
| Markdown das respostas | `frontend/lib/agronomic/chat-markdown.ts` |

- Mensagens ao modelo: `system` (regras + dados atuais do caso + análise inicial como referência + parecer humano finalizado, atribuído ao agrônomo + respostas da fila + atualizações do caso + resumo compacto das mensagens antigas) → histórico recente `user`/`assistant` alternado → `user` com a **pergunta atual** e as fotos (base64, até 3: as enviadas agora e as mais recentes do caso).
- Provedores: OpenAI `OPENAI_CHAT_MODEL` (principal) → Gemini (fallback, mesmas mensagens). Sem resposta fixa: falha = erro explícito, pergunta preservada, botão "Tentar novamente".
- O chat **não altera** `ai_analysis_json` nem pareceres humanos. A fila de perguntas pendentes só avança quando a mensagem não é uma pergunta e depois de uma resposta real.
- Idempotência: `client_message_id` (reenvio não duplica) e `reply_to_message_id` com índice único (duas requisições simultâneas não gravam duas respostas).
- Logs `[case-chat]` em JSON: requestId, caseId, provedor, modelo, duração, status, categoria de erro, fallback, persistência. Sem texto da conversa, imagens ou chaves.

## Deploy
1. Migration `supabase/migrations/20261008120000_case_chat_idempotency.sql` (não destrutiva; o código funciona sem ela, mas a proteção contra resposta duplicada depende dela).
2. Vercel: atualizar `GEMINI_MODEL` (hoje aponta para modelo descontinuado). Opcional: `GEMINI_FALLBACK_MODEL` (padrão `gemini-3.1-pro-preview`), `OPENAI_BASE_URL` (só para testes).

## Testes
- `npm test` → `tests/case-chat-ai.test.ts` (cenários A–H com banco em memória e provedores falsos).
- `RUN_REAL_AI_TESTS=1 OPENAI_API_KEY=... npm test` → `tests/case-chat-real-ai.test.ts` (provedor real; pulado sem chave).
- E2E: `tests/e2e` (OpenAI falsa embutida no Supabase falso).
