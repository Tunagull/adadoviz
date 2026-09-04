/**
 * Vercel Edge-önbellekli kur proxy'si.
 *
 * ⚠️ PERF (ilk yükleme): Kurlar Render'ın ücretsiz katmanındaki backend'den
 * geliyor; 15 dk boştan sonra uyanışı 30–60 sn sürüyor ve o sırada her
 * ziyaretçi bekliyordu. Bu fonksiyon Vercel'in CDN'inde cevabı önbelleğe alır:
 *
 *   - `s-maxage=45`      → CDN 45 sn boyunca aynı cevabı sunucuya sormadan verir
 *   - `stale-while-revalidate=600` → cevap bayatladıktan sonra 10 dk daha
 *     ANINDA bayat kopyayı sunar, taze kopyayı arkada çeker
 *
 * Sonuç: backend soğuk olsa bile yalnızca TEK istek (cache miss) bekler;
 * diğer tüm ziyaretçiler önbellekten anında kur görür.
 *
 * Vercel env: RATES_UPSTREAM = https://<render-backend-host>  (opsiyonel;
 * verilmezse aşağıdaki varsayılan kullanılır).
 */
const UPSTREAM =
  process.env.RATES_UPSTREAM || "https://adadoviz-backend.onrender.com";

/** Sıcak invocation'lar arası bellek yedeği (upstream tümüyle çökerse). */
let lastGoodBody = null;
let lastGoodAt = 0;

export default async function handler(req, res) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 22000);
  try {
    const upstream = await fetch(`${UPSTREAM}/api/kurlar`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    clearTimeout(timer);

    if (upstream.ok) {
      const body = await upstream.text();
      lastGoodBody = body;
      lastGoodAt = Date.now();
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader(
        "cache-control",
        "public, s-maxage=45, stale-while-revalidate=600"
      );
      return res.status(200).send(body);
    }
    throw new Error(`upstream ${upstream.status}`);
  } catch (err) {
    clearTimeout(timer);
    if (lastGoodBody && Date.now() - lastGoodAt < 6 * 60 * 60 * 1000) {
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "public, s-maxage=15, stale-while-revalidate=600");
      res.setHeader("x-rates-stale", "1");
      return res.status(200).send(lastGoodBody);
    }
    res.setHeader("cache-control", "no-store");
    return res
      .status(503)
      .json({ error: "Kur kaynağına ulaşılamadı.", detail: String(err && err.message) });
  }
}
