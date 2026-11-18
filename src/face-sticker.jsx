// A neutral smiling face, drawn as a flat "sticker" (no photo, no file, no network), shown in «Моя палитра»
// until the person adds a selfie: a young woman, a young man, or a neutral face when the gender is not set.
// The clothes take the drape colour (CSS variable --drape), like the fabric a colour analyst holds under
// the chin. The skin follows the undertone from the palette (warm / cool / neutral), so the picture is
// closer to the person, and the earrings take the person's best metal.

const SKIN = {
  warm: { base: "#E2AD87", shade: "#C9906A", blush: "#E4886C" },
  cool: { base: "#E7B4A5", shade: "#CE9585", blush: "#DE7C84" },
  neutral: { base: "#E3AF95", shade: "#CB937A", blush: "#E08378" },
};

// «тёплый подтон» → warm, «холодный» → cool, anything else → neutral
export function skinTone(undertone) {
  const t = String(undertone || "").toLowerCase();
  if (/т[её]пл|warm/.test(t)) return "warm";
  if (/холод|cool/.test(t)) return "cool";
  return "neutral";
}

const FACE = "M67 88 C67 62 82 50 100 50 C118 50 133 62 133 88 C133 116 118 136 100 136 C82 136 67 116 67 88 Z";
const FACE_MALE = "M66 88 C66 62 82 50 100 50 C118 50 134 62 134 88 L134 102 C134 124 118 138 100 138 C82 138 66 124 66 102 Z";

const HAIR = {
  female: {
    back: "M100 38 C70 38 56 60 57 92 C58 118 54 140 47 160 C62 166 77 163 85 154 L85 120 L115 120 L115 154 C123 163 138 166 153 160 C146 140 142 118 143 92 C144 60 130 38 100 38 Z",
    front: "M57 96 C55 60 74 40 102 40 C130 40 146 60 143 96 C141 80 134 68 122 61 C112 72 92 80 70 82 C64 86 60 90 57 96 Z",
  },
  male: {
    back: "",
    front: "M64 94 C60 58 78 38 102 38 C128 38 142 56 136 94 C134 80 131 72 126 66 C114 70 96 70 80 64 C72 72 67 82 64 94 Z",
  },
  neutral: {
    back: "M100 40 C72 40 58 60 58 92 C58 112 60 124 66 132 L84 128 L116 128 L134 132 C140 124 142 112 142 92 C142 60 128 40 100 40 Z",
    front: "M58 96 C56 60 74 40 100 40 C126 40 144 60 142 96 C140 78 126 65 100 65 C74 65 60 78 58 96 Z",
  },
};

export function FaceSticker({ gender = "", undertone = "", metal = "" }) {
  const kind = gender === "female" || gender === "male" ? gender : "neutral";
  const male = kind === "male";
  const skin = SKIN[skinTone(undertone)];
  const hair = male ? "#2B211C" : "#3A2A22";
  const hairShape = HAIR[kind];
  return (
    <svg className="face-sticker" viewBox="24 28 152 152" aria-hidden="true" focusable="false">
      <rect width="200" height="200" fill="#E9E3DA" />
      {hairShape.back && <path d={hairShape.back} fill={hair} />}
      <path d="M86 116 V158 C92 166 108 166 114 158 V116 Z" fill={skin.shade} />
      <path className="face-sticker__cloth" d="M-12 200 C-6 170 38 157 78 152 C86 164 114 164 122 152 C162 157 206 170 212 200 Z" />
      <ellipse cx="66" cy="96" rx="7" ry="11" fill={skin.base} />
      <ellipse cx="134" cy="96" rx="7" ry="11" fill={skin.base} />
      {kind === "female" && metal && (
        <g fill={metal}>
          <circle cx="65" cy="109" r="2.8" />
          <circle cx="135" cy="109" r="2.8" />
        </g>
      )}
      <path d={male ? FACE_MALE : FACE} fill={skin.base} />
      <path d={hairShape.front} fill={hair} />
      <g fill="none" stroke={hair} strokeWidth={male ? 4 : 3} strokeLinecap="round">
        <path d="M78 84 Q86 79 94 83" />
        <path d="M106 83 Q114 79 122 84" />
      </g>
      <g fill="#2A211D">
        <ellipse cx="86" cy="95" rx="3.4" ry="4.2" />
        <ellipse cx="114" cy="95" rx="3.4" ry="4.2" />
      </g>
      <g fill="#FFFFFF" opacity=".8">
        <circle cx="87.3" cy="93.4" r="1.1" />
        <circle cx="115.3" cy="93.4" r="1.1" />
      </g>
      <path d="M100 99 Q96.5 108 100.8 110.5" fill="none" stroke={skin.shade} strokeWidth="2.4" strokeLinecap="round" />
      <g fill={skin.blush} opacity={male ? 0.16 : 0.3}>
        <ellipse cx="79" cy="111" rx="7.5" ry="4.2" />
        <ellipse cx="121" cy="111" rx="7.5" ry="4.2" />
      </g>
      <path d={male ? "M90 118 Q100 127 110 118 Q100 121.5 90 118 Z" : "M88 117 Q100 129 112 117 Q100 122 88 117 Z"} fill={male ? "#A4564C" : "#B9575A"} />
    </svg>
  );
}
