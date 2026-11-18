// Live checks for «Снять с подсказками»: is the whole body in the frame, is the pose right, is the phone
// upright, is the person still. Plain math on MediaPipe Pose landmarks (33 points, x and y from 0 to 1
// across the video frame), so it runs in tests. The camera screen (src/body-capture.jsx) speaks the hint.
//
// Directions are given from the person's side: a camera facing the person sees their right hand on the
// left of the frame, so a person standing on the left of the frame has to step to their left.

const I = { nose: 0, lEye: 2, rEye: 5, lEar: 7, rEar: 8, lSh: 11, rSh: 12, lEl: 13, rEl: 14, lWr: 15, rWr: 16, lHip: 23, rHip: 24, lAnk: 27, rAnk: 28, lHeel: 29, rHeel: 30, lToe: 31, rToe: 32 };

export const HINTS = {
  none: "Встань в кадр целиком — от макушки до стоп",
  head: "Отойди чуть назад — не видно макушки",
  feet: "Отойди чуть назад — не видно стоп",
  closer: "Подойди на шаг ближе",
  left: "Шагни чуть влево",
  right: "Шагни чуть вправо",
  face: "Повернись лицом к камере",
  armsOut: "Отведи руки чуть в стороны",
  armsDown: "Опусти руки чуть ниже",
  feetApart: "Поставь ноги на ширину бёдер",
  feetCloser: "Поставь ноги чуть уже",
  side: "Повернись боком к камере",
  armsAlong: "Опусти руки вдоль тела",
  tilt: "Поставь телефон ровно, вертикально",
  ok: "Отлично, замри",
};

const seen = (p) => p && (p.visibility ?? 1) > 0.5 && p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1;

// Phone tilt from the `deviceorientation` event: upright in portrait is beta ≈ 90°, gamma ≈ 0°.
// A phone leaning a little against a wall is fine; more than ~15° makes the legs look shorter.
export function phoneUpright(tilt) {
  if (!tilt || tilt.beta == null || tilt.gamma == null) return true; // no sensor (a computer): skip the check
  return Math.abs(Math.abs(tilt.beta) - 90) <= 15 && Math.abs(tilt.gamma) <= 15;
}

// The pose for one view ("front" or "side") → { ok, id, text, body } where `body` is the person's top
// and bottom as shares of the frame height.
export function checkPose(landmarks, { view = "front", width = 1080, height = 1920, tilt = null } = {}) {
  const say = (id, body = null) => ({ ok: id === "ok", id, text: HINTS[id], body });
  if (!phoneUpright(tilt)) return say("tilt");
  const lm = landmarks;
  if (!Array.isArray(lm) || lm.length < 33 || !seen(lm[I.nose]) || !seen(lm[I.lHip]) || !seen(lm[I.rHip])) return say("none");
  const px = (i) => ({ x: lm[i].x * width, y: lm[i].y * height });
  const nose = px(I.nose);
  const shY = ((lm[I.lSh].y + lm[I.rSh].y) / 2) * height;
  // the top of the head: about two thirds of the nose-to-shoulders distance above the nose
  const top = nose.y - 0.65 * Math.max(0, shY - nose.y);
  const feet = [I.lAnk, I.rAnk, I.lHeel, I.rHeel, I.lToe, I.rToe].filter((i) => seen(lm[i])).map((i) => px(i).y);
  const ankles = seen(lm[I.lAnk]) || seen(lm[I.rAnk]);
  const body = { top: top / height, bottom: feet.length ? Math.max(...feet) / height : null };
  if (top < 0.01 * height) return say("head", body);
  if (!ankles || !feet.length || Math.max(...feet) > 0.985 * height) return say("feet", body);
  const tall = Math.max(...feet) - top;
  if (tall < 0.55 * height) return say("closer", body);
  const hip = { x: ((lm[I.lHip].x + lm[I.rHip].x) / 2) * width };
  if (hip.x < 0.28 * width) return say("left", body);
  if (hip.x > 0.72 * width) return say("right", body);

  const lSh = px(I.lSh); const rSh = px(I.rSh);
  const shoulders = Math.abs(lSh.x - rSh.x);
  // angle of an arm from the vertical, shoulder to wrist (0° = hanging straight down)
  const arm = (s, w) => (seen(lm[w]) ? (Math.atan2(Math.abs(px(w).x - px(s).x), Math.max(1, px(w).y - px(s).y)) * 180) / Math.PI : null);
  const arms = [arm(I.lSh, I.lWr), arm(I.rSh, I.rWr)].filter((a) => a !== null);

  if (view === "side") {
    if (shoulders > 0.09 * tall) return say("side", body);
    if (arms.some((a) => a > 22)) return say("armsAlong", body);
    return say("ok", body);
  }
  if (shoulders < 0.12 * tall) return say("face", body);
  if (arms.length < 2) return say("armsOut", body);
  if (Math.min(...arms) < 10) return say("armsOut", body);
  if (Math.max(...arms) > 50) return say("armsDown", body);
  if (seen(lm[I.lAnk]) && seen(lm[I.rAnk])) {
    const feetGap = Math.abs(lm[I.lAnk].x - lm[I.rAnk].x) * width;
    const hips = Math.abs(lm[I.lHip].x - lm[I.rHip].x) * width;
    if (feetGap < 0.7 * hips) return say("feetApart", body);
    if (feetGap > 2.6 * hips) return say("feetCloser", body);
  }
  return say("ok", body);
}

// Is the person standing still? `history` is [{ t, landmarks }], newest last; the nose, shoulders and hips
// must stay within ~1 % of the frame height for `ms` milliseconds.
export function isStill(history, { ms = 700, height = 1920, width = 1080 } = {}) {
  if (history.length < 2) return false;
  const last = history[history.length - 1];
  const recent = history.filter((h) => last.t - h.t <= ms);
  if (last.t - recent[0].t < ms * 0.8) return false;
  const pts = [I.nose, I.lSh, I.rSh, I.lHip, I.rHip];
  const limit = 0.012 * height;
  return recent.every((h) => pts.every((i) => {
    const a = h.landmarks?.[i]; const b = last.landmarks?.[i];
    return a && b && Math.hypot((a.x - b.x) * width, (a.y - b.y) * height) <= limit;
  }));
}

// The head and shoulders for the palette, cut from a full-length photo: a box around the face from
// the ears and eyes (normalised landmarks) → { x, y, w, h } in pixels, or null when the face is not
// seen or too small to read the colours (the ears less than 40 px apart).
export function faceBox(landmarks, width, height) {
  const lm = landmarks;
  if (!Array.isArray(lm) || lm.length < 11 || !seen(lm[I.nose]) || !seen(lm[I.lEye]) || !seen(lm[I.rEye])) return null;
  const eyes = Math.abs(lm[I.lEye].x - lm[I.rEye].x) * width;
  const ears = seen(lm[I.lEar]) && seen(lm[I.rEar]) ? Math.abs(lm[I.lEar].x - lm[I.rEar].x) * width : 2.2 * eyes;
  const span = Math.max(ears, 2.2 * eyes);
  if (span < 40) return null;
  const cx = lm[I.nose].x * width;
  const eyeY = ((lm[I.lEye].y + lm[I.rEye].y) / 2) * height;
  const w = 2.6 * span; const h = 3.1 * span;
  const x = Math.max(0, Math.round(cx - w / 2));
  const y = Math.max(0, Math.round(eyeY - 1.25 * span));
  return { x, y, w: Math.round(Math.min(w, width - x)), h: Math.round(Math.min(h, height - y)) };
}
