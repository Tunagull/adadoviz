import * as React from "react";
import * as RechartsPrimitive from "recharts";
import { cn } from "../../lib/utils";

/**
 * shadcn chart primitive'inin JSX + Tailwind 3 uyarlaması.
 *
 * Kaynak `bg-background` / `stroke-border` / `outline-hidden` token'ları
 * bu projede yok; eşdeğerleri ink paleti. `@/` alias'ı yok — göreli import.
 *
 * Format: { THEME_NAME: CSS_SELECTOR }
 */
const THEMES = { light: "", dark: ".dark" };

const ChartContext = React.createContext(null);

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer />");
  }
  return context;
}

function ChartContainer({ id, className, children, config, ...props }) {
  const uniqueId = React.useId();
  const chartId = `chart-${id || uniqueId.replace(/:/g, "")}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-ink-500 dark:[&_.recharts-cartesian-axis-tick_text]:fill-ink-400 [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-ink-200/50 dark:[&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-white/10 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-ink-300 dark:[&_.recharts-curve.recharts-tooltip-cursor]:stroke-white/20 [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-ink-200 dark:[&_.recharts-polar-grid_[stroke='#ccc']]:stroke-white/10 [&_.recharts-radial-bar-background-sector]:fill-ink-100 dark:[&_.recharts-radial-bar-background-sector]:fill-ink-800 [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-ink-100 dark:[&_.recharts-rectangle.recharts-tooltip-cursor]:fill-ink-800 [&_.recharts-reference-line_[stroke='#ccc']]:stroke-ink-200 dark:[&_.recharts-reference-line_[stroke='#ccc']]:stroke-white/10 [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-none [&_.recharts-sector]:outline-none [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-surface]:outline-none",
          className
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

const ChartStyle = ({ id, config }) => {
  const colorConfig = Object.entries(config || {}).filter(([, item]) => item?.theme || item?.color);
  if (!colorConfig.length) return null;

  const css = Object.entries(THEMES)
    .map(([theme, prefix]) => {
      const body = colorConfig
        .map(([key, itemConfig]) => {
          const color = itemConfig.theme?.[theme] || itemConfig.color;
          return color ? `  --color-${key}: ${color};` : null;
        })
        .filter(Boolean)
        .join("\n");
      return `${prefix} [data-chart=${id}] {\n${body}\n}`;
    })
    .join("\n");

  return <style dangerouslySetInnerHTML={{ __html: css }} />;
};

const ChartTooltip = RechartsPrimitive.Tooltip;

function ChartTooltipContent({
  active,
  payload,
  className,
  indicator = "dot",
  hideLabel = false,
  hideIndicator = false,
  label,
  labelFormatter,
  labelClassName,
  formatter,
  color,
  nameKey,
  labelKey,
  hideKeys = [],
}) {
  const { config } = useChart();

  const tooltipLabel = React.useMemo(() => {
    if (hideLabel || !payload?.length) return null;
    const [item] = payload;
    const key = `${labelKey || item?.dataKey || item?.name || "value"}`;
    const itemConfig = getPayloadConfigFromPayload(config, item, key);
    const value =
      !labelKey && typeof label === "string"
        ? config[label]?.label || label
        : itemConfig?.label;

    if (labelFormatter) {
      return <div className={cn("font-medium", labelClassName)}>{labelFormatter(value, payload)}</div>;
    }
    if (!value) return null;
    return <div className={cn("font-medium", labelClassName)}>{value}</div>;
  }, [label, labelFormatter, payload, hideLabel, labelClassName, config, labelKey]);

  if (!active || !payload?.length) return null;

  const seen = new Set();
  const rows = payload.filter((item) => {
    if (hideKeys.includes(item.dataKey)) return false;
    if (item.value == null) return false;
    const id = `${item.dataKey}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  if (!rows.length) return null;

  const nestLabel = rows.length === 1 && indicator !== "dot";

  return (
    <div
      className={cn(
        "grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-ink-200/80 bg-white px-2.5 py-1.5 text-xs shadow-xl dark:border-white/10 dark:bg-ink-900",
        className
      )}
    >
      {!nestLabel ? tooltipLabel : null}
      <div className="grid gap-1.5">
        {rows.map((item, index) => {
          const key = `${nameKey || item.name || item.dataKey || "value"}`;
          const itemConfig = getPayloadConfigFromPayload(config, item, key);
          const indicatorColor = color || item.payload?.fill || item.color;

          return (
            <div
              key={`${item.dataKey}-${index}`}
              className={cn(
                "flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-ink-500",
                indicator === "dot" && "items-center"
              )}
            >
              {formatter && item?.value !== undefined && item.name ? (
                formatter(item.value, item.name, item, index, item.payload)
              ) : (
                <>
                  {itemConfig?.icon ? (
                    <itemConfig.icon />
                  ) : (
                    !hideIndicator && (
                      <div
                        className={cn("shrink-0 rounded-[2px] border bg-current", {
                          "h-2.5 w-2.5": indicator === "dot",
                          "w-1": indicator === "line",
                          "w-0 border-[1.5px] border-dashed bg-transparent": indicator === "dashed",
                          "my-0.5": nestLabel && indicator === "dashed",
                        })}
                        style={{
                          backgroundColor: indicator === "dashed" ? "transparent" : indicatorColor,
                          borderColor: indicatorColor,
                        }}
                      />
                    )
                  )}
                  <div
                    className={cn(
                      "flex flex-1 justify-between leading-none",
                      nestLabel ? "items-end" : "items-center"
                    )}
                  >
                    <div className="grid gap-1.5">
                      {nestLabel ? tooltipLabel : null}
                      <span className="text-ink-500 dark:text-ink-400">
                        {itemConfig?.label || item.name}
                      </span>
                    </div>
                    {item.value != null && item.value !== "" ? (
                      <span className="font-mono font-medium tabular-nums text-ink-900 dark:text-white">
                        {Number(item.value).toLocaleString()}
                      </span>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const ChartLegend = RechartsPrimitive.Legend;

function ChartLegendContent({
  className,
  hideIcon = false,
  payload,
  verticalAlign = "bottom",
  nameKey,
}) {
  const { config } = useChart();
  if (!payload?.length) return null;

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-4",
        verticalAlign === "top" ? "pb-3" : "pt-3",
        className
      )}
    >
      {payload.map((item) => {
        const key = `${nameKey || item.dataKey || "value"}`;
        const itemConfig = getPayloadConfigFromPayload(config, item, key);
        return (
          <div
            key={String(item.value)}
            className="flex items-center gap-1.5 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:text-ink-500"
          >
            {itemConfig?.icon && !hideIcon ? (
              <itemConfig.icon />
            ) : (
              <div className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
            )}
            {itemConfig?.label}
          </div>
        );
      })}
    </div>
  );
}

function getPayloadConfigFromPayload(config, payload, key) {
  if (typeof payload !== "object" || payload === null) return undefined;

  const payloadPayload =
    "payload" in payload && typeof payload.payload === "object" && payload.payload !== null
      ? payload.payload
      : undefined;

  let configLabelKey = key;
  if (key in payload && typeof payload[key] === "string") {
    configLabelKey = payload[key];
  } else if (payloadPayload && key in payloadPayload && typeof payloadPayload[key] === "string") {
    configLabelKey = payloadPayload[key];
  }

  return configLabelKey in config ? config[configLabelKey] : config[key];
}

/**
 * Demo'daki CustomTooltip yüzeyi — popover yerine ink kart.
 * Area+Line aynı dataKey'i iki kez basarsa tekrarı eler.
 */
function ChartSwatch({ label, color }) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className="size-3.5 rounded-full border-4 bg-white dark:bg-ink-950"
        style={{ borderColor: color }}
      />
      <span className="text-ink-500 dark:text-ink-400">{label}</span>
    </div>
  );
}

function ChartHoverCard({ label, children, className }) {
  return (
    <div
      className={cn(
        "min-w-[180px] rounded-lg border border-ink-200 bg-white p-3 shadow-sm shadow-black/5 dark:border-white/10 dark:bg-ink-900 dark:shadow-black/40",
        className
      )}
    >
      {label ? (
        <div className="mb-2.5 text-[11px] font-medium tracking-wide text-ink-500 dark:text-ink-400">
          {label}
        </div>
      ) : null}
      <div className="space-y-2">{children}</div>
    </div>
  );
}

export {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  ChartStyle,
  ChartHoverCard,
  ChartSwatch,
  useChart,
};
