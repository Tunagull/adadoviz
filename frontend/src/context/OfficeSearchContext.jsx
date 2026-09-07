import { useState } from "react";
import {
  OfficeSearchContext,
  createOfficeSearchStore,
} from "./officeSearchStore";

/**
 * Anasayfadaki büro listesini alt çubuktaki gooey aramaya taşır.
 * Store mantığı ve hook'lar `officeSearchStore.js`'te (F-H4).
 */
export function OfficeSearchProvider({ children }) {
  const [store] = useState(createOfficeSearchStore);
  return <OfficeSearchContext.Provider value={store}>{children}</OfficeSearchContext.Provider>;
}
