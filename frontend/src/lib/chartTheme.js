/**
 * AdaDöviz grafik cildi — mat siyah + beyaz neon.
 *
 * shadcn `line-charts-1` demo'sundaki pembe/teal ve `--color-pink-500`
 * token'ları bu kod tabanında yok. Çizgi dili (linear, gradient alan,
 * içi boş nokta, kesik ikinci seri, yatay kesik ızgara) aynı; renkler
 * ink / surface-neon ölçeğinden gelir. Yeşil/kırmızı yalnızca semantik
 * trend (tek seri yükseliş/düşüş) için.
 */

export function chartSkin(isDark) {
  return {
    grid: isDark ? "rgba(255,255,255,0.10)" : "rgba(8,8,10,0.08)",
    tick: isDark ? "#97979f" : "#6b6b74",
    axis: isDark ? "rgba(255,255,255,0.12)" : "rgba(8,8,10,0.10)",
    tooltipBg: isDark ? "#16161a" : "#ffffff",
    tooltipBorder: isDark ? "rgba(255,255,255,0.12)" : "rgba(8,8,10,0.10)",
    tooltipFg: isDark ? "#ffffff" : "#08080a",
    tooltipMuted: isDark ? "#97979f" : "#6b6b74",
    cursor: isDark ? "rgba(255,255,255,0.16)" : "rgba(8,8,10,0.14)",
    dotFill: isDark ? "#08080a" : "#ffffff",
    neon: isDark ? "#ffffff" : "#08080a",
    mutedLine: isDark ? "#9d9da8" : "#6f6f7b",
    up: "#10b981",
    down: "#ef4444",
  };
}

/** En fazla 4 işletme serisi — parlaklık basamağı, ton değil. */
export function comparePalette(isDark) {
  return isDark
    ? ["#ffffff", "#9d9da8", "#6f6f7b", "#4f4f57"]
    : ["#08080a", "#41414a", "#6f6f7b", "#97979f"];
}

export function hollowDot(color, fill, r = 5) {
  return {
    fill,
    stroke: color,
    strokeWidth: 2,
    r,
    strokeDasharray: "0",
  };
}
