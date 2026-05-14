import { NextResponse } from "next/server";
import { recommendCrop, validateCropInput, type CropInput } from "../../../../lib/crop/recommend";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as CropInput;
    const errors = validateCropInput(payload);

    if (Object.keys(errors).length > 0) {
      return NextResponse.json({ success: false, errors }, { status: 400 });
    }

    const result = recommendCrop(payload);

    return NextResponse.json({
      success: true,
      data: result,
      message: `Recomendação gerada: ${result.recommended_crop} (${Math.round(result.confidence * 100)}% de confiança).`
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: "Não foi possível gerar a recomendação." }, { status: 500 });
  }
}
