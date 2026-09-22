"use client";

/**
 * Anexos (fotos e audio) de uma solicitacao de Contato/Orcamento na area
 * administrativa. Os arquivos ficam em bucket privado: as URLs assinadas
 * (validas por 10 minutos) so sao geradas quando o anexo e aberto.
 */

import { useState } from "react";
import { formatBytes, formatDuration } from "../../lib/public-requests/config";
import { getCurrentAuthSession } from "../../lib/supabaseAuth";

type SignedAttachment = {
  kind: "image" | "audio";
  mime_type: string;
  size_bytes: number;
  original_name: string;
  duration_seconds: number | null;
  url: string | null;
};

export default function RequestAttachmentsViewer({ requestId, count }: { requestId: string; count: number }) {
  const [items, setItems] = useState<SignedAttachment[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (count <= 0) return null;

  async function load() {
    if (loading) return;
    setLoading(true);
    setError("");

    try {
      const session = await getCurrentAuthSession();
      if (!session?.access_token) throw new Error("Sessão expirada. Faça login novamente.");
      const response = await fetch(`/api/admin/public-request-attachments?id=${encodeURIComponent(requestId)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store"
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Não foi possível carregar os anexos.");
      setItems(Array.isArray(payload?.attachments) ? payload.attachments : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar os anexos.");
    } finally {
      setLoading(false);
    }
  }

  const images = (items ?? []).filter((item) => item.kind === "image");
  const audios = (items ?? []).filter((item) => item.kind === "audio");

  return (
    <div className="mt-3 min-w-0">
      <button
        type="button"
        onClick={load}
        disabled={loading}
        className="inline-flex min-h-10 items-center rounded-full border border-leaf-200 bg-white px-4 py-2 text-sm font-bold text-leaf-700 hover:bg-leaf-50 disabled:opacity-60"
      >
        {loading ? "Carregando anexos..." : items ? "Atualizar anexos" : `Ver anexos (${count})`}
      </button>
      {error ? <p className="mt-2 text-sm text-red-700" role="alert">{error}</p> : null}

      {items ? (
        <div className="mt-3 grid gap-3">
          {images.length > 0 ? (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {images.map((item, index) => (
                <li key={`${item.original_name}-${index}`} className="min-w-0 overflow-hidden rounded-2xl border border-leaf-100 bg-leaf-50">
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noopener noreferrer" className="block aspect-square">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.url} alt={item.original_name} className="h-full w-full object-cover" />
                    </a>
                  ) : (
                    <p className="p-3 text-xs text-red-700">Arquivo indisponível.</p>
                  )}
                  <p className="truncate px-2 py-1 text-[11px] text-slate-600" title={item.original_name}>
                    {item.original_name} · {formatBytes(item.size_bytes)}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
          {audios.map((item, index) => (
            <div key={`${item.original_name}-${index}`} className="rounded-2xl border border-leaf-100 bg-leaf-50 p-3">
              {item.url ? (
                <audio controls preload="none" src={item.url} className="w-full">
                  <track kind="captions" />
                </audio>
              ) : (
                <p className="text-xs text-red-700">Áudio indisponível.</p>
              )}
              <p className="mt-1 text-xs text-slate-600">
                Mensagem de voz{item.duration_seconds ? ` · ${formatDuration(item.duration_seconds)}` : ""} · {formatBytes(item.size_bytes)}
              </p>
            </div>
          ))}
          <p className="text-xs text-slate-500">Links temporários (10 minutos). Clique em &quot;Atualizar anexos&quot; se expirarem.</p>
        </div>
      ) : null}
    </div>
  );
}
