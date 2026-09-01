import { useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Calendar } from "./calendar";
import { tr, enUS } from "react-day-picker/locale";

function parseDay(value) {
  if (!value || typeof value !== "string" || value.length < 10) return undefined;
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function toIsoDay(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Detaylı analiz tarih alanı: native `type="date"` yerine takvim.
 */
export function DateField({
  label,
  value,
  min,
  max,
  onChange,
  locale = "tr-TR",
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selected = parseDay(value);
  const minDate = parseDay(min);
  const maxDate = parseDay(max);
  const rdpLocale = locale?.startsWith("en") ? enUS : tr;

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (event) => {
      if (rootRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const display = selected
    ? selected.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })
    : "—";

  const disabled = [];
  if (minDate) disabled.push({ before: minDate });
  if (maxDate) disabled.push({ after: maxDate });

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className}`}>
      <button
        type="button"
        className="date-field-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="date-field-trigger__label">{label}</span>
        <span className="date-field-trigger__value">{display}</span>
        <CalendarDays className="date-field-trigger__icon" aria-hidden="true" />
      </button>
      {open ? (
        <div className="date-field-popover" role="dialog" aria-label={label}>
          <Calendar
            mode="single"
            locale={rdpLocale}
            required
            selected={selected}
            defaultMonth={selected || maxDate || minDate}
            disabled={disabled}
            onSelect={(date) => {
              if (!date) return;
              onChange?.(toIsoDay(date));
              setOpen(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

export default DateField;
