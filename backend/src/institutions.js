/** Kurum kimlikleri — frontend LOCAL_BANKS ile uyumlu. */
const INSTITUTIONS = [
  { id: "ziraat", name: "Ziraat Bankası" },
  { id: "garanti", name: "Garanti BBVA" },
  { id: "akbank", name: "Akbank" },
  { id: "isbank", name: "Türkiye İş Bankası" },
  { id: "yapikredi", name: "Yapı Kredi" },
  { id: "halkbank", name: "Halkbank" },
  { id: "vakifbank", name: "VakıfBank" },
  { id: "qnb", name: "QNB Finansbank" },
  { id: "denizbank", name: "DenizBank" },
  { id: "kuveytturk", name: "Kuveyt Türk" },
  { id: "teb", name: "TEB" },
  { id: "ing", name: "ING Bank" },
  { id: "odeabank", name: "Odeabank" },
  { id: "fibabanka", name: "Fibabanka" },
  { id: "albaraka", name: "Albaraka Türk" },
  { id: "sun_doviz", name: "Sun Döviz" },
];

const CURRENCIES = ["EUR", "USD", "GBP", "ALTIN"];

function findInstitutionByName(bankName) {
  const normalized = String(bankName || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  return (
    INSTITUTIONS.find((inst) => {
      const target = inst.name
        .toLocaleLowerCase("tr-TR")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      return normalized === target || normalized.includes(target) || target.includes(normalized);
    }) || null
  );
}

function findInstitutionById(institutionId) {
  return INSTITUTIONS.find((inst) => inst.id === institutionId) || null;
}

module.exports = {
  INSTITUTIONS,
  CURRENCIES,
  findInstitutionByName,
  findInstitutionById,
};
