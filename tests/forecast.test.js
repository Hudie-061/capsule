import { describe, expect, it } from "vitest";
import { dayWeather, forecastUrl, hoursOf } from "../src/lib/forecast.js";
import { weatherFromHours } from "../src/lib/weather.js";
import worker from "../proxy/worker.js";

// Open-Meteo's hourly answer for two days (the shape checked against the real API on 21.11.2026).
function openMeteo(day1, day2) {
  const time = []; const t = []; const a = []; const pop = []; const rain = []; const snow = []; const wind = [];
  for (const [date, f] of [["2026-11-21", day1], ["2026-11-22", day2]]) {
    for (let h = 0; h < 24; h += 1) {
      const row = f(h);
      time.push(`${date}T${String(h).padStart(2, "0")}:00`);
      t.push(row.temp); a.push(row.feels); pop.push(row.pop ?? 0); rain.push(row.rain ?? 0); snow.push(row.snow ?? 0); wind.push(row.wind ?? 5);
    }
  }
  return { time, temperature_2m: t, apparent_temperature: a, precipitation_probability: pop, precipitation: rain, snowfall: snow, wind_speed_10m: wind };
}

describe("forecast", () => {
  it("asks Open-Meteo for the rounded place only, in its own time zone", () => {
    const url = forecastUrl({ lat: 50.8, lon: 4.4 });
    expect(url).toMatch(/^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=50\.8&longitude=4\.4&/);
    expect(url).toContain("timezone=auto");
    expect(url).toContain("apparent_temperature");
  });

  it("dresses for the hours out (8:00–20:00) of the chosen day", () => {
    // a cold night does not count, a windy cold day does; tomorrow is mild
    const hourly = openMeteo(
      (h) => (h < 8 || h > 20 ? { temp: -10, feels: -15 } : { temp: 6, feels: 2, wind: 35 }),
      (h) => ({ temp: 18, feels: 18 }),
    );
    const forecast = { hours: hoursOf(hourly) };
    const today = dayWeather(forecast, new Date(2026, 10, 21, 9));
    expect(today).toMatchObject({ min: 6, max: 6, feels: 2, wind: true, level: "cold", needOuter: true, from: "forecast", label: "+6 °C, ветер" });
    const tomorrow = dayWeather(forecast, new Date(2026, 10, 22, 9));
    expect(tomorrow).toMatchObject({ level: "mild", needOuter: false, wind: false });
    expect(dayWeather(forecast, new Date(2026, 10, 25))).toBeNull(); // beyond the forecast
  });

  it("calls rain and snow only when they really come", () => {
    const base = { temp: 9, feels: 7 };
    expect(weatherFromHours([{ ...base, pop: 30, rain: 0.2 }]).rain).toBe(false);
    expect(weatherFromHours([{ ...base, pop: 70, rain: 0.4 }]).rain).toBe(true);
    expect(weatherFromHours([{ ...base, rain: 1.2 }]).rain).toBe(true);
    expect(weatherFromHours([{ temp: -1, feels: -4, snow: 0.5 }])).toMatchObject({ snow: true, level: "frost", label: "-1 °C, снег" });
    expect(weatherFromHours([{ temp: 2, feels: 0 }, { temp: 8, feels: 5 }]).label).toBe("+2…+8 °C");
    expect(weatherFromHours([{ temp: null, feels: null }])).toBeNull();
  });

  it("the Worker says it is a forecast and gives the day's range", async () => {
    const calls = [];
    const fetchBefore = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      calls.push(JSON.parse(init.body).contents[0].parts[0].text);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ outfits: [] }) }] } }] }), { status: 200 });
    };
    try {
      const kv = { get: async () => null, put: async () => {} };
      await worker.fetch(new Request("https://proxy.test/api/plan", {
        method: "POST", headers: { "X-Access-Code": "abc", Origin: "https://a.test", "Content-Type": "application/json" },
        body: JSON.stringify({ wardrobe: [{ id: "a", name: "Футболка", part: "upperbody" }], weather: { temp: 5, feels: 2, min: 2, max: 8, wind: true, level: "cold", from: "forecast" } }),
      }), { GEMINI_API_KEY: "k", ACCESS_CODES: "a:abc", ALLOWED_ORIGINS: "https://a.test", USAGE: kv });
    } finally {
      globalThis.fetch = fetchBefore;
    }
    expect(calls[0]).toContain("WEATHER (forecast for that day at the person's place, 8:00-20:00)");
    expect(calls[0]).toContain("Between +2 °C and +8 °C, feels like +2 °C on average; windy.");
  });
});
