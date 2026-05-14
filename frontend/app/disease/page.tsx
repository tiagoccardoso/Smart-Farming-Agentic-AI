"use client";

import { useState } from "react";
import SectionTitle from "../../components/SectionTitle";
import FileUploader from "../../components/FileUploader";
import ConfidenceBar from "../../components/ConfidenceBar";
import TopKList from "../../components/TopKList";
import { detectDisease } from "../../lib/api";

export default function DiseasePage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!file) {
      setError("Envie uma imagem de folha.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await detectDisease(file);
      setResult(response?.data ?? response);
    } catch (err: any) {
      setError(err?.message ?? "Não foi possível analisar a imagem.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-14">
      <SectionTitle title="Triagem de doenças" subtitle="Envie uma foto da folha para receber uma orientação inicial leve." />

      <div className="mb-8 rounded-2xl border border-sun-200 bg-sun-50 p-4 text-sm text-slate-700">
        Esta versão 100% Next.js substitui o antigo modelo pesado ResNet50 por uma triagem orientativa. Para diagnóstico final,
        valide com assistência técnica ou laboratório fitossanitário.
      </div>

      <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
          <FileUploader file={file} onChange={setFile} />
          <button
            onClick={handleSubmit}
            className="mt-6 w-full rounded-full bg-leaf-600 px-6 py-3 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700"
            disabled={loading}
          >
            {loading ? "Analisando..." : "Fazer triagem"}
          </button>
          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        </div>

        <div className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
          {result ? (
            <div className="space-y-5">
              <div>
                <p className="text-sm text-slate-500">Resultado da triagem</p>
                <h3 className="text-2xl font-semibold text-leaf-700">{result?.predicted_disease ?? "Não identificado"}</h3>
              </div>
              <ConfidenceBar value={result?.confidence ?? 0} />
              <div>
                <p className="mb-2 text-sm font-semibold text-slate-700">Hipóteses iniciais</p>
                <TopKList
                  items={(result?.top_predictions ?? []).map((item: any) => ({
                    label: item.disease,
                    value: item.probability
                  }))}
                />
              </div>
              {result?.message && (
                <div className="rounded-2xl bg-sun-50 p-4 text-xs text-slate-700">
                  {result.message}
                </div>
              )}
              {result?.recommendations && (
                <div className="rounded-2xl bg-leaf-50 p-4 text-xs text-slate-700">
                  <p className="mb-2 font-semibold">Próximos passos</p>
                  <ul className="list-disc space-y-1 pl-4">
                    {result.recommendations.map((item: string) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-slate-500">Os resultados aparecerão aqui após o envio da imagem.</div>
          )}
        </div>
      </div>
    </div>
  );
}
