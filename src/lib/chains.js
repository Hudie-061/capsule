// Popular mass-market chains (the owner's choice, 16.11.2026). Price offers are limited to them:
// at most 2 per chain and 10 in all, cheapest first. Each chain also has a search link on its own
// site with the same query, which costs nothing and works even when Google Shopping has no offer.
//
// Search pages were opened by hand for Belgium (H&M, Zara, Uniqlo, Mango, Foot Locker). Other
// countries use the same pattern where the chain sells online; anything else falls back to a Google
// search inside the chain's site. New Yorker has no search link, so it always uses that fallback.
const q = encodeURIComponent;

const LANG = { be: "nl", nl: "nl", fr: "fr", de: "de", lu: "fr", at: "de", es: "es", it: "it", pt: "pt", ie: "en", pl: "pl", gb: "en", us: "en" };
const HM = { be: "nl_be", nl: "nl_nl", fr: "fr_fr", de: "de_de", at: "de_at", es: "es_es", it: "it_it", pt: "pt_pt", pl: "pl_pl", gb: "en_gb", us: "en_us" };
const UNIQLO = new Set(["be", "nl", "fr", "de", "es", "it", "gb", "us"]);
const MANGO = { be: ["nl", "heren", "dames"], nl: ["nl", "heren", "dames"] };
const FOOTLOCKER = { be: "footlocker.be/nl", nl: "footlocker.nl/nl", fr: "footlocker.fr/fr", de: "footlocker.de/de", lu: "footlocker.lu/fr", at: "footlocker.at/de", es: "footlocker.es/es", it: "footlocker.it/it", pt: "footlocker.pt/pt", ie: "footlocker.ie/en", pl: "footlocker.pl/pl", gb: "footlocker.co.uk/en", us: "footlocker.com" };

// `match` is tested against the shop name Google Shopping gives (`source`).
// `own` = shown as a search link; the rest only count as popular when they appear in offers.
export const CHAINS = [
  { id: "zara", name: "Zara", match: /^zara\b|zara\.com/i, site: "zara.com", own: true,
    search: (c, s, g) => `https://www.zara.com/${c === "gb" ? "uk" : c}/${LANG[c]}/search?searchTerm=${q(s)}${g ? `&section=${g === "female" ? "WOMAN" : "MAN"}` : ""}` },
  { id: "hm", name: "H&M", match: /^h\s*&\s*m\b|^h&amp;m\b|(^|\.)hm\.com/i, site: "hm.com", own: true,
    search: (c, s) => (HM[c] ? `https://www2.hm.com/${HM[c]}/search-results.html?q=${q(s)}` : null) },
  { id: "uniqlo", name: "Uniqlo", match: /uniqlo/i, site: "uniqlo.com", own: true,
    search: (c, s) => (UNIQLO.has(c) ? `https://www.uniqlo.com/${c === "gb" ? "uk" : c}/${LANG[c]}/search?q=${q(s)}` : null) },
  { id: "mango", name: "Mango", match: /^mango\b|mango\.com/i, site: "mango.com", own: true,
    search: (c, s, g) => (MANGO[c] ? `https://shop.mango.com/${c}/${MANGO[c][0]}/search/${g === "female" ? MANGO[c][2] : MANGO[c][1]}?q=${q(s)}` : null) },
  { id: "newyorker", name: "New Yorker", match: /new\s*yorker/i, site: "newyorker.de", own: true, search: () => null },
  { id: "footlocker", name: "Foot Locker", match: /foot\s*locker/i, site: "footlocker.com", own: true, shoes: true,
    search: (c, s) => (c === "us" ? `https://www.footlocker.com/search?query=${q(s)}` : FOOTLOCKER[c] ? `https://www.${FOOTLOCKER[c]}/search?query=${q(s)}` : null) },
  { id: "ca", name: "C&A", match: /^c\s*&\s*a\b/i, site: "c-and-a.com" },
  { id: "pullbear", name: "Pull&Bear", match: /pull\s*(&|and)\s*bear/i, site: "pullandbear.com" },
  { id: "bershka", name: "Bershka", match: /bershka/i, site: "bershka.com" },
  { id: "we", name: "WE Fashion", match: /^we(\s*fashion)?$|wefashion/i, site: "wefashion.com" },
  { id: "jbc", name: "JBC", match: /^jbc\b/i, site: "jbc.be" },
  { id: "jd", name: "JD Sports", match: /^jd(\s*sports)?\b/i, site: "jdsports.com", shoes: true },
];

// Chains searched one by one in «Популярные» (one paid search each, so four at most; ids match the Worker).
export function searchChains(gap) {
  return gap?.part === "shoes" ? ["footlocker", "zara", "hm", "mango"] : ["zara", "hm", "uniqlo", "mango"];
}

export const chainOf = (store) => CHAINS.find((c) => c.match.test(String(store || "").trim())) || null;

// Store search engines want the garment, not "men" or a size: "men charcoal wide leg trousers" → "charcoal wide leg trousers".
export function shopQuery(text) {
  return String(text || "")
    .replace(/\b(men'?s?|women'?s?|male|female|unisex|for (him|her))\b/gi, " ")
    .replace(/\b(size \S+|W\d{2}\s*L\d{2}|EU \d+)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Gender for the shop's men/women section: from the query first, then the profile.
export function queryGender(text, fallback = "") {
  if (/\b(women'?s?|female|for her)\b/i.test(text)) return "female";
  if (/\b(men'?s?|male|for him)\b/i.test(text)) return "male";
  return fallback === "female" || fallback === "male" ? fallback : "";
}

const googleInside = (chain, country, s) => `https://www.google.com/search?q=${q(`${s} site:${chain.site}`)}&gl=${country}`;

// A link that searches the chain's own site (or Google inside it) for this text.
export function chainSearch(chain, country, s, gender = "") {
  return chain.search?.(country, s, gender) || googleInside(chain, country, s);
}

// Search links for the chains that suit this piece: shoe chains only for shoes.
export function chainLinks(country, query, { shoes = false, gender = "" } = {}) {
  const s = shopQuery(query);
  const g = queryGender(query, gender);
  const list = CHAINS.filter((c) => c.own && (!c.shoes || shoes));
  return (shoes ? [...list.filter((c) => c.shoes), ...list.filter((c) => !c.shoes)] : list).map((c) => {
    const own = c.search?.(country, s, g) || "";
    return { id: c.id, name: c.name, url: own || googleInside(c, country, s), own: Boolean(own) };
  });
}

// Popular chains only, new only, at most `perChain` per chain and `max` in all, cheapest first.
export function chainOffers(offers, { perChain = 2, max = 10 } = {}) {
  const taken = new Map();
  const out = [];
  for (const o of [...(offers || [])].sort((a, b) => a.total - b.total)) {
    const chain = chainOf(o.store);
    if (!chain || o.condition === "used") continue;
    const n = taken.get(chain.id) || 0;
    if (n >= perChain) continue;
    taken.set(chain.id, n + 1);
    out.push(o);
    if (out.length >= max) break;
  }
  return out;
}

// Where an offer goes when the shop's exact page is unknown: the chain's search for this product
// name, or a Google search for the name and the shop.
export function offerFallback(offer, country, gender = "") {
  const title = String(offer?.title || "").split(/\s+[|–—]\s+|\s+-\s+(?=[^-]*$)/)[0].slice(0, 80).trim();
  const chain = chainOf(offer?.store);
  if (chain) return chainSearch(chain, country, shopQuery(title) || title, gender);
  return `https://www.google.com/search?q=${q(`${title} ${offer?.store || ""}`.trim())}&gl=${country}`;
}
