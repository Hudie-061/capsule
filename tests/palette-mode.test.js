import { describe, expect, it } from "vitest";
import { defaultPaletteMode, hasSimple, paletteFor, paletteProfileText } from "../src/lib/palette-mode.js";
import worker from "../proxy/worker.js";

// A saved result as the Worker returns it (Мягкое лето — the owner's case: «приглушённая ягода»).
const softSummer = {
  season: "Мягкое лето", undertone: "холодный подтон", contrast: "средний контраст", why: "…",
  best: [
    { name: "Грейж", hex: "#A39B91", why: "мягко повторяет цвет волос" }, { name: "Мягкий графит", hex: "#5A5C60", why: "замена чёрному" },
    { name: "Серо-синий", hex: "#6E7F94", why: "" }, { name: "Пыльная роза", hex: "#C2949A", why: "освежает кожу" },
    { name: "Шалфей", hex: "#9AAE97", why: "" }, { name: "Пыльно-голубой", hex: "#8AA2B8", why: "" },
    { name: "Приглушённый лиловый", hex: "#9C8AA5", why: "" }, { name: "Приглушённая ягода", hex: "#8E4E62", why: "" },
  ],
  avoid: [{ name: "Чёрный", hex: "#111111", why: "делает черты резче" }, { name: "Чистый белый", hex: "#FFFFFF", why: "" }, { name: "Ярко-оранжевый", hex: "#FF6A13", why: "" }, { name: "Лимонный", hex: "#F4E04D", why: "" }],
  metal: { name: "Матовое серебро", good: ["#B9BCC0"], avoid: "#E5B84C" }, traits: [], jewelry: [],
};

const PLAIN = /^(Белый|Молочный|Бежевый|Серо-бежевый|Светло-серый|Серый|Тёмно-серый|Чёрный|Тёмно-синий|Синий|Голубой|Серо-голубой|Коричневый|Светло-коричневый|Тёмно-коричневый|Серо-коричневый|Хаки|Оливковый|Зелёный|Светло-зелёный|Тёмно-зелёный|Серо-зелёный|Мятный|Бирюзовый|Тёмно-бирюзовый|Бордовый|Красный|Розовый|Ярко-розовый|Бледно-розовый|Сиреневый|Персиковый|Горчичный|Оранжевый|Жёлтый|Ярко-синий)$/;

describe("palette modes", () => {
  it("men start with the simple palette, everyone else with the full one", () => {
    expect(defaultPaletteMode("male")).toBe("simple");
    expect(defaultPaletteMode("female")).toBe("extended");
    expect(defaultPaletteMode("")).toBe("extended");
  });

  it("the simple palette has plain colour names, 4 base and 4 accents", () => {
    const p = paletteFor(softSummer, "simple");
    expect(p.mode).toBe("simple");
    expect(p.best.filter((c) => c.role === "base")).toHaveLength(4);
    expect(p.best.filter((c) => c.role === "accent")).toHaveLength(4);
    for (const c of [...p.best, ...p.avoid]) expect(c.name).toMatch(PLAIN);
    expect(p.best.map((c) => c.name)).not.toContain("Приглушённая ягода");
    expect(p.season).toBe("Мягкое лето");
    expect(p.metal.name).toBe("Матовое серебро");
  });

  it("borrows the stylist's own words for a close colour, a plain line otherwise", () => {
    const p = paletteFor(softSummer, "simple");
    expect(p.best.find((c) => c.name === "Розовый").why).toBe("освежает кожу");
    expect(p.avoid.find((c) => c.name === "Чёрный").why).toBe("делает черты резче");
    expect(p.best.every((c) => c.why)).toBe(true);
  });

  it("the extended palette is the season's fan with roles: 3 base, 5 accents", () => {
    const p = paletteFor(softSummer, "extended");
    expect(p.best.map((c) => c.name)).toEqual(softSummer.best.map((c) => c.name));
    expect(p.best.map((c) => c.role)).toEqual(["base", "base", "base", "accent", "accent", "accent", "accent", "accent"]);
  });

  it("tells the stylist the mode in the profile line", () => {
    expect(paletteProfileText(paletteFor(softSummer, "simple"))).toMatch(/^Мягкое лето \(холодный подтон, средний контраст\), простые цвета: серый, тёмно-серый/);
    expect(paletteProfileText(paletteFor(softSummer, "extended"))).toMatch(/^Мягкое лето \(холодный подтон, средний контраст\): грейж/);
  });

  it("has a simple fan for every season the Worker can return", async () => {
    // the season names are the enum of the palette schema in the Worker
    let schema;
    const fetchBefore = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      schema = JSON.parse(init.body).generationConfig.responseSchema;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }), { status: 200 });
    };
    try {
      const kv = { get: async () => null, put: async () => {} };
      await worker.fetch(new Request("https://proxy.test/api/palette", {
        method: "POST", headers: { "X-Access-Code": "abc", Origin: "https://a.test", "Content-Type": "application/json" },
        body: JSON.stringify({ image: { mimeType: "image/png", data: "iVBORw0KGgo=" } }),
      }), { GEMINI_API_KEY: "k", ACCESS_CODES: "a:abc", ALLOWED_ORIGINS: "https://a.test", USAGE: kv });
    } finally {
      globalThis.fetch = fetchBefore;
    }
    const seasons = schema.properties.season.enum;
    expect(seasons).toHaveLength(12);
    for (const s of seasons) expect(hasSimple(s)).toBe(true);
  });
});
