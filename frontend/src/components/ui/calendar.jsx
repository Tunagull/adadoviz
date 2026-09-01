import { cn } from "../../lib/utils";
import { ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";

const buttonClassNames =
  "relative flex h-9 w-9 items-center justify-center rounded-lg text-ink-900 disabled:pointer-events-none disabled:opacity-50 dark:text-white [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0";

/**
 * react-day-picker takvimi.
 *
 * Kaynak shadcn + TypeScript + Tailwind v4 token'ları. Bu kod tabanı JSX ve
 * Tailwind 3; `cn` yerel, renkler ink/surface-neon. Varsayılan stiller
 * `react-day-picker/style.css` + `.rdp-adadoviz` değişkenleri.
 */
export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  components: userComponents,
  mode = "single",
  ...props
}) {
  const defaultClassNames = {
    button_next: buttonClassNames,
    button_previous: buttonClassNames,
    caption_label: "flex h-full items-center gap-2 text-sm font-medium",
    day: "h-9 w-9 py-px text-sm",
    day_button: cn(
      buttonClassNames,
      "outline-none focus-visible:ring-2 focus-visible:ring-ink-950/40 dark:focus-visible:ring-white/50"
    ),
    dropdown: "absolute inset-0 bg-transparent opacity-0",
    dropdown_root:
      "relative h-8 rounded-lg border border-ink-300 px-2 shadow-sm dark:border-white/10",
    dropdowns: "flex h-9 w-full items-center justify-center gap-1.5 text-sm",
    hidden: "invisible",
    month: "w-full",
    month_caption: "relative z-[2] mx-9 mb-1 flex h-9 items-center justify-center px-1",
    months: "relative flex flex-col gap-2 sm:flex-row",
    nav: "absolute top-0 z-[1] flex w-full justify-between",
    outside: "text-ink-400 dark:text-ink-500",
    range_end: "range-end",
    range_middle: "range-middle",
    range_start: "range-start",
    week_number: "h-9 w-9 p-0 text-xs font-medium text-ink-500",
    weekday: "h-9 w-9 p-0 text-xs font-medium text-ink-500",
  };

  const mergedClassNames = Object.keys(defaultClassNames).reduce(
    (acc, key) => {
      const userClass = classNames?.[key];
      const baseClass = defaultClassNames[key];
      acc[key] = userClass ? cn(baseClass, userClass) : baseClass;
      return acc;
    },
    { ...defaultClassNames }
  );

  const defaultComponents = {
    Chevron: ({ className: chevronClass, orientation, ...rest }) => {
      if (orientation === "left") {
        return <ChevronLeft className={cn(chevronClass, "rtl:rotate-180")} aria-hidden="true" {...rest} />;
      }
      if (orientation === "right") {
        return <ChevronRight className={cn(chevronClass, "rtl:rotate-180")} aria-hidden="true" {...rest} />;
      }
      return <ChevronsUpDown className={chevronClass} aria-hidden="true" {...rest} />;
    },
  };

  return (
    <DayPicker
      mode={mode}
      showOutsideDays={showOutsideDays}
      className={cn("rdp-adadoviz w-fit", className)}
      classNames={mergedClassNames}
      components={{ ...defaultComponents, ...userComponents }}
      formatters={{
        formatMonthDropdown: (date) => date.toLocaleString("default", { month: "short" }),
      }}
      {...props}
    />
  );
}

export default Calendar;
