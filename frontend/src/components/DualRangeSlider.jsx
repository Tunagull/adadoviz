import { useEffect, useState } from "react";

/**
 * DualRangeSlider — tek track üzerinde iki thumb (min/max).
 *
 * ⚠️ A-C1: Eskiden thumb'lar `<div onMouseDown>` idi — klavye yok, dokunma yok,
 * ARIA yok (WCAG 2.1.1, 4.1.2, 2.5.7). Artık iki üst üste bindirilmiş native
 * `<input type="range">`: klavye (ok/Home/End/PageUp-Down), dokunma ve ekran
 * okuyucu (`aria-valuetext` = "HH:MM") tarayıcıdan bedava gelir.
 *
 * Props:
 *   - min (0), max (1440), step (15) — dakika
 *   - minValue / maxValue — mevcut aralık (dakika)
 *   - onRangeChange: (min, max)
 *   - disabled
 *   - minLabel / maxLabel — erişilebilir ad
 */
function toClock(minutes) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function DualRangeSlider({
  min = 0,
  max = 1440,
  step = 15,
  minValue = 480,
  maxValue = 1020,
  onRangeChange = () => {},
  disabled = false,
  minLabel = "Açılış saati",
  maxLabel = "Kapanış saati",
}) {
  const [localMin, setLocalMin] = useState(minValue);
  const [localMax, setLocalMax] = useState(maxValue);

  useEffect(() => setLocalMin(minValue), [minValue]);
  useEffect(() => setLocalMax(maxValue), [maxValue]);

  const commitMin = (raw) => {
    const value = Math.max(min, Math.min(Number(raw), localMax - step));
    setLocalMin(value);
    onRangeChange(value, localMax);
  };

  const commitMax = (raw) => {
    const value = Math.min(max, Math.max(Number(raw), localMin + step));
    setLocalMax(value);
    onRangeChange(localMin, value);
  };

  const span = max - min || 1;
  const minPercent = ((localMin - min) / span) * 100;
  const maxPercent = ((localMax - min) / span) * 100;

  return (
    <div className="w-full space-y-3">
      <div className="dual-range" data-disabled={disabled ? "" : undefined}>
        <div className="dual-range__track" />
        <div
          className="dual-range__fill"
          style={{ left: `${minPercent}%`, right: `${100 - maxPercent}%` }}
        />
        <input
          type="range"
          className="dual-range__input"
          min={min}
          max={max}
          step={step}
          value={localMin}
          disabled={disabled}
          aria-label={minLabel}
          aria-valuetext={toClock(localMin)}
          onChange={(e) => commitMin(e.target.value)}
        />
        <input
          type="range"
          className="dual-range__input"
          min={min}
          max={max}
          step={step}
          value={localMax}
          disabled={disabled}
          aria-label={maxLabel}
          aria-valuetext={toClock(localMax)}
          onChange={(e) => commitMax(e.target.value)}
        />
      </div>

      <div className="flex justify-between px-1 text-xs text-ink-500 dark:text-ink-400">
        <span>{toClock(localMin)}</span>
        <span>{toClock(localMax)}</span>
      </div>
    </div>
  );
}
