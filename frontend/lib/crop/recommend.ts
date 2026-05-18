export type CropInput = {
  N: number;
  P: number;
  K: number;
  temperature: number;
  humidity: number;
  ph: number;
  rainfall: number;
};

export type CropRecommendation = {
  recommended_crop: string;
  confidence: number;
  top_3_recommendations: Array<{ crop: string; probability: number }>;
  input_conditions: CropInput;
  explanation: string;
};

type CropRule = {
  crop: string;
  ideal: Partial<Record<keyof CropInput, [number, number]>>;
  description: string;
};

const cropRules: CropRule[] = [
  {
    crop: "rice",
    ideal: { N: [70, 120], P: [30, 60], K: [30, 60], temperature: [20, 32], humidity: [75, 95], ph: [5.5, 7], rainfall: [150, 300] },
    description: "boa adaptação a alta umidade e maior disponibilidade de água"
  },
  {
    crop: "maize",
    ideal: { N: [60, 120], P: [35, 70], K: [30, 70], temperature: [18, 30], humidity: [50, 80], ph: [5.8, 7.2], rainfall: [60, 160] },
    description: "equilíbrio entre temperatura amena, fertilidade e chuva moderada"
  },
  {
    crop: "cotton",
    ideal: { N: [80, 140], P: [35, 70], K: [40, 90], temperature: [24, 36], humidity: [40, 70], ph: [6, 8], rainfall: [50, 120] },
    description: "clima quente, pH próximo do neutro e menor excesso de umidade"
  },
  {
    crop: "mango",
    ideal: { N: [50, 100], P: [40, 90], K: [50, 100], temperature: [18, 29], humidity: [55, 80], ph: [5.8, 7], rainfall: [50, 140] },
    description: "bom balanço de potássio, pH levemente ácido e umidade controlada"
  },
  {
    crop: "lentil",
    ideal: { N: [40, 90], P: [25, 60], K: [20, 55], temperature: [10, 24], humidity: [40, 70], ph: [6, 7.8], rainfall: [40, 110] },
    description: "temperaturas mais baixas e umidade moderada"
  },
  {
    crop: "kidneybeans",
    ideal: { N: [20, 70], P: [30, 70], K: [25, 70], temperature: [18, 30], humidity: [50, 75], ph: [5.8, 7.2], rainfall: [60, 160] },
    description: "condições equilibradas de solo, pH e chuva"
  },
  {
    crop: "chickpea",
    ideal: { N: [60, 120], P: [40, 90], K: [70, 140], temperature: [12, 24], humidity: [60, 85], ph: [5, 6.5], rainfall: [50, 140] },
    description: "temperatura mais amena, boa umidade e maior demanda por potássio"
  },
  {
    crop: "coffee",
    ideal: { N: [80, 160], P: [30, 70], K: [80, 180], temperature: [22, 34], humidity: [60, 85], ph: [5.5, 7.5], rainfall: [120, 260] },
    description: "clima quente, boa chuva e alta disponibilidade de nutrientes"
  }
];

function scoreRange(value: number, min: number, max: number) {
  if (value >= min && value <= max) return 1;

  const span = Math.max(max - min, 1);
  const distance = value < min ? min - value : value - max;
  return Math.max(0, 1 - distance / span);
}

function cropScore(input: CropInput, rule: CropRule) {
  const entries = Object.entries(rule.ideal) as Array<[keyof CropInput, [number, number]]>;
  const baseScore = entries.reduce((sum, [key, [min, max]]) => sum + scoreRange(input[key], min, max), 0) / entries.length;

  const soilFertility = (input.N + input.P + input.K) / 3;
  const climateIndex = (input.temperature * input.humidity) / 100;
  const moistureIndex = (input.rainfall * input.humidity) / 100;

  const bonus =
    (soilFertility >= 35 && soilFertility <= 120 ? 0.03 : 0) +
    (climateIndex >= 10 && climateIndex <= 28 ? 0.02 : 0) +
    (moistureIndex >= 30 && moistureIndex <= 240 ? 0.02 : 0);

  return Math.min(1, baseScore + bonus);
}

export function recommendCrop(input: CropInput): CropRecommendation {
  const ranked = cropRules
    .map((rule) => ({ rule, score: cropScore(input, rule) }))
    .sort((a, b) => b.score - a.score);

  const top = ranked.slice(0, 3);
  const total = top.reduce((sum, item) => sum + item.score, 0) || 1;
  const confidence = Math.max(0.52, Math.min(0.94, top[0].score));

  return {
    recommended_crop: top[0].rule.crop,
    confidence,
    top_3_recommendations: top.map((item) => ({
      crop: item.rule.crop,
      probability: Math.max(0.03, item.score / total)
    })),
    input_conditions: input,
    explanation: `A cultura ${top[0].rule.crop} foi priorizada por apresentar ${top[0].rule.description} para os valores informados.`
  };
}

export function validateCropInput(input: Partial<CropInput>) {
  const validations: Record<keyof CropInput, [number, number, string]> = {
    N: [0, 300, "Nitrogênio (kg/ha)"],
    P: [0, 150, "Fósforo (kg/ha)"],
    K: [0, 200, "Potássio (kg/ha)"],
    temperature: [-50, 60, "Temperatura (°C)"],
    humidity: [0, 100, "Umidade (%)"],
    ph: [3, 10, "pH do solo"],
    rainfall: [0, 5000, "Chuva (mm)"]
  };

  const errors: Record<string, string> = {};

  for (const [field, [min, max, label]] of Object.entries(validations)) {
    const value = input[field as keyof CropInput];
    if (typeof value !== "number" || Number.isNaN(value)) {
      errors[field] = `${label} precisa ser um número válido.`;
      continue;
    }
    if (value < min || value > max) {
      errors[field] = `${label} deve ficar entre ${min} e ${max}.`;
    }
  }

  return errors;
}
