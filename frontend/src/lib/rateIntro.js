/*
  Kur kartlarındaki giriş animasyonu (roller sayaç) SADECE kullanıcı kurları
  ilk defa gördüğünde oynar. "İlk defa" = bu tarayıcıda bir kez — bayrak
  localStorage'da tutulur.

  localStorage okunamıyorsa (gizli sekme, kapalı depolama) animasyonu
  oynatMA — güvenli varsayılan, çünkü "görüldü" bilgisini kalıcı yazamayız
  ve her açılışta tekrar oynaması can sıkıcı olur.
*/
const SEEN_KEY = "adadoviz:rates-intro-seen";

export function shouldPlayRateIntro() {
  try {
    return window.localStorage.getItem(SEEN_KEY) == null;
  } catch {
    return false;
  }
}

export function markRateIntroSeen() {
  try {
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* yut — bir dahaki sefere shouldPlayRateIntro zaten false döndürecek */
  }
}
