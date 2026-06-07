"use client";

import { useEffect, useState } from "react";
import MobileImagePicker from "./MobileImagePicker";

type Props = {
  file: File | null;
  onChange: (file: File | null) => void;
};

export default function FileUploader({ file, onChange }: Props) {
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");

  useEffect(() => {
    if (!file) {
      setPreviewUrl("");
      return;
    }

    const nextPreviewUrl = URL.createObjectURL(file);
    setPreviewUrl(nextPreviewUrl);

    return () => URL.revokeObjectURL(nextPreviewUrl);
  }, [file]);

  function selectImage(nextFile: File | null) {
    setError("");

    if (!nextFile) {
      onChange(null);
      return;
    }

    if (!nextFile.type.startsWith("image/")) {
      setError("Formato inválido. Selecione ou tire uma foto em formato de imagem.");
      onChange(null);
      return;
    }

    onChange(nextFile);
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-leaf-200 bg-white p-6 text-sm text-slate-600">
      <MobileImagePicker
        accept="image/*"
        cameraAccept="image/*"
        galleryLabel="Selecionar imagem"
        cameraLabel="Tirar foto"
        onGalleryChange={(event) => selectImage(event.target.files?.[0] ?? null)}
        onCameraChange={(event) => selectImage(event.target.files?.[0] ?? null)}
      />
      {error && <div className="rounded-xl bg-red-50 p-3 text-red-700">{error}</div>}
      {file && (
        <div className="rounded-xl bg-leaf-50 p-3 text-slate-700">
          <p className="break-all">Selecionado: {file.name}</p>
          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="Pré-visualização da imagem" className="mt-3 max-h-48 w-full rounded-xl object-cover" />
          )}
          <button
            type="button"
            onClick={() => selectImage(null)}
            className="mt-3 rounded-full bg-white px-3 py-1 text-xs font-bold text-red-700 ring-1 ring-red-100 hover:bg-red-50"
          >
            Remover imagem
          </button>
        </div>
      )}
    </div>
  );
}
