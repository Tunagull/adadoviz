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

/**
 * En fazla 4 işletme serisi.
 *
 * ⚠️ A-C4 / D2: Eskiden 4 seri 4 birbirine yakın griyle çiziliyordu; komşu
 * griler 2px çizgide ayırt edilemiyor ve bazıları arka planla <3:1 kontrasta
 * düşüyordu (WCAG 1.4.11). Seri kimliği artık "semantik" kabul edilip her
 * çizgiye ayrı bir HUE veriliyor (yeşil/kırmızı trend için ayrılmış olduğundan
 * kullanılmıyor). Her renk hem beyaz hem mat-siyah zeminde ≥3:1.
 * İkincil ipucu olarak `compareDash` her seriye ayrı bir kesik deseni verir.
 */
export function comparePalette(isDark) {
  return isDark
    ? ["#60a5fa", "#fbbf24", "#22d3ee", "#c084fc"]
    : ["#1d4ed8", "#b45309", "#0e7490", "#7e22ce"];
}

/** Renk körlüğü / tek renkli baskı için seri başına kesik desen. */
export const compareDash = ["0", "6 3", "1 4", "10 4 2 4"];

export function hollowDot(color, fill, r = 5) {
  return {
    fill,
    stroke: color,
    strokeWidth: 2,
    r,
    strokeDasharray: "0",
  };
}
