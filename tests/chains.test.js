import { describe, expect, it } from "vitest";
import { chainLinks, chainOf, chainOffers, offerFallback, queryGender, searchChains, shopOrder, shopQuery, shopQueryFor, zalandoSearch } from "../src/lib/chains.js";

const offer = (store, total, extra = {}) => ({ id: `${store}-${total}`, store, title: `Item ${total}`, total, price: total, condition: "new", ...extra });

describe("popular chains", () => {
  it("recognises the chains by the shop name Google Shopping gives", () => {
    expect(chainOf("H&M")?.id).toBe("hm");
    expect(chainOf("ZARA")?.id).toBe("zara");
    expect(chainOf("UNIQLO Belgium")?.id).toBe("uniqlo");
    expect(chainOf("Foot Locker Belgium")?.id).toBe("footlocker");
    expect(chainOf("NEW YORKER")?.id).toBe("newyorker");
    expect(chainOf("www2.hm.com/nl_be/index.html")?.id).toBe("hm"); // how Google Shopping names H&M in Belgium
    expect(chainOf("ABOUT YOU")?.id).toBe("aboutyou");
    expect(chainOf("Bol.com")).toBe(null);
    expect(chainOf("Mangopay shop")).toBe(null);
  });

  it("keeps at most 2 offers per chain and 10 in all, cheapest first, new only", () => {
    const offers = [
      offer("H&M", 30), offer("H&M", 20), offer("H&M", 10), offer("Bol.com", 5), offer("Zara", 40), offer("Zara", 35, { condition: "used" }),
      ...["Uniqlo", "Mango", "C&A", "Bershka", "Pull&Bear", "JBC"].flatMap((s, i) => [offer(s, 50 + i), offer(s, 60 + i)]),
    ];
    const out = chainOffers(offers);
    expect(out).toHaveLength(10);
    expect(out.map((o) => o.total)).toEqual([...out.map((o) => o.total)].sort((a, b) => a - b));
    expect(out.filter((o) => o.store === "H&M").map((o) => o.total)).toEqual([10, 20]);
    expect(out.some((o) => o.store === "Bol.com" || o.condition === "used")).toBe(false);
  });

  it("searches the shops' own sites without gender words or sizes", () => {
    expect(shopQuery("men charcoal wide leg trousers W34 L32")).toBe("charcoal wide leg trousers");
    expect(queryGender("women black boots")).toBe("female");
    expect(queryGender("black boots", "male")).toBe("male");
    const links = Object.fromEntries(chainLinks("be", "men charcoal wide leg trousers").map((l) => [l.id, l]));
    expect(links.hm.url).toBe("https://www2.hm.com/nl_be/search-results.html?q=charcoal+wide+leg+trousers&sort=ascPrice");
    expect(links.zara.url).toBe("https://www.zara.com/be/nl/search?searchTerm=charcoal%20wide%20leg%20trousers&section=MAN");
    expect(links.uniqlo.url).toBe("https://www.uniqlo.com/be/nl/search?q=charcoal%20wide%20leg%20trousers&sort=2");
    expect(links.aboutyou).toMatchObject({ own: false, url: expect.stringContaining("site%3Aaboutyou.be") });
    expect(links.mango.url).toBe("https://shop.mango.com/be/nl/search/heren?q=charcoal%20wide%20leg%20trousers");
    expect(links.newyorker).toMatchObject({ own: false, url: expect.stringContaining("site%3Anewyorker.de") });
    expect(links.footlocker).toBeUndefined(); // shoe chains only for shoes
    expect(chainLinks("gb", "white sneakers", { shoes: true }).find((l) => l.id === "footlocker").url).toBe("https://www.footlocker.co.uk/en/search?query=white%20sneakers&sort=price-asc");
    expect(chainLinks("pl", "jeans").find((l) => l.id === "uniqlo")).toMatchObject({ own: false });
  });

  it("compares prices on Zalando and About You only: two searches", () => {
    expect(searchChains({ part: "shoes", kind: "sneakers" })).toEqual(["zalando", "aboutyou"]);
    expect(searchChains({ part: "wholebody_up", kind: "blazer" })).toEqual(["zalando", "aboutyou"]);
    expect(chainOf("nl.zalando.be")?.id).toBe("zalando");
    expect(chainLinks("be", "men navy blazer").find((l) => l.id === "zalando").url).toBe("https://www.zalando.be/heren/?q=navy+blazer&order=price&dir=asc");
  });

  it("puts Zalando first, then discounted offers, then the cheapest (Black Friday)", () => {
    const list = shopOrder([
      offer("H&M", 20), offer("Zara", 30, { oldPrice: 45 }), offer("nl.zalando.be", 60), offer("nl.zalando.be", 50, { oldPrice: 80 }), offer("Uniqlo", 25, { oldPrice: 30 }),
    ]);
    expect(list.map((o) => [o.store, o.total])).toEqual([["nl.zalando.be", 50], ["nl.zalando.be", 60], ["Uniqlo", 25], ["Zara", 30], ["H&M", 20]]);
    expect(chainLinks("be", "men navy blazer")[0].id).toBe("zalando");
    expect(chainLinks("be", "white sneakers", { shoes: true }).map((l) => l.id).slice(0, 4)).toEqual(["zalando", "aboutyou", "shein", "footlocker"]);
  });

  it("opens SHEIN's search with gender, colour and type in the words, and size M as SHEIN's filter code", () => {
    const shein = (query, filters = {}, country = "be") => chainLinks(country, query, { filters }).find((l) => l.id === "shein");
    expect(shein("women white t-shirt").url).toBe("https://m.shein.com/euqs/pdsearch/women%20white%20t-shirt/");
    // M plus SHEIN's combined sizes that include it (S/M, M/L); codes read from the owner's links
    expect(shein("women white t-shirt", { size: { system: "letter", pick: "M" } }).url).toBe("https://m.shein.com/euqs/pdsearch/women%20white%20t-shirt/?attr_ids=87_417-87_1002167-87_387");
    expect(shein("men grey hoodie", { size: { system: "letter", pick: "L" } }).url).toBe("https://m.shein.com/euqs/pdsearch/men%20grey%20hoodie/?attr_ids=87_754-87_387-87_756");
    expect(shein("men black jeans", { size: { system: "wl", pick: { w: 32, l: 32 } } }, "nl").url).toBe("https://m.shein.com/nl/pdsearch/men%20black%20jeans/");
    // the tile says what the link does
    expect(shein("women white t-shirt", { size: { system: "letter", pick: "M" } }).notes).toEqual(["женское", "размер M (и S/M, M/L)", "цвет и тип в поиске"]);
    expect(shein("women white t-shirt", { size: { system: "euBottom", pick: 38 } }).notes).toContain("размер — на сайте");
  });

  it("describes each shop tile by the filters its link really carries", () => {
    const tiles = Object.fromEntries(chainLinks("be", "men grey hoodie", { filters: { size: { system: "letter", pick: "L" }, sale: true, budget: 50 }, money: (n) => `${n} €` }).map((l) => [l.id, l.notes]));
    expect(tiles.zalando).toEqual(["твой размер L", "сначала дешёвые", "только скидки", "до 50 €"]);
    expect(tiles.hm).toEqual(["размер L", "сначала дешёвые"]);
    expect(tiles.aboutyou).toEqual(["поиск Google по сайту"]);
    expect(tiles.zara).toEqual(["мужское", "поиск на сайте"]);
  });

  it("puts the size and cheapest-first into the other shops' links where they support it", () => {
    const links = Object.fromEntries(chainLinks("be", "men grey hoodie", { filters: { size: { system: "letter", pick: "L" } } }).map((l) => [l.id, l.url]));
    expect(links.hm).toBe("https://www2.hm.com/nl_be/search-results.html?q=grey+hoodie&sizes=menswear%3BNO_FORMAT%5BSML%5D%3BL&sort=ascPrice");
    expect(links.zalando).toContain("sizes=L");
    // numeric sizes have other formats at H&M: only the order then
    expect(Object.fromEntries(chainLinks("be", "men jeans", { filters: { size: { system: "wl", pick: { w: 33, l: 32 } } } }).map((l) => [l.id, l.url])).hm).toBe("https://www2.hm.com/nl_be/search-results.html?q=jeans&sort=ascPrice");
  });

  it("opens Zalando already filtered: the person's size, cheapest first, sale only and a budget", () => {
    // checked by hand on zalando.be: sizes, length, sale, price_to, order=price&dir=asc
    expect(zalandoSearch("be", "men black wide trousers", { size: { system: "wl", pick: { w: 33, l: 32 } } }))
      .toBe("https://www.zalando.be/heren/?q=black+wide+trousers&sizes=33&length=32&order=price&dir=asc");
    expect(zalandoSearch("be", "women white sneakers", { size: { system: "shoe", pick: 39.5 }, sale: true, budget: 50 }))
      .toBe("https://www.zalando.be/dames/?q=white+sneakers&sizes=39.5&sale=true&price_to=50&order=price&dir=asc");
    expect(zalandoSearch("de", "grey hoodie", { gender: "male", size: { system: "letter", pick: "L" } }))
      .toBe("https://www.zalando.de/herren/?q=grey+hoodie&sizes=L&order=price&dir=asc");
    expect(zalandoSearch("pl", "jeans")).toBe(null); // no Zalando link pattern for this country yet
  });

  it("always talks to shops in English, with the person's gender", () => {
    expect(shopQueryFor({ query: "navy wool blazer", kind: "blazer" }, "male")).toBe("men navy wool blazer");
    expect(shopQueryFor({ query: "women black boots" }, "female")).toBe("women black boots");
    // a Russian name only (older links, a piece from the wardrobe): built from colour and type
    expect(shopQueryFor({ item: "Синие джинсы", query: "Синие джинсы", kind: "jeans", color: "#2f5da8" }, "male")).toBe("men blue jeans");
    expect(shopQueryFor({ item: "Тёмно-синяя куртка", kind: "jacket", color: "#1f2a44" }, "")).toBe("navy jacket");
  });

  it("drops article numbers from the fallback search and keeps the gender of the product", () => {
    const link = offerFallback({ store: "Zalando", title: "Urban Classics 90's jeans Women's TB7127-17835-0005" }, "be", "male");
    expect(link).toContain("/dames/");
    expect(link).toContain("q=Urban+Classics+90s+jeans");
    expect(link).not.toContain("TB7127");
  });

  it("falls back to the chain's search for the product name", () => {
    expect(offerFallback({ store: "H&M", title: "Loose Fit Jeans | H&M BE" }, "be")).toBe("https://www2.hm.com/nl_be/search-results.html?q=Loose+Fit+Jeans&sort=ascPrice");
    expect(offerFallback({ store: "Bol.com", title: "Straight jeans" }, "nl")).toBe("https://www.google.com/search?q=Straight%20jeans%20Bol.com&gl=nl");
    expect(offerFallback({ store: "ABOUT YOU", title: "Straight jeans" }, "nl")).toContain("site%3Aaboutyou.nl");
    expect(offerFallback({ store: "nl.zalando.be", title: "Straight jeans" }, "be")).toBe("https://www.zalando.be/catalogus/?q=Straight+jeans&order=price&dir=asc");
  });
});
