// The brand of a piece the way shops write it. People type it in Russian («Томми Хилфигер»), but shops and
// Google search in Latin letters («Tommy Hilfiger»): everything sent to shops is English (owner's rule,
// 18.11.2026). Popular brands are spelled out; any other Cyrillic name is transliterated, a Latin one is kept.

const BRANDS = [
  ["Tommy Hilfiger", "томми хилфигер", "томи хилфигер", "хилфигер", "томми", "tommy hilfiger", "tommy", "hilfiger"],
  ["Calvin Klein", "кельвин кляйн", "келвин кляйн", "кальвин кляйн", "кельвин кляин", "calvin klein", "ck"],
  ["Ralph Lauren", "ральф лорен", "поло ральф лорен", "ральф лоран", "ralph lauren", "polo ralph lauren"],
  ["Lacoste", "лакост", "лакоста", "lacoste"],
  ["Nike", "найк", "найки", "nike"],
  ["adidas", "адидас", "adidas"],
  ["Puma", "пума", "puma"],
  ["New Balance", "нью баланс", "нью бэланс", "ньюбаланс", "new balance"],
  ["Reebok", "рибок", "reebok"],
  ["Converse", "конверс", "converse"],
  ["Vans", "ванс", "vans"],
  ["ASICS", "асикс", "asics"],
  ["Levi's", "левайс", "левис", "ливайс", "levis", "levi's", "levi s"],
  ["Wrangler", "вранглер", "рэнглер", "wrangler"],
  ["Zara", "зара", "zara"],
  ["H&M", "эйч энд эм", "эйчэндэм", "эйч и эм", "нм", "h&m", "hm", "h and m"],
  ["Uniqlo", "юникло", "uniqlo"],
  ["Mango", "манго", "mango"],
  ["Bershka", "бершка", "bershka"],
  ["Pull&Bear", "пул энд бир", "пулл энд беар", "пул энд беар", "pull&bear", "pull and bear", "pull bear"],
  ["Stradivarius", "страдивариус", "stradivarius"],
  ["Massimo Dutti", "массимо дутти", "масимо дути", "massimo dutti"],
  ["Hugo Boss", "хьюго босс", "хуго босс", "босс", "hugo boss", "boss"],
  ["HUGO", "хьюго", "хуго", "hugo"],
  ["Carhartt", "кархарт", "кархартт", "carhartt", "carhartt wip"],
  ["The North Face", "норт фейс", "зе норт фейс", "the north face", "north face", "tnf"],
  ["Stone Island", "стон айленд", "стоун айленд", "stone island"],
  ["Fred Perry", "фред перри", "fred perry"],
  ["Gant", "гант", "gant"],
  ["Jack & Jones", "джек энд джонс", "джек джонс", "jack & jones", "jack and jones", "jack jones"],
  ["Diesel", "дизель", "diesel"],
  ["Gap", "гэп", "гап", "gap"],
  ["ASOS", "асос", "asos"],
  ["SHEIN", "шеин", "шейн", "shein"],
  ["Timberland", "тимберленд", "тимбы", "timberland"],
  ["Dr. Martens", "доктор мартинс", "доктор мартенс", "мартинсы", "др мартенс", "dr martens", "dr. martens"],
  ["UGG", "угг", "угги", "ugg"],
  ["Columbia", "коламбия", "колумбия", "columbia"],
  ["Patagonia", "патагония", "patagonia"],
  ["Arc'teryx", "арктерикс", "arcteryx", "arc'teryx"],
  ["Moncler", "монклер", "moncler"],
  ["Canada Goose", "канада гус", "canada goose"],
  ["Superdry", "супердрай", "superdry"],
  ["Champion", "чемпион", "champion"],
  ["Fila", "фила", "fila"],
  ["Armani Exchange", "армани эксчейндж", "armani exchange"],
  ["Guess", "гесс", "гес", "guess"],
  ["Michael Kors", "майкл корс", "michael kors"],
  ["COS", "кос", "cos"],
  ["Weekday", "уикдэй", "weekday"],
].flatMap(([name, ...aliases]) => aliases.map((alias) => [alias, name]));

const ALIAS = new Map(BRANDS);
const clean = (text) => String(text || "").toLowerCase().replace(/ё/g, "е").replace(/[«»"“”.,!?()]/g, " ").replace(/[-–—_]/g, " ").replace(/\s+/g, " ").trim();

const LATIN = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
const titleCase = (text) => text.replace(/(^|[\s&-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

// «Томми Хилфигер» → "Tommy Hilfiger", "tommy" → "Tommy Hilfiger", «Свой бренд» → "Svoy Brend", "" → "".
export function brandLatin(text) {
  const key = clean(text);
  if (!key) return "";
  if (ALIAS.has(key)) return ALIAS.get(key);
  if (!/[а-я]/.test(key)) return String(text).trim().replace(/\s+/g, " ").slice(0, 40);
  return titleCase([...key].map((c) => LATIN[c] ?? c).join("")).slice(0, 40);
}

// Whether a shop's product title or shop name is of this brand ("TOMMY HILFIGER Logo hoodie" — yes).
export function isOfBrand(text, brand) {
  if (!brand) return false;
  const words = (s) => clean(s).replace(/['’&]/g, "").replace(/\s+/g, "");
  return words(text).includes(words(brand));
}

// The query without the brand's words (for «Похожие» in other shops) and with it, after the gender word
// ("men black hoodie" + "Tommy Hilfiger" → "men Tommy Hilfiger black hoodie").
export function withoutBrand(query, brand) {
  if (!brand) return query;
  const words = brand.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  return query.split(/\s+/).filter((w) => !words.includes(w.toLowerCase().replace(/['’]s$/, ""))).join(" ").trim();
}
export function withBrand(query, brand) {
  if (!brand) return query;
  const m = /^(men|women)\s+(.*)$/i.exec(query);
  return m ? `${m[1]} ${brand} ${m[2]}` : `${brand} ${query}`.trim();
}
