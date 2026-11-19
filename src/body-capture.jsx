// «Снять с подсказками»: the phone takes both full-length photos by itself, for people with no one to
// hold the camera. The phone stands upright at waist height; the person steps back and hears what to
// fix ("отойди назад", "руки чуть в стороны"). When the pose is right and the person stands still, a
// 3-2-1 countdown with beeps takes a short burst of frames (the measurements use the median), then the
// same for the side view. Everything happens on the phone: the frames live in memory only.
// Pose checks: src/lib/pose-check.js. Joints: MediaPipe Pose in video mode (src/lib/pose-models.js).
import { useEffect, useRef, useState } from "react";
import { checkPose, HINTS, isStill } from "./lib/pose-check.js";
import { loadLiveLandmarker } from "./lib/pose-models.js";
import { canvasToBlob, makeCanvas } from "./lib/image.js";
import { PoseGuide } from "./pose-guide.jsx";
import { Icon, SwapIcon } from "./ui.jsx";

const BURST = 4; // frames per photo
const COUNT = 3; // seconds of countdown
const MEASURE_SIDE = 1280; // frames for measuring are kept at this size (memory on phones)
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];
const VIEW_NAME = { front: "Спереди", side: "Боком" };

function frameOf(video, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
  const canvas = makeCanvas(Math.round(video.videoWidth * scale), Math.round(video.videoHeight * scale));
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// onDone({ front: [canvas], side: [canvas], frontFull: canvas }) — frontFull is the camera's full size,
// for the face (palette) and the try-on photo.
export function BodyCapture({ onDone, onCancel }) {
  const videoRef = useRef(null);
  const overlayRef = useRef(null);
  const streamRef = useRef(null);
  const tiltRef = useRef(null);
  const audioRef = useRef(null);
  const voiceRef = useRef(true);
  const run = useRef(null);
  const wakeRef = useRef(null);
  const [facing, setFacing] = useState("user");
  const [voice, setVoice] = useState(true);
  const [phase, setPhase] = useState("start"); // start → loading → front → side → review
  const [hint, setHint] = useState({ id: "none", text: HINTS.none, ok: false });
  const [count, setCount] = useState(0);
  const [error, setError] = useState("");
  const [shots, setShots] = useState(null); // { front, side, frontFull, urls: { front, side } }

  voiceRef.current = voice;

  const say = (text) => {
    if (!voiceRef.current || !window.speechSynthesis || !text) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ru-RU";
    u.rate = 1.05;
    window.speechSynthesis.speak(u);
  };
  const beep = (freq = 880, ms = 140) => {
    const ctx = audioRef.current;
    if (!ctx || !voiceRef.current) return;
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.frequency.value = freq; gain.gain.value = 0.15;
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + ms / 1000);
  };

  // Only the camera: switching between front and back must not stop the joints loop (it did, so the
  // back camera never recognised anyone).
  const stopTracks = () => {
    for (const track of streamRef.current?.getTracks() || []) track.stop();
    streamRef.current = null;
  };
  // The camera and the loop: when the photos are taken or the screen closes.
  const stopCamera = () => {
    stopTracks();
    if (run.current) run.current.stopped = true;
    wakeRef.current?.release?.().catch(() => {});
    wakeRef.current = null;
  };
  // The screen must not dim while the person steps back from the phone (Screen Wake Lock; where the
  // browser has none, the phone's own auto-lock applies).
  const keepAwake = async () => {
    try { wakeRef.current = (await navigator.wakeLock?.request("screen")) || null; } catch { /* not supported */ }
  };

  // everything stops when the screen closes
  useEffect(() => {
    const onTilt = (e) => { tiltRef.current = e.beta == null ? null : { beta: e.beta, gamma: e.gamma }; };
    // the wake lock ends when the page is hidden; take it again when it is back
    const onVisible = () => { if (document.visibilityState === "visible" && streamRef.current && (!wakeRef.current || wakeRef.current.released)) keepAwake(); };
    window.addEventListener("deviceorientation", onTilt);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("deviceorientation", onTilt);
      document.removeEventListener("visibilitychange", onVisible);
      stopCamera();
      window.speechSynthesis?.cancel();
      audioRef.current?.close?.().catch(() => {});
    };
  }, []);

  useEffect(() => () => { if (shots?.urls) Object.values(shots.urls).forEach((u) => u && URL.revokeObjectURL(u)); }, [shots]);

  // A tall picture for a standing person. Asking for 1920×1920 gave a square crop on phones, so the
  // person had to step far back. Phones read width/height differently, so a few sizes are tried in turn
  // and the first tall one is kept (on a computer a wide picture is fine).
  const startCamera = async (which = facing) => {
    setError("");
    stopTracks();
    const video = videoRef.current;
    const portrait = window.innerHeight >= window.innerWidth;
    const sizes = portrait
      ? [{ width: { ideal: 1080 }, height: { ideal: 1920 }, aspectRatio: { ideal: 9 / 16 } }, { width: { ideal: 1920 }, height: { ideal: 1080 } }, { width: { ideal: 1280 }, height: { ideal: 720 } }]
      : [{ width: { ideal: 1920 }, height: { ideal: 1080 } }];
    try {
      let best = null;
      for (const size of sizes) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: which, ...size } });
        video.srcObject = stream;
        await video.play();
        if (!video.videoWidth) await new Promise((r) => { video.onloadedmetadata = r; setTimeout(r, 1500); });
        const tall = video.videoHeight / Math.max(1, video.videoWidth);
        if (!portrait || tall >= 1.3) { if (best) best.stream.getTracks().forEach((t) => t.stop()); best = { stream, tall }; break; }
        if (!best || tall > best.tall) { if (best) best.stream.getTracks().forEach((t) => t.stop()); best = { stream, tall }; } else stream.getTracks().forEach((t) => t.stop());
      }
      if (video.srcObject !== best.stream) { video.srcObject = best.stream; await video.play(); }
      streamRef.current = best.stream;
      return true;
    } catch (e) {
      setError(e?.name === "NotAllowedError"
        ? "Нет доступа к камере. Разреши его в настройках браузера или загрузи готовые фото."
        : "Камера не включилась. Можно загрузить готовые фото.");
      setPhase("start");
      return false;
    }
  };

  // The first tap: sound and voice need a tap to start on phones, and iPhone asks for the tilt sensor.
  // `which`: "user" — the person films themselves with the front camera; "environment" — someone else
  // holds the phone and films with the back camera.
  const begin = async (which = facing) => {
    setFacing(which);
    try { audioRef.current ??= new (window.AudioContext || window.webkitAudioContext)(); } catch { /* no sound */ }
    try { await window.DeviceOrientationEvent?.requestPermission?.(); } catch { /* no tilt check */ }
    say(which === "user" ? "Поставь телефон вертикально на уровне пояса и отойди на два-три шага" : "Держи телефон вертикально на уровне пояса, в двух-трёх шагах");
    setPhase("loading");
    const [ok, landmarker] = await Promise.all([startCamera(which), loadLiveLandmarker().catch(() => null)]);
    if (!ok) return;
    keepAwake();
    if (!landmarker) { stopCamera(); setError("Не получилось загрузить распознавание фигуры. Проверь интернет и попробуй ещё раз."); setPhase("start"); return; }
    run.current = { landmarker, view: "front", history: [], countdownAt: 0, shown: 0, forced: false, burst: [], full: null, front: null, pending: { id: "", since: 0 }, spoken: { id: "", at: 0 }, grace: performance.now() + 2500, last: 0, stopped: false };
    setPhase("front");
  };

  const switchCamera = async () => {
    const next = facing === "user" ? "environment" : "user";
    setFacing(next);
    if (run.current) { run.current.history = []; run.current.countdownAt = 0; run.current.grace = performance.now() + 1500; }
    setCount(0);
    await startCamera(next);
  };

  // The loop: joints → checks → hint, countdown, burst.
  useEffect(() => {
    if (phase !== "front" && phase !== "side") return undefined;
    // a timer, not animation frames: frames stop whenever the page is not drawn, a timer keeps going
    let timer = 0;
    const draw = (lm, W, H) => {
      const canvas = overlayRef.current;
      if (!canvas) return;
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, W, H);
      if (!lm) return;
      ctx.strokeStyle = run.current?.okNow ? "#9BE27A" : "#F4EFE7";
      ctx.lineWidth = Math.max(3, W / 180);
      ctx.lineCap = "round";
      for (const [a, b] of BONES) {
        if ((lm[a].visibility ?? 1) < 0.5 || (lm[b].visibility ?? 1) < 0.5) continue;
        ctx.beginPath(); ctx.moveTo(lm[a].x * W, lm[a].y * H); ctx.lineTo(lm[b].x * W, lm[b].y * H); ctx.stroke();
      }
    };
    const finishShot = (now) => {
      const r = run.current;
      const frames = r.burst; r.burst = []; r.capturing = false;
      beep(1320, 220);
      if (r.view === "front") {
        r.front = frames; r.view = "side"; r.grace = now + 3000; r.history = [];
        r.spoken = { id: "", at: now };
        say("Готово. Теперь повернись боком, руки вдоль тела");
        setPhase("side");
        return;
      }
      stopCamera();
      say("Готово!");
      const result = { front: r.front, side: frames, frontFull: r.full, urls: { front: null, side: null } };
      Promise.all([canvasToBlob(r.full || r.front[1], "image/jpeg", 0.85), canvasToBlob(frames[1] || frames[0], "image/jpeg", 0.85)])
        .then(([f, s]) => setShots({ ...result, urls: { front: URL.createObjectURL(f), side: URL.createObjectURL(s) } }))
        .catch(() => setShots(result));
      setPhase("review");
    };
    const tick = () => {
      timer = setTimeout(tick, 100);
      const now = performance.now();
      const r = run.current; const video = videoRef.current;
      if (!r || r.stopped || !video || video.readyState < 2 || now - r.last < 90) return;
      r.last = now;
      if (r.capturing) {
        r.burst.push(frameOf(video, MEASURE_SIDE));
        if (r.view === "front" && r.burst.length === 2) r.full = frameOf(video, 4096);
        if (r.burst.length >= BURST) finishShot(now);
        return;
      }
      let lm = null;
      try { lm = r.landmarker.detectForVideo(video, now).landmarks?.[0] || null; } catch { return; }
      const W = video.videoWidth; const H = video.videoHeight;
      const check = checkPose(lm, { view: r.view, width: W, height: H, tilt: tiltRef.current });
      r.history.push({ t: now, landmarks: lm });
      while (r.history.length && now - r.history[0].t > 1500) r.history.shift();
      const still = check.ok && isStill(r.history, { width: W, height: H });
      r.okNow = check.ok;
      draw(lm, W, H);
      setHint((h) => (h.id === check.id ? h : check));

      if (r.countdownAt) {
        if (!check.ok && !r.forced) { r.countdownAt = 0; setCount(0); say(check.text); r.spoken = { id: check.id, at: now }; return; }
        const left = COUNT - Math.floor((now - r.countdownAt) / 1000);
        if (left !== r.shown) { r.shown = left; setCount(Math.max(0, left)); if (left > 0) beep(); }
        if (left <= 0) { r.countdownAt = 0; r.forced = false; r.capturing = true; setCount(0); }
        return;
      }
      if (now < r.grace) return;
      if (check.ok && still) { r.countdownAt = now; r.shown = 0; say("Замри"); return; }
      // speak a hint once it has held for a moment; repeat it now and then
      if (check.id !== r.pending.id) r.pending = { id: check.id, since: now };
      const changed = r.spoken.id !== check.id;
      if (now - r.pending.since > 700 && now - r.spoken.at > (changed ? 2500 : 7000) && check.id !== "ok") {
        say(check.text);
        r.spoken = { id: check.id, at: now };
      }
    };
    timer = setTimeout(tick, 100);
    return () => clearTimeout(timer);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // The shutter by hand: for someone helping, or when the checks keep complaining.
  const shootNow = () => {
    const r = run.current;
    if (!r || r.countdownAt || r.capturing) return;
    r.forced = true; r.countdownAt = performance.now(); r.shown = 0;
  };

  const retake = () => {
    setShots(null);
    begin(facing);
  };

  const mirrored = facing === "user";
  const live = phase === "front" || phase === "side" || phase === "loading";

  return (
    <div className="capture" role="dialog" aria-modal="true" aria-label="Съёмка в полный рост">
      <div className="capture__top">
        <button type="button" className="round-button round-button--lg capture__close" aria-label="Закрыть" onClick={onCancel}><Icon name="close" size={22} width={2} /></button>
        {live && phase !== "loading" && <span className="capture__step">{VIEW_NAME[phase]} · {phase === "front" ? "1" : "2"} из 2</span>}
        <button type="button" className={`pill-chip capture__voice${voice ? " is-on" : ""}`} aria-pressed={voice} onClick={() => setVoice(!voice)}>
          <SwapIcon name={voice ? "bell" : "close"} size={14} width={2} /> {voice ? "Голос вкл." : "Без звука"}
        </button>
      </div>

      {phase === "start" && (
        <div className="capture__intro">
          <h2 className="sheet__title">Сниму сам — без помощника</h2>
          <PoseGuide />
          <ol className="capture__steps">
            <li><b>Поставь телефон вертикально</b> на уровне пояса — на полку, стул или у стены.</li>
            <li><b>Отойди на 2–3 шага</b>, чтобы был виден весь рост. Подскажу голосом, куда встать.</li>
            <li><b>Встань как на картинке</b> — сниму сам после отсчёта 3-2-1, потом попрошу повернуться боком.</li>
          </ol>
          <p className="tiny-text">Облегающая одежда, без обуви. Кадры обрабатываются на телефоне и не сохраняются.</p>
          {error && <p className="status-line status-line--error">{error}</p>}
          <button type="button" className="btn btn--light btn--block btn--tall" onClick={() => begin("user")}><Icon name="camera" size={20} width={2} /> Снимаю себя сам</button>
          <button type="button" className="btn btn--outline-light btn--block" onClick={() => begin("environment")}><Icon name="person" size={18} width={2} /> Меня снимает другой человек</button>
          <p className="tiny-text">Второй вариант — задняя камера, она чётче. Подсказки слышны вам обоим.</p>
        </div>
      )}

      <div className={`capture__stage${live ? "" : " is-hidden"}${mirrored ? " is-mirrored" : ""}`}>
        <video ref={videoRef} playsInline muted autoPlay />
        <canvas ref={overlayRef} aria-hidden="true" />
        {phase === "loading" && <span className="capture__loading"><span className="spinner" aria-hidden="true" /> Включаю камеру и распознавание…</span>}
        {count > 0 && <span className="capture__count" aria-live="assertive">{count}</span>}
        {(phase === "front" || phase === "side") && <span className={`capture__hint${hint.ok ? " is-ok" : ""}`} aria-live="polite">{count > 0 ? "Замри" : hint.text}</span>}
      </div>
      {(phase === "front" || phase === "side") && (
        <div className="capture__actions">
          <button type="button" className="btn btn--outline-light" onClick={switchCamera}><Icon name="refresh" size={16} width={2} /> Камера</button>
          <button type="button" className="btn btn--light btn--grow2" onClick={shootNow}><Icon name="camera" size={18} width={2} /> Снять сейчас</button>
        </div>
      )}

      {phase === "review" && (
        <div className="capture__review">
          <h2 className="sheet__title">Нравятся фото?</h2>
          <div className="capture__shots">
            {["front", "side"].map((view) => (
              <figure key={view}>
                {shots?.urls?.[view] ? <img src={shots.urls[view]} alt={`Фото ${VIEW_NAME[view].toLowerCase()}`} /> : <span className="shimmer shimmer--dark" />}
                <figcaption>{VIEW_NAME[view]}</figcaption>
              </figure>
            ))}
          </div>
          <p className="tiny-text">Видно всё тело, от макушки до стоп? Тогда измеряю.</p>
          <div className="action-row">
            <button type="button" className="btn btn--outline-light btn--grow1" onClick={retake}>Переснять</button>
            <button type="button" className="btn btn--light btn--grow2" disabled={!shots} onClick={() => onDone(shots)}><Icon name="check" size={18} width={2.2} /> Нравятся</button>
          </div>
        </div>
      )}
    </div>
  );
}
