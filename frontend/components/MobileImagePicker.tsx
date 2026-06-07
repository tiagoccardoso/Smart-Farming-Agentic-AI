"use client";

import { ChangeEvent, useRef } from "react";

type MobileImagePickerProps = {
  accept?: string;
  cameraAccept?: string;
  multiple?: boolean;
  disabled?: boolean;
  galleryLabel?: string;
  cameraLabel?: string;
  galleryAriaLabel?: string;
  cameraAriaLabel?: string;
  className?: string;
  buttonClassName?: string;
  capture?: boolean | "user" | "environment";
  onGalleryChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onCameraChange?: (event: ChangeEvent<HTMLInputElement>) => void;
};

const defaultButtonClass =
  "inline-flex min-h-11 w-full items-center justify-center rounded-full border border-leaf-200 bg-white px-4 py-2 text-sm font-bold text-leaf-700 transition hover:bg-leaf-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto";

export default function MobileImagePicker({
  accept = "image/*",
  cameraAccept = "image/*",
  multiple = false,
  disabled = false,
  galleryLabel = "Selecionar imagem",
  cameraLabel = "Tirar foto",
  galleryAriaLabel,
  cameraAriaLabel,
  className = "",
  buttonClassName = "",
  capture = "environment",
  onGalleryChange,
  onCameraChange,
}: MobileImagePickerProps) {
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const buttonClass = `${defaultButtonClass} ${buttonClassName}`.trim();

  function handleGalleryChange(event: ChangeEvent<HTMLInputElement>) {
    onGalleryChange(event);
    event.currentTarget.value = "";
  }

  function handleCameraChange(event: ChangeEvent<HTMLInputElement>) {
    (onCameraChange ?? onGalleryChange)(event);
    event.currentTarget.value = "";
  }

  return (
    <div className={`grid gap-2 sm:flex sm:flex-wrap ${className}`.trim()}>
      <input
        ref={galleryInputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={handleGalleryChange}
        className="sr-only"
        aria-label={galleryAriaLabel ?? galleryLabel}
        disabled={disabled}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept={cameraAccept}
        capture={capture}
        onChange={handleCameraChange}
        className="sr-only"
        aria-label={cameraAriaLabel ?? cameraLabel}
        disabled={disabled}
      />
      <button
        type="button"
        onClick={() => galleryInputRef.current?.click()}
        disabled={disabled}
        className={buttonClass}
      >
        {galleryLabel}
      </button>
      <button
        type="button"
        onClick={() => cameraInputRef.current?.click()}
        disabled={disabled}
        className={buttonClass}
      >
        {cameraLabel}
      </button>
    </div>
  );
}
