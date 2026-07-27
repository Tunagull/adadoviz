import { useRef, useState } from "react";
import { LogoCropModal } from "./LogoCropModal";

function initialLetter(name) {
  const t = String(name || "").trim();
  return t ? t.charAt(0).toUpperCase() : "?";
}

/**
 * Logo preview + file picker + circular cropper.
 * Calls onChange(logoDataUrl | null).
 */
export function BusinessLogoField({ logoUrl, name, onChange }) {
  const fileRef = useRef(null);
  const [cropSrc, setCropSrc] = useState(null);

  const openPicker = () => fileRef.current?.click();

  const onFileChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setCropSrc(reader.result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs text-slate-400 font-medium">İŞLETME LOGOSU</label>
      <div className="flex items-center gap-4">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt="Logo"
            className="h-16 w-16 shrink-0 rounded-full object-cover bg-white shadow-sm ring-2 ring-slate-700"
          />
        ) : (
          <div
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xl font-bold text-teal-300 ring-2 ring-slate-700"
            aria-hidden
          >
            {initialLetter(name)}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={openPicker}
            className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-teal-500/50 hover:text-teal-300"
          >
            Logoyu Değiştir
          </button>
          {logoUrl && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-300 transition hover:bg-rose-500/20"
            >
              Kaldır
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onFileChange}
        />
      </div>

      {cropSrc && (
        <LogoCropModal
          imageSrc={cropSrc}
          onClose={() => setCropSrc(null)}
          onConfirm={(dataUrl) => {
            onChange(dataUrl);
            setCropSrc(null);
          }}
        />
      )}
    </div>
  );
}
