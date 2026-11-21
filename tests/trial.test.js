import { describe, expect, it } from "vitest";
import { WISH_SHOPS, chainLinks } from "../src/lib/chains.js";
import { withPiece } from "../src/lib/stylist.js";
import worker from "../proxy/worker.js";

const tee = { id: "tee", name: "Белая футболка", part: "upperbody", kind: "t-shirt" };
const jeans = { id: "jeans", name: "Синие джинсы", part: "lowerbody", kind: "jeans" };
const sneakers = { id: "sneakers", name: "Кроссовки", part: "shoes", kind: "sneakers" };
const coat = { id: "coat", name: "Чёрное пальто", part: "wholebody_up", kind: "coat" };
const dress = { id: "dress", name: "Чёрное платье", part: "wholebody_up", kind: "dress" };
const wool = { id: "wish-wool", name: "Шерстяная куртка", part: "wholebody_up", kind: "jacket", want: true };
const shirt = { id: "wish-shirt", name: "Голубая рубашка", part: "upperbody", kind: "shirt", want: true };
const bag = { id: "wish-bag", name: "Сумка", part: "accessories_up", kind: "bag", want: true };
const wishDress = { id: "wish-dress", name: "Зелёное платье", part: "wholebody_up", kind: "dress", want: true };
const byId = new Map([tee, jeans, sneakers, coat, dress, wool, shirt, bag, wishDress].map((i) => [i.id, i]));

describe("«Примерить»: the wished piece is in every outfit", () => {
  it("keeps an outfit that already has it", () => {
    expect(withPiece(["tee", "jeans", "wish-wool"], wool, byId)).toEqual(["tee", "jeans", "wish-wool"]);
  });

  it("takes the place of the owned piece of its kind", () => {
    expect(withPiece(["tee", "jeans", "coat", "sneakers"], wool, byId)).toEqual(["tee", "jeans", "sneakers", "wish-wool"]);
    expect(withPiece(["tee", "jeans", "sneakers"], wool, byId)).toEqual(["tee", "jeans", "sneakers", "wish-wool"]);
    expect(withPiece(["tee", "jeans", "sneakers"], shirt, byId)).toEqual(["jeans", "sneakers", "wish-shirt"]);
    expect(withPiece(["tee", "jeans"], bag, byId)).toEqual(["tee", "jeans", "wish-bag"]);
  });

  it("a dress replaces top and bottom, a top cannot go with a dress alone", () => {
    expect(withPiece(["tee", "jeans", "coat", "sneakers"], wishDress, byId)).toEqual(["coat", "sneakers", "wish-dress"]);
    expect(withPiece(["dress", "sneakers"], shirt, byId)).toBeNull(); // a shirt and no bottom is not an outfit
  });
});

describe("«Найти похожую»", () => {
  it("puts Zara, H&M, Zalando, Uniqlo and SHEIN first, in that order", () => {
    const ids = chainLinks("be", "men brown wool jacket", { gender: "male", prefer: WISH_SHOPS }).map((c) => c.id);
    expect(ids.slice(0, 5)).toEqual(["zara", "hm", "zalando", "uniqlo", "shein"]);
    expect(chainLinks("be", "men brown wool jacket", { gender: "male" })[0].id).toBe("zalando"); // the usual order elsewhere
  });
});

describe("Worker: outfits around a piece to buy", () => {
  it("asks for the piece in every outfit and leaves the weather out unless given", async () => {
    const prompts = [];
    const fetchBefore = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      prompts.push(JSON.parse(init.body).contents[0].parts[0].text);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ outfits: [] }) }] } }] }), { status: 200 });
    };
    const send = (body) => worker.fetch(new Request("https://proxy.test/api/plan", {
      method: "POST", headers: { "X-Access-Code": "abc", Origin: "https://a.test", "Content-Type": "application/json" }, body: JSON.stringify(body),
    }), { GEMINI_API_KEY: "k", ACCESS_CODES: "a:abc", ALLOWED_ORIGINS: "https://a.test", USAGE: { get: async () => null, put: async () => {} } });
    try {
      await send({ wardrobe: [tee, jeans, wool], include: "wish-wool" });
      await send({ wardrobe: [tee, jeans, wool], include: "not-in-wardrobe" });
    } finally {
      globalThis.fetch = fetchBefore;
    }
    expect(prompts[0]).toContain("PIECE TO TRY ON");
    expect(prompts[0]).toContain("EVERY outfit MUST include this piece (id wish-wool)");
    expect(prompts[0]).not.toContain("WEATHER");
    expect(prompts[1]).not.toContain("PIECE TO TRY ON"); // an unknown id is ignored
  });
});
