import { NextResponse } from "next/server";
import { analyzeLeafImage } from "../../../../lib/disease/analyze";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: "Envie uma imagem de folha." }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ success: false, error: "O arquivo precisa ser uma imagem." }, { status: 400 });
    }

    const result = analyzeLeafImage(file.name, file.size);

    return NextResponse.json({
      success: true,
      data: result,
      message: result.message
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: "Não foi possível analisar a imagem." }, { status: 500 });
  }
}
