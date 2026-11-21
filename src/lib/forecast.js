// The weather for «Сегодня» by the phone's location, so the person does not have to type «+6 и ветрено».
// Forecast: Open-Meteo (open-meteo.com) — no key and no account, free for non-commercial use, data under
// CC BY 4.0 (the app names the source next to the forecast). A paid plan is needed if the app ever earns money.
// Privacy: the position is asked once, with the person's permission, and rounded to 0.1° (about 10 km) on the
// phone; only that goes to Open-Meteo, straight from the phone (no Worker, no AI call). The position and the
// forecast stay in IndexedDB; «Выключить» forgets both.
import { dateKey } from "./daily.js";
import { kv } from "./db.js";
import { getSettings, saveSettings } from "./settings.js";
import { weatherFromHours } from "./weather.js";

const API = "https://api.open-meteo.com/v1/forecast";
const FIELDS = ["temperature_2m", "apparent_temperature", "precipitation_probability", "precipitation", "snowfall", "wind_speed_10m"];
const FRESH = 2 * 3600 * 1000; // a forecast younger than 2 hours is reused
const roundSpot = ({ latitude, longitude }) => ({ lat: Math.round(latitude * 10) / 10, lon: Math.round(longitude * 10) / 10 });

export const forecastUrl = ({ lat, lon }) => `${API}?latitude=${lat}&longitude=${lon}&hourly=${FIELDS.join(",")}&timezone=auto&forecast_days=3&wind_speed_unit=kmh`;

// The phone's position, rounded. Coarse is enough for weather (no GPS), a position up to 3 hours old is fine.
export function locate({ timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("Этот браузер не умеет определять место. Пиши погоду сам — например «+6, ветер».")); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(roundSpot(pos.coords)),
      (e) => reject(new Error(e?.code === 1
        ? "Нет доступа к местоположению. Разреши его для этого сайта или приложения в настройках телефона — или пиши погоду сам."
        : "Не получилось определить место. Попробуй ещё раз чуть позже — или пиши погоду сам.")),
      { enableHighAccuracy: false, timeout, maximumAge: 3 * 3600 * 1000 },
    );
  });
}

// Open-Meteo's hourly columns → one row per hour: { time: "2026-11-21T08:00", temp, feels, pop, rain, snow, wind }.
export function hoursOf(hourly) {
  const h = hourly || {};
  return (h.time || []).map((time, i) => ({
    time, temp: h.temperature_2m?.[i], feels: h.apparent_temperature?.[i], pop: h.precipitation_probability?.[i],
    rain: h.precipitation?.[i], snow: h.snowfall?.[i], wind: h.wind_speed_10m?.[i],
  }));
}

// The weather of one day, 8:00–20:00 local time at the place (Open-Meteo answers in that time zone), or null.
export function dayWeather(forecast, date) {
  if (!forecast?.hours || !date) return null;
  const day = dateKey(date);
  return weatherFromHours(forecast.hours.filter((h) => h.time?.startsWith(day) && Number(h.time.slice(11, 13)) >= 8 && Number(h.time.slice(11, 13)) <= 20));
}

// The saved forecast, refreshed when older than 2 hours. null when the person has not turned it on.
export async function getForecast({ force = false } = {}) {
  const s = await getSettings();
  if (!s.weatherAuto || !s.weatherSpot) return null;
  const spot = s.weatherSpot;
  const cached = await kv.get("forecast", null);
  if (!force && cached && cached.lat === spot.lat && cached.lon === spot.lon && Date.now() - Date.parse(cached.at) < FRESH) return cached;
  let data;
  try {
    const response = await fetch(forecastUrl(spot));
    if (!response.ok) throw new Error(String(response.status));
    data = await response.json();
  } catch {
    if (cached?.hours) return cached; // offline: the last forecast is still better than nothing
    throw new Error("Прогноз сейчас недоступен. Можно написать погоду самому.");
  }
  const value = { at: new Date().toISOString(), lat: spot.lat, lon: spot.lon, hours: hoursOf(data.hourly) };
  await kv.set("forecast", value);
  return value;
}

// The person moved (a trip): when the permission is already given, the position is updated quietly in the
// background for the next forecast. Never asks; never blocks the screen.
export async function refreshSpot() {
  try {
    const s = await getSettings();
    if (!s.weatherAuto || (await navigator.permissions?.query({ name: "geolocation" }))?.state !== "granted") return false;
    const spot = await locate({ timeout: 8000 });
    if (spot.lat === s.weatherSpot?.lat && spot.lon === s.weatherSpot?.lon) return false;
    await saveSettings({ weatherSpot: spot });
    return true;
  } catch {
    return false;
  }
}

export async function turnOnForecast() {
  const spot = await locate();
  await saveSettings({ weatherAuto: true, weatherSpot: spot });
  return getForecast({ force: true });
}

export async function turnOffForecast() {
  await saveSettings({ weatherAuto: false, weatherSpot: null });
  await kv.del("forecast");
}
