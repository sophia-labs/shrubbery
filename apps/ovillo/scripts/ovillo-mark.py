"""Draw Ovillo's mark: an egg made out of one string (prints the SVG path, viewBox 0 0 24 24).

    python3 apps/ovillo/scripts/ovillo-mark.py

"Ovillo" is a ball of thread, from the Latin for a little egg. One continuous
thread: it comes in as the loose end (lying along the ground, passing under the
egg), runs once around the egg's outline, then crosses it in three windings.
The windings are the visible halves of latitude circles of a unit sphere about a
tilted axis, mapped onto the egg; between windings the thread runs along the
outline the short way (hidden under the outline already drawn). Catmull-Rom
through the points gives the cubic Beziers. The output is
packages/components/src/ovillo-mark.ts's OVILLO_MARK_PATH.
"""
import math

EGG = dict(cx=11.0, cy=10.2, a=6.4, b=8.0, k=0.17)  # centre, half-width, half-height, top narrower by k
AXIS_TILT, AXIS_ROLL = 66.0, -58.0                  # the windings' axis, degrees
WINDINGS = [0.52, 0.04, -0.44]                     # each winding's height along the axis
TAIL_AT = -74.0                                    # where the loose end joins the outline (degrees)
TAIL = [(22.8, 21.4), (20.2, 22.1), (16.8, 21.2), (12.4, 22.3), (8.0, 21.6), (6.9, 19.7), (9.4, 17.9)]
STEP, KEEP = math.pi / 8, 9


def egg(u, v):
    return (EGG['cx'] + EGG['a'] * u * (1 - EGG['k'] * v), EGG['cy'] - EGG['b'] * v)


def winding(axis, h, n=64):
    """The visible arc (z >= 0) of {p on the unit sphere : p . axis = h}, as unit-disk points, in order."""
    nrm = math.sqrt(sum(c * c for c in axis))
    axis = [c / nrm for c in axis]
    e1 = [axis[1], -axis[0], 0.0]
    m = math.hypot(e1[0], e1[1])
    e1 = [e1[0] / m, e1[1] / m, 0.0]
    e2 = [axis[1] * e1[2] - axis[2] * e1[1], axis[2] * e1[0] - axis[0] * e1[2], axis[0] * e1[1] - axis[1] * e1[0]]
    r = math.sqrt(max(0.0, 1 - h * h))
    pts = [[h * axis[j] + r * (math.cos(2 * math.pi * i / n) * e1[j] + math.sin(2 * math.pi * i / n) * e2[j]) for j in range(3)] for i in range(n)]
    start = next(i for i, p in enumerate(pts) if p[2] < 0)
    vis = [p for p in pts[start:] + pts[:start] if p[2] >= 0]
    arc = [(p[0], p[1]) for p in vis]
    for i in (0, -1):
        mag = math.hypot(vis[i][0], vis[i][1])
        arc[i] = (vis[i][0] / mag, vis[i][1] / mag)
    return arc


def curve(pts, move):
    out = [f"M{pts[0][0]:.1f} {pts[0][1]:.1f}"] if move else []
    for i in range(len(pts) - 1):
        p0, p1, p2, p3 = pts[max(0, i - 1)], pts[i], pts[i + 1], pts[min(len(pts) - 1, i + 2)]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        out.append(f"C{c1[0]:.1f} {c1[1]:.1f} {c2[0]:.1f} {c2[1]:.1f} {p2[0]:.1f} {p2[1]:.1f}")
    return "".join(out)


def around(t0, t1, short):
    d = (t1 - t0 + math.pi) % (2 * math.pi) - math.pi if short else t1 - t0
    n = max(1, int(math.ceil(abs(d) / STEP)))
    return [(math.cos(t0 + d * i / n), math.sin(t0 + d * i / n)) for i in range(n + 1)]


def mark():
    tilt, roll = math.radians(AXIS_TILT), math.radians(AXIS_ROLL)
    axis = [math.sin(tilt) * math.cos(roll), math.sin(tilt) * math.sin(roll), math.cos(tilt)]
    windings = [winding(axis, h) for h in WINDINGS]
    for i, w in enumerate(windings):  # the thread goes back and forth
        if (w[0][0] < w[-1][0]) != (i % 2 == 0):
            windings[i] = list(reversed(w))
    t = math.radians(TAIL_AT)
    entry = egg(math.cos(t), math.sin(t))
    ahead = egg(math.cos(t + 0.35), math.sin(t + 0.35))  # the loose end joins the outline along it
    d = curve(TAIL + [entry, ahead], True)
    d = d[: d.rfind('C')]
    d += curve([egg(u, v) for u, v in around(t, t + 2 * math.pi - 1e-6, False)], False)
    cur = t
    for w in windings:
        a0 = math.atan2(w[0][1], w[0][0])
        if abs((a0 - cur + math.pi) % (2 * math.pi) - math.pi) > 0.05:
            d += curve([egg(u, v) for u, v in around(cur, a0, True)], False)
        picked = [w[round(i * (len(w) - 1) / (KEEP - 1))] for i in range(KEEP)]
        d += curve([egg(u, v) for u, v in picked], False)
        cur = math.atan2(w[-1][1], w[-1][0])
    return d


if __name__ == '__main__':
    print(mark())
