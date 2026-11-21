import { describe, expect, it } from "vitest";
import { dressForWeather, readWeather, weatherPenalty } from "../src/lib/weather.js";

const tee = { id: "tee", name: "Белая футболка", part: "upperbody", color: "#F7F7F5", kind: "t-shirt" };
const knit = { id: "knit", name: "Серый свитер", part: "upperbody", color: "#8A8A8A", kind: "sweater" };
const jeans = { id: "jeans", name: "Синие джинсы", part: "lowerbody", color: "#2F4A7A", kind: "jeans" };
const sneakers = { id: "sneakers", name: "Белые кроссовки", part: "shoes", color: "#F2F2F2", kind: "sneakers" };
const coat = { id: "coat", name: "Чёрное пальто", part: "wholebody_up", color: "#151515", kind: "coat" };
const jacket = { id: "jacket", name: "Бежевая куртка", part: "wholebody_up", color: "#D8C3A5", kind: "jacket" };
const blazer = { id: "blazer", name: "Тёмно-синий пиджак", part: "wholebody_up", color: "#1F2A44", kind: "blazer" };
const dress = { id: "dress", name: "Чёрное платье", part: "wholebody_up", color: "#111111", kind: "dress" };

describe("readWeather", () => {
  it("reads the owner's case: +6 and windy is cold", () => {
    const w = readWeather("+6 и ветрено");
    expect(w).toMatchObject({ temp: 6, feels: 2, wind: true, level: "cold", needOuter: true, noOuter: false, label: "+6 °C, ветер" });
  });

  it("reads temperatures written in different ways", () => {
    expect(readWeather("минус 3, снег")).toMatchObject({ temp: -3, snow: true, level: "frost" });
    expect(readWeather("Учёба, -2")).toMatchObject({ temp: -2, level: "frost" });
    expect(readWeather("на улице 18 градусов")).toMatchObject({ temp: 18, level: "mild", needOuter: false });
    expect(readWeather("5 мороза")).toMatchObject({ temp: -5 });
    expect(readWeather("около нуля")).toMatchObject({ temp: 0, level: "frost" });
    expect(readWeather("Работа, +25")).toMatchObject({ temp: 25, level: "warm", noOuter: true });
  });

  it("does not take times or plain numbers for degrees", () => {
    expect(readWeather("Работа в 9:00").temp).toBeNull();
    expect(readWeather("Встреча 9-18").temp).toBeNull();
    expect(readWeather("Свидание").known).toBe(false);
  });

  it("understands the chips without a number", () => {
    expect(readWeather("Холодно")).toMatchObject({ level: "cold", needOuter: true });
    expect(readWeather("Дождь")).toMatchObject({ rain: true, needOuter: true });
    expect(readWeather("Тепло")).toMatchObject({ level: "mild", needOuter: false, noOuter: false });
    expect(readWeather("жарко")).toMatchObject({ level: "warm", noOuter: true });
  });
});

describe("dressForWeather", () => {
  const items = [tee, knit, jeans, sneakers, coat, jacket, blazer, dress];
  const cold = readWeather("+6 и ветрено");

  it("adds a coat or jacket to every outfit that has none in the cold", () => {
    const [a, b] = dressForWeather([{ itemIds: ["tee", "jeans", "sneakers"], tips: [] }, { itemIds: ["knit", "jeans"], tips: [] }], items, cold, { source: "+6 и ветрено" });
    expect(a.itemIds.some((id) => id === "coat" || id === "jacket")).toBe(true);
    expect(b.itemIds.some((id) => id === "coat" || id === "jacket")).toBe(true);
    expect(a.itemIds).not.toEqual(expect.arrayContaining(["coat", "jacket"])); // one layer, not two
    expect(a.itemIds.find((id) => id === "coat" || id === "jacket")).not.toBe(b.itemIds.find((id) => id === "coat" || id === "jacket")); // variety
    expect(a.tips[0]).toMatchObject({ title: "По погоде" });
    expect(a.tips[0].why).toMatch(/^\+6 °C, ветер: добавил «/);
    expect(a.weatherFor).toBe("+6 и ветрено");
  });

  it("puts a coat over a dress too, and keeps outfits that already have one", () => {
    const [withDress, done] = dressForWeather([{ itemIds: ["dress", "sneakers"] }, { itemIds: ["tee", "jeans", "coat"] }], items, cold);
    expect(withDress.itemIds.some((id) => id === "coat" || id === "jacket")).toBe(true);
    expect(done.itemIds).toEqual(["tee", "jeans", "coat"]);
  });

  it("replaces a blazer with a warm layer in real cold, keeps it when it is only cool", () => {
    const [frozen] = dressForWeather([{ itemIds: ["tee", "jeans", "blazer"] }], items, cold);
    expect(frozen.itemIds).not.toContain("blazer");
    const [cool] = dressForWeather([{ itemIds: ["tee", "jeans", "blazer"] }], items, readWeather("+14"));
    expect(cool.itemIds).toContain("blazer");
  });

  it("leaves hand-edited outfits and outfits already checked for these words alone", () => {
    const edited = { itemIds: ["tee", "jeans"], edited: true };
    const checked = { itemIds: ["tee", "jeans"], weatherFor: "+6 и ветрено" };
    const out = dressForWeather([edited, checked], items, cold, { source: "+6 и ветрено" });
    expect(out[0]).toBe(edited);
    expect(out[1]).toBe(checked);
  });

  it("says so when there is no coat or jacket in the wardrobe", () => {
    const [o] = dressForWeather([{ itemIds: ["tee", "jeans"] }], [tee, jeans], cold);
    expect(o.itemIds).toEqual(["tee", "jeans"]);
    expect(o.tips[0].why).toMatch(/куртки или пальто в гардеробе нет/);
  });

  it("takes the coat off in the heat when the rest is still an outfit", () => {
    const [o] = dressForWeather([{ itemIds: ["tee", "jeans", "coat"] }], items, readWeather("+27"));
    expect(o.itemIds).toEqual(["tee", "jeans"]);
  });

  it("changes nothing without weather words", () => {
    const outfits = [{ itemIds: ["tee", "jeans"] }];
    expect(dressForWeather(outfits, items, readWeather("Учёба"))).toBe(outfits);
  });

  it("ranks a t-shirt-only outfit lower in the cold when there is knitwear", () => {
    expect(weatherPenalty([tee, jeans, coat], cold, items)).toBeGreaterThan(0);
    expect(weatherPenalty([knit, jeans, coat], cold, items)).toBe(0);
    expect(weatherPenalty([tee, jeans], readWeather("+20"), items)).toBe(0);
  });
});
