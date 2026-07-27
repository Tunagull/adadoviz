import { apiUrl } from "./api";

export async function fetchKktcRates() {
  try {
    const response = await fetch(apiUrl("/api/kktc-kurlar"));
    const data = await response.json();
    
    if (!response.ok || !data.success) {
      throw new Error(data.error || "KKTC kurları alınamadı.");
    }

    return {
      kurlar: data.kurlar || [],
      tarih: data.tarih || null,
      fetchedAt: data.fetchedAt,
    };
  } catch (error) {
    console.error("[KKTC-RATES] Fetch hatası:", error.message);
    throw error;
  }
}
