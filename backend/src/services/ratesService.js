/**
 * Kur kaynağı — KKTC MERKEZ BANKASI (tek gerçeklik kaynağı).
 *
 * ⚠️ MANTIK DÜZELTMESİ (denetim bulgusu K-03): Bu dosya önceden TCMB
 * (www.tcmb.gov.tr/kurlar/today.xml) kurlarını çekiyordu; oysa tüm arayüz
 * "KKTC Merkez Bankası kurları baz alınarak yapılmıştır" diyor ve iki kurumun
 * bülten tarihleri birbirini tutmuyor (ölçüm: TCMB 28.08.2026 / KKTC 31.08.2026).
 * Artık fiyatlamanın tek kaynağı KKTC MB'nin günlük XML bültenidir.
 *
 * Kaynak: https://mb.gov.ct.tr/kur/gunluk.xml
 *   <KKTCMB_Doviz_Kurlari>
 *     <Kur_Tarihi>31/08/2026</Kur_Tarihi>
 *     <Duyuru_No>2026/161</Duyuru_No>
 *     <Gecerli_Tarih_Araligi>29/08/2026 - 31/08/2026</Gecerli_Tarih_Araligi>
 *     <Resmi_Kurlar>
 *       <Resmi_Kur>
 *         <Birim>1</Birim><Sembol>USD</Sembol>
 *         <Doviz_Alis>48.07320</Doviz_Alis><Doviz_Satis>48.15980</Doviz_Satis>
 *         <Efektif_Alis>48.03960</Efektif_Alis><Efektif_Satis>48.23210</Efektif_Satis>
 *       </Resmi_Kur> …
 *
 * Kaynağa ulaşılamazsa SAHTE (mock) kur ÜRETİLMEZ. Hata döner; çağıran taraf
 * son geçerli cache'i korur ve geçmiş tabloya hiçbir şey yazmaz.
 */
const fs = require("fs");
const axios = require("axios");
const https = require("https");
const xml2js = require("xml2js");

const SOURCE_URL = "https://mb.gov.ct.tr/kur/gunluk.xml";
const TRACKED_CURRENCIES = ["USD", "EUR", "GBP"];

/**
 * S-M3 / B-M5: Kur kaynağı artık VARSAYILAN olarak TLS doğrulamalı çekilir.
 * KKTC MB zinciri eksikse operatör CA'yı bundle etmeli:
 *   - KKTC_MB_CA_FILE=/path/to/kktc-mb-chain.pem  (bu host'a özel), veya
 *   - NODE_EXTRA_CA_CERTS=...                      (Node geneli)
 * Son çare — bilinçli ve loglanan geçici çözüm:
 *   - KKTC_MB_ALLOW_INSECURE_TLS=1                 (doğrulamayı kapatır, UYARI loglar)
 */
let _insecureTlsWarned = false;
function buildHttpsAgent() {
  const caFile = String(process.env.KKTC_MB_CA_FILE || "").trim();
  if (caFile) {
    try {
      return new https.Agent({ ca: fs.readFileSync(caFile), rejectUnauthorized: true });
    } catch (err) {
      console.warn(`[RATES] KKTC_MB_CA_FILE okunamadı (${caFile}): ${err.message}`);
    }
  }
  if (process.env.KKTC_MB_ALLOW_INSECURE_TLS === "1") {
    if (!_insecureTlsWarned) {
      console.warn(
        "[RATES] ⚠️ KKTC_MB_ALLOW_INSECURE_TLS=1 — kur kaynağı TLS doğrulaması KAPALI. " +
          "MITM sahte kur enjekte edebilir. Bir an önce KKTC_MB_CA_FILE ile CA bundle edin."
      );
      _insecureTlsWarned = true;
    }
    return new https.Agent({ rejectUnauthorized: false });
  }
  return new https.Agent({ rejectUnauthorized: true });
}

/** KKTC XML sayıları nokta ondalıklı gelir; virgüllü varyantı da tolere et. */
function parseRate(value) {
  if (value == null) return null;
  const parsed = Number.parseFloat(String(value).replace(",", ".").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** "31/08/2026" → ISO. KKTC bülteni gün içi saat vermez; 12:00 (+03) kabul edilir. */
function bulletinDateToIso(kurTarihi) {
  const m = String(kurTarihi || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const iso = new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00+03:00`);
  return Number.isNaN(iso.getTime()) ? null : iso.toISOString();
}

/**
 * KKTC MB günlük bülteni. Başarısızlıkta throw eder (mock YOK).
 * @returns {Promise<{source:string,fetchedAt:string,xmlDate:string,bulletinDate:string,
 *   bulletinNo:string,validRange:string,updatedAt:string,rates:object}>}
 */
async function scrapeRatesFromSource() {
  const httpsAgent = buildHttpsAgent();

  const { data } = await axios.get(SOURCE_URL, {
    timeout: 12000,
    httpsAgent,
    headers: {
      "User-Agent": "Mozilla/5.0 (AdaDovizRatesBot)",
      Accept: "application/xml, text/xml, */*",
    },
  });

  const parsed = await new xml2js.Parser({ explicitArray: true }).parseStringPromise(data);
  const root = parsed?.KKTCMB_Doviz_Kurlari;
  if (!root) {
    throw new Error("KKTC MB XML kök düğümü (KKTCMB_Doviz_Kurlari) bulunamadı.");
  }

  const kurTarihi = root.Kur_Tarihi?.[0] || null;
  const bulletinNo = root.Duyuru_No?.[0] || null;
  const validRange = root.Gecerli_Tarih_Araligi?.[0] || null;
  const officialRates = root.Resmi_Kurlar?.[0]?.Resmi_Kur || [];

  const rates = {};
  for (const row of officialRates) {
    const symbol = String(row.Sembol?.[0] || "").trim().toUpperCase();
    if (!TRACKED_CURRENCIES.includes(symbol)) continue;

    // Birim genelde 1'dir; JPY gibi kurlarda 100 olabilir — birim başına normalize et.
    const unit = parseRate(row.Birim?.[0]) || 1;
    const buy = parseRate(row.Doviz_Alis?.[0]);
    const sell = parseRate(row.Doviz_Satis?.[0]);
    if (buy == null || sell == null) continue;

    const efektifBuy = parseRate(row.Efektif_Alis?.[0]);
    const efektifSell = parseRate(row.Efektif_Satis?.[0]);

    rates[symbol] = {
      buy: buy / unit,
      sell: sell / unit,
      efektif_buy: efektifBuy != null ? efektifBuy / unit : buy / unit,
      efektif_sell: efektifSell != null ? efektifSell / unit : sell / unit,
    };
  }

  const missing = TRACKED_CURRENCIES.filter((c) => !rates[c]);
  if (missing.length > 0) {
    throw new Error(`KKTC MB bülteninde eksik kur: ${missing.join(", ")}`);
  }

  const updatedAt = bulletinDateToIso(kurTarihi) || new Date().toISOString();

  return {
    source: SOURCE_URL,
    sourceName: "KKTC Merkez Bankası",
    fetchedAt: new Date().toISOString(),
    xmlDate: kurTarihi,
    bulletinDate: kurTarihi,
    bulletinNo,
    validRange,
    updatedAt,
    rates,
  };
}

/**
 * Hata durumunda { error, source: "error" } döner — asla uydurma kur döndürmez.
 * Çağıran (server.js refreshRatesCacheWithChangeDetection) bu döngüde
 * kayıt/broadcast yapmaz, son geçerli cache korunur.
 */
async function getRates() {
  try {
    return await scrapeRatesFromSource();
  } catch (error) {
    return {
      source: "error",
      sourceName: "KKTC Merkez Bankası (erişilemedi)",
      fetchedAt: new Date().toISOString(),
      rates: null,
      error: error.message,
    };
  }
}

module.exports = {
  getRates,
  scrapeRatesFromSource,
  SOURCE_URL,
  TRACKED_CURRENCIES,
};
