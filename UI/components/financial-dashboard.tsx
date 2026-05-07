"use client"

import { useState, useMemo } from "react"
import { Search, TrendingUp, Percent } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { BankCard } from "@/components/bank-card"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  banks,
  sortOptions,
  getBestGBPBuyRate,
  getHighestInterestRate,
  type SortOption,
  type Bank,
} from "@/lib/mock-data"

export function FinancialDashboard() {
  const [mode, setMode] = useState<"exchange" | "interest">("exchange")
  const [searchQuery, setSearchQuery] = useState("")
  const [sortBy, setSortBy] = useState<SortOption>("none")

  const filteredAndSortedBanks = useMemo(() => {
    let result = [...banks]

    // Filter by search query
    if (searchQuery) {
      result = result.filter((bank) =>
        bank.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    }

    // Sort (skip if "none" is selected)
    if (sortBy !== "none") {
      result.sort((a, b) => {
        const [currency, type, direction] = sortBy.split("-") as [
          "usd" | "eur" | "gbp" | "altin",
          "buy" | "sell",
          "high" | "low"
        ]
        const currencyUpper = currency.toUpperCase() as "USD" | "EUR" | "GBP" | "ALTIN"

        const rateA = getRate(a, currencyUpper, type)
        const rateB = getRate(b, currencyUpper, type)

        return direction === "high" ? rateB - rateA : rateA - rateB
      })
    }

    return result
  }, [searchQuery, sortBy])

  // Calculate hero stats
  const bestGBP = getBestGBPBuyRate(banks)
  const highestInterest = getHighestInterestRate(banks)

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              KKTC Döviz & Faiz
            </h1>
            <p className="mt-2 text-base text-muted-foreground">
              Kuzey Kıbrıs bankalarının güncel döviz kurları ve faiz oranları
            </p>
          </div>
          <ThemeToggle />
        </div>

        {/* Hero Summary Cards */}
        <div className="mb-8 grid gap-4 sm:grid-cols-2">
          {/* Best GBP Rate Card */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-6 text-white shadow-lg">
            <div className="absolute right-4 top-4 opacity-20">
              <TrendingUp className="size-16" />
            </div>
            <div className="relative">
              <p className="text-sm font-medium text-emerald-100 uppercase tracking-wider">
                En İyi GBP Alış Kuru
              </p>
              {bestGBP && (
                <>
                  <p className="mt-2 font-mono text-4xl font-bold">
                    {bestGBP.rate.toFixed(2)} TL
                  </p>
                  <p className="mt-1 text-sm text-emerald-100">
                    {bestGBP.bank.name}
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Highest Interest Rate Card */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 p-6 text-white shadow-lg">
            <div className="absolute right-4 top-4 opacity-20">
              <Percent className="size-16" />
            </div>
            <div className="relative">
              <p className="text-sm font-medium text-violet-100 uppercase tracking-wider">
                En Yüksek Faiz Oranı
              </p>
              {highestInterest && (
                <>
                  <p className="mt-2 font-mono text-4xl font-bold">
                    %{highestInterest.rate.rate.toFixed(1)}
                  </p>
                  <p className="mt-1 text-sm text-violet-100">
                    {highestInterest.bank.name} - {highestInterest.rate.type}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {/* Left: Tabs */}
          <Tabs
            value={mode}
            onValueChange={(value) => setMode(value as "exchange" | "interest")}
          >
            <TabsList className="h-11 p-1">
              <TabsTrigger value="exchange" className="px-5 text-sm">
                Kur
              </TabsTrigger>
              <TabsTrigger value="interest" className="px-5 text-sm">
                Faiz
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Center & Right: Search and Sort */}
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:justify-end sm:gap-4">
            {/* Search */}
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Banka ara..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-11 pl-10 bg-card shadow-sm"
              />
            </div>

            {/* Sort */}
            <Select
              value={sortBy}
              onValueChange={(value) => setSortBy(value as SortOption)}
            >
              <SelectTrigger className="h-11 w-full bg-card shadow-sm sm:w-[220px]">
                <SelectValue placeholder="Sırala" />
              </SelectTrigger>
              <SelectContent>
                {sortOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Bank Cards Grid */}
        {filteredAndSortedBanks.length > 0 ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredAndSortedBanks.map((bank) => (
              <BankCard key={bank.id} bank={bank} mode={mode} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-2xl bg-card py-16 shadow-md text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-muted mb-4">
              <Search className="size-8 text-muted-foreground" />
            </div>
            <p className="text-lg font-semibold text-foreground">
              Banka bulunamadı
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Arama kriterlerinizi değiştirmeyi deneyin
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="mt-12 text-center text-sm text-muted-foreground">
          <p>
            Son güncelleme:{" "}
            {new Date().toLocaleDateString("tr-TR", {
              day: "numeric",
              month: "long",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
          <p className="mt-1">
            Bu veriler örnek amaçlıdır. Güncel kurlar için bankaların resmi
            kanallarını kontrol edin.
          </p>
        </div>
      </div>
    </div>
  )
}

// Helper function to get rate for sorting
function getRate(
  bank: Bank,
  currency: "EUR" | "USD" | "GBP" | "ALTIN",
  type: "buy" | "sell"
): number {
  const rate = bank.exchangeRates.find((r) => r.currency === currency)
  return rate ? rate[type] : 0
}
