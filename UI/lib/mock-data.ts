export interface ExchangeRate {
  currency: "EUR" | "USD" | "GBP" | "ALTIN"
  buy: number
  sell: number
}

export interface InterestRate {
  type: string
  rate: number
}

export interface Bank {
  id: string
  name: string
  exchangeRates: ExchangeRate[]
  interestRates: InterestRate[]
}

export const banks: Bank[] = [
  {
    id: "creditwest-bank",
    name: "Creditwest Bank",
    exchangeRates: [
      { currency: "EUR", buy: 38.35, sell: 38.85 },
      { currency: "USD", buy: 35.10, sell: 35.60 },
      { currency: "GBP", buy: 44.70, sell: 45.30 },
      { currency: "ALTIN", buy: 3245, sell: 3320 },
    ],
    interestRates: [
      { type: "Vadeli Mevduat (3 Ay)", rate: 40.5 },
      { type: "Vadeli Mevduat (6 Ay)", rate: 43.5 },
      { type: "Vadeli Mevduat (1 Yıl)", rate: 46.5 },
    ],
  },
  {
    id: "iktisatbank",
    name: "Kıbrıs İktisat Bankası",
    exchangeRates: [
      { currency: "EUR", buy: 38.50, sell: 39.00 },
      { currency: "USD", buy: 35.25, sell: 35.75 },
      { currency: "GBP", buy: 44.85, sell: 45.45 },
      { currency: "ALTIN", buy: 3260, sell: 3335 },
    ],
    interestRates: [
      { type: "Vadeli Mevduat (3 Ay)", rate: 43.0 },
      { type: "Vadeli Mevduat (6 Ay)", rate: 46.0 },
      { type: "Vadeli Mevduat (1 Yıl)", rate: 49.0 },
    ],
  },
  {
    id: "koopbank",
    name: "Kıbrıs Türk Kooperatif Merkez Bankası",
    exchangeRates: [
      { currency: "EUR", buy: 38.40, sell: 38.90 },
      { currency: "USD", buy: 35.15, sell: 35.65 },
      { currency: "GBP", buy: 44.75, sell: 45.35 },
      { currency: "ALTIN", buy: 3250, sell: 3325 },
    ],
    interestRates: [
      { type: "Vadeli Mevduat (3 Ay)", rate: 41.0 },
      { type: "Vadeli Mevduat (6 Ay)", rate: 44.5 },
      { type: "Vadeli Mevduat (1 Yıl)", rate: 47.5 },
    ],
  },
  {
    id: "limasol-bank",
    name: "Limasol Türk Kooperatif Bankası",
    exchangeRates: [
      { currency: "EUR", buy: 38.44, sell: 38.94 },
      { currency: "USD", buy: 35.19, sell: 35.69 },
      { currency: "GBP", buy: 44.79, sell: 45.39 },
      { currency: "ALTIN", buy: 3255, sell: 3330 },
    ],
    interestRates: [
      { type: "Vadeli Mevduat (3 Ay)", rate: 41.8 },
      { type: "Vadeli Mevduat (6 Ay)", rate: 44.8 },
      { type: "Vadeli Mevduat (1 Yıl)", rate: 47.8 },
    ],
  },
  {
    id: "near-east-bank",
    name: "Yakın Doğu Bank",
    exchangeRates: [
      { currency: "EUR", buy: 38.45, sell: 38.95 },
      { currency: "USD", buy: 35.20, sell: 35.70 },
      { currency: "GBP", buy: 44.80, sell: 45.40 },
      { currency: "ALTIN", buy: 3258, sell: 3333 },
    ],
    interestRates: [
      { type: "Vadeli Mevduat (3 Ay)", rate: 42.5 },
      { type: "Vadeli Mevduat (6 Ay)", rate: 45.0 },
      { type: "Vadeli Mevduat (1 Yıl)", rate: 48.0 },
    ],
  },
  {
    id: "turk-bankasi",
    name: "Türk Bankası",
    exchangeRates: [
      { currency: "EUR", buy: 38.48, sell: 38.98 },
      { currency: "USD", buy: 35.22, sell: 35.72 },
      { currency: "GBP", buy: 44.82, sell: 45.42 },
      { currency: "ALTIN", buy: 3262, sell: 3337 },
    ],
    interestRates: [
      { type: "Vadeli Mevduat (3 Ay)", rate: 42.0 },
      { type: "Vadeli Mevduat (6 Ay)", rate: 45.5 },
      { type: "Vadeli Mevduat (1 Yıl)", rate: 48.5 },
    ],
  },
  {
    id: "capitalbank",
    name: "CapitalBank",
    exchangeRates: [
      { currency: "EUR", buy: 38.52, sell: 39.02 },
      { currency: "USD", buy: 35.28, sell: 35.78 },
      { currency: "GBP", buy: 44.90, sell: 45.50 },
      { currency: "ALTIN", buy: 3270, sell: 3345 },
    ],
    interestRates: [
      { type: "Vadeli Mevduat (3 Ay)", rate: 43.5 },
      { type: "Vadeli Mevduat (6 Ay)", rate: 46.5 },
      { type: "Vadeli Mevduat (1 Yıl)", rate: 49.5 },
    ],
  },
  {
    id: "asbank",
    name: "Asbank",
    exchangeRates: [
      { currency: "EUR", buy: 38.42, sell: 38.92 },
      { currency: "USD", buy: 35.18, sell: 35.68 },
      { currency: "GBP", buy: 44.78, sell: 45.38 },
      { currency: "ALTIN", buy: 3252, sell: 3327 },
    ],
    interestRates: [
      { type: "Vadeli Mevduat (3 Ay)", rate: 41.5 },
      { type: "Vadeli Mevduat (6 Ay)", rate: 44.0 },
      { type: "Vadeli Mevduat (1 Yıl)", rate: 47.0 },
    ],
  },
  {
    id: "universal-bank",
    name: "Universal Bank",
    exchangeRates: [
      { currency: "EUR", buy: 38.38, sell: 38.88 },
      { currency: "USD", buy: 35.12, sell: 35.62 },
      { currency: "GBP", buy: 44.72, sell: 45.32 },
      { currency: "ALTIN", buy: 3248, sell: 3323 },
    ],
    interestRates: [
      { type: "Vadeli Mevduat (3 Ay)", rate: 40.0 },
      { type: "Vadeli Mevduat (6 Ay)", rate: 43.0 },
      { type: "Vadeli Mevduat (1 Yıl)", rate: 46.0 },
    ],
  },
  {
    id: "vakiflar-bankasi",
    name: "Kıbrıs Vakıflar Bankası",
    exchangeRates: [
      { currency: "EUR", buy: 38.46, sell: 38.96 },
      { currency: "USD", buy: 35.21, sell: 35.71 },
      { currency: "GBP", buy: 44.81, sell: 45.41 },
      { currency: "ALTIN", buy: 3256, sell: 3331 },
    ],
    interestRates: [
      { type: "Vadeli Mevduat (3 Ay)", rate: 42.2 },
      { type: "Vadeli Mevduat (6 Ay)", rate: 45.2 },
      { type: "Vadeli Mevduat (1 Yıl)", rate: 48.2 },
    ],
  },
  {
    id: "albank",
    name: "Albank",
    exchangeRates: [
      { currency: "EUR", buy: 38.55, sell: 39.05 },
      { currency: "USD", buy: 35.30, sell: 35.80 },
      { currency: "GBP", buy: 44.95, sell: 45.55 },
      { currency: "ALTIN", buy: 3275, sell: 3350 },
    ],
    interestRates: [
      { type: "Vadeli Mevduat (3 Ay)", rate: 44.0 },
      { type: "Vadeli Mevduat (6 Ay)", rate: 47.0 },
      { type: "Vadeli Mevduat (1 Yıl)", rate: 50.0 },
    ],
  },
  {
    id: "novabank",
    name: "Novabank",
    exchangeRates: [
      { currency: "EUR", buy: 38.36, sell: 38.86 },
      { currency: "USD", buy: 35.11, sell: 35.61 },
      { currency: "GBP", buy: 44.71, sell: 45.31 },
      { currency: "ALTIN", buy: 3246, sell: 3321 },
    ],
    interestRates: [
      { type: "Vadeli Mevduat (3 Ay)", rate: 40.2 },
      { type: "Vadeli Mevduat (6 Ay)", rate: 43.2 },
      { type: "Vadeli Mevduat (1 Yıl)", rate: 46.2 },
    ],
  },
  {
    id: "akfinans-bank",
    name: "Akfinans Bank",
    exchangeRates: [
      { currency: "EUR", buy: 38.43, sell: 38.93 },
      { currency: "USD", buy: 35.17, sell: 35.67 },
      { currency: "GBP", buy: 44.77, sell: 45.37 },
      { currency: "ALTIN", buy: 3253, sell: 3328 },
    ],
    interestRates: [
      { type: "Vadeli Mevduat (3 Ay)", rate: 41.3 },
      { type: "Vadeli Mevduat (6 Ay)", rate: 44.3 },
      { type: "Vadeli Mevduat (1 Yıl)", rate: 47.3 },
    ],
  },
  {
    id: "sekerbank",
    name: "Şekerbank (Kıbrıs)",
    exchangeRates: [
      { currency: "EUR", buy: 38.47, sell: 38.97 },
      { currency: "USD", buy: 35.23, sell: 35.73 },
      { currency: "GBP", buy: 44.83, sell: 45.43 },
      { currency: "ALTIN", buy: 3257, sell: 3332 },
    ],
    interestRates: [
      { type: "Vadeli Mevduat (3 Ay)", rate: 42.3 },
      { type: "Vadeli Mevduat (6 Ay)", rate: 45.3 },
      { type: "Vadeli Mevduat (1 Yıl)", rate: 48.3 },
    ],
  },
  {
    id: "faisal-islam-bankasi",
    name: "Kıbrıs Faisal İslam Bankası",
    exchangeRates: [
      { currency: "EUR", buy: 38.41, sell: 38.91 },
      { currency: "USD", buy: 35.16, sell: 35.66 },
      { currency: "GBP", buy: 44.76, sell: 45.36 },
      { currency: "ALTIN", buy: 3251, sell: 3326 },
    ],
    interestRates: [
      { type: "Vadeli Mevduat (3 Ay)", rate: 40.8 },
      { type: "Vadeli Mevduat (6 Ay)", rate: 43.8 },
      { type: "Vadeli Mevduat (1 Yıl)", rate: 46.8 },
    ],
  },
]

export type SortOption =
  | "none"
  | "usd-buy-high"
  | "usd-buy-low"
  | "eur-buy-high"
  | "eur-buy-low"
  | "gbp-buy-high"
  | "gbp-buy-low"
  | "usd-sell-high"
  | "usd-sell-low"
  | "eur-sell-high"
  | "eur-sell-low"
  | "gbp-sell-high"
  | "gbp-sell-low"
  | "altin-buy-high"
  | "altin-buy-low"
  | "altin-sell-high"
  | "altin-sell-low"

export const sortOptions: { value: SortOption; label: string }[] = [
  { value: "none", label: "Sıralama Yok" },
  { value: "gbp-buy-high", label: "En Yüksek Alış (GBP)" },
  { value: "gbp-buy-low", label: "En Düşük Alış (GBP)" },
  { value: "usd-buy-high", label: "En Yüksek Alış (USD)" },
  { value: "usd-buy-low", label: "En Düşük Alış (USD)" },
  { value: "eur-buy-high", label: "En Yüksek Alış (EUR)" },
  { value: "eur-buy-low", label: "En Düşük Alış (EUR)" },
  { value: "altin-buy-high", label: "En Yüksek Alış (Altın)" },
  { value: "altin-buy-low", label: "En Düşük Alış (Altın)" },
  { value: "gbp-sell-high", label: "En Yüksek Satış (GBP)" },
  { value: "gbp-sell-low", label: "En Düşük Satış (GBP)" },
  { value: "usd-sell-high", label: "En Yüksek Satış (USD)" },
  { value: "usd-sell-low", label: "En Düşük Satış (USD)" },
  { value: "eur-sell-high", label: "En Yüksek Satış (EUR)" },
  { value: "eur-sell-low", label: "En Düşük Satış (EUR)" },
  { value: "altin-sell-high", label: "En Yüksek Satış (Altın)" },
  { value: "altin-sell-low", label: "En Düşük Satış (Altın)" },
]

// Helper function to find best rates
export function getBestGBPBuyRate(bankList: Bank[]): { bank: Bank; rate: number } | null {
  let best: { bank: Bank; rate: number } | null = null
  for (const bank of bankList) {
    const gbpRate = bank.exchangeRates.find(r => r.currency === "GBP")
    if (gbpRate && (!best || gbpRate.buy > best.rate)) {
      best = { bank, rate: gbpRate.buy }
    }
  }
  return best
}

export function getHighestInterestRate(bankList: Bank[]): { bank: Bank; rate: InterestRate } | null {
  let best: { bank: Bank; rate: InterestRate } | null = null
  for (const bank of bankList) {
    for (const rate of bank.interestRates) {
      if (!best || rate.rate > best.rate.rate) {
        best = { bank, rate }
      }
    }
  }
  return best
}
