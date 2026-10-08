# Modernização dos casos agronômicos (out/2026)

Escopo: `/consultoria-ia` (lista, detalhe, análise da IA, chat, edição), rotas de
casos e o Painel da Doutora. Sem commit/push/deploy feitos nesta etapa.

## Causas dos problemas

### Edição que não salvava
1. **RLS bloqueava casos em revisão humana.** A policy `Users can update own cases`
   (migration `20260517153000`) só aceita `human_review_status` em
   `not_requested | pending_payment | pending`. Em qualquer caso enviado para
   parecer (`waiting_review`, `in_review`, ...), o PATCH falhava com 403.
2. **Fotos sem compactação no modal de edição.** O fluxo de novo caso compacta as
   fotos, o modal de edição não. Fotos de celular estouram o limite de 4,5 MB de
   corpo das funções da Vercel, que responde 413 sem JSON.
3. **Erro escondido.** A mensagem de erro aparecia na página, atrás do modal.
   O usuário fechava o modal e perdia as alterações.
4. **Salvamento não atômico.** O texto era gravado antes dos uploads; uma falha
   no meio deixava o salvamento pela metade e arquivos órfãos no storage.
   Também: caso sem propriedade descartava os campos de fazenda em silêncio, e
   cada edição rebaixava o status `ai_analyzed` para `submitted`.

### Rolagem até o final ao abrir um caso
`useEffect(() => chatEndRef.scrollIntoView(...), [chatMessages])` rodava ao
carregar o histórico e rolava a página inteira até o fim do chat. Além disso, o
detalhe ficava em outra coluna (no celular, abaixo de toda a lista).

### Chat
- O servidor já aceitava foto e áudio, mas a tela só enviava texto.
- A tela esperava `payload.messages`, que a API não devolvia: o histórico piscava vazio.
- A migration `20260607120000` redefiniu os tipos do bucket só com imagens + PDF
  e removeu os tipos de áudio.
- Se a transcrição falhava, a requisição inteira caía e o áudio virava órfão.
- O chat não verificava o limite de perguntas do plano.

## O que mudou

**Edição** (`lib/server/agronomic-case-edit.ts`, `PATCH /api/agronomic-cases/[caseId]`,
`POST /api/agronomic-cases/[caseId]/attachments`)
- O servidor valida a propriedade do caso com o token do usuário. Em seguida grava
  apenas campos de conteúdo (cultura, estágio, sintomas, histórico, propriedade)
  com a service role. Status, revisão humana, campos da IA e pagamento nunca são
  alterados por essa rota.
- UPDATE com `return=representation`: se nenhuma linha for afetada, é erro.
- Cada foto ou laudo de solo sobe em requisição própria, compactada no navegador
  (até 1920 px; sem metadados de GPS), com progresso.
- O caminho no storage é determinístico (`clientUploadId`): repetir o envio não
  duplica arquivo nem registro. Se o vínculo no banco falhar, o arquivo enviado é
  apagado (compensação).
- Remoção de fotos escolhidas pelo usuário. Com parecer humano solicitado, o
  arquivo fica no storage.
- Caso sem propriedade: cria a propriedade e vincula ao caso.
- O PATCH multipart antigo (`/enviar-caso?caseId=`) continua funcionando. Falha
  parcial devolve 207 e não é mais tratada como sucesso.
- `/enviar-caso` em modo edição não dispara mais análise da IA automaticamente,
  então não consome crédito.

**Indicadores de salvamento** (`lib/agronomic/case-save.ts`, `CaseEditor`, `SaveStatus`)
- Estados: Alterações não salvas → Salvando... → Alterações salvas com sucesso,
  ou Erro + Tentar novamente, ou Salvo parcialmente.
- O sucesso só aparece depois que o caso é relido do servidor e os textos, as
  fotos novas e as remoções são conferidos.
- O que falhou continua pendente; uma nova tentativa reenvia só o que falhou.
- Trava contra duplo clique; aviso ao sair com alterações; confirmação ao fechar;
  barra de salvar fixa no rodapé; Ctrl+S.

**Navegação** (`app/consultoria-ia/page.tsx`)
- Lista em coluna única. O caso abre dentro do próprio cartão, logo abaixo do
  cabeçalho; clicar de novo recolhe.
- Nenhuma rolagem automática. A posição do cartão clicado é preservada mesmo
  quando outro cartão acima se fecha.
- Filtros, busca sem acento e paginação de 20 por página. `?caseId=` na URL e
  `?caseId=&editar=1` abre direto a edição.

**Análise da IA** (`lib/agronomic/analysis-sections.ts`, `AnalysisAccordion`)
- Seções: Resumo (aberto), Sintomas identificados, Possíveis causas, Avaliação
  técnica, Recomendações de manejo, Cuidados e prevenção, Próximos passos,
  Fontes e referências (recolhida). Várias podem ficar abertas.
- Seções vazias somem. A análise funciona com JSON novo, com JSON antigo e com
  casos que só têm texto (`ai_summary`).
- URLs saem do corpo do texto e viram referências numeradas [n], com links para
  a seção de fontes. Só entram fontes reais (pesquisa bem-sucedida, base interna
  ou URL citada pela própria IA).
- O prompt pede `preventiveCare` e `nextSteps` (opcionais), não aceita URLs no
  texto e não aceita percentuais de confiança.

**Chat** (`CaseChat`, `/api/agronomic-cases/[caseId]/chat`)
- Seção "Converse com a IA sobre este caso".
- Texto, até 4 fotos (galeria ou câmera, com prévia e remoção) e áudio (gravar,
  ouvir, regravar, enviar ou anexar arquivo de até 3 min).
- A rolagem acontece só dentro da caixa do chat.
- Arquivos e mensagens são gravados antes de chamar a IA. Se a IA falhar, nada
  se perde e "Tentar novamente" gera a resposta (`{retry: true}`) sem duplicar a
  mensagem.
- Transcrição: linha `transcription` após o `audio`. Se falhar, o áudio fica
  salvo e a tela informa que a transcrição não foi concluída.
- O limite `ai_question` do plano é verificado antes do envio.

**IA após edição** (`lib/agronomic/case-freshness.ts`)
- `ai_analysis_json.analyzedAt` passa a ser gravado em toda análise.
- Edições e anexos geram `case_activity_logs` com `metadata.kind`. O GET do caso
  devolve `freshness`, e a tela mostra "Novas informações disponíveis para
  análise" com o botão "Atualizar análise com IA".
- A versão anterior da análise fica em `case_activity_logs`
  (`kind = ai_analysis`, `metadata.previous`) e aparece em "Análises anteriores".
- Uma segunda análise pedida em menos de 30 s devolve a mesma, sem gastar crédito.
- Pareceres humanos (`human_reviews`) nunca são tocados.

**Painel da Doutora** (`SpecialistCaseTimeline`, `GET /api/specialist/human-review-cases/[caseId]/timeline`)
- Linha do tempo cronológica: criação, atualizações do produtor (com os campos
  alterados), novas fotos e laudos, análises da IA, solicitação e pareceres, e o
  chat completo (fotos ampliáveis, áudios com player e transcrição).
- Selos "Novo" (desde a última visita naquele navegador) e "Após a solicitação".
  O filtro "Só novidades" mostra apenas os itens novos.
- Inclui a análise atual completa da IA, com fontes.
- O parecer humano tem identidade visual própria na tela do produtor, separada
  da IA.

## Migration
- `20261008090000_restore_case_chat_audio_types.sql`: devolve os tipos de áudio
  ao bucket `agronomic-cases` (inclui `audio/mp4` do iPhone). Não é destrutiva.
  **Precisa ser aplicada no Supabase**; sem ela, o storage recusa os áudios.

## Testes
- `npm test`: 149/149 (111 anteriores + 38 novos: seções da análise, salvamento,
  servidor de edição, histórico e linha do tempo).
- `tsc`: sem erros. `next lint`: só os 3 avisos que já existiam. `next build`: OK.
- E2E (`tests/e2e`, app compilado + Supabase falso): 24/24 cenários, incluindo
  Android (Pixel 5), iPhone 13 (emulado no Chromium), iPad e desktop 1366.

## Pendências e limites
- O bucket `agronomic-cases` continua **público** (URLs `/object/public/`).
  Fechar exige migrar para URLs assinadas em todas as telas; não foi feito para
  não quebrar anexos antigos.
- A IA ainda recebe as fotos apenas como URL no texto do prompt; não há análise
  visual de verdade (o provedor não recebe a imagem).
- Transcrição depende de `OPENAI_API_KEY` (`OPENAI_TRANSCRIPTION_MODEL`, padrão
  `gpt-4o-mini-transcribe`).
- O destaque "Novo" no Painel da Doutora usa o armazenamento local do navegador
  (por especialista e por caso). Em outro navegador, tudo aparece como primeira
  visita.
- A lista carrega os 100 casos mais recentes; a busca atua sobre eles.
- Fazer um teste no Supabase real (preview) antes do deploy, principalmente o
  upload de áudio no iPhone e a service role.
