// Exact item types ("hoodie", "blazer", "chain") and where they sit on a body.
// New items get `kind` from the detect task; older items and shopping gaps without it are
// recognised from their Russian name, so icons and the mannequin work for everything.

const FROM_NAME = [
  [/пиджак|блейзер|жакет/i, "blazer"],
  [/пальто|тренч|парк[аи]\b|пуховик/i, "coat"],
  [/куртк|бомбер|ветровк|косух|джинсовк|анорак|жилет/i, "jacket"],
  [/худи|толстовк|свитшот/i, "hoodie"],
  [/свитер|джемпер|кардиган|водолазк|пуловер/i, "sweater"],
  [/рубашк|блуз|сорочк/i, "shirt"],
  [/футболк|майк|лонгслив|поло|топ\b|танк/i, "t-shirt"],
  [/плать|сарафан|комбинезон/i, "dress"],
  [/шорт/i, "shorts"],
  [/юбк/i, "skirt"],
  [/джинс/i, "jeans"],
  [/брюк|штан|карго|чинос|джоггер|легинс|лосин/i, "trousers"],
  [/ботин|сапог|челси|берц|угг/i, "boots"],
  [/туфл|лофер|мокасин|балетк|сандал|босоножк|шлёпанц|шлепанц/i, "loafers"],
  [/кроссовк|кеды|сникер/i, "sneakers"],
  [/рюкзак/i, "backpack"],
  [/сумк|шопер|клатч|портфел/i, "bag"],
  [/кепк|бейсболк/i, "cap"],
  [/шапк|бини/i, "beanie"],
  [/шляп|панам/i, "hat"],
  [/шарф|платок|снуд/i, "scarf"],
  [/галстук/i, "tie"],
  [/ремен|ремн|пояс/i, "belt"],
  [/цепоч|цепь|колье|ожерель|кулон|подвеск/i, "chain"],
  [/часы/i, "watch"],
  [/солнцезащит/i, "sunglasses"],
  [/очк/i, "glasses"],
  [/браслет/i, "bracelet"],
  [/кольц|перстень|печатк/i, "ring"],
  [/серьг|серёж|сереж/i, "earrings"],
];

const BY_PART = { upperbody: "t-shirt", wholebody_up: "jacket", lowerbody: "trousers", shoes: "sneakers", accessories_up: "bag" };
const KNOWN = new Set([...FROM_NAME.map(([, kind]) => kind), "dress"]);
const ALIASES = { "t shirt": "t-shirt", tee: "t-shirt", tshirt: "t-shirt", longsleeve: "t-shirt", polo: "t-shirt", top: "t-shirt", blouse: "shirt", sweatshirt: "hoodie", cardigan: "sweater", jumper: "sweater", parka: "coat", trench: "coat", bomber: "jacket", vest: "jacket", pants: "trousers", chinos: "trousers", joggers: "trousers", leggings: "trousers", trainers: "sneakers", shoes: "sneakers", sandals: "loafers", heels: "loafers", necklace: "chain", pendant: "chain", tote: "bag", handbag: "bag", clutch: "bag", baseball: "cap", jumpsuit: "dress" };

export function kindOf(item) {
  const given = String(item?.kind || "").toLowerCase().trim();
  if (KNOWN.has(given)) return given;
  if (ALIASES[given]) return ALIASES[given];
  const text = `${item?.name || ""} ${item?.item || ""} ${(item?.tags || []).join(" ")}`;
  for (const [pattern, kind] of FROM_NAME) if (pattern.test(text)) return kind;
  return BY_PART[item?.part] || "t-shirt";
}

// Where an accessory sits on the mannequin.
const SLOT = {
  cap: "head", hat: "head", beanie: "head",
  glasses: "face", sunglasses: "face", earrings: "face",
  chain: "neck", scarf: "neck", tie: "neck",
  belt: "waist",
  bag: "hand", backpack: "hand",
  watch: "wrist", bracelet: "wrist", ring: "wrist",
};
export const slotOf = (item) => SLOT[kindOf(item)] || "hand";
