import { knowledgeBase } from "../../data/knowledge-base";

function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function answerQuestion(question: string) {
  const tokens = normalize(question);
  const ranked = knowledgeBase
    .map((item) => {
      const searchable = normalize(`${item.title} ${item.content} ${item.keywords.join(" ")}`);
      const matches = tokens.filter((token) => searchable.includes(token)).length;
      const keywordMatches = item.keywords.filter((keyword) => tokens.includes(normalize(keyword)[0] ?? keyword)).length;
      const score = matches + keywordMatches * 2;
      return { item, score };
    })
    .sort((a, b) => b.score - a.score);

  const retrieved = ranked
    .filter(({ score }) => score > 0)
    .slice(0, 3)
    .map(({ item, score }) => ({
      content: item.content,
      title: item.title,
      relevance_score: Math.min(0.98, 0.45 + score / Math.max(tokens.length * 2, 1))
    }));

  const best = retrieved[0];

  return {
    answer: best
      ? `${best.content} Recomendo usar essa orientação como triagem e validar decisões importantes com um agrônomo local.`
      : "Não encontrei uma resposta específica na base leve. Tente mencionar a cultura, o sintoma ou o manejo desejado, como irrigação, pH, NPK ou doenças em folhas.",
    retrieved_docs: retrieved,
    source: "base-local-nextjs"
  };
}
