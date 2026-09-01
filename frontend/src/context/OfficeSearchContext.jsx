import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * Anasayfadaki büro listesini alt çubuktaki gooey aramaya taşır.
 * Liste yalnızca dashboard mount olduğunda dolu; diğer public sayfalarda
 * arama kutusu yine açılır ama "büro yok" yerine gezinme kısayolları kalır.
 */
const OfficeSearchContext = createContext(null);

const EMPTY = {
  items: [],
  query: "",
  onQuery: () => {},
  onPick: () => {},
};

export function OfficeSearchProvider({ children }) {
  const [catalog, setCatalog] = useState(EMPTY);

  const register = useCallback((next) => {
    setCatalog({
      items: next?.items || [],
      query: next?.query || "",
      onQuery: next?.onQuery || EMPTY.onQuery,
      onPick: next?.onPick || EMPTY.onPick,
    });
    return () => setCatalog(EMPTY);
  }, []);

  const value = useMemo(
    () => ({
      items: catalog.items,
      query: catalog.query,
      onQuery: catalog.onQuery,
      onPick: catalog.onPick,
      register,
    }),
    [catalog, register]
  );

  return <OfficeSearchContext.Provider value={value}>{children}</OfficeSearchContext.Provider>;
}

export function useOfficeSearch() {
  return useContext(OfficeSearchContext);
}

export function useRegisterOfficeSearch(items, query, onQuery, onPick) {
  const ctx = useOfficeSearch();
  const register = ctx?.register;

  useEffect(() => {
    if (!register) return undefined;
    return register({ items, query, onQuery, onPick });
  }, [register, items, query, onQuery, onPick]);
}
