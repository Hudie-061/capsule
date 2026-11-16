// Everything "Сегодня" needs to remember between launches: when the user wants the outfit
// (morning / evening / both), the planned outfits per day, and cached try-on photos.
// All of it stays on the device (IndexedDB), like the wardrobe itself.
import { blobs, deleteAssetsWithPrefix, kv } from "./db.js";

// ---- dates ------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, "0");
export const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export function targetDate(mode, now = new Date()) {
  const date = new Date(now);
  if (mode === "evening") date.setDate(date.getDate() + 1);
  return date;
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const formatDay = (date) => capitalize(new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(date));
export const formatShortDate = (date) => new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(date);
export const monthName = (date = new Date()) => new Intl.DateTimeFormat("ru-RU", { month: "long" }).format(new Date(date.getFullYear(), date.getMonth(), 15)).replace(/^./, (c) => c.toLowerCase());

// "в ноябре" — prepositional month names for the savings card.
const MONTHS_IN = ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе", "сентябре", "октябре", "ноябре", "декабре"];
export const inMonth = (date = new Date()) => `в ${MONTHS_IN[date.getMonth()]}`;

// ---- when to get the outfit -----------------------------------------------------
export const TIMING_MODES = ["morning", "evening", "both"];
export const MORNING_TIMES = ["06:30", "07:00", "07:30", "08:00"];
export const EVENING_TIMES = ["20:00", "21:00", "22:00", "23:00"];
const DEFAULT_TIMING = { mode: "both", morning: "07:30", evening: "21:00" };

export async function getTiming() {
  const saved = (await kv.get("timing", {})) || {};
  return {
    mode: TIMING_MODES.includes(saved.mode) ? saved.mode : DEFAULT_TIMING.mode,
    morning: MORNING_TIMES.includes(saved.morning) ? saved.morning : DEFAULT_TIMING.morning,
    evening: EVENING_TIMES.includes(saved.evening) ? saved.evening : DEFAULT_TIMING.evening,
  };
}

export async function saveTiming(timing) {
  await kv.set("timing", timing);
  return getTiming();
}

// "Оба раза": before 17:00 show today's outfit, later — tomorrow's.
export function defaultMode(timing, now = new Date()) {
  if (timing.mode === "morning" || timing.mode === "evening") return timing.mode;
  return now.getHours() >= 17 ? "evening" : "morning";
}

// ---- planned outfits per day ------------------------------------------------------
// { outfits: [{ title, why, itemIds, tuck }], index, chosen: { at } | null }
const PLAN = "plan:";

export async function getDayPlan(date) {
  return kv.get(PLAN + dateKey(date), null);
}

export async function saveDayPlan(date, plan) {
  await kv.set(PLAN + dateKey(date), plan);
  // Keep a week of history; older plans are no longer useful.
  const cutoff = dateKey(new Date(Date.now() - 7 * 86400000));
  const keys = (await kv.keys()).filter((k) => String(k).startsWith(PLAN) && String(k).slice(PLAN.length) < cutoff);
  await Promise.all(keys.map((k) => kv.del(k)));
}

// ---- try-on cache: one generated photo per outfit (set of item ids) ---------------------
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

const TRYON = "asset:tryon/";
// "v2": fitting-room prompt with a fixed pose; photos made with the old prompt are not reused.
const tryOnKey = (itemIds) => `${TRYON}v2-${hash([...itemIds].sort().join("+"))}`;

export const getTryOn = (itemIds) => blobs.get(tryOnKey(itemIds));
export const saveTryOn = (itemIds, blob) => blobs.set(tryOnKey(itemIds), blob);
// A new reference photo makes every cached try-on outdated.
export const clearTryOns = () => deleteAssetsWithPrefix(TRYON);

// ---- shopping gaps cache ----------------------------------------------------------------
export async function getGapsCache() {
  return kv.get("gaps", null);
}

export async function saveGapsCache(result, itemCount) {
  const value = { result, itemCount, at: new Date().toISOString() };
  await kv.set("gaps", value);
  return value;
}

// ---- colour palette -----------------------------------------------------------------------
export const getPalette = () => kv.get("palette", null);
export async function savePalette(result) {
  const value = { result, at: new Date().toISOString() };
  await kv.set("palette", value);
  return value;
}
