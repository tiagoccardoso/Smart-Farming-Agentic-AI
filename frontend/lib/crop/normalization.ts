export type CropRecord = {
  id?: string;
  name: string;
  slug?: string | null;
  aliases?: string[] | null;
  model_label?: string | null;
  display_name_pt?: string | null;
  display_name_en?: string | null;
  scientific_name?: string | null;
  recommended_soil?: string | null;
  ideal_climate?: string | null;
  common_diseases?: string | null;
  common_pests?: string | null;
  growth_cycle?: string | null;
  irrigation_notes?: string | null;
  fertilization_notes?: string | null;
  recommended_region?: string | null;
  known_risks?: string | null;
  management_notes?: string | null;
  active?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type NormalizedCrop = {
  slug: string;
  name: string;
  displayNamePt: string;
  displayNameEn: string | null;
  modelLabel: string | null;
  aliases: string[];
  record?: CropRecord;
};

type StaticCrop = {
  slug: string;
  name: string;
  display_name_pt: string;
  display_name_en: string;
  model_label: string | null;
  aliases: string[];
};

export const STATIC_CROP_CATALOG: StaticCrop[] = [
  { slug: "maca", name: "Maçã", display_name_pt: "Maçã", display_name_en: "Apple", model_label: "apple", aliases: ["maca", "maçã", "apple"] },
  { slug: "banana", name: "Banana", display_name_pt: "Banana", display_name_en: "Banana", model_label: "banana", aliases: ["banana"] },
  { slug: "feijao-preto", name: "Feijão-preto / Black gram", display_name_pt: "Feijão-preto / Black gram", display_name_en: "Black gram", model_label: "blackgram", aliases: ["feijao preto", "feijão preto", "blackgram", "black gram", "urad"] },
  { slug: "grao-de-bico", name: "Grão-de-bico", display_name_pt: "Grão-de-bico", display_name_en: "Chickpea", model_label: "chickpea", aliases: ["grao de bico", "grão de bico", "grao-de-bico", "grão-de-bico", "chickpea"] },
  { slug: "coco", name: "Coco", display_name_pt: "Coco", display_name_en: "Coconut", model_label: "coconut", aliases: ["coco", "coconut"] },
  { slug: "cafe", name: "Café", display_name_pt: "Café", display_name_en: "Coffee", model_label: "coffee", aliases: ["cafe", "café", "coffee"] },
  { slug: "algodao", name: "Algodão", display_name_pt: "Algodão", display_name_en: "Cotton", model_label: "cotton", aliases: ["algodao", "algodão", "cotton"] },
  { slug: "uva", name: "Uva", display_name_pt: "Uva", display_name_en: "Grapes", model_label: "grapes", aliases: ["uva", "uvas", "grape", "grapes"] },
  { slug: "juta", name: "Juta", display_name_pt: "Juta", display_name_en: "Jute", model_label: "jute", aliases: ["juta", "jute"] },
  { slug: "feijao-vermelho", name: "Feijão-vermelho / Kidney bean", display_name_pt: "Feijão-vermelho / Kidney bean", display_name_en: "Kidney bean", model_label: "kidneybeans", aliases: ["feijao vermelho", "feijão vermelho", "kidneybeans", "kidney bean", "kidney beans"] },
  { slug: "lentilha", name: "Lentilha", display_name_pt: "Lentilha", display_name_en: "Lentil", model_label: "lentil", aliases: ["lentilha", "lentil"] },
  { slug: "milho", name: "Milho", display_name_pt: "Milho", display_name_en: "Maize", model_label: "maize", aliases: ["milho", "maize", "corn"] },
  { slug: "manga", name: "Manga", display_name_pt: "Manga", display_name_en: "Mango", model_label: "mango", aliases: ["manga", "mango"] },
  { slug: "feijao-moth", name: "Feijão-moth / Moth bean", display_name_pt: "Feijão-moth / Moth bean", display_name_en: "Moth bean", model_label: "mothbeans", aliases: ["feijao moth", "feijão moth", "mothbeans", "moth bean", "moth beans"] },
  { slug: "feijao-mungo", name: "Feijão-mungo", display_name_pt: "Feijão-mungo", display_name_en: "Mung bean", model_label: "mungbean", aliases: ["feijao mungo", "feijão mungo", "mungbean", "mung bean"] },
  { slug: "melao", name: "Melão", display_name_pt: "Melão", display_name_en: "Muskmelon", model_label: "muskmelon", aliases: ["melao", "melão", "muskmelon", "melon"] },
  { slug: "laranja", name: "Laranja", display_name_pt: "Laranja", display_name_en: "Orange", model_label: "orange", aliases: ["laranja", "orange"] },
  { slug: "mamao", name: "Mamão", display_name_pt: "Mamão", display_name_en: "Papaya", model_label: "papaya", aliases: ["mamao", "mamão", "papaya"] },
  { slug: "feijao-guandu", name: "Feijão-guandu", display_name_pt: "Feijão-guandu", display_name_en: "Pigeon peas", model_label: "pigeonpeas", aliases: ["feijao guandu", "feijão guandu", "guandu", "pigeonpeas", "pigeon peas"] },
  { slug: "roma", name: "Romã", display_name_pt: "Romã", display_name_en: "Pomegranate", model_label: "pomegranate", aliases: ["roma", "romã", "pomegranate"] },
  { slug: "arroz", name: "Arroz", display_name_pt: "Arroz", display_name_en: "Rice", model_label: "rice", aliases: ["arroz", "rice"] },
  { slug: "melancia", name: "Melancia", display_name_pt: "Melancia", display_name_en: "Watermelon", model_label: "watermelon", aliases: ["melancia", "watermelon"] },
  { slug: "soja", name: "Soja", display_name_pt: "Soja", display_name_en: "Soybean", model_label: null, aliases: ["soja", "soy", "soybean", "soya"] },
];

export function normalizeCropText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function toCropSlug(value: string | null | undefined) {
  return normalizeCropText(value).replace(/\s+/g, "-");
}

function recordToNormalizedCrop(record: CropRecord): NormalizedCrop {
  const displayNamePt = record.display_name_pt?.trim() || record.name;
  return {
    slug: record.slug || toCropSlug(displayNamePt),
    name: record.name,
    displayNamePt,
    displayNameEn: record.display_name_en?.trim() || null,
    modelLabel: record.model_label?.trim() || null,
    aliases: Array.isArray(record.aliases) ? record.aliases.filter(Boolean) : [],
    record,
  };
}

function staticToNormalizedCrop(crop: StaticCrop): NormalizedCrop {
  return {
    slug: crop.slug,
    name: crop.name,
    displayNamePt: crop.display_name_pt,
    displayNameEn: crop.display_name_en,
    modelLabel: crop.model_label,
    aliases: crop.aliases,
  };
}

function getLookupValues(crop: NormalizedCrop) {
  return [
    crop.slug,
    crop.name,
    crop.displayNamePt,
    crop.displayNameEn,
    crop.modelLabel,
    ...crop.aliases,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(normalizeCropText);
}

export function normalizeCropInput(
  input: string | null | undefined,
  catalog: CropRecord[] = [],
): NormalizedCrop | null {
  const normalizedInput = normalizeCropText(input);
  if (!normalizedInput) return null;

  const candidates = catalog.length
    ? catalog.map(recordToNormalizedCrop)
    : STATIC_CROP_CATALOG.map(staticToNormalizedCrop);

  return (
    candidates.find((crop) => getLookupValues(crop).includes(normalizedInput)) ??
    candidates.find((crop) =>
      getLookupValues(crop).some(
        (value) => value.includes(normalizedInput) || normalizedInput.includes(value),
      ),
    ) ??
    null
  );
}

export function getCropDisplayName(
  input: string | null | undefined,
  catalog: CropRecord[] = [],
) {
  return normalizeCropInput(input, catalog)?.displayNamePt || input || "Não identificada";
}

export type CropRecommendationLike = {
  recommended_crop?: string | null;
  top_3_recommendations?: Array<{ crop: string; probability: number }>;
  explanation?: string;
};

export function normalizeRecommendationResult<T extends CropRecommendationLike>(
  result: T,
  catalog: CropRecord[] = [],
): T {
  const recommended = getCropDisplayName(result.recommended_crop, catalog);
  const originalRecommended = result.recommended_crop || "";
  const top3 = result.top_3_recommendations?.map((item) => ({
    ...item,
    crop: getCropDisplayName(item.crop, catalog),
  }));

  return {
    ...result,
    recommended_crop: recommended,
    top_3_recommendations: top3,
    explanation: result.explanation?.replace(originalRecommended, recommended),
  };
}
