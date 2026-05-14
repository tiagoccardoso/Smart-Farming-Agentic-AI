# 🌾 Guia rápido — Consultor Agrícola IA 100% Next.js

Esta é a versão leve do projeto, traduzida para português BR e preparada para rodar sem backend Flask/Python.

## Como iniciar

```bash
cd frontend
npm install
npm run dev
```

Abra no navegador:

```text
http://localhost:3000
```

## Como testar

### 1. Recomendação de culturas

1. Acesse `/crop`.
2. Informe N, P, K, temperatura, umidade, pH e chuva.
3. Clique em **Gerar recomendação**.
4. Veja a cultura recomendada, confiança e alternativas.

### 2. Triagem de folhas

1. Acesse `/disease`.
2. Envie uma imagem de folha.
3. Clique em **Fazer triagem**.
4. Veja hipóteses iniciais e próximos passos.

### 3. Perguntas agrícolas

1. Acesse `/qa`.
2. Faça uma pergunta, por exemplo: `Com que frequência devo irrigar tomateiros?`.
3. Veja a resposta e os trechos de conhecimento usados.

## Build de produção

```bash
cd frontend
npm run build
```

## Deploy na Vercel

- Root Directory: `frontend`
- Install Command: `npm install`
- Build Command: `npm run build`

Não é necessário subir Flask nem configurar URL externa de API.
