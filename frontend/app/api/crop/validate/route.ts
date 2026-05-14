import { NextResponse } from "next/server";
import { validateCropInput, type CropInput } from "../../../../lib/crop/recommend";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Partial<CropInput>;
    const errors = validateCropInput(payload);

    return NextResponse.json({ success: Object.keys(errors).length === 0, errors });
  } catch (error) {
    return NextResponse.json({ success: false, error: "Não foi possível validar os dados." }, { status: 500 });
  }
}
