# Análise inicial: timeout de 37 s em produção (out/2026)

Caso: `/consultoria-ia?caseId=ec33892e-df2c-4037-ad17-ffff1648cc16` (tomate, 1 foto).
Código de suporte: `91689349683-d734721b2e8a`, que corresponde ao request Vercel
`jm6wl-1791689349683-d734721b2e8a` (deploy `4af7264`).

## Evidência (logs de runtime da Vercel)

```
03:29:10.767  [analyze-case] jobs_unavailable_sync_fallback
03:29:46.792  Provider principal (openai) falhou na análise inicial. { category: 'AI_TIMEOUT', images: 1 }
03:29:46.792  Fallback (gemini) não executado por falta de tempo na análise inicial.
03:29:47.115  [analyze-case] model_failed { code: 'AI_TIMEOUT', durationMs: 37328 }
```

As três tentativas desse caso (10/10 20:17 UTC e 11/10 03:27 e 03:29 UTC)
falharam com 37,3 s. Uma duração fixa assim aponta para um corte do nosso próprio
orçamento de tempo, não para instabilidade do provedor.

## Causa raiz

1. **A migration `20261010120000_agronomic_analysis_jobs.sql` não foi aplicada em
   produção.** A `SUPABASE_SERVICE_ROLE_KEY` existe na Vercel, então o
   `AnalysisJobStoreUnavailableError` só pode vir da tabela ausente
   (PGRST205/42P01). Por isso o processamento em segundo plano, com status
   persistido e modo background da OpenAI, nunca foi usado, e a rota caiu no
   fluxo síncrono limitado a 60 s.
2. **O orçamento do fluxo síncrono cortava a chamada principal.** A sequência era:
   ~1,1 s de preparo, depois 12 s de pesquisa (o teto foi esgotado), e a OpenAI
   recebia só ~24 s, porque 12 s ficavam reservados para o Gemini. A chamada era
   abortada pelo nosso AbortController aos ~24 s. Depois disso sobravam 11,7 s,
   abaixo do mínimo de 12 s, e o Gemini também não rodava. Ou seja, os 12 s
   reservados nunca eram usados.

## Correção

- `lib/agronomic/case-analysis.ts`: o fallback só tem janela reservada quando o
  principal também tem a janela-alvo inteira (`ANALYSIS_PRIMARY_TARGET_MS`, 45 s).
  O fluxo síncrono passa a usar teto de pesquisa de 8 s
  (`ANALYSIS_SYNC_RESEARCH_CAP_MS`). Com isso o principal recebe ~40 s, contra
  ~24 s antes. A classificação de erro passa a considerar o status HTTP antes do
  texto da mensagem.
- `src/lib/ai/orchestrator/analyze-case.ts`: registra os tempos por etapa
  (pesquisa e cada tentativa de provedor, com janela, duração e resultado). Uma
  resposta inválida do principal não é mais mascarada como "indisponível" quando
  o fallback falha por falta de configuração.
- `app/api/agronomic-ai/analyze-case/route.ts`: os logs `model_completed` e
  `model_failed` trazem as etapas. A ausência da tabela gera `console.error` com
  o motivo e o código. Falha ao gravar a análise vira `SAVE_FAILED`, e não erro
  genérico.
- `lib/server/analysis-jobs.ts`: o erro informa o motivo (`table_missing` ou
  `missing_config`) e o código do banco.

## Ação necessária no ambiente

Aplicar `supabase/migrations/20261010120000_agronomic_analysis_jobs.sql` no
Supabase de produção (SQL Editor). A mudança é aditiva: cria a tabela, os
índices e a RLS somente leitura para o dono. Ela ativa o fluxo durável, em que a
análise roda no provedor sem o limite de 60 s e é retomada ao recarregar a
página, com no máximo um job ativo por caso entre instâncias. Sem a migration, o
fluxo síncrono corrigido atende análises de até ~40 s. Acima disso, o resultado
continua sendo um `AI_TIMEOUT` honesto, sem que a plataforma derrube a função.

## Verificação

- `npm test`: 215 testes, 213 aprovados e 2 ignorados (já ignorados antes).
  Os testes de regressão estão em `tests/case-analysis-budget.test.ts`.
- `tests/e2e/analyze-case.repro.mjs` (app compilado + Supabase/OpenAI falsos):
  - código antigo, `slow-model`: 504 `AI_TIMEOUT` em 37,0 s, com a mesma
    sequência de logs de produção;
  - código novo, `slow-model`: 200 em 38,2 s, análise e foto gravadas no caso;
  - com a tabela, `durable-slow-model` (modelo de 70 s): 202 e depois
    `completed`, com 1 chamada ao modelo;
  - clique duplo: 409, ou o mesmo job reaproveitado; 429 → `AI_UNAVAILABLE`;
    JSON inválido → `AI_INVALID_RESPONSE`; outro usuário → 404.
- `tests/e2e/casos.e2e.mjs`: 25/25 cenários, com e sem a tabela de jobs,
  incluindo Android, iPhone, tablet e desktop.
