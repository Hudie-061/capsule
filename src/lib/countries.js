// Countries for shopping: the price search region (Google Shopping `gl`), the currency, and
// where to look for second-hand. Ids match the Worker's COUNTRIES list.
const q = encodeURIComponent;
const vinted = (domain) => ({ id: "vinted", name: "Vinted", cond: "used", note: "Б/у от людей · доставка в пункт выдачи", url: (s) => `https://www.${domain}/catalog?search_text=${q(s)}` });

export const COUNTRIES = [
  { id: "be", name: "Бельгия", currency: "EUR", used: [vinted("vinted.be"), { id: "2dehands", name: "2dehands", cond: "used", note: "Объявления в Бельгии · часто самовывоз", url: (s) => `https://www.2dehands.be/q/${q(s).replace(/%20/g, "+")}/` }] },
  { id: "nl", name: "Нидерланды", currency: "EUR", used: [vinted("vinted.nl"), { id: "marktplaats", name: "Marktplaats", cond: "used", note: "Объявления в Нидерландах", url: (s) => `https://www.marktplaats.nl/q/${q(s).replace(/%20/g, "+")}/` }] },
  { id: "fr", name: "Франция", currency: "EUR", used: [vinted("vinted.fr"), { id: "leboncoin", name: "leboncoin", cond: "used", note: "Объявления во Франции", url: (s) => `https://www.leboncoin.fr/recherche?text=${q(s)}` }] },
  { id: "de", name: "Германия", currency: "EUR", used: [vinted("vinted.de"), { id: "kleinanzeigen", name: "Kleinanzeigen", cond: "used", note: "Объявления в Германии", url: (s) => `https://www.kleinanzeigen.de/s-${q(s.trim().replace(/\s+/g, "-"))}/k0` }] },
  { id: "lu", name: "Люксембург", currency: "EUR", used: [vinted("vinted.lu")] },
  { id: "at", name: "Австрия", currency: "EUR", used: [vinted("vinted.at")] },
  { id: "es", name: "Испания", currency: "EUR", used: [vinted("vinted.es")] },
  { id: "it", name: "Италия", currency: "EUR", used: [vinted("vinted.it")] },
  { id: "pt", name: "Португалия", currency: "EUR", used: [vinted("vinted.pt")] },
  { id: "ie", name: "Ирландия", currency: "EUR", used: [vinted("vinted.ie")] },
  { id: "pl", name: "Польша", currency: "PLN", used: [vinted("vinted.pl")] },
  { id: "gb", name: "Великобритания", currency: "GBP", used: [vinted("vinted.co.uk")] },
  { id: "us", name: "США", currency: "USD", used: [{ id: "ebay", name: "eBay", cond: "used", note: "Б/у и новое от продавцов", url: (s) => `https://www.ebay.com/sch/i.html?_nkw=${q(s)}` }] },
];

export const countryById = (id) => COUNTRIES.find((c) => c.id === id) || COUNTRIES[0];

// Search links when exact prices are not available: Google Shopping in the country + second-hand sites.
export function storeLinks(countryId) {
  const c = countryById(countryId);
  return [
    { id: "google", name: "Google Покупки", cond: "new", note: `Сравнение цен по магазинам · ${c.name}`, url: (s) => `https://www.google.com/search?tbm=shop&gl=${c.id}&hl=ru&q=${q(s)}` },
    ...c.used,
  ];
}

export function money(value, currency = "EUR") {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency, maximumFractionDigits: value % 1 ? 2 : 0 }).format(value);
}
