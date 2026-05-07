"use client"

import { useEffect, useState } from "react"
import { Sun, Moon } from "lucide-react"

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const isDarkMode = document.documentElement.classList.contains("dark")
    setIsDark(isDarkMode)
  }, [])

  const toggleTheme = () => {
    const newIsDark = !isDark
    setIsDark(newIsDark)
    if (newIsDark) {
      document.documentElement.classList.add("dark")
      localStorage.setItem("theme", "dark")
    } else {
      document.documentElement.classList.remove("dark")
      localStorage.setItem("theme", "light")
    }
  }

  useEffect(() => {
    const savedTheme = localStorage.getItem("theme")
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
    
    if (savedTheme === "dark" || (!savedTheme && prefersDark)) {
      document.documentElement.classList.add("dark")
      setIsDark(true)
    } else {
      document.documentElement.classList.remove("dark")
      setIsDark(false)
    }
  }, [])

  if (!mounted) {
    return (
      <div className="relative h-10 w-20 rounded-full bg-muted">
        <div className="absolute left-1 top-1 size-8 rounded-full bg-background" />
      </div>
    )
  }

  return (
    <button
      onClick={toggleTheme}
      className="relative h-10 w-20 rounded-full bg-gradient-to-r from-amber-100 to-amber-200 p-1 shadow-inner transition-all duration-500 dark:from-slate-700 dark:to-slate-800"
      aria-label={isDark ? "Açık temaya geç" : "Koyu temaya geç"}
    >
      {/* Track background decoration */}
      <div className="absolute inset-0 overflow-hidden rounded-full">
        {/* Sun rays - visible in light mode */}
        <div className="absolute -left-1 top-1/2 -translate-y-1/2 transition-opacity duration-500 dark:opacity-0">
          <div className="flex gap-0.5">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="h-1 w-1 rounded-full bg-amber-300"
                style={{ opacity: 0.4 + i * 0.2 }}
              />
            ))}
          </div>
        </div>
        {/* Stars - visible in dark mode */}
        <div className="absolute right-2 top-2 opacity-0 transition-opacity duration-500 dark:opacity-100">
          <div className="size-1 rounded-full bg-white/60" />
        </div>
        <div className="absolute right-4 bottom-2 opacity-0 transition-opacity duration-500 dark:opacity-100">
          <div className="size-0.5 rounded-full bg-white/40" />
        </div>
      </div>

      {/* Sliding knob */}
      <div
        className={`relative flex size-8 items-center justify-center rounded-full bg-white shadow-md transition-all duration-500 ease-in-out dark:bg-slate-900 ${
          isDark ? "translate-x-10" : "translate-x-0"
        }`}
      >
        {/* Sun icon */}
        <Sun
          className={`absolute size-5 text-amber-500 transition-all duration-300 ${
            isDark ? "scale-0 rotate-90 opacity-0" : "scale-100 rotate-0 opacity-100"
          }`}
        />
        {/* Moon icon */}
        <Moon
          className={`absolute size-5 text-slate-300 transition-all duration-300 ${
            isDark ? "scale-100 rotate-0 opacity-100" : "scale-0 -rotate-90 opacity-0"
          }`}
        />
      </div>
    </button>
  )
}
