// orb-v1 — an autopoietic unity, drawn as a technical illustrator would draw a
// living thing.
//
// The orb has no surface of its own. Its membrane is twelve smaller orbs
// (the vertices of an icosahedron), and each of those is the same figure
// again: a bounding circle, a ring that turns, a few points, one dot going
// round. Inside the large orb one closed thread stitches through every
// membrane-orb, diving into the interior between them. Dots circulate along
// the thread. The thread is the network of processes; the membrane-orbs are
// the components it produces; the membrane they form is what encloses the
// thread. Nothing in the figure is prior to anything else.
//
// Dependency-free ES module. Canvas 2D, line work and points only, no glow,
// no gradient. Everything fades with depth, as ink would on the far side of
// a glass sphere.
//
//   import { mount } from './orb-v1.js';
//   const unmount = mount(containerElement);
//
// mount(container, { t0 }) optionally starts the clock at t0 seconds.

const INK = '#23242A';
const FAINT = '#9A9CA4';
const BLUE = '#00356B';

const TURN = 72;          // seconds per full rotation of the orb
const LAP = 48;           // seconds for a dot to travel the thread once
const SPIN = 26;          // seconds per turn of a membrane-orb's ring
const FPS_CAP = 30;

// ---------------------------------------------------------------- geometry

const PHI = (1 + Math.sqrt(5)) / 2;

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function add(a, b, s = 1) { return [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]; }
function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }

// Twelve unit vectors: the icosahedron, stood on a vertex so no node sits
// exactly on the rotation axis and the silhouette stays uneven as it turns.
function icosahedron() {
  const raw = [];
  for (const a of [-1, 1]) for (const b of [-PHI, PHI]) {
    raw.push([0, a, b]); raw.push([a, b, 0]); raw.push([b, 0, a]);
  }
  // tilt so a vertex points up-ish but off-axis
  const t = 0.55, c = Math.cos(t), s = Math.sin(t);
  return raw.map(norm).map(([x, y, z]) => [x * c - y * s, x * s + y * c, z]);
}

// A Hamiltonian cycle on the icosahedron graph (every vertex once, back to
// the start). Twelve vertices: a short backtracking search at mount time.
function hamiltonianCycle(V) {
  const n = V.length;
  const adj = V.map((a, i) => V.map((b, j) => (i !== j && dot(a, b) > 0.3) ? j : -1).filter(j => j >= 0));
  const path = [0], used = new Set([0]);
  const go = () => {
    if (path.length === n) return adj[path[n - 1]].includes(0);
    const last = path[path.length - 1];
    for (const j of adj[last]) {
      if (used.has(j)) continue;
      used.add(j); path.push(j);
      if (go()) return true;
      path.pop(); used.delete(j);
    }
    return false;
  };
  go();
  return path;
}

// Closed centripetal Catmull-Rom spline through control points: it passes
// through every point and, unlike the uniform kind, never cusps or loops
// back on itself between them.
function closedSpline(P, per) {
  const n = P.length, out = [];
  const dist = (a, b) => Math.sqrt(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
  const lerp = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
    const t0 = 0, t1 = t0 + dist(p0, p1), t2 = t1 + dist(p1, p2), t3 = t2 + dist(p2, p3);
    for (let k = 0; k < per; k++) {
      const t = t1 + (t2 - t1) * (k / per);
      const A1 = lerp(p0, p1, (t - t0) / (t1 - t0)), A2 = lerp(p1, p2, (t - t1) / (t2 - t1)), A3 = lerp(p2, p3, (t - t2) / (t3 - t2));
      const B1 = lerp(A1, A2, (t - t0) / (t2 - t0)), B2 = lerp(A2, A3, (t - t1) / (t3 - t1));
      out.push(lerp(B1, B2, (t - t1) / (t2 - t1)));
    }
  }
  return out;
}

function buildScene() {
  const nodes = icosahedron();
  const cycle = hamiltonianCycle(nodes);
  // Control points: each node, then a point pulled deep into the interior
  // between it and the next, so the thread stitches in and out of the membrane.
  const ctrl = [];
  for (let i = 0; i < cycle.length; i++) {
    const a = nodes[cycle[i]], b = nodes[cycle[(i + 1) % cycle.length]];
    ctrl.push(scale(a, 0.84));
    // Between two membrane-orbs the thread swings through the interior,
    // off to one side and then the other, so it circulates rather than
    // spokes: a current under the skin, not a wheel.
    const mid = norm(add(a, b));
    const side = norm(cross(mid, add(b, a, -1)));
    ctrl.push(add(scale(mid, 0.6), side, (i % 2 ? 0.2 : -0.2)));
  }
  const thread = closedSpline(ctrl, 8);
  // Local frames for the membrane-orbs.
  const frames = nodes.map(n => {
    const ref = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = norm(cross(n, ref));
    const v = cross(n, u);
    return { n, u, v };
  });
  return { nodes, frames, thread };
}

// ---------------------------------------------------------------- drawing

// Rotation: slow turn about a vertical axis, the whole axis leaned toward
// the viewer a little so the top of the orb shows.
function rotator(t) {
  const a = (t / TURN) * Math.PI * 2;
  const ca = Math.cos(a), sa = Math.sin(a);
  const lean = 0.42, cl = Math.cos(lean), sl = Math.sin(lean);
  return ([x, y, z]) => {
    const x1 = x * ca + z * sa, z1 = -x * sa + z * ca;
    return [x1, y * cl - z1 * sl, y * sl + z1 * cl];
  };
}

// Depth to opacity. z in [-1, 1], toward the viewer positive.
function fade(z, lo, hi) {
  const u = Math.min(1, Math.max(0, (z + 1.15) / 2.3));
  return lo + (hi - lo) * u * u;
}

// Produce the frame as a list of flat primitives, back to front. Pure
// function of time and size, so the SVG fallback can be written from it.
export function frame(t, W, H) {
  const S = buildScene.cache || (buildScene.cache = buildScene());
  const R = Math.min(W / 2.9, H / 2.55);
  const cx = W / 2, cy = H / 2;
  const rot = rotator(t);
  const D = 5.2;                       // camera distance in units of R
  const proj = p => {
    const k = D / (D - p[2]);
    return { x: cx + p[0] * R * k, y: cy - p[1] * R * k, z: p[2], k };
  };
  const prims = [];
  const push = p => prims.push(p);

  // The large orb's own outline: the faintest hairline. It is not the
  // membrane, only where the membrane would be.
  push({ kind: 'circle', x: cx, y: cy, r: R * 0.985, z: -1.3, w: 0.6, color: FAINT, a: 0.45 });

  // The thread.
  // Drawn in short runs, each at the opacity of its own depth, so the
  // line fades as it goes round the far side.
  const T = S.thread.map(p => proj(rot(p)));
  const RUN = 4;
  for (let i = 0; i < T.length; i += RUN) {
    const pts = [];
    let z = 0;
    for (let k = 0; k <= RUN; k++) { const q = T[(i + k) % T.length]; pts.push(q.x, q.y); z += q.z; }
    z /= RUN + 1;
    push({ kind: 'path', pts, z, w: 0.8, color: INK, a: fade(z, 0.12, 0.72) });
  }

  // Dots that circulate along the thread: the only accent.
  const n = S.thread.length;
  for (let k = 0; k < 3; k++) {
    const u = ((t / LAP) + k / 3) % 1;
    const f = u * n, i = Math.floor(f), g = f - i;
    const p = S.thread[i], q = S.thread[(i + 1) % n];
    const m = proj(rot([p[0] + (q[0] - p[0]) * g, p[1] + (q[1] - p[1]) * g, p[2] + (q[2] - p[2]) * g]));
    push({ kind: 'dot', x: m.x, y: m.y, r: 1.9 * m.k, z: m.z + 0.01, color: BLUE, a: fade(m.z, 0.25, 1) });
  }

  // The membrane: twelve small orbs, each the figure in miniature.
  const r = R * 0.19;
  S.frames.forEach(({ n: nn, u, v }, idx) => {
    const c = scale(nn, 1);
    const pc = proj(rot(c));
    const az = pc.z;
    const rr = r * pc.k;
    // its own slow turn, each on its own phase
    const th = (t / SPIN) * Math.PI * 2 * (idx % 2 ? 1 : -1) + idx * 1.1;
    const cu = Math.cos(th), su = Math.sin(th);
    const u1 = add(scale(u, cu), v, su);         // turning tangent
    const v1 = add(scale(u, -su), v, cu);
    const lu = 0.19 * 0.72;                       // local radius, in R
    // bounding circle
    push({ kind: 'circle', x: pc.x, y: pc.y, r: rr, z: az - 0.02, w: 0.7, color: INK, a: fade(az, 0.12, 0.85) });
    // its ring: a disc leaning out of the membrane, whose axis precesses
    // about the radial as the orb turns, so it is never a bare needle.
    const cb = Math.cos(0.95), sb = Math.sin(0.95);
    const m = add(scale(nn, cb), v1, sb);         // ring axis
    const e1 = u1;                                 // in the ring plane
    const e2 = add(scale(nn, -sb), v1, cb);        // in the ring plane
    const ring = [];
    const steps = 20;
    for (let s = 0; s <= steps; s++) {
      const ph = (s / steps) * Math.PI * 2;
      const p = proj(rot(add(add(c, e1, lu * Math.cos(ph)), e2, lu * Math.sin(ph))));
      ring.push(p.x, p.y);
    }
    push({ kind: 'path', pts: ring, z: az - 0.01, w: 0.6, color: INK, a: fade(az, 0.08, 0.6) });
    // its six points: four quarter-marks on the ring, two on its axis
    const pts = [add(c, e1, lu), add(c, e1, -lu), add(c, e2, lu), add(c, e2, -lu),
      add(c, m, lu), add(c, m, -lu)];
    for (const p of pts) {
      const q = proj(rot(p));
      push({ kind: 'dot', x: q.x, y: q.y, r: 1.0 * q.k, z: q.z, color: INK, a: fade(q.z, 0.15, 0.95) });
    }
    // its one circulating dot
    const ph = ((t / (SPIN * 0.7)) + idx * 0.37) * Math.PI * 2;
    const p = add(add(c, e1, lu * Math.cos(ph)), e2, lu * Math.sin(ph));
    const q = proj(rot(p));
    push({ kind: 'dot', x: q.x, y: q.y, r: 1.4 * q.k, z: q.z + 0.005, color: INK, a: fade(q.z, 0.2, 1) });
    // its centre, a small open mark: the orb within the orb
    push({ kind: 'circle', x: pc.x, y: pc.y, r: 1.6 * pc.k, z: az + 0.001, w: 0.6, color: INK, a: fade(az, 0.12, 0.8) });
  });

  prims.sort((a, b) => a.z - b.z);
  return prims;
}

function paint(ctx, prims) {
  ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
  for (const p of prims) {
    ctx.globalAlpha = p.a;
    if (p.kind === 'path') {
      ctx.strokeStyle = p.color; ctx.lineWidth = p.w;
      ctx.beginPath(); ctx.moveTo(p.pts[0], p.pts[1]);
      for (let i = 2; i < p.pts.length; i += 2) ctx.lineTo(p.pts[i], p.pts[i + 1]);
      ctx.stroke();
    } else if (p.kind === 'circle') {
      ctx.strokeStyle = p.color; ctx.lineWidth = p.w;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- mount

export function mount(container, opts = {}) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let W = 0, H = 0, dpr = 1;
  const resize = () => {
    const rect = container.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width));
    H = Math.max(1, Math.round(rect.height));
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    draw(true);
  };

  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  const still = () => reduced && reduced.matches;

  // Time runs only while the figure is being looked at.
    let elapsed = Number(opts.t0) || 0, last = null, raf = 0, visible = true, onscreen = true, lastPaint = -1e9;

  const draw = (force) => {
    if (!W || !H) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const t = still() ? 17.5 : elapsed;
    paint(ctx, frame(t, W, H));
  };

  const tick = (now) => {
    raf = 0;
    if (!visible || !onscreen || still()) return;
    if (last != null) elapsed += Math.min(0.1, (now - last) / 1000);
    last = now;
    if (now - lastPaint >= 1000 / FPS_CAP - 1) { lastPaint = now; draw(); }
    raf = requestAnimationFrame(tick);
  };
  const run = () => {
    if (raf || !visible || !onscreen || still()) { if (still()) draw(); return; }
    last = null;
    raf = requestAnimationFrame(tick);
  };
  const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };

  const onVis = () => { visible = document.visibilityState !== 'hidden'; visible ? run() : stop(); };
  document.addEventListener('visibilitychange', onVis);

  let io = null;
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver(es => {
      onscreen = es.some(e => e.isIntersecting);
      onscreen ? run() : stop();
    }, { threshold: 0.01 });
    io.observe(container);
  }

  let ro = null;
  if ('ResizeObserver' in window) {
    ro = new ResizeObserver(resize);
    ro.observe(container);
  } else {
    window.addEventListener('resize', resize);
  }
  const onMotion = () => { still() ? (stop(), draw()) : run(); };
  if (reduced && reduced.addEventListener) reduced.addEventListener('change', onMotion);

  resize();
  run();

  return () => {
    stop();
    document.removeEventListener('visibilitychange', onVis);
    if (io) io.disconnect();
    if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
    if (reduced && reduced.removeEventListener) reduced.removeEventListener('change', onMotion);
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  };
}
