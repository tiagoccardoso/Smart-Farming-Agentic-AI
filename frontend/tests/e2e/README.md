# E2E — casos agronômicos (Consultoria IA + Painel da Doutora)

Roda o app **compilado** contra um Supabase falso em memória (PostgREST, Auth e
Storage) e uma OpenAI falsa (`/openai/v1/responses`, no mesmo servidor), sem
rede externa. A OpenAI falsa responde citando a pergunta atual, o que permite
verificar que cada pergunta do chat gera uma resposta própria.
O Supabase falso reproduz a RLS real de UPDATE em `agronomic_cases`, que era a
causa das edições perdidas em casos enviados para parecer.

Não faz parte do `npm test` (não adiciona dependências ao projeto).

```bash
cd frontend/tests/e2e
python make-assets.py                      # Pillow + ffmpeg
node fake-supabase.mjs &                   # porta 54321

cd ../..
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=anon-key-e2e npx next build
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=anon-key-e2e \
SUPABASE_SERVICE_ROLE_KEY=service-key-e2e OPENAI_API_KEY=fake OPENAI_BASE_URL=http://127.0.0.1:54321/openai/v1 \
npx next start -p 3100 &

cd tests/e2e
npx -y playwright@1.56.0 install chromium  # uma vez
PLAYWRIGHT_MODULE=$(npm root -g)/playwright node casos.e2e.mjs
```

Atenção: o build com a URL local serve só para o teste. Refaça o build normal
antes de publicar. Capturas de tela ficam em `shots/` e o resultado em
`results.json` (ambos fora do git).

Cenários: abertura sem rolagem e logo abaixo do cartão, recolher/reabrir,
estabilidade ao trocar de cartão, filtros/paginação, seções da análise e fontes,
chat com texto/foto/áudio, falha da IA com "Tentar novamente" sem duplicar,
histórico após recarregar e isolamento entre casos, edição com foto grande
compactada e remoção de foto, aviso "Novas informações" + atualização da
análise, falha de rede e de storage sem sucesso falso, confirmação ao fechar com
alterações, caso legado sem propriedade, Painel da Doutora (linha do tempo,
"Após a solicitação", "Novo") e responsividade em Android, iPhone (emulado no
Chromium), tablet e desktop.
