import { describe, expect, it } from "vitest";
import { chainLinks, chainOf, chainOffers, offerFallback, queryGender, shopQuery } from "../src/lib/chains.js";

const offer = (store, total, extra = {}) => ({ id: `${store}-${total}`, store, title: `Item ${total}`, total, price: total, condition: "new", ...extra });

describe("popular chains", () => {
  it("recognises the chains by the shop name Google Shopping gives", () => {
    expect(chainOf("H&M")?.id).toBe("hm");
    expect(chainOf("ZARA")?.id).toBe("zara");
    expect(chainOf("UNIQLO Belgium")?.id).toBe("uniqlo");
    expect(chainOf("Foot Locker Belgium")?.id).toBe("footlocker");
    expect(chainOf("NEW YORKER")?.id).toBe("newyorker");
    expect(chainOf("www2.hm.com/nl_be/index.html")?.id).toBe("hm"); // how Google Shopping names H&M in Belgium
    expect(chainOf("Zalando")).toBe(null);
    expect(chainOf("Mangopay shop")).toBe(null);
  });

  it("keeps at most 2 offers per chain and 10 in all, cheapest first, new only", () => {
    const offers = [
      offer("H&M", 30), offer("H&M", 20), offer("H&M", 10), offer("Zalando", 5), offer("Zara", 40), offer("Zara", 35, { condition: "used" }),
      ...["Uniqlo", "Mango", "C&A", "Bershka", "Pull&Bear", "JBC"].flatMap((s, i) => [offer(s, 50 + i), offer(s, 60 + i)]),
    ];
    const out = chainOffers(offers);
    expect(out).toHaveLength(10);
    expect(out.map((o) => o.total)).toEqual([...out.map((o) => o.total)].sort((a, b) => a - b));
    expect(out.filter((o) => o.store === "H&M").map((o) => o.total)).toEqual([10, 20]);
    expect(out.some((o) => o.store === "Zalando" || o.condition === "used")).toBe(false);
  });

  it("searches the shops' own sites without gender words or sizes", () => {
    expect(shopQuery("men charcoal wide leg trousers W34 L32")).toBe("charcoal wide leg trousers");
    expect(queryGender("women black boots")).toBe("female");
    expect(queryGender("black boots", "male")).toBe("male");
    const links = Object.fromEntries(chainLinks("be", "men charcoal wide leg trousers").map((l) => [l.id, l]));
    expect(links.hm.url).toBe("https://www2.hm.com/nl_be/search-results.html?q=charcoal%20wide%20leg%20trousers");
    expect(links.zara.url).toBe("https://www.zara.com/be/nl/search?searchTerm=charcoal%20wide%20leg%20trousers&section=MAN");
    expect(links.uniqlo.url).toBe("https://www.uniqlo.com/be/nl/search?q=charcoal%20wide%20leg%20trousers");
    expect(links.mango.url).toBe("https://shop.mango.com/be/nl/search/heren?q=charcoal%20wide%20leg%20trousers");
    expect(links.newyorker).toMatchObject({ own: false, url: expect.stringContaining("site%3Anewyorker.de") });
    expect(links.footlocker).toBeUndefined(); // shoe chains only for shoes
    expect(chainLinks("gb", "white sneakers", { shoes: true }).find((l) => l.id === "footlocker").url).toBe("https://www.footlocker.co.uk/en/search?query=white%20sneakers");
    expect(chainLinks("pl", "jeans").find((l) => l.id === "uniqlo")).toMatchObject({ own: false });
  });

  it("falls back to the chain's search for the product name", () => {
    expect(offerFallback({ store: "H&M", title: "Loose Fit Jeans | H&M BE" }, "be")).toBe("https://www2.hm.com/nl_be/search-results.html?q=Loose%20Fit%20Jeans");
    expect(offerFallback({ store: "Zalando", title: "Straight jeans" }, "nl")).toBe("https://www.google.com/search?q=Straight%20jeans%20Zalando&gl=nl");
  });
});
