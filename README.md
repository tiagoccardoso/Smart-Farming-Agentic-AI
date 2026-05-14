# 🌾 Consultor Agrícola IA — versão leve 100% Next.js

Aplicação web em **português do Brasil** para apoiar decisões agrícolas com uma arquitetura leve e pronta para deploy na Vercel. O projeto foi convertido para usar o **Next.js App Router** como frontend e backend, substituindo o fluxo Flask/Python por **Route Handlers internos**.

> Observação: o backend Python original continua no repositório como legado/referência, mas não é necessário para rodar a versão principal em Next.js.

---

## ✨ O que a aplicação faz

- 🌱 **Recomendação de culturas**: sugere culturas com base em NPK, temperatura, umidade, pH e chuva.
- 🍃 **Triagem de folhas/doenças**: recebe imagem da folha e retorna uma orientação inicial leve, sem modelo pesado local.
- ❓ **Perguntas agrícolas**: responde dúvidas comuns usando uma base local em TypeScript.
- 🚀 **Deploy simplificado**: roda apenas com Next.js, sem Flask, PyTorch, TensorFlow, FAISS ou arquivos grandes de modelo.
- 🇧🇷 **Interface traduzida**: telas, menus e mensagens em português BR.

---

## 🧭 Arquitetura atual

```text
Usuário no navegador
        ↓
Next.js App Router
        ↓
Route Handlers internos
        ↓
TypeScript leve:
  - regras de recomendação de culturas
  - triagem orientativa de folhas
  - base local de conhecimento agrícola
        ↓
Resposta em português
```

Rotas internas principais:

- `POST /api/crop/recommend`
- `POST /api/crop/validate`
- `POST /api/disease/predict`
- `POST /api/qa`

---

## 🧰 Stack principal

- Next.js 14
- React 18
- TypeScript
- Tailwind CSS
- Route Handlers do Next.js

---

## 🚀 Como rodar localmente

```bash
cd frontend
npm install
npm run dev
```

Acesse:

```text
http://localhost:3000
```

---

## ✅ Como fazer build

```bash
cd frontend
npm run build
```

---

## ☁️ Deploy na Vercel

1. Suba o repositório para GitHub, GitLab ou Bitbucket.
2. Crie um novo projeto na Vercel.
3. Configure o **Root Directory** como:

```text
frontend
```

4. Use as configurações padrão de Next.js:

```text
Install Command: npm install
Build Command: npm run build
Output: gerenciado pelo Next.js
```

5. Faça o deploy.

Não é necessário configurar `NEXT_PUBLIC_API_BASE`, porque o frontend agora chama rotas relativas internas, como `/api/crop/recommend`.

---

## 📁 Estrutura relevante

```text
frontend/
├── app/
│   ├── api/
│   │   ├── crop/recommend/route.ts
│   │   ├── crop/validate/route.ts
│   │   ├── disease/predict/route.ts
│   │   └── qa/route.ts
│   ├── crop/page.tsx
│   ├── disease/page.tsx
│   ├── qa/page.tsx
│   └── page.tsx
├── components/
├── data/
│   └── knowledge-base.ts
└── lib/
    ├── api.ts
    ├── crop/recommend.ts
    ├── disease/analyze.ts
    └── qa/search.ts
```

---

## ⚠️ Limitações da versão leve

Esta versão prioriza simplicidade, rapidez e deploy fácil na Vercel. Por isso:

- A recomendação de culturas usa regras leves em TypeScript, não o Random Forest Python original.
- A triagem de doenças é orientativa e não executa o antigo modelo ResNet50.
- O Q&A usa uma base local simples em vez de FAISS/Sentence Transformers.

Para uso real em produção agrícola, valide recomendações com análise de solo, dados locais e acompanhamento de um profissional de agronomia.

---

## 🔮 Próximos passos possíveis

- Integrar API externa de visão para diagnóstico de doenças.
- Adicionar banco de dados para histórico de consultas.
- Usar LLM ou embeddings externos para melhorar o Q&A.
- Exportar relatórios por propriedade/talhão.
- Adicionar autenticação de usuários.
