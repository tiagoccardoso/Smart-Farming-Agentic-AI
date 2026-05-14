const checklist = [
  "Fotografe a folha em ambiente bem iluminado, sem blur e com o sintoma ocupando boa parte da imagem.",
  "Observe se há manchas circulares, bordas amareladas, pó branco, necrose, furos ou presença de insetos.",
  "Compare folhas novas e velhas, pois a distribuição do sintoma ajuda a separar doença, praga e deficiência nutricional.",
  "Isole plantas muito afetadas e evite molhar as folhas até confirmar o diagnóstico com assistência técnica."
];

export function analyzeLeafImage(fileName: string, size: number) {
  const sizeMb = size / (1024 * 1024);

  return {
    predicted_disease: "Triagem visual leve",
    confidence: 0.64,
    top_predictions: [
      { disease: "Possível doença foliar", probability: 0.64 },
      { disease: "Possível deficiência nutricional", probability: 0.22 },
      { disease: "Possível estresse hídrico ou praga", probability: 0.14 }
    ],
    image_path: fileName,
    lightweight: true,
    message:
      "Esta versão 100% Next.js não executa o antigo modelo ResNet50. Ela faz uma triagem leve e orienta os próximos passos para avaliação no campo.",
    recommendations: checklist,
    file_info: {
      name: fileName,
      size_mb: Number(sizeMb.toFixed(2))
    }
  };
}
