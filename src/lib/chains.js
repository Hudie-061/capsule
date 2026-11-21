// Popular mass-market chains (the owner's choice, 16.11.2026). Price offers are limited to them:
// at most 2 per chain and 10 in all, cheapest first. Each chain also has a search link on its own
// site with the same query, which costs nothing and works even when Google Shopping has no offer.
//
// Search pages were opened by hand for Belgium (H&M, Zara, Uniqlo, Mango, Foot Locker). Other
// countries use the same pattern where the chain sells online; anything else falls back to a Google
// search inside the chain's site. New Yorker has no search link, so it always uses that fallback.
import { colorNameEn } from "./colors.js";
import { kindOf } from "./kinds.js";

const q = encodeURIComponent;

const LANG = { be: "nl", nl: "nl", fr: "fr", de: "de", lu: "fr", at: "de", es: "es", it: "it", pt: "pt", ie: "en", pl: "pl", gb: "en", us: "en" };
const HM = { be: "nl_be", nl: "nl_nl", fr: "fr_fr", de: "de_de", at: "de_at", es: "es_es", it: "it_it", pt: "pt_pt", pl: "pl_pl", gb: "en_gb", us: "en_us" };
const UNIQLO = new Set(["be", "nl", "fr", "de", "es", "it", "gb", "us"]);
const MANGO = { be: ["nl", "heren", "dames"], nl: ["nl", "heren", "dames"] };
// Zalando: [domain, men, women, everyone]. Filters in the link, checked by hand on zalando.be 18.11.2026:
// order=price&dir=asc (cheapest first), sizes=M / 33 / 52 / 42.5, length=32 (inside leg), sale=true
// (discounted only), price_to=50. Zalando turns sizes into its own path (/heren/__maat-33/).
const ZALANDO = {
  be: ["zalando.be", "heren", "dames", "catalogus"], nl: ["zalando.nl", "heren", "dames", "catalogus"],
  fr: ["zalando.fr", "homme", "femme", "catalogue"], de: ["zalando.de", "herren", "damen", "katalog"],
  at: ["zalando.at", "herren", "damen", "katalog"], gb: ["zalando.co.uk", "men", "women", "catalogue"],
};

// The filters a shop link can carry: the size picked in «Покупки», sale only, a budget.
// `size` is { system, pick } from sizes.js (pick: "M", 52, 42.5, or { w, l } for jeans).
function zalandoLink(c, s, g, { size = null, sale = false, budget = 0 } = {}) {
  const z = ZALANDO[c];
  if (!z) return null;
  const params = new URLSearchParams({ q: s });
  if (size?.pick != null) {
    if (size.system === "wl") { params.set("sizes", String(size.pick.w)); params.set("length", String(size.pick.l)); }
    else params.set("sizes", String(size.pick));
  }
  if (sale) params.set("sale", "true");
  if (budget > 0) params.set("price_to", String(budget));
  params.set("order", "price");
  params.set("dir", "asc");
  return `https://www.${z[0]}/${g === "female" ? z[2] : g === "male" ? z[1] : z[3]}/?${params.toString()}`;
}
const FOOTLOCKER = { be: "footlocker.be/nl", nl: "footlocker.nl/nl", fr: "footlocker.fr/fr", de: "footlocker.de/de", lu: "footlocker.lu/fr", at: "footlocker.at/de", es: "footlocker.es/es", it: "footlocker.it/it", pt: "footlocker.pt/pt", ie: "footlocker.ie/en", pl: "footlocker.pl/pl", gb: "footlocker.co.uk/en", us: "footlocker.com" };

// Filters in the other shops' links, checked by hand on the Belgian sites 18.11.2026:
// H&M sort=ascPrice and letter sizes as sizes=menswear;NO_FORMAT[SML];L (their numeric sizes use other
// formats, so only letters); Uniqlo sort=2; Foot Locker sort=price-asc. Zara and Mango keep no filters in
// the address, so their links stay a plain search.
function hmLink(c, s, g, { size = null } = {}) {
  if (!HM[c]) return null;
  const params = new URLSearchParams({ q: s });
  if (size?.system === "letter" && size.pick && (g === "male" || g === "female")) params.set("sizes", `${g === "female" ? "womenswear" : "menswear"};NO_FORMAT[SML];${size.pick}`);
  params.set("sort", "ascPrice");
  return `https://www2.hm.com/${HM[c]}/search-results.html?${params.toString()}`;
}

// About You (aboutyou.be/.nl/.de…): its own search has no address with the query in it, so the link is a
// Google search inside the country's About You site. Its offers come from the price search like the rest.
const ABOUTYOU = { be: "aboutyou.be", nl: "aboutyou.nl", de: "aboutyou.de", at: "aboutyou.at", pl: "aboutyou.pl", es: "aboutyou.es", it: "aboutyou.it", pt: "aboutyou.pt", ie: "aboutyou.ie", lu: "aboutyou.lu" };

// SHEIN (added at the owner's request, 19.11.2026): its search page m.shein.com/<site>/pdsearch/<query>/ —
// the query already says gender, colour and type in English ("women white t-shirt"), which is what the
// owner sets by hand there. Belgium uses the EU site (euqs, the address the owner sent). Sizes are SHEIN's
// own attribute codes (size = attribute 87). They were read from two links the owner sent on 19.11.2026:
// one with only M (87_417), one with every letter size ticked — the address lists the codes in the order
// of the size panel (XXS, XS, XS/S, S, S/M, M, …), and M is 6th there too. SHEIN also sells combined
// sizes ("S/M", "M/L"), so a person in M also gets S/M and M/L. Colours stay in the words: SHEIN files
// one colour under many codes (white is 27_739 and 27_103). SHEIN blocks automated browsers with a
// captcha, so these links were not opened here: the owner checks them on the phone.
const SHEIN = { be: "euqs", lu: "euqs", at: "euqs", ie: "euqs", pt: "euqs", nl: "nl", fr: "fr", de: "de", es: "es", it: "it", pl: "pl", us: "us" };
const SHEIN_SIZE_CODES = { XXS: 755, XS: 568, "XS/S": 1002166, S: 66916637, "S/M": 1002167, M: 417, "M/L": 387, L: 754, "L/XL": 756, XL: 1004710, "XL/XXL": 757, XXL: 66916697, "3XL": 759, "4XL": 758, "5XL": 1006125 };
// the person's size → the SHEIN sizes that fit (the size itself and the combined ones that include it)
const SHEIN_FITS = { XS: ["XS", "XS/S"], S: ["S", "XS/S", "S/M"], M: ["M", "S/M", "M/L"], L: ["L", "M/L", "L/XL"], XL: ["XL", "L/XL", "XL/XXL"], XXL: ["XXL", "XL/XXL"], "3XL": ["3XL"] };
const sheinSizes = (size) => (size?.system === "letter" ? SHEIN_FITS[size.pick] || [] : []);
function sheinLink(c, s, g, { size = null } = {}) {
  const base = c === "gb" ? "https://m.shein.co.uk" : `https://m.shein.com/${SHEIN[c] || "euqs"}`;
  const codes = sheinSizes(size).map((name) => `87_${SHEIN_SIZE_CODES[name]}`).join("-");
  // SHEIN has no men/women section in a search address, so the gender goes into the words
  const words = [g === "female" ? "women" : g === "male" ? "men" : "", s].filter(Boolean).join(" ");
  return `${base}/pdsearch/${q(words)}/${codes ? `?attr_ids=${codes}` : ""}`;
}
const sheinHasSize = (size) => sheinSizes(size).length > 0;

// `match` is tested against the shop name Google Shopping gives (`source`).
// `own` = shown as a search link; the rest only count as popular when they appear in offers.
export const CHAINS = [
  { id: "zara", name: "Zara", match: /^zara\b|zara\.com/i, site: "zara.com", own: true,
    search: (c, s, g) => `https://www.zara.com/${c === "gb" ? "uk" : c}/${LANG[c]}/search?searchTerm=${q(s)}${g ? `&section=${g === "female" ? "WOMAN" : "MAN"}` : ""}` },
  { id: "hm", name: "H&M", match: /^h\s*&\s*m\b|^h&amp;m\b|(^|\.)hm\.com/i, site: "hm.com", own: true, search: hmLink },
  { id: "uniqlo", name: "Uniqlo", match: /uniqlo/i, site: "uniqlo.com", own: true,
    search: (c, s) => (UNIQLO.has(c) ? `https://www.uniqlo.com/${c === "gb" ? "uk" : c}/${LANG[c]}/search?q=${q(s)}&sort=2` : null) },
  { id: "mango", name: "Mango", match: /^mango\b|mango\.com/i, site: "mango.com", own: true,
    search: (c, s, g) => (MANGO[c] ? `https://shop.mango.com/${c}/${MANGO[c][0]}/search/${g === "female" ? MANGO[c][2] : MANGO[c][1]}?q=${q(s)}` : null) },
  // Not a chain but the biggest fashion marketplace here: many brands, unusual pieces, Black Friday deals.
  { id: "zalando", name: "Zalando", match: /zalando/i, site: "zalando.com", own: true, filters: true,
    search: zalandoLink },
  // The other big fashion marketplace in Belgium, the Netherlands and Germany.
  { id: "aboutyou", name: "About You", match: /about\s*you/i, site: "aboutyou.com", sites: ABOUTYOU, own: true, search: () => null },
  // A huge cheap catalogue; a free link only (no price search).
  { id: "shein", name: "SHEIN", match: /shein/i, site: "shein.com", own: true, search: sheinLink },
  { id: "newyorker", name: "New Yorker", match: /new\s*yorker/i, site: "newyorker.de", own: true, search: () => null },
  { id: "footlocker", name: "Foot Locker", match: /foot\s*locker/i, site: "footlocker.com", own: true, shoes: true,
    search: (c, s) => (c === "us" ? `https://www.footlocker.com/search?query=${q(s)}&sort=price-asc` : FOOTLOCKER[c] ? `https://www.${FOOTLOCKER[c]}/search?query=${q(s)}&sort=price-asc` : null) },
  { id: "ca", name: "C&A", match: /^c\s*&\s*a\b/i, site: "c-and-a.com" },
  { id: "pullbear", name: "Pull&Bear", match: /pull\s*(&|and)\s*bear/i, site: "pullandbear.com" },
  { id: "bershka", name: "Bershka", match: /bershka/i, site: "bershka.com" },
  { id: "we", name: "WE Fashion", match: /^we(\s*fashion)?$|wefashion/i, site: "wefashion.com" },
  { id: "jbc", name: "JBC", match: /^jbc\b/i, site: "jbc.be" },
  { id: "jd", name: "JD Sports", match: /^jd(\s*sports)?\b/i, site: "jdsports.com", shoes: true },
];

// Shops whose prices «Сравнить цены» searches (one paid search each; ids match the Worker). Since
// 19.11.2026 only the two marketplaces — Zalando and About You, two searches instead of five; every other
// shop is a free link tile that opens its own search with the filters it understands.
export function searchChains() {
  return ["zalando", "aboutyou"];
}

export const chainOf = (store) => CHAINS.find((c) => c.match.test(String(store || "").trim())) || null;

// The search text for shops, always in English: the stylist's English query, or — when a piece only has a
// Russian name (older links, a piece from the wardrobe) — gender + colour + type built on the phone
// ("men blue jeans"). The gender word is added when the query lacks it.
const CYRILLIC = /[а-яё]/i;
export function shopQueryFor(gap, gender = "") {
  const g = gender === "female" ? "women" : gender === "male" ? "men" : "";
  const q = String(gap?.query || "").trim();
  if (q && !CYRILLIC.test(q)) return !g || /\b(men|women)'?s?\b/i.test(q) ? q : `${g} ${q}`;
  const kind = kindOf(gap || {});
  return [g, colorNameEn(gap?.color), kind && !CYRILLIC.test(kind) ? kind : "clothing"].filter(Boolean).join(" ");
}

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

const googleInside = (chain, country, s) => `https://www.google.com/search?q=${q(`${s} site:${chain.sites?.[country] || chain.site}`)}&gl=${country}`;
// A chain without its own search link (Pull&Bear, Bershka…): Google search inside its site.
export function siteSearch(chainId, country, query) {
  const chain = CHAINS.find((c) => c.id === chainId);
  return chain ? googleInside(chain, country, shopQuery(query)) : "";
}

// A link that searches the chain's own site (or Google inside it) for this text. `filters` (size, sale,
// budget) are added where the shop's link supports them (Zalando).
export function chainSearch(chain, country, s, gender = "", filters = {}) {
  return chain.search?.(country, s, gender, filters) || googleInside(chain, country, s);
}

// The Zalando search with the person's size, cheapest first (and sale only / budget): the «wow» link.
export function zalandoSearch(country, query, { gender = "", size = null, sale = false, budget = 0 } = {}) {
  return zalandoLink(country, shopQuery(query), queryGender(query, gender), { size, sale, budget });
}

// Search links for the chains that suit this piece: shoe chains only for shoes.
// What each shop link does, in a few words for its tile («твой размер M · сначала дешёвые»): only the
// filters that shop's address really carries (see the notes above each link builder).
function linkNotes(id, own, { size = null, sale = false, budget = 0 } = {}, g = "", money = (n) => `${n}`) {
  if (!own) return ["поиск Google по сайту"];
  const sizeLabel = size?.pick == null ? "" : size.system === "wl" ? `W${size.pick.w} L${size.pick.l}` : `${size.pick}`;
  const sex = g === "female" ? "женское" : g === "male" ? "мужское" : "";
  if (id === "zalando") return [sizeLabel ? `твой размер ${sizeLabel}` : "все размеры", "сначала дешёвые", sale ? "только скидки" : "", budget ? `до ${money(budget)}` : ""];
  if (id === "hm") return [size?.system === "letter" && sex ? `размер ${sizeLabel}` : "", "сначала дешёвые"];
  if (id === "uniqlo" || id === "footlocker") return ["сначала дешёвые"];
  if (id === "shein") return [sex, sheinHasSize(size) ? `размер ${sizeLabel}${sheinSizes(size).length > 1 ? ` (и ${sheinSizes(size).slice(1).join(", ")})` : ""}` : "размер — на сайте", "цвет и тип в поиске"];
  return [sex, "поиск на сайте"];
}

// The shop tiles in «Покупки»: every shop's own search with the filters it understands (free).
// Zalando, About You and SHEIN first (the marketplaces), shoe chains for shoes, then the chains.
// `money` formats the budget in the country's currency for the tile.
// «Найти похожую» from «Хочу купить» (the owner, 21.11.2026): these five shops first, in this order.
export const WISH_SHOPS = ["zara", "hm", "zalando", "uniqlo", "shein"];

// `prefer`: shop ids to put first, in that order (the rest follow as usual).
export function chainLinks(country, query, { shoes = false, gender = "", filters = {}, money, prefer = null } = {}) {
  const s = shopQuery(query);
  const g = queryGender(query, gender);
  const list = CHAINS.filter((c) => c.own && (!c.shoes || shoes));
  const usual = (c) => (c.id === "zalando" ? 0 : c.id === "aboutyou" ? 1 : c.id === "shein" ? 2 : c.shoes ? 3 : 4);
  const rank = (c) => (prefer?.includes(c.id) ? prefer.indexOf(c.id) - 100 : usual(c));
  return [...list].sort((a, b) => rank(a) - rank(b)).map((c) => {
    const own = c.search?.(country, s, g, filters) || "";
    return { id: c.id, name: c.name, url: own || googleInside(c, country, s), own: Boolean(own), notes: linkNotes(c.id, Boolean(own), filters, g, money).filter(Boolean) };
  });
}

// Black Friday order (the owner's choice, 18.11.2026): Zalando first, then discounted offers, then the
// cheapest. The «Лучшая цена» badge still goes to the cheapest offer, wherever it is in the list.
export const isDiscounted = (o) => Boolean(o?.oldPrice && o.oldPrice > o.price);
export function shopOrder(offers) {
  const rank = (o) => (chainOf(o.store)?.id === "zalando" ? 0 : 2) + (isDiscounted(o) ? 0 : 1);
  return [...(offers || [])].sort((a, b) => rank(a) - rank(b) || a.total - b.total);
}

// Popular chains only, new only, at most `perChain` per chain and `max` in all, in Black Friday order.
// Within a chain the cheapest offers are kept.
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
  return shopOrder(out);
}

// Where an offer goes when the shop's exact page is unknown: the chain's search for this product
// name, or a Google search for the name and the shop.
// Article numbers ("TB7127-17835-0005") are dropped: a shop search for them finds nothing useful.
// The gender in the product name ("Women's") wins over the person's.
export function offerFallback(offer, country, gender = "") {
  const raw = String(offer?.title || "");
  const title = raw.split(/\s+[|–—]\s+|\s+-\s+(?=[^-]*$)/)[0]
    .replace(/\b[a-z0-9]*\d[a-z0-9]*(?:-[a-z0-9]+)+\b/gi, " ") // TB7127-17835-0005
    .replace(/\b[a-z]{1,4}\d{3,}[a-z0-9]*\b/gi, " ") // TB7127, SKU123
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 80)
    .trim();
  const g = queryGender(raw, gender);
  const chain = chainOf(offer?.store);
  if (chain) return chainSearch(chain, country, shopQuery(title) || title, g);
  return `https://www.google.com/search?q=${q(`${title} ${offer?.store || ""}`.trim())}&gl=${country}`;
}
