import { createContext, useContext, useEffect, useSyncExternalStore } from "react";

/**
 * Büro arama store'u — provider `OfficeSearchContext.jsx`'te.
 *
 * ⚠️ F-H4: Eskiden her tuş vuruşunda provider'da `setState` çağrılıyordu →
 * `OfficeSearchProvider` ve altındaki tüm ağaç (AppShell, Routes, SiteDownbar,
 * CinematicFooter, CookieConsent) yeniden render oluyordu. Artık dış store
 * (ref + dinleyiciler): context değeri kalıcı, yalnızca `useSyncExternalStore`
 * ile abone olan bileşen (SiteDownbar) yeniden render olur.
 */
export const OfficeSearchContext = createContext(null);

export const NOOP = () => {};
export const EMPTY_SNAPSHOT = { items: [], query: "", onQuery: NOOP, onPick: NOOP };

/** Yeni bir store örneği (provider'ın lazy state initializer'ında bir kez çağrılır). */
export function createOfficeSearchStore() {
  const state = { snapshot: EMPTY_SNAPSHOT, listeners: new Set() };
  const emit = () => state.listeners.forEach((l) => l());
  return {
    register(next) {
      state.snapshot = {
        ...state.snapshot,
        items: next?.items || [],
        onQuery: next?.onQuery || NOOP,
        onPick: next?.onPick || NOOP,
      };
      emit();
      return () => {
        state.snapshot = { ...state.snapshot, items: [], onQuery: NOOP, onPick: NOOP };
        emit();
      };
    },
    setQuery(q) {
      const query = q || "";
      if (query === state.snapshot.query) return;
      state.snapshot = { ...state.snapshot, query };
      emit();
    },
    subscribe(listener) {
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    },
    getSnapshot: () => state.snapshot,
  };
}

/** Kalıcı API (register/setQuery) — abone olmaz, yeniden render tetiklemez. */
export function useOfficeSearchApi() {
  return useContext(OfficeSearchContext);
}

/** Canlı katalog + sorgu — yalnızca bu hook'u çağıran bileşen re-render olur. */
export function useOfficeSearch() {
  const api = useContext(OfficeSearchContext);
  return useSyncExternalStore(
    api ? api.subscribe : () => NOOP,
    api ? api.getSnapshot : () => EMPTY_SNAPSHOT
  );
}

export function useRegisterOfficeSearch(items, query, onQuery, onPick) {
  const api = useOfficeSearchApi();

  useEffect(() => {
    if (!api) return undefined;
    return api.register({ items, onQuery, onPick });
  }, [api, items, onQuery, onPick]);

  useEffect(() => {
    api?.setQuery(query);
  }, [api, query]);
}
