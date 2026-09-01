/**
 * Sınıf birleştirici. Kaynak shadcn bileşenleri `cn` bekliyor; bu kod
 * tabanında `clsx` / `tailwind-merge` yok, dolayısıyla yalnızca boş olmayan
 * parçaları birleştiriyor. Çakışan Tailwind sınıflarını çözmez — çağıran
 * tarafın çelişki üretmemesi gerekir.
 */
export function cn(...parts) {
  const out = [];
  for (const part of parts) {
    if (!part) continue;
    if (typeof part === "string") {
      out.push(part);
      continue;
    }
    if (Array.isArray(part)) {
      const nested = cn(...part);
      if (nested) out.push(nested);
      continue;
    }
    if (typeof part === "object") {
      for (const [key, on] of Object.entries(part)) {
        if (on) out.push(key);
      }
    }
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}
