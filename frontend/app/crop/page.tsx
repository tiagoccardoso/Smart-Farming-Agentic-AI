"use client";

import { useEffect, useState } from "react";
import InputField from "../../components/InputField";
import SectionTitle from "../../components/SectionTitle";
import ConfidenceBar from "../../components/ConfidenceBar";
import TopKList from "../../components/TopKList";
import { recommendCrop } from "../../lib/api";
import { toNumber } from "../../lib/validators";
import {
  normalizeRecommendationResult,
  type CropRecord,
  type CropRecommendationLike,
} from "../../lib/crop/normalization";

export default function CropPage() {
  const [form, setForm] = useState({
    N: "90",
    P: "42",
    K: "43",
    temperature: "20",
    humidity: "82",
    ph: "6.5",
    rainfall: "202",
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CropRecommendationLike & { confidence?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CropRecord[]>([]);

  useEffect(() => {
    fetch("/api/crops")
      .then((response) => response.json())
      .then((payload) => setCatalog(payload.crops ?? []))
      .catch(() => setCatalog([]));
  }, []);

  const handleChange = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);

    try {
      const payload = {
        N: toNumber(form.N),
        P: toNumber(form.P),
        K: toNumber(form.K),
        temperature: toNumber(form.temperature),
        humidity: toNumber(form.humidity),
        ph: toNumber(form.ph),
        rainfall: toNumber(form.rainfall),
      };
      const response = await recommendCrop(payload);
      setResult(normalizeRecommendationResult(response?.data ?? response, catalog));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível gerar a recomendação.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-14">
      <SectionTitle
        title="Recomendação de culturas"
        subtitle="Informe dados de solo e clima para receber uma sugestão leve em Next.js."
      />

      <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
          <div className="grid gap-4 md:grid-cols-2">
            <InputField
              label="Nitrogênio (N)"
              name="N"
              value={form.N}
              onChange={(val) => handleChange("N", val)}
            />
            <InputField
              label="Fósforo (P)"
              name="P"
              value={form.P}
              onChange={(val) => handleChange("P", val)}
            />
            <InputField
              label="Potássio (K)"
              name="K"
              value={form.K}
              onChange={(val) => handleChange("K", val)}
            />
            <InputField
              label="Temperatura (°C)"
              name="temperature"
              value={form.temperature}
              onChange={(val) => handleChange("temperature", val)}
            />
            <InputField
              label="Umidade (%)"
              name="humidity"
              value={form.humidity}
              onChange={(val) => handleChange("humidity", val)}
            />
            <InputField
              label="pH do solo"
              name="ph"
              value={form.ph}
              onChange={(val) => handleChange("ph", val)}
            />
            <InputField
              label="Chuva (mm)"
              name="rainfall"
              value={form.rainfall}
              onChange={(val) => handleChange("rainfall", val)}
            />
          </div>
          <button
            onClick={handleSubmit}
            className="mt-6 w-full rounded-full bg-leaf-600 px-6 py-3 text-sm font-semibold text-white shadow-soft hover:bg-leaf-700"
            disabled={loading}
          >
            {loading ? "Calculando..." : "Gerar recomendação"}
          </button>
          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        </div>

        <div className="rounded-3xl border border-leaf-100 bg-white p-6 shadow-soft">
          {catalog.length > 0 && (
            <div className="mb-6 rounded-2xl bg-leaf-50 p-4">
              <p className="text-sm font-semibold text-leaf-800">
                Base de culturas integrada à IA
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {catalog.slice(0, 8).map((crop) => (
                  <span
                    key={crop.id}
                    className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-leaf-100"
                  >
                    {crop.display_name_pt || crop.name}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-600">
                Quando um caso usa uma cultura cadastrada, a consultoria IA
                considera clima, solo, ciclo, riscos, doenças, pragas e manejo
                registrados no Painel da Doutora.
              </p>
            </div>
          )}
          {result ? (
            <div className="space-y-5">
              <div>
                <p className="text-sm text-slate-500">Cultura recomendada</p>
                <h3 className="text-2xl font-semibold text-leaf-700">
                  {result?.recommended_crop ?? "Não identificada"}
                </h3>
              </div>
              <ConfidenceBar value={result?.confidence ?? 0} />
              <div>
                <p className="mb-2 text-sm font-semibold text-slate-700">
                  Melhores alternativas
                </p>
                <TopKList
                  items={(result?.top_3_recommendations ?? []).map(
                    (item) => ({
                      label: item.crop,
                      value: item.probability,
                    }),
                  )}
                />
              </div>
              {result?.explanation && (
                <div className="rounded-2xl bg-leaf-50 p-4 text-xs text-slate-700">
                  {result.explanation}
                </div>
              )}
              <div className="rounded-2xl bg-sun-50 p-4 text-xs text-slate-700">
                Dica: use análise de solo recente e dados climáticos locais para
                melhorar a qualidade da recomendação.
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-500">
              Os resultados aparecerão aqui após o envio do formulário.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
