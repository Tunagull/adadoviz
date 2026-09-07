/**
 * P3.5 — İçerik / landing sayfaları (C9).
 *
 * Statik ilk sürüm: içerik burada yapılandırılmış veri olarak yaşar (markdown
 * + build-time derleyici yerine — eklenti gerektirmez). `ContentPage.jsx` bu
 * kaydı `type/slug` ile okuyup `SeoHead` + JSON-LD (Article + FAQPage +
 * BreadcrumbList) üretir. İleride superadmin'den düzenlenebilir hale gelirse
 * (`content_pages` tablosu) bu dosya fallback kalır.
 *
 * Her giriş: { type, slug, updated, tr:{...}, en:{...} }
 *   tr/en: { title, description, h1, lead, sections:[{h, p:[], list?:[]}],
 *            faq:[{q,a}], related:[{label, to}] }
 */

export const CONTENT_TYPES = ["rehber", "kur", "sehir"];

const PAGES = [
  {
    type: "rehber",
    slug: "kktc-doviz-bozdurma",
    updated: "2026-09-07",
    tr: {
      title: "KKTC'de Döviz Bozdurma Rehberi (2026)",
      description:
        "KKTC'de döviz nasıl bozdurulur? Alış-satış kuru, komisyon, güvenilir büro seçimi ve en iyi kuru bulmanın pratik yolları.",
      h1: "KKTC'de Döviz Nasıl Bozdurulur?",
      lead: "Kuzey Kıbrıs'ta döviz bozdururken kur farkını, komisyonu ve büro seçimini doğru yönetmek için bilmeniz gerekenler.",
      sections: [
        {
          h: "Resmî para birimi ve kullanılan dövizler",
          p: [
            "KKTC'de resmî para birimi Türk Lirası'dır. Günlük hayatta ABD doları (USD), euro (EUR) ve İngiliz sterlini (GBP) de yaygın olarak elden çıkarılır.",
            "Turistik bölgelerde işletmeler döviz kabul edebilir, ancak uyguladıkları kur genellikle yetkili bir döviz bürosundan alacağınız kurdan düşüktür. Nakit ihtiyacınızı büroda bozdurmak çoğu zaman daha avantajlıdır.",
          ],
        },
        {
          h: "Nerede bozdurulur?",
          p: [
            "Üç ana seçenek vardır: yetkili döviz büroları, bankalar ve bazı oteller. Döviz büroları genelde bankalardan daha iyi kur verir, işlem hızlıdır ve çoğu komisyon almaz.",
            "Bankalar daha kurumsal bir kayıt sağlar ama kurları genelde daha dezavantajlıdır ve işlem ücreti uygulayabilir.",
          ],
        },
        {
          h: "Alış ve satış kuru ne demek?",
          p: [
            "Büro sizden döviz alırken 'alış' kurunu, size döviz satarken 'satış' kurunu uygular. İkisi arasındaki farka spread denir ve bu fark büronun kârıdır.",
            "Elinizdeki dövizi TL'ye çeviriyorsanız sizin için önemli olan alış kurudur; ne kadar yüksekse elinize o kadar çok TL geçer.",
          ],
        },
        {
          h: "İyi kuru nasıl bulursunuz?",
          p: [
            "Tek bir büroya bakıp karar vermeyin. Aynı şehirdeki birkaç büronun kurunu karşılaştırın — birkaç kuruşluk fark bile büyük miktarlarda anlam taşır.",
            "AdaDöviz canlı listede tüm büroların anlık alış/satış kurunu yan yana gösterir; 'Bugünkü en iyi kur' aracı ise girdiğiniz tutara göre elinize en çok TL'yi geçirecek büroyu sıralar.",
          ],
        },
        {
          h: "Dikkat edilecekler",
          p: [
            "İlan edilen kur ile kasada uygulanan kur aynı mı, teyit edin.",
            "İşlem sonrası makbuz isteyin.",
            "Büyük miktarlarda kimlik istenebilir; bu normaldir.",
            "Vitrindeki 'komisyon yok' ibaresi her zaman geçerli olmayabilir — sorun.",
          ],
        },
      ],
      faq: [
        {
          q: "KKTC'de dolar bozdurmak için komisyon ödenir mi?",
          a: "Çoğu yetkili döviz bürosu komisyon almaz; kâr alış ile satış kuru arasındaki farktadır. Bankalar işlem ücreti uygulayabilir.",
        },
        {
          q: "Banka mı, döviz bürosu mu daha iyi?",
          a: "Döviz büroları genelde daha iyi kur verir ve işlem daha hızlıdır. Kurumsal kayıt önemliyse banka tercih edilebilir.",
        },
        {
          q: "Kıbrıs'ta euro geçer mi?",
          a: "Güney Kıbrıs'ta euro resmî para birimidir. KKTC'de resmî para Türk Lirası'dır; birçok işletme euro, sterlin ve dolar kabul eder ama kur genelde döviz bürosundan düşüktür.",
        },
        {
          q: "En iyi kuru nasıl bulurum?",
          a: "AdaDöviz'de tüm büroların canlı kurunu karşılaştırın veya 'Bugünkü en iyi kur' aracına tutarınızı girin.",
        },
      ],
      related: [
        { label: "Bugünkü en iyi kur", to: "/en-iyi-kur" },
        { label: "Döviz bürosu haritası", to: "/harita" },
        { label: "Dolar/TL kuru", to: "/kur/usd-try" },
      ],
    },
    en: {
      title: "Exchanging Currency in North Cyprus (2026 Guide)",
      description:
        "How to exchange currency in North Cyprus: buy/sell rates, commission, choosing a trusted bureau and practical ways to find the best rate.",
      h1: "How to Exchange Currency in North Cyprus",
      lead: "What you need to know to handle the spread, commission and bureau choice when changing money in North Cyprus.",
      sections: [
        {
          h: "Official currency and what is accepted",
          p: [
            "The official currency of North Cyprus (KKTC) is the Turkish Lira. US dollars (USD), euros (EUR) and British pounds (GBP) are also widely exchanged in daily life.",
            "In tourist areas businesses may accept foreign cash, but the rate they apply is usually worse than an authorised exchange bureau. Changing cash at a bureau is generally the better deal.",
          ],
        },
        {
          h: "Where to exchange",
          p: [
            "Three main options: authorised exchange bureaus, banks and some hotels. Bureaus usually give a better rate than banks, are faster and mostly charge no commission.",
            "Banks give a more formal record but tend to offer worse rates and may charge a transaction fee.",
          ],
        },
        {
          h: "What buy and sell rates mean",
          p: [
            "A bureau applies its 'buy' rate when it takes foreign currency from you, and its 'sell' rate when it sells foreign currency to you. The gap between them is the spread — the bureau's margin.",
            "If you are converting foreign cash into lira, the buy rate is what matters: the higher it is, the more lira you receive.",
          ],
        },
        {
          h: "How to find a good rate",
          p: [
            "Don't decide based on one bureau. Compare several in the same city — even a small difference adds up on larger amounts.",
            "AdaDöviz shows every bureau's live buy/sell rate side by side; the 'best rate today' tool ranks bureaus by how much lira you would actually receive for your amount.",
          ],
        },
        {
          h: "Things to watch",
          p: [
            "Confirm that the displayed rate matches the rate applied at the counter.",
            "Ask for a receipt after the transaction.",
            "ID may be requested for larger amounts — this is normal.",
            "A 'no commission' sign may not always apply — ask.",
          ],
        },
      ],
      faq: [
        {
          q: "Is there a commission to exchange dollars in North Cyprus?",
          a: "Most authorised bureaus charge no commission; their margin is the gap between the buy and sell rate. Banks may charge a transaction fee.",
        },
        {
          q: "Bank or exchange bureau — which is better?",
          a: "Bureaus usually give a better rate and are faster. Choose a bank if a formal corporate record matters.",
        },
        {
          q: "Are euros accepted in Cyprus?",
          a: "The euro is official in the south. In North Cyprus the official currency is the Turkish Lira; many businesses accept euros, pounds and dollars but at a rate worse than a bureau.",
        },
        {
          q: "How do I find the best rate?",
          a: "Compare every bureau's live rate on AdaDöviz, or enter your amount into the 'best rate today' tool.",
        },
      ],
      related: [
        { label: "Best rate today", to: "/en-iyi-kur" },
        { label: "Bureau map", to: "/harita" },
        { label: "USD/TRY rate", to: "/kur/usd-try" },
      ],
    },
  },

  {
    type: "kur",
    slug: "usd-try",
    updated: "2026-09-07",
    tr: {
      title: "KKTC Dolar/TL Kuru (USD/TRY)",
      description:
        "KKTC döviz bürolarında güncel dolar alış ve satış kuru nasıl okunur, kuru ne etkiler ve en iyi USD/TRY kuru nasıl bulunur.",
      h1: "KKTC'de Dolar/TL (USD/TRY) Kuru",
      lead: "Kuzey Kıbrıs döviz bürolarında dolar alış-satış kuru: nasıl çalışır, ne zaman bozdurmalı ve nerede en iyi kur var.",
      sections: [
        {
          h: "USD/TRY nedir?",
          p: [
            "USD/TRY, 1 ABD dolarının Türk Lirası karşılığıdır. KKTC'de günlük hayatta en çok işlem gören paritedir; turistlerin ve yerlilerin en sık bozdurduğu döviz dolardır.",
          ],
        },
        {
          h: "Alış ve satış",
          p: [
            "Büro dolarınızı 'alış' kurundan alır, size dolar satarken 'satış' kurunu uygular. Satış kuru her zaman alıştan biraz yüksektir; aradaki fark büronun kârıdır.",
            "Dolar bozduruyorsanız alış kuruna, dolar alıyorsanız satış kuruna bakın.",
          ],
        },
        {
          h: "Kuru ne etkiler?",
          p: [
            "Uluslararası piyasalar ve TCMB politikası ana belirleyicidir.",
            "KKTC Merkez Bankası'nın yayımladığı referans kur büroların çıpasıdır.",
            "Her büronun uyguladığı marj ve o günkü nakit yoğunluğu kuru birkaç kuruş oynatabilir.",
          ],
        },
        {
          h: "KKTC'de en iyi dolar kuru nerede?",
          p: [
            "Sabit bir cevabı yoktur — büroların kuru gün içinde değişir. Pratik yöntem, birden çok büronun anlık kurunu aynı anda karşılaştırmaktır.",
            "AdaDöviz canlı listede tüm büroların dolar alış/satış kurunu gösterir; 'Bugünkü en iyi kur' aracına tutarınızı girip USD seçerek elinize en çok TL'yi geçirecek büroyu bulabilirsiniz.",
          ],
        },
      ],
      faq: [
        {
          q: "KKTC'de bugün dolar ne kadar?",
          a: "Kur gün içinde değişir. AdaDöviz canlı listede tüm KKTC döviz bürolarının anlık dolar alış ve satış kurunu görebilirsiniz.",
        },
        {
          q: "Dolar bozdurmanın en iyi zamanı ne?",
          a: "Kur oynaklığını önceden bilmek zordur. En pratik yöntem, bozduracağınız an birden çok büroyu karşılaştırıp en yüksek alış kurunu seçmektir.",
        },
        {
          q: "Döviz büroları doları hangi kurdan alır?",
          a: "'Alış' kurundan. Size dolar satarken uyguladıkları 'satış' kuru her zaman biraz daha yüksektir.",
        },
      ],
      related: [
        { label: "Bugünkü en iyi dolar kuru", to: "/en-iyi-kur?birim=USD" },
        { label: "Döviz bozdurma rehberi", to: "/rehber/kktc-doviz-bozdurma" },
        { label: "Girne'de döviz bürosu", to: "/sehir/girne" },
      ],
    },
    en: {
      title: "North Cyprus USD/TRY (Dollar to Lira) Rate",
      description:
        "How to read the live dollar buy/sell rate at North Cyprus exchange bureaus, what moves it and how to find the best USD/TRY rate.",
      h1: "USD/TRY (Dollar to Lira) Rate in North Cyprus",
      lead: "Dollar buy and sell rates at North Cyprus bureaus: how it works, when to exchange and where the best rate is.",
      sections: [
        {
          h: "What is USD/TRY?",
          p: [
            "USD/TRY is the value of one US dollar in Turkish Lira. It is the most traded pair in daily life in North Cyprus — the dollar is what tourists and locals exchange most often.",
          ],
        },
        {
          h: "Buy and sell",
          p: [
            "A bureau takes your dollars at its 'buy' rate and sells you dollars at its 'sell' rate. The sell rate is always a little higher; the gap is the bureau's margin.",
            "If you are selling dollars, watch the buy rate; if you are buying dollars, watch the sell rate.",
          ],
        },
        {
          h: "What moves the rate?",
          p: [
            "International markets and Turkish central bank policy are the main drivers.",
            "The reference rate published by the North Cyprus Central Bank is the anchor bureaus price against.",
            "Each bureau's margin and its cash position on the day can move the rate by a few kuruş.",
          ],
        },
        {
          h: "Where is the best dollar rate in North Cyprus?",
          p: [
            "There is no fixed answer — bureau rates change through the day. The practical method is to compare several bureaus' live rates at the same time.",
            "AdaDöviz shows every bureau's dollar buy/sell rate live; enter your amount into the 'best rate today' tool and pick USD to find the bureau that leaves you with the most lira.",
          ],
        },
      ],
      faq: [
        {
          q: "How much is a dollar in North Cyprus today?",
          a: "The rate changes through the day. AdaDöviz shows the live dollar buy and sell rate for every North Cyprus bureau.",
        },
        {
          q: "When is the best time to exchange dollars?",
          a: "Rate swings are hard to predict. The practical method is to compare several bureaus at the moment you exchange and take the highest buy rate.",
        },
        {
          q: "What rate do bureaus buy dollars at?",
          a: "The 'buy' rate. The 'sell' rate they apply when selling you dollars is always a little higher.",
        },
      ],
      related: [
        { label: "Best dollar rate today", to: "/en-iyi-kur?birim=USD" },
        { label: "Currency exchange guide", to: "/rehber/kktc-doviz-bozdurma" },
        { label: "Exchange bureaus in Kyrenia", to: "/sehir/girne" },
      ],
    },
  },

  {
    type: "sehir",
    slug: "girne",
    updated: "2026-09-07",
    tr: {
      title: "Girne'de Döviz Bürosu ve Kur Karşılaştırma",
      description:
        "Girne'de güvenilir döviz bürosu bulma, güncel dolar/euro/sterlin kurlarını karşılaştırma, yol tarifi ve pratik ipuçları.",
      h1: "Girne'de Döviz Bozdurma ve Döviz Büroları",
      lead: "Girne'de döviz bozdururken en iyi kuru bulmanın, güvenilir büro seçmenin ve en yakın büroya ulaşmanın yolları.",
      sections: [
        {
          h: "Girne'de döviz bozdurma",
          p: [
            "Girne KKTC'nin en yoğun turistik merkezlerinden biridir; liman çevresinde ve şehir merkezinde çok sayıda yetkili döviz bürosu bulunur.",
            "Oteller ve bazı işletmeler döviz kabul eder, ancak uyguladıkları kur genelde döviz bürosundan alacağınızdan düşüktür. Nakit ihtiyacınızı büroda bozdurmak daha avantajlıdır.",
          ],
        },
        {
          h: "Kurları karşılaştırın",
          p: [
            "AdaDöviz'de şehir filtresini Girne yapıp tüm büroların anlık dolar, euro ve sterlin alış/satış kurunu yan yana görebilirsiniz.",
            "Harita görünümünde bürolar konumlarıyla listelenir; 'Bana en yakın' ile bulunduğunuz noktaya en yakın büroyu ve yol tarifini alırsınız.",
          ],
        },
        {
          h: "Pratik ipuçları",
          p: [
            "Merkeze yakın birkaç büronun kurunu karşılaştırmadan bozdurmayın.",
            "Vitrindeki kur ile kasadaki kuru teyit edin.",
            "İşlem sonrası makbuz alın.",
          ],
        },
      ],
      faq: [
        {
          q: "Girne'de nerede döviz bozdurulur?",
          a: "Liman çevresi ve şehir merkezindeki yetkili döviz bürolarında. AdaDöviz haritasından size en yakın büroyu ve yol tarifini bulabilirsiniz.",
        },
        {
          q: "Girne'de otelde döviz bozdurmak mantıklı mı?",
          a: "Genelde hayır. Oteller döviz bürolarından belirgin şekilde daha düşük kur verir.",
        },
        {
          q: "Girne'de en iyi kur hangi büroda?",
          a: "Değişkendir ve gün içinde oynar. AdaDöviz'de Girne'yi filtreleyip büroları canlı karşılaştırmak en doğru yöntemdir.",
        },
      ],
      related: [
        { label: "Girne büro haritası", to: "/harita?sehir=girne" },
        { label: "Bugünkü en iyi kur", to: "/en-iyi-kur" },
        { label: "Döviz bozdurma rehberi", to: "/rehber/kktc-doviz-bozdurma" },
      ],
    },
    en: {
      title: "Currency Exchange Bureaus in Kyrenia (Girne)",
      description:
        "Finding a trusted exchange bureau in Kyrenia, comparing live USD/EUR/GBP rates, directions and practical tips.",
      h1: "Currency Exchange in Kyrenia (Girne)",
      lead: "How to find the best rate, choose a trusted bureau and reach the nearest one when exchanging money in Kyrenia.",
      sections: [
        {
          h: "Exchanging money in Kyrenia",
          p: [
            "Kyrenia is one of North Cyprus's busiest tourist centres, with many authorised exchange bureaus around the harbour and in the town centre.",
            "Hotels and some businesses accept foreign cash, but at a rate usually worse than a bureau. Changing cash at a bureau is the better deal.",
          ],
        },
        {
          h: "Compare the rates",
          p: [
            "Set the city filter to Kyrenia on AdaDöviz to see every bureau's live dollar, euro and pound buy/sell rate side by side.",
            "The map view lists bureaus by location; 'nearest to me' finds the closest bureau and directions from where you are.",
          ],
        },
        {
          h: "Practical tips",
          p: [
            "Don't exchange before comparing a few bureaus near the centre.",
            "Confirm the window rate matches the counter rate.",
            "Take a receipt after the transaction.",
          ],
        },
      ],
      faq: [
        {
          q: "Where can I exchange money in Kyrenia?",
          a: "At authorised bureaus around the harbour and in the town centre. The AdaDöviz map finds the nearest one and directions.",
        },
        {
          q: "Is exchanging money at a hotel in Kyrenia worth it?",
          a: "Usually not. Hotels give a noticeably worse rate than exchange bureaus.",
        },
        {
          q: "Which bureau has the best rate in Kyrenia?",
          a: "It varies and moves through the day. Filtering Kyrenia on AdaDöviz and comparing bureaus live is the most reliable method.",
        },
      ],
      related: [
        { label: "Kyrenia bureau map", to: "/harita?sehir=girne" },
        { label: "Best rate today", to: "/en-iyi-kur" },
        { label: "Currency exchange guide", to: "/rehber/kktc-doviz-bozdurma" },
      ],
    },
  },
];

const BY_KEY = new Map(PAGES.map((p) => [`${p.type}/${p.slug}`, p]));

/** type + slug → içerik girişi (yoksa null). */
export function getContentPage(type, slug) {
  return BY_KEY.get(`${String(type || "")}/${String(slug || "")}`) || null;
}

/** Belirli tipteki tüm girişler (ör. rehber listesi / sitemap). */
export function listContentPages(type) {
  return type ? PAGES.filter((p) => p.type === type) : [...PAGES];
}

/** type/slug → tam yol. */
export function contentPath(type, slug) {
  return `/${type}/${slug}`;
}
