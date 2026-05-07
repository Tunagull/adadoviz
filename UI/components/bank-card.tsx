"use client"

import type { Bank } from "@/lib/mock-data"

interface BankCardProps {
  bank: Bank
  mode: "exchange" | "interest"
}

// Format currency display name
function getCurrencyDisplay(currency: string): string {
  if (currency === "ALTIN") return "ALTIN (gr)"
  return currency
}

// Format rate based on currency type
function formatRate(rate: number, currency: string): string {
  if (currency === "ALTIN") {
    return rate.toLocaleString("tr-TR")
  }
  return rate.toFixed(2)
}

export function BankCard({ bank, mode }: BankCardProps) {
  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-md transition-all duration-300 hover:shadow-xl hover:-translate-y-1">
      {/* Bank Header with Logo */}
      <div className="flex items-center gap-3 px-5 py-4">
        <img
          src="https://placehold.co/100x100/ffffff/111111?text=Logo"
          alt={`${bank.name} logo`}
          className="size-10 shrink-0 rounded-full bg-white object-contain shadow-sm"
        />
        <h3 className="text-base font-semibold text-foreground leading-tight">
          {bank.name}
        </h3>
      </div>

      {/* Content Area */}
      {mode === "exchange" ? (
        <div className="px-5 pb-5">
          <div className="divide-y divide-muted/30">
            {bank.exchangeRates.map((rate) => (
              <div
                key={rate.currency}
                className="flex items-center justify-between py-3"
              >
                {/* Currency Badge */}
                <span className="inline-flex items-center justify-center rounded-lg bg-muted/50 px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                  {getCurrencyDisplay(rate.currency)}
                </span>

                {/* Rates */}
                <div className="flex items-center gap-5">
                  <div className="text-right">
                    <span className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-0.5">
                      ALIŞ
                    </span>
                    <span className="font-mono text-xl font-bold text-emerald-600 dark:text-emerald-400">
                      {formatRate(rate.buy, rate.currency)}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-0.5">
                      SATIŞ
                    </span>
                    <span className="font-mono text-xl font-bold text-rose-500 dark:text-rose-400">
                      {formatRate(rate.sell, rate.currency)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="px-5 pb-5">
          {bank.interestRates.length > 0 ? (
            <div className="divide-y divide-muted/30">
              {bank.interestRates.map((rate, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between py-3"
                >
                  <span className="text-sm text-muted-foreground">
                    {rate.type}
                  </span>
                  <span className="font-mono text-2xl font-bold text-primary">
                    %{rate.rate.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              Çok Yakında
            </div>
          )}
        </div>
      )}
    </div>
  )
}
