# Converts the MakeHuman hm08 base mesh (CC0 1.0) and a few shape targets into one compact binary
# for the app (src/assets/mh-body.bin): Int16 positions, Uint16 triangle indices, sparse Int16 deltas.
# Run once on a computer, not in the app:
#   python -I scripts/makehuman-to-bin.py <folder with base.obj and the .target files> src/assets/mh-body.bin
# Files come from github.com/makehumancommunity/makehuman, makehuman/data/:
#   3dobjs/base.obj
#   targets/macrodetails/{african,asian,caucasian}-{female,male}-young.target
#   targets/macrodetails/universal-{female,male}-young-averagemuscle-{minweight,maxweight}.target
#   targets/measure/measure-{bust-circ,underbust-circ,waist-circ,hips-circ,neck-circ,shoulder-dist,
#                            upperleg-height,thigh-circ}-{decr,incr}.target
import json, struct, sys
src, out = sys.argv[1], sys.argv[2]

V = []; faces = {}; g = None
for line in open(f"{src}/base.obj", encoding="utf-8"):
    if line.startswith("v "): V.append([float(x) for x in line.split()[1:4]])
    elif line.startswith("g "): g = line.split()[1]
    elif line.startswith("f "): faces.setdefault(g, []).append([int(p.split("/")[0]) - 1 for p in line.split()[1:]])

keep_groups = ["body", "helper-l-eye", "helper-r-eye"]
verts = sorted({i for name in keep_groups for f in faces[name] for i in f})
remap = {v: n for n, v in enumerate(verts)}
N = len(verts)

def tris(name):
    out = []
    for f in faces[name]:
        a, b, c, d = (remap[i] for i in f)
        out += [a, b, c, a, c, d]
    return out
body_idx = tris("body")
eye_idx = tris("helper-l-eye") + tris("helper-r-eye")

def read_target(name):
    d = {}
    for line in open(f"{src}/{name}.target", encoding="utf-8"):
        if not line[:1].isdigit(): continue
        p = line.split()
        i = int(p[0])
        if i in remap: d[remap[i]] = [float(x) for x in p[1:4]]
    return d

def mean(names):
    parts = [read_target(n) for n in names]
    out = {}
    for part in parts:
        for i, v in part.items():
            acc = out.setdefault(i, [0.0, 0.0, 0.0])
            for k in range(3): acc[k] += v[k] / len(parts)
    return out

targets = {
    "female": mean([f"{e}-female-young" for e in ("african", "asian", "caucasian")]),
    "male": mean([f"{e}-male-young" for e in ("african", "asian", "caucasian")]),
}
for g1, g2 in (("f", "female"), ("m", "male")):
    for w in ("minweight", "maxweight"): targets[f"{g1}-{w}"] = read_target(f"universal-{g2}-young-averagemuscle-{w}")
    # height targets are left out: the app scales the body to the exact height instead
for m in ("bust-circ", "underbust-circ", "waist-circ", "hips-circ", "neck-circ", "shoulder-dist", "upperleg-height", "thigh-circ"):
    for d in ("decr", "incr"): targets[f"{m}-{d}"] = read_target(f"measure-{m}-{d}")

chunks = []
offset = 0
def push(data):
    global offset
    pad = (-len(data)) % 4
    chunks.append(data + b"\0" * pad)
    start = offset
    offset += len(data) + pad
    return start

pos_scale = max(abs(c) for i in verts for c in V[i]) / 32000
positions = push(struct.pack(f"<{N*3}h", *[round(V[i][k] / pos_scale) for i in verts for k in range(3)]))
body_at = push(struct.pack(f"<{len(body_idx)}H", *body_idx))
eye_at = push(struct.pack(f"<{len(eye_idx)}H", *eye_idx))
meta_targets = []
for name, d in targets.items():
    items = sorted((i, v) for i, v in d.items() if max(abs(x) for x in v) >= 0.0005)
    if not items: raise SystemExit(f"empty target {name}")
    scale = max(abs(x) for _, v in items for x in v) / 32000
    idx_at = push(struct.pack(f"<{len(items)}H", *[i for i, _ in items]))
    delta_at = push(struct.pack(f"<{len(items)*3}h", *[round(x / scale) for _, v in items for x in v]))
    meta_targets.append({"name": name, "count": len(items), "scale": scale, "index": idx_at, "delta": delta_at})

meta = {
    "source": "MakeHuman hm08 base mesh and targets, CC0 1.0 (makehumancommunity/makehuman)",
    "units": "decimetre", "vertices": N, "positionScale": pos_scale,
    "positions": positions, "body": {"at": body_at, "count": len(body_idx)}, "eyes": {"at": eye_at, "count": len(eye_idx)},
    "targets": meta_targets,
}
head = json.dumps(meta, separators=(",", ":")).encode()
head += b" " * ((-len(head)) % 4)
blob = b"MHB1" + struct.pack("<I", len(head)) + head + b"".join(chunks)
open(out, "wb").write(blob)
print("vertices", N, "body tris", len(body_idx) // 3, "bytes", len(blob))
for t in meta_targets: print(f"  {t['name']:22} {t['count']:6} max {t['scale']*32000:.3f}")
