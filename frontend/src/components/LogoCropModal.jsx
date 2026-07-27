import { useCallback, useState } from "react";
import Cropper from "react-easy-crop";
import { X } from "lucide-react";

async function createImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", (error) => reject(error));
    image.setAttribute("crossOrigin", "anonymous");
    image.src = url;
  });
}

/**
 * Crop to the selected 1:1 area and export as JPEG data URL (256×256).
 * Circular display is handled with CSS rounded-full on the dashboard.
 */
export async function getCroppedImg(imageSrc, pixelCrop, outputSize = 256) {
  const image = await createImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas desteklenmiyor.");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, outputSize, outputSize);

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    outputSize,
    outputSize
  );

  return canvas.toDataURL("image/jpeg", 0.85);
}

export function LogoCropModal({ imageSrc, onConfirm, onClose }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const onCropComplete = useCallback((_croppedArea, pixels) => {
    setCroppedAreaPixels(pixels);
  }, []);

  const handleConfirm = async () => {
    if (!croppedAreaPixels) return;
    setBusy(true);
    setError("");
    try {
      const dataUrl = await getCroppedImg(imageSrc, croppedAreaPixels, 256);
      onConfirm(dataUrl);
    } catch (err) {
      setError(err.message || "Kırpma başarısız.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        className="relative bg-slate-900 border border-slate-700 rounded-2xl p-4 md:p-6 w-[95%] md:w-full max-w-lg shadow-2xl flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <X
          size={24}
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-rose-500 cursor-pointer transition-colors z-10"
          aria-label="Kapat"
        />

        <div className="pr-8">
          <h3 className="text-lg font-bold text-slate-100">Logoyu Kırp</h3>
          <p className="mt-1 text-sm text-slate-400">
            Görseli sürükleyip yakınlaştırarak yuvarlak alana oturtun.
          </p>
        </div>

        <div className="relative h-72 w-full overflow-hidden rounded-xl bg-slate-950">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-slate-400">Zoom</label>
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-full accent-teal-500"
          />
        </div>

        {error && <p className="text-sm text-rose-400">{error}</p>}

        <button
          type="button"
          onClick={handleConfirm}
          disabled={busy || !croppedAreaPixels}
          className="rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-500 disabled:opacity-60"
        >
          {busy ? "İşleniyor..." : "Kırpmayı Onayla"}
        </button>
      </div>
    </div>
  );
}
