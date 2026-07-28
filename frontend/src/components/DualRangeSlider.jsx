import { useState, useRef, useEffect } from "react";

/**
 * DualRangeSlider: Tek track üzerinde iki thumb (min/max)
 * Props:
 *   - min: minimum value (0)
 *   - max: maximum value (1440)
 *   - step: adım (30)
 *   - minValue: mevcut minimum (dakika)
 *   - maxValue: mevcut maximum (dakika)
 *   - onRangeChange: (min, max) callback
 *   - disabled: boolean
 */
export function DualRangeSlider({
  min = 0,
  max = 1440,
  step = 30,
  minValue = 480,
  maxValue = 1020,
  onRangeChange = () => {},
  disabled = false,
}) {
  const [localMin, setLocalMin] = useState(minValue);
  const [localMax, setLocalMax] = useState(maxValue);
  const [draggingMin, setDraggingMin] = useState(false);
  const [draggingMax, setDraggingMax] = useState(false);
  const trackRef = useRef(null);

  // Min/Max sync
  useEffect(() => {
    setLocalMin(minValue);
  }, [minValue]);

  useEffect(() => {
    setLocalMax(maxValue);
  }, [maxValue]);

  const handleMinChange = (newMin) => {
    let value = Math.round(newMin / step) * step;
    value = Math.max(min, Math.min(value, localMax - step));
    setLocalMin(value);
    onRangeChange(value, localMax);
  };

  const handleMaxChange = (newMax) => {
    let value = Math.round(newMax / step) * step;
    value = Math.max(localMin + step, Math.min(value, max));
    setLocalMax(value);
    onRangeChange(localMin, value);
  };

  const handleMinMouseDown = () => {
    if (!disabled) setDraggingMin(true);
  };

  const handleMaxMouseDown = () => {
    if (!disabled) setDraggingMax(true);
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!trackRef.current) return;

      const rect = trackRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, x / rect.width));
      const value = percentage * (max - min) + min;

      if (draggingMin) {
        handleMinChange(value);
      } else if (draggingMax) {
        handleMaxChange(value);
      }
    };

    const handleMouseUp = () => {
      setDraggingMin(false);
      setDraggingMax(false);
    };

    if (draggingMin || draggingMax) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [draggingMin, draggingMax, localMin, localMax, min, max, step]);

  // Yüzde hesapla
  const minPercent = ((localMin - min) / (max - min)) * 100;
  const maxPercent = ((localMax - min) / (max - min)) * 100;

  return (
    <div className="w-full space-y-3">
      {/* Track Container */}
      <div
        ref={trackRef}
        className="relative h-2 bg-slate-300 rounded-full cursor-pointer dark:bg-slate-700"
      >
        {/* Aktif Alan (Cyan Highlight) */}
        <div
          className="absolute h-2 bg-cyan-500 dark:bg-cyan-500 rounded-full"
          style={{
            left: `${minPercent}%`,
            right: `${100 - maxPercent}%`,
          }}
        />

        {/* Min Thumb */}
        <div
          onMouseDown={handleMinMouseDown}
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-5 bg-white border-2 border-cyan-500 dark:bg-slate-800 dark:border-cyan-400 rounded-full cursor-grab active:cursor-grabbing shadow-lg transition ${
            disabled ? "opacity-50 cursor-not-allowed" : ""
          }`}
          style={{
            left: `${minPercent}%`,
            zIndex: draggingMin ? 10 : 5,
          }}
        />

        {/* Max Thumb */}
        <div
          onMouseDown={handleMaxMouseDown}
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-5 bg-white border-2 border-cyan-500 dark:bg-slate-800 dark:border-cyan-400 rounded-full cursor-grab active:cursor-grabbing shadow-lg transition ${
            disabled ? "opacity-50 cursor-not-allowed" : ""
          }`}
          style={{
            left: `${maxPercent}%`,
            zIndex: draggingMax ? 10 : 5,
          }}
        />
      </div>

      {/* Değerleri Display Edebilmek İçin (İsteğe Bağlı) */}
      <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 px-1 pointer-events-none">
        <span>00:00</span>
        <span>24:00</span>
      </div>
    </div>
  );
}
