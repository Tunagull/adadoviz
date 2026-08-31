export function PartnershipPage() {
  return (
    <div className="rounded-2xl border border-white/10 bg-ink-900/60 p-6 shadow-xl backdrop-blur-lg">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-white">Partnerlik</h1>
        <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">
          İşletmeniz için partnerlik başvuru formu iskeleti.
        </p>
      </div>

      <form className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium uppercase tracking-wide text-brand-300">
              Kurum Adı
            </label>
            <input
              type="text"
              disabled
              placeholder="Örn: Akbank"
              className="h-11 rounded-lg border border-ink-700 bg-ink-950 px-3 text-sm text-ink-100 outline-none opacity-60"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium uppercase tracking-wide text-brand-300">
              Yetkili Kişi
            </label>
            <input
              type="text"
              disabled
              placeholder="Örn: Ayşe Yılmaz"
              className="h-11 rounded-lg border border-ink-700 bg-ink-950 px-3 text-sm text-ink-100 outline-none opacity-60"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium uppercase tracking-wide text-brand-300">
              E-posta
            </label>
            <input
              type="email"
              disabled
              placeholder="partner@kurum.com"
              className="h-11 rounded-lg border border-ink-700 bg-ink-950 px-3 text-sm text-ink-100 outline-none opacity-60"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium uppercase tracking-wide text-brand-300">
              Telefon
            </label>
            <input
              type="tel"
              disabled
              placeholder="+90 ..."
              className="h-11 rounded-lg border border-ink-700 bg-ink-950 px-3 text-sm text-ink-100 outline-none opacity-60"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium uppercase tracking-wide text-brand-300">
            Mesaj
          </label>
          <textarea
            disabled
            rows={5}
            placeholder="Sözleşme kapsamı ve talebinizi kısaca belirtin..."
            className="rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-ink-100 outline-none opacity-60"
          />
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            disabled
            className="rounded-lg border border-ink-700 bg-ink-950 px-4 py-2.5 text-sm font-medium text-ink-300 opacity-60"
          >
            Gönder
          </button>
          <p className="text-xs text-ink-500">
            Formun işleyişi sonraki adımda eklenecek.
          </p>
        </div>
      </form>
    </div>
  );
}

