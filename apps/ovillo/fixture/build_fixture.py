"""Build the Ovillo app's FIXTURE: three real Ariadne pieces, written to the `ovl:` contract.

    uv run --with numpy --with soundfile python apps/ovillo/fixture/build_fixture.py \
        <pieces.json> <r4-sounds-dir> <bench-log> <patches-dir> <out-dir>

This is a fixture, and it says so (fixture/README.md; the playlist's rdfs:comment). It stands in for the
`ovillo` graph until the graph builder's `site/graph/out/` exists. Its numbers are not invented: every
sound, receipt, ledger value, energy frame and touch is copied or computed from the renders of
2026-10-20 (the same files the static r4 site was built from):

  pieces.json         the r4 build's piece list (slug, title, group, tags, engine, note, wav, score, receipt, energy)
  r4-sounds-dir       the r4 build's `sounds/` (the gain-matched mp3s and the trimmed receipts it serves)
  bench-log           the bench's render log for the bench piece (pattern, pickup, closure residual)
  patches-dir         the bench patches (`glass.json`, ...)

Writes <out>/ovillo.nt (the `user:rdf` graph) and <out>/site/{media,scores,receipts}/.
"""
import json
import re
import shutil
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

SLUGS = ["hilo-de-luz", "gigante-y-juguete", "agua-mansa"]
BASE = "https://ovillo.sophia-labs.com"
OVL = "http://sophia.ai/ovillo#"
DCT = "http://purl.org/dc/terms/"
RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
RDFS = "http://www.w3.org/2000/01/rdf-schema#"
XSD = "http://www.w3.org/2001/XMLSchema#"


def iri(kind, slug):
    return f"{BASE}/id/{kind}/{slug}"


def lit(value):
    s = str(value).replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\r", "\\r")
    return f'"{s}"'


def typed(value, dtype):
    return f'{lit(value)}^^<{XSD}{dtype}>'


def dbl(x):
    return typed(repr(float(x)), "double")


def integer(x):
    return typed(int(x), "integer")


class Graph:
    def __init__(self):
        self.lines = []

    def add(self, s, p, o):
        self.lines.append(f"<{s}> <{p}> {o} .")

    def ref(self, s, p, o):
        self.add(s, p, f"<{o}>")

    def text(self):
        return "\n".join(self.lines) + "\n"


def sig4(a):
    return np.array([float(f"{v:.4g}") for v in a.ravel()]).reshape(a.shape)


def peaks_json(wav, gain_db):
    """The graph builder's shape: min,max of the mono mix every 10 ms (the energy trace's hop), after the page gain."""
    x, sr = sf.read(wav, always_2d=True)
    spp = int(round(sr / 100))
    m = x.mean(axis=1) * 10 ** (gain_db / 20)
    m = np.pad(m, (0, (-len(m)) % spp)).reshape(-1, spp)
    pk = np.stack([m.min(axis=1), m.max(axis=1)], axis=1).round(3).ravel().tolist()
    return {"sr": int(sr), "samplesPerPeak": spp, "peaks": pk}


def energy_json(trace_path):
    """The graph builder's compact trace (ovillo.energy.v1): per body (strings, box, room) the stored energy every
    hop, summed over the piece's Worlds, raw energy (not decibels), 4 significant digits; with more than one World,
    each World's own frames too; touches as {t, string, kind, ...}."""
    tr = json.loads(Path(trace_path).read_text())
    worlds, touches = [], []
    for w in tr["worlds"]:
        ch = w["channels"]
        fr = np.array(w["frames"], dtype=float)
        sel = lambda f: [i for i, c in enumerate(ch) if f(c)]
        cols = [fr[:, sel(lambda c: c.startswith("string/"))].sum(axis=1),
                fr[:, sel(lambda c: c.startswith("box/"))].sum(axis=1),
                fr[:, sel(lambda c: c == "room")].sum(axis=1)]
        worlds.append((w["instrument"], sig4(np.stack(cols, axis=1))))
        for t in w.get("touches", []):
            touches.append({"t": round(t["seconds"], 4), "string": t.get("string"), "kind": t.get("kind"),
                            "fret": t.get("fret"), "db": t.get("db"), "hand": t.get("hand"), "world": w["instrument"]})
    n = max(len(f) for _, f in worlds)
    total = np.zeros((n, 3))
    for _, f in worlds:
        total[: len(f)] += f
    touches.sort(key=lambda t: (t["t"], t["world"], t["string"] if t["string"] is not None else -1))
    out = {"schema": "ovillo.energy.v1", "hopSeconds": tr["worlds"][0]["hopSeconds"], "startSeconds": 0,
           "channels": ["strings", "box", "room"],
           "units": "stored energy in the World's own state units (raw energy, not decibels); strings, box and room "
                    "each summed over their bodies; 4 significant digits",
           "frames": sig4(total).tolist(), "touches": touches}
    if len(worlds) > 1:
        out["worlds"] = [{"world": name, "frames": f.tolist()} for name, f in worlds]
    return out


def score_instruments(score_text):
    """`# instruments:` lines: `gt = steel-string guitar (treble, -12, anatomy=..., tuning=..., capo=0)`."""
    out = {}
    for m in re.finditer(r"^#\s+(\w+)\s+=\s+([^(\n]+)\(([^)]*)\)", score_text, re.M):
        name, desc, args = m.group(1), m.group(2).strip(), m.group(3)
        kv = dict(re.findall(r"(\w+)=([^,]+)", args))
        if "anatomy" in kv:
            out[name] = {"title": desc, "anatomy": kv["anatomy"].strip(), "tuning": kv.get("tuning", "").strip()}
    return out


def main():
    pieces_path, sounds_dir, bench_log, patches_dir, out = map(Path, sys.argv[1:6])
    pieces = {p["slug"]: p for p in json.loads(pieces_path.read_text())}
    manifest = {m["slug"]: m for m in json.loads((sounds_dir / "manifest.json").read_text())}
    for sub in ("media", "scores", "receipts"):
        (out / "site" / sub).mkdir(parents=True, exist_ok=True)
    g = Graph()
    playlist = iri("playlist", "fixture")
    g.ref(playlist, RDF + "type", OVL + "Playlist")
    g.add(playlist, DCT + "title", lit("Fixture: three Ariadne pieces"))
    g.add(playlist, RDFS + "comment", lit(
        "FIXTURE for apps/ovillo (Shrubbery), standing in for the ovillo graph until it is built. "
        "Every number is copied or computed from the renders of 2026-10-20; see apps/ovillo/fixture/README.md."))

    for position, slug in enumerate(SLUGS, start=1):
        p, m = pieces[slug], manifest[slug]
        piece, render, score = iri("piece", slug), iri("render", slug), iri("score", slug)
        g.ref(playlist, OVL + "item", piece)
        g.ref(piece, RDF + "type", OVL + "Piece")
        g.add(piece, DCT + "title", lit(p["title"]))
        g.add(piece, OVL + "slug", lit(slug))
        g.add(piece, OVL + "group", lit(p["group"]))
        for tag in p.get("tags", []):
            g.add(piece, OVL + "tag", lit(tag))
        g.add(piece, OVL + "note", lit(p["note"]))
        g.add(piece, OVL + "engine", lit(p["engine"]))
        g.add(piece, OVL + "position", integer(position))
        g.ref(piece, OVL + "score", score)
        g.ref(piece, OVL + "render", render)

        # The score: the source text, copied.
        src = Path(p["score"])
        score_text = src.read_text()
        ext = src.suffix
        shutil.copyfile(src, out / "site" / "scores" / f"{slug}{ext}")
        g.ref(score, RDF + "type", OVL + "Score")
        g.add(score, OVL + "format", lit("mus" if ext == ".mus" else "ovillo-score-json"))
        g.add(score, OVL + "text", lit(score_text))
        g.add(score, OVL + "repoPath", lit(f"site/scores/{src.name}"))

        # The render: the r4 mp3 (gain-matched), peaks from the World's samples.
        shutil.copyfile(sounds_dir / f"{slug}.mp3", out / "site" / "media" / f"{slug}.mp3")
        (out / "site" / "media" / f"{slug}.peaks.json").write_text(json.dumps(peaks_json(p["wav"], m["pageGainDb"]), separators=(",", ":")))
        g.ref(render, RDF + "type", OVL + "Render")
        g.ref(render, OVL + "audio", (f"{BASE}/media/{slug}.mp3"))
        g.ref(render, OVL + "peaks", (f"{BASE}/media/{slug}.peaks.json"))
        g.add(render, OVL + "durationSeconds", dbl(sf.info(p["wav"]).duration))
        g.add(render, OVL + "worldPeakDbfs", dbl(m["worldPeakDbfs"]))
        g.add(render, OVL + "worldRmsDbfs", dbl(m["worldRmsDbfs"]))
        g.add(render, OVL + "pageGainDb", dbl(m["pageGainDb"]))
        g.add(render, DCT + "created", typed("2026-10-20", "date"))

        instruments = score_instruments(score_text) if ext == ".mus" else {}
        if p.get("energy"):
            (out / "site" / "media" / f"{slug}.energy.json").write_text(
                json.dumps(energy_json(p["energy"]), separators=(",", ":")))
            g.ref(render, OVL + "energyTrace", (f"{BASE}/media/{slug}.energy.json"))
        if (sounds_dir / f"{slug}.receipt.json").exists():
            receipt = json.loads((sounds_dir / f"{slug}.receipt.json").read_text())
            shutil.copyfile(sounds_dir / f"{slug}.receipt.json", out / "site" / "receipts" / f"{slug}.json")
            g.ref(render, OVL + "receipt", (f"{BASE}/receipts/{slug}.json"))
            g.add(render, OVL + "renderDigest", lit(receipt["renderDigest"]))
            g.add(render, OVL + "engineVersion", lit(receipt["engineVersion"]))
            g.add(score, OVL + "sourceDigest", lit(receipt["sourceDigest"]))
            for w in receipt.get("ariadneWorlds", []):
                ledger = iri("ledger", f"{slug}-{w['instrument']}")
                g.ref(render, OVL + "ledger", ledger)
                g.ref(ledger, RDF + "type", OVL + "Ledger")
                g.add(ledger, OVL + "world", lit(w["instrument"]))
                g.add(ledger, OVL + "anatomy", lit(w["anatomy"]))
                g.add(ledger, OVL + "planDigest", lit(w["planDigest"]))
                for k in ("plucks", "hammerOns", "pullOffs", "slides"):
                    g.add(ledger, OVL + k, integer(w[k]))
                for k, prop in (("sourceWork", "sourceWork"), ("controlWork", "controlWork"),
                                ("internalLoss", "internalLoss"), ("radiation", "radiation"),
                                ("cumulativeClosureResidual", "closureResidual"),
                                ("maximumFrameResidual", "maxFrameResidual")):
                    g.add(ledger, OVL + prop, dbl(w[k]))
                inst = iri("instrument", f"{slug}-{w['instrument']}")
                g.ref(piece, OVL + "instrument", inst)
                g.ref(inst, RDF + "type", OVL + "Instrument")
                info = instruments.get(w["instrument"], {})
                g.add(inst, DCT + "title", lit(info.get("title", "steel-string guitar")))
                g.add(inst, OVL + "kind", lit("steel-string"))
                g.add(inst, OVL + "anatomy", lit(w["anatomy"]))
                if info.get("tuning"):
                    g.add(inst, OVL + "tuning", lit(info["tuning"]))
        if p.get("bench"):
            log = bench_log.read_text()
            pattern, pickup = re.search(r"pattern (\w+)\s+pickup (\w+)", log).groups()
            safety = int(re.search(r"safety-limited frames (\d+)", log).group(1))
            residual = float(re.search(r"closure residual ([0-9.e+-]+)", log).group(1))
            bench = iri("bench", slug)
            g.ref(render, OVL + "bench", bench)
            g.ref(bench, RDF + "type", OVL + "BenchRun")
            g.add(bench, OVL + "pattern", lit(pattern.lower()))
            g.add(bench, OVL + "pickup", lit(pickup.lower()))
            patch = json.loads((patches_dir / f"{p['bench']['patch']}.json").read_text())
            g.add(bench, OVL + "patch", lit(json.dumps({"name": p["bench"]["patch"], **patch}, separators=(",", ":"))))
            g.add(bench, OVL + "closureResidual", dbl(residual))
            g.add(bench, OVL + "safetyLimitedFrames", integer(safety))
            inst = iri("instrument", f"{slug}-bench")
            g.ref(piece, OVL + "instrument", inst)
            g.ref(inst, RDF + "type", OVL + "Instrument")
            g.add(inst, DCT + "title", lit("the bench: a simulated guitar played into an Ariadne World"))
            g.add(inst, OVL + "kind", lit("bench"))
        print(f"{slug:20s} {m['seconds']:5.1f}s")

    (out / "ovillo.nt").write_text(g.text())
    print(f"{len(g.lines)} triples -> {out / 'ovillo.nt'}")


if __name__ == "__main__":
    main()
