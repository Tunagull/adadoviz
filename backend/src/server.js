const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const { scrapeAllBanks, emptyPayloadForServerError } = require("./scraper");

const app = express();
const PORT = process.env.PORT || 5000;
let cachedRates = {
  updatedAt: null,
  totalBanks: 0,
  banks: [],
};

app.use(cors({ origin: "*" }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/kurlar", (_req, res) => {
  res.json(cachedRates);
});

async function refreshRatesCache() {
  try {
    const scraped = await scrapeAllBanks();

    cachedRates = {
      updatedAt: scraped.updatedAt,
      totalBanks: scraped.totalBanks,
      banks: scraped.banks,
    };

    if (cachedRates.totalBanks !== 15 || cachedRates.banks.length !== 15) {
      console.error(
        "[SCRAPER] cache beklenmeyen boyut:",
        cachedRates.totalBanks,
        cachedRates.banks.length
      );
    }

    console.log(
      `[SCRAPER] Cache güncellendi — totalBanks=${cachedRates.totalBanks}, updatedAt=${cachedRates.updatedAt}`
    );
  } catch (error) {
    console.error("[SCRAPER] Refresh başarısız:", error.message);
    cachedRates = emptyPayloadForServerError();
    console.log("[SCRAPER] Acil fallback (15 banka) yüklendi.");
  }
}

async function startServer() {
  await refreshRatesCache();

  cron.schedule("*/15 * * * *", async () => {
    await refreshRatesCache();
  });

  app.listen(PORT, () => {
    console.log(`Backend API is running on http://localhost:${PORT}`);
    console.log("Rates endpoint: GET /api/kurlar");
    console.log(`İlk yüklemede cache: totalBanks=${cachedRates.totalBanks}`);
  });
}

startServer();
