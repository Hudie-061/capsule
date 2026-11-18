// Stick figures: how to stand for each full-length photo, with the levels that get measured.
// Shown on «Мерки по фото» and before the camera starts (src/body-capture.jsx).
export function PoseGuide() {
  const level = (y, x1, x2) => <line className="pose-guide__level" x1={x1} x2={x2} y1={y} y2={y} />;
  return (
    <div className="pose-guide" aria-label="Как встать: спереди — прямо, руки чуть в стороны, ноги на ширине бёдер; сбоку — прямо, руки вдоль тела">
      <figure>
        <svg viewBox="0 0 120 200" aria-hidden="true">
          <line className="pose-guide__floor" x1="6" x2="114" y1="190" y2="190" />
          {level(62, 44, 76)}{level(80, 47, 73)}{level(100, 44, 76)}
          <circle cx="60" cy="20" r="11" />
          <path d="M60 31 V104 M44 44 H76 M50 104 H70 M44 44 L18 92 M76 44 L102 92 M52 104 L45 188 M68 104 L75 188 M45 188 H37 M75 188 H83" />
        </svg>
        <figcaption><b>Спереди</b><span>руки чуть в стороны, ноги на ширине бёдер</span></figcaption>
      </figure>
      <figure>
        <svg viewBox="0 0 120 200" aria-hidden="true">
          <line className="pose-guide__floor" x1="6" x2="114" y1="190" y2="190" />
          {level(62, 49, 73)}{level(80, 51, 70)}{level(100, 48, 72)}
          <circle cx="60" cy="20" r="11" />
          <path d="M71 19 L74 22 M60 31 V104 M60 44 L63 100 M60 104 L59 188 M59 188 H73" />
        </svg>
        <figcaption><b>Сбоку</b><span>прямо, руки вдоль тела</span></figcaption>
      </figure>
    </div>
  );
}
