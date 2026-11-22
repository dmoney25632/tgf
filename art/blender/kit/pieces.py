"""The soldier kit pieces, modelled at real sizes in the male bind space (see kitlib).

Each function builds one shipped piece (a glTF node of the same name) on
the Biped bone gear.ts rides it on. Straps, bands and pads are draped onto
the outermost of the Rocketbox bodies (body / head / helmet / vest unions),
so they sit on every avatar that can wear them.

Triangle budgets (LOD0, LOD1 roughly a third): the fullest NPC loadout
(hat, eyewear, shemagh, chest rig, assault pack and straps, radio, belt kit,
knee pads) stays near 8k; the per-piece numbers are in the build report.
"""
import math

import bmesh

from kitlib import (
    C, CI, Piece, Q, T, V, _obj, band, bevel, box, catmull, cyl, ladder_lock, loft, ribbon, sbox, seg, snap, soft, sr_buckle, torus, webbing_row,
)

HARD = ("rubber", "plastic", "polymer", "hardware", "metal", "frame", "glass", "rim", "steel", "steelD", "trim", "kneecap", "radio", "lens")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def warp(objs, f):
    """Moves base-mesh vertices (before modifiers) with f(three-space Vector) -> Vector."""
    for o in objs:
        for v in o.data.vertices:
            v.co = C @ f(CI @ v.co)
        o.data.update()


def bend_y(cx, cz, R):
    """Wraps geometry authored flat (facing +z at z = cz + R) around a vertical axis at (cx, cz)."""

    def f(p):
        a = (p.x - cx) / R
        r = R + (p.z - (cz + R))
        return V(cx + math.sin(a) * r, p.y, cz + math.cos(a) * r)

    return f


def torso_hint(q):
    """Outward direction from the spine (up over the shoulders)."""
    c = V(q.x * 0.35, min(q.y, 1.3), -0.035)
    return (q - c).normalized()


def radial(cx, cz):
    return lambda q: V(q.x - cx, 0, q.z - cz).normalized()


def leg_hint(cx, cz=0.015):
    return lambda q: V(q.x - cx, 0, q.z - cz).normalized()


def path(fit, pts, offset, hint=torso_hint, sub=3, smooth=2):
    """Smooth strap path through control points, draped onto the fit surface from outside."""
    p = catmull([V(*q) for q in pts], sub if Q.lod == 0 else max(2, sub // 2))
    hints = [hint(q) for q in p] if hint is not None else None
    return fit.conform(p, offset, hints, smooth)


def face(o, along):
    """Rotation whose +z is the outward normal o and +y runs along `along`."""
    from mathutils import Matrix

    z = o.normalized()
    y = (along - z * along.dot(z)).normalized()
    x = y.cross(z)
    return Matrix((x, y, z)).transposed().to_4x4()


def at(q, o, lift):
    return T(q.x + o.x * lift, q.y + o.y * lift, q.z + o.z * lift)


def tube(name, pts, r, role, n=8, closed=False):
    """Round tube along a path (hose, cable, antenna, rolled cloth). r: radius or f(u, i)."""
    n = seg(n, 5)
    bm = bmesh.new()
    rings = []
    N = len(pts)
    prev = None
    for i, p in enumerate(pts):
        if closed:
            tg = (pts[(i + 1) % N] - pts[(i - 1) % N]).normalized()
        else:
            tg = (pts[min(i + 1, N - 1)] - pts[max(i - 1, 0)]).normalized()
        a = (prev - tg * prev.dot(tg)).normalized() if prev is not None else tg.orthogonal().normalized()
        prev = a
        b = tg.cross(a)
        rr = r(i / max(1, N - 1), i) if callable(r) else r
        rings.append([bm.verts.new(p + (a * math.cos(k / n * math.tau) + b * math.sin(k / n * math.tau)) * rr) for k in range(n)])
    spans = N if closed else N - 1
    for i in range(spans):
        A, B = rings[i], rings[(i + 1) % N]
        for k in range(n):
            bm.faces.new((A[k], A[(k + 1) % n], B[(k + 1) % n], B[k]))
    if not closed:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    return _obj(name, bm, role)


def sheet(name, grid, role, thick=0.003):
    """Cloth sheet from a grid of points (rows of columns), solidified."""
    bm = bmesh.new()
    vs = [[bm.verts.new(p) for p in row] for row in grid]
    for j in range(len(vs) - 1):
        for i in range(len(vs[0]) - 1):
            bm.faces.new((vs[j][i], vs[j + 1][i], vs[j + 1][i + 1], vs[j][i + 1]))
    o = _obj(name, bm, role)
    m = o.modifiers.new("Solid", "SOLIDIFY")
    m.thickness = thick
    m.offset = -1
    return o


# ---------------------------------------------------------------------------
# Head
# ---------------------------------------------------------------------------
def boonie(ctx):
    """Boonie hat: six-panel crown, stitched floppy brim, hat band with foliage loops, vent eyelets,
    chin cord worn round the back of the head with a cord lock."""
    P = Piece("boonie")
    P.wear = 0.25
    n = seg(24, 12)
    cz = 0.012

    def crown_fn(i, j, v):
        if Q.lod == 0 and i % (n // 6) == 0 and 0 < j < 5:
            d = V(v.x, 0, v.z - cz).normalized()
            return v - d * 0.0018
        return v

    crown = loft("crown", [
        {"y": 1.662, "rx": 0.1, "rz": 0.114, "cz": cz},
        {"y": 1.69, "rx": 0.1, "rz": 0.114, "cz": cz},
        {"y": 1.722, "rx": 0.098, "rz": 0.111, "cz": cz},
        {"y": 1.748, "rx": 0.092, "rz": 0.104, "cz": cz - 0.002},
        {"y": 1.763, "rx": 0.082, "rz": 0.093, "cz": cz - 0.003},
        {"y": 1.771, "rx": 0.06, "rz": 0.068, "cz": cz - 0.004},
        {"y": 1.774, "rx": 0.03, "rz": 0.034, "cz": cz - 0.004},
    ], n, "hat", cap0=False, cap1=True, fn=crown_fn)
    soft(crown, 0.0014, 30)
    # Brim: two stitched rows (grooves), drooping more at the back and sides, slightly wavy.
    rows = [(0.0, 0.0), (0.024, 0.0), (0.027, -0.0014), (0.03, 0.0), (0.05, -0.0012), (0.07, 0.0)] if Q.lod == 0 else [(0.0, 0.0), (0.035, 0.0), (0.07, 0.0)]
    nb = seg(24, 12)

    def brim_fn(i, j, v):
        out, dip = rows[j]
        a = i / nb * math.tau
        t = out / 0.07
        droop = t ** 1.4 * (0.011 + 0.012 * (1 - math.cos(a)) / 2 + 0.003 * math.sin(3 * a + 0.7))
        return V(v.x, v.y - droop + dip, v.z)

    brim = loft("brim", [{"y": 1.668, "rx": 0.1 + o, "rz": 0.114 + o, "cz": cz} for o, _ in rows], nb, "hat", cap0=False, cap1=False, fn=brim_fn)
    m = brim.modifiers.new("Solid", "SOLIDIFY")
    m.thickness = 0.0035
    m.offset = -1
    soft(brim, 0.0012, 26)
    band("hatband", 1.68, 0.0, cz, 0.1012, 0.1152, 0.022, 0.0022, "hatband", n=n)
    if Q.lod == 0:
        for k in range(6):
            a = (k + 0.5) / 6 * math.tau
            box(f"loop{k}", 0.026, 0.024, 0.0026, T(math.sin(a) * 0.1028, 1.68, cz + math.cos(a) * 0.1168, 0, a, 0), "hatband", 0)
        for s in (1, -1):
            torus(f"eyelet{s}", 0.0035, 0.0012, T(s * 0.0985, 1.734, cz, 0, 0, math.pi / 2), "metal", 8, 3)
    pts, nrm = path(ctx.heads, [(0.1, 1.672, 0.0), (0.085, 1.62, -0.06), (0.04, 1.585, -0.098), (0.0, 1.578, -0.106), (-0.04, 1.585, -0.098), (-0.085, 1.62, -0.06), (-0.1, 1.672, 0.0)], 0.0025, radial(0, 0.0))
    ribbon("cord", pts, nrm, 0.004, 0.003, "hatband")
    if Q.lod == 0:
        box("cordlock", 0.012, 0.016, 0.009, T(0, 1.58, -0.111, 0.25), "plastic", 0.003)
    return P


def _goggle(M):
    """Ballistic goggle: wrapped frame with a lens recess, foam backing, top vents.
    Built in a local frame (front at z 0, back toward -z), placed by M, then wrapped round the face."""
    n = seg(24, 12)

    def ring(z, w, h, notch):
        return {"y": z, "rx": w / 2, "rz": h / 2, "p": 4.0, "notch": notch}

    def notch_fn(rings):
        def fn(i, j, v):
            nt = rings[j].get("notch", 0)
            if nt and v.z < 0:
                v = V(v.x, v.y, v.z + nt * math.exp(-(v.x / 0.022) ** 2))
            return v

        return fn

    R = T(0, 0, 0, -math.pi / 2)  # rings built along y -> stacked along -z, height on y
    outer = [ring(-0.036, 0.168, 0.056, 0.016), ring(-0.008, 0.176, 0.062, 0.017), ring(0.0, 0.17, 0.057, 0.016), ring(0.0, 0.152, 0.043, 0.012), ring(-0.004, 0.15, 0.041, 0.012)]
    objs = [loft("g_frame", outer, n, "frame", M @ R, cap0=False, cap1=False, fn=notch_fn(outer))]
    foam = [ring(-0.046, 0.164, 0.052, 0.015), ring(-0.036, 0.168, 0.056, 0.016)]
    objs.append(loft("g_foam", foam, n, "foam", M @ R, cap0=True, cap1=False, fn=notch_fn(foam)))
    lens = [ring(-0.0042, 0.15, 0.041, 0.012), ring(-0.0042, 0.1, 0.027, 0.008)]
    objs.append(loft("g_lens", lens, n, "glass", M @ R, cap0=False, cap1=True, fn=notch_fn(lens)))
    if Q.lod == 0:
        for k in range(2):
            objs.append(box(f"g_vent{k}", 0.05, 0.004, 0.003, M @ T(-0.03 + k * 0.06, 0.03, -0.016), "foam", 0))
    return objs


def goggles(ctx, helmet):
    P = Piece("goggles_helmet" if helmet else "goggles_eyes")
    P.wear = 0.15
    if helmet:
        objs = _goggle(T(0, 1.708, 0.138, -0.36))
        warp(objs, bend_y(0, 0.138 - 0.12, 0.12))
        pts, nrm = path(ctx.helmets, [(0.086, 1.712, 0.105), (0.13, 1.705, 0.02), (0.128, 1.7, -0.08), (0.0, 1.694, -0.142), (-0.128, 1.7, -0.08), (-0.13, 1.705, 0.02), (-0.086, 1.712, 0.105)], 0.003, radial(0, 0.0))
    else:
        objs = _goggle(T(0, 1.624, 0.142, 0.05))
        warp(objs, bend_y(0, 0.142 - 0.105, 0.105))
        pts, nrm = path(ctx.heads, [(0.083, 1.626, 0.085), (0.092, 1.63, 0.01), (0.085, 1.632, -0.07), (0.0, 1.635, -0.1), (-0.085, 1.632, -0.07), (-0.092, 1.63, 0.01), (-0.083, 1.626, 0.085)], 0.0025, radial(0, 0.0))
    ribbon("strap", pts, nrm, 0.036, 0.0022, "elastic")
    if Q.lod == 0:
        for s in (1, -1):
            i = 3 if s > 0 else len(pts) - 4
            q, o = pts[i], nrm[i]
            box(f"slide{s}", 0.012, 0.042, 0.004, at(q, o, 0.002) @ face(o, V(0, 1, 0)), "plastic", 0)
    return P


def eyewear(ctx, kind):
    """Ballistic spectacles (clear) or wrap shades (dark): frame piece + lens piece."""
    P = Piece(kind)
    P.wear = 0.05
    dark = kind == "shades"
    n = seg(16, 10)
    cy = 1.617 if dark else 1.62  # wraps sit a touch lower, clear of cap peaks
    lenses = []
    for s in (1, -1):
        cx = s * (0.034 if dark else 0.033)
        yaw = s * (0.2 if dark else 0.08)
        rx, ry = (0.0285, 0.0185) if dark else (0.027, 0.0185)
        p = 3.2 if dark else 2.6
        Mr = T(cx, cy, 0.122, 0, yaw, 0) @ T(0, 0, 0, math.pi / 2)
        w = 0.0016 if dark else 0.0022
        loft(f"rim{s}", [
            {"y": -0.0018, "rx": rx + w, "rz": ry + w, "p": p},
            {"y": 0.0018, "rx": rx + w, "rz": ry + w, "p": p},
            {"y": 0.0018, "rx": rx, "rz": ry, "p": p},
            {"y": -0.0018, "rx": rx, "rz": ry, "p": p},
        ], n, "rim", Mr, cap0=False, cap1=False)
        hx = s * (0.064 if dark else 0.061)
        box(f"hinge{s}", 0.006, 0.008, 0.008, T(hx, cy + 0.005, 0.112, 0, yaw * 2, 0), "rim", 0.0015)
        pts = catmull([V(hx, cy + 0.006, 0.108), V(s * 0.074, cy + 0.006, 0.07), V(s * 0.078, cy + 0.004, 0.03), V(s * 0.077, cy - 0.008, 0.0), V(s * 0.072, cy - 0.022, -0.012)], 2)
        ribbon(f"temple{s}", pts, [V(s, 0, 0) for _ in pts], 0.0055 if dark else 0.0042, 0.0022, "rim", back=True)
        if Q.lod == 0:
            box(f"pad{s}", 0.004, 0.009, 0.003, T(s * 0.0115, cy - 0.01, 0.118, 0, s * 0.6, 0), "plastic", 0)
        lenses.append((cx, yaw, rx, ry, p, s))
    if dark:
        pts = catmull([V(-0.062, cy + 0.017, 0.113), V(-0.034, cy + 0.019, 0.124), V(0, cy + 0.017, 0.127), V(0.034, cy + 0.019, 0.124), V(0.062, cy + 0.017, 0.113)], 3)
        ribbon("brow", pts, [V(0, 0, 1) for _ in pts], 0.005, 0.004, "rim", back=True)
    else:
        pts = catmull([V(-0.008, 1.623, 0.125), V(0, 1.627, 0.1265), V(0.008, 1.623, 0.125)], 2)
        ribbon("bridge", pts, [V(0, 0, 1) for _ in pts], 0.0035, 0.003, "rim", back=True)
    L = Piece(kind + "_lens")
    L.wear = 0.0
    for cx, yaw, rx, ry, p, s in lenses:
        Mr = T(cx, cy, 0.122, 0, yaw, 0) @ T(0, 0, 0, math.pi / 2)
        loft(f"lens{s}", [
            {"y": 0.0, "rx": rx + 0.0008, "rz": ry + 0.0008, "p": p},
            {"y": 0.0014, "rx": rx * 0.55, "rz": ry * 0.55, "p": p},
        ], n, "lens", Mr, cap0=False, cap1=True)
    return [P, L]


# ---------------------------------------------------------------------------
# Neck
# ---------------------------------------------------------------------------
def shemagh(ctx):
    """Scarf wound twice round the neck: two rolled, rumpled loops and a small knot at the throat."""
    P = Piece("shemagh")
    P.wear = 0.3
    N = 20 if Q.lod == 0 else 12
    for k, (rx, rz, y0, y1, r0, amp, ph) in enumerate([(0.093, 0.103, 1.402, 1.44, 0.021, 0.006, 0.0), (0.08, 0.087, 1.445, 1.468, 0.016, 0.005, 1.7)]):
        pts = []
        for i in range(N):
            a = i / N * math.tau
            y = y0 + (y1 - y0) * (1 - math.cos(a)) / 2 + 0.004 * math.sin(3 * a + ph)
            pts.append(V(math.sin(a) * rx, y, -0.012 + math.cos(a) * rz))
        rfn = lambda u, i, r0=r0, amp=amp, ph=ph: r0 + amp * math.sin(5 * u * math.tau + ph) + amp * 0.5 * math.sin(9 * u * math.tau)  # noqa: E731
        soft(tube(f"roll{k}", pts, rfn, "cloth" if k == 0 else "clothD", n=7, closed=True), 0.0018, 70)
    if Q.lod == 0:
        o = loft("knot", [
            {"y": -0.016, "rx": 0.008, "rz": 0.006, "p": 2.2},
            {"y": -0.006, "rx": 0.02, "rz": 0.014, "p": 2.2},
            {"y": 0.008, "rx": 0.018, "rz": 0.013, "p": 2.2},
            {"y": 0.016, "rx": 0.007, "rz": 0.005, "p": 2.2},
        ], 8, "clothD", T(0.018, 1.408, 0.098, 0.35, 0.2, 0.5))
        soft(o, 0.0015, 90)
    return P


def shemagh_tail(ctx, vest=False):
    """The loose triangle hanging down the chest from under the rolls (over the plate carrier in _vest)."""
    P = Piece("shemagh_tail_vest" if vest else "shemagh_tail")
    P.wear = 0.3
    surf = ctx.torso_vest if vest else ctx.chest
    cols = 4 if Q.lod == 0 else 2
    rows = 5 if Q.lod == 0 else 2
    grid = []
    for j in range(rows + 1):
        t = j / rows
        y = 1.41 - 0.13 * t
        w = 0.1 * (1 - t) + 0.012
        x0 = 0.012 + 0.012 * t
        row = []
        for i in range(cols + 1):
            u = i / cols
            x = x0 - w / 2 + w * u
            loc, nrm = surf.surface(V(x, y, 0.12), V(0, 0.15, 1).normalized())
            ripple = 0.003 * math.sin(u * math.pi * 3 + j * 1.1) * (1 - t * 0.5)
            row.append(loc + nrm * (0.006 + ripple + 0.004 * (1 - t)))
        grid.append(row)
    soft(sheet("tail", grid, "cloth", 0.0035), 0.001, 60)
    return P


# ---------------------------------------------------------------------------
# Chest rig (no plate carrier)
# ---------------------------------------------------------------------------
def flap(name, w, d, drop, M, role="nylonD"):
    """Pouch flap: a stiffened lid over the top folding down the front, with a pull tab."""
    t = 0.004
    box(name, w, t, d + 0.004, M @ T(0, t / 2, 0.001), role, 0.0015)
    box(name + "_front", w, drop, t, M @ T(0, -drop / 2 + t, d / 2 + t / 2 + 0.002), role, 0.0015)
    if Q.lod == 0:
        box(name + "_tab", 0.016, 0.016, 0.0025, M @ T(0, -drop - 0.004, d / 2 + 0.004), "strap", 0)


def mag_pouch(name, M, w=0.072, h=0.11, d=0.038, role="nylon"):
    o = sbox(name, w, h, d, M, role, p=5, bulge=0.05)
    soft(o, 0.0008, 45)
    flap(name + "_flap", w + 0.003, d + 0.003, 0.042, M @ T(0, h / 2 + 0.001, 0))
    if Q.lod == 0:
        loft(name + "_band", [{"y": -0.03, "rx": w / 2 + 0.0035, "rz": d / 2 + 0.0035, "p": 5}, {"y": -0.016, "rx": w / 2 + 0.0035, "rz": d / 2 + 0.0035, "p": 5}], 12, "elastic", M, cap0=False, cap1=False)
    return o


def chest_rig(ctx):
    """Split-front chest rig: three rifle-mag pouches, PALS under them and on the wings,
    H harness (padded over the shoulders, buckled at the front), side straps round the ribs."""
    P = Piece("chest_rig")
    P.wear = 0.3
    R, zc = 0.26, 0.168
    Mp = T(0, 1.13, zc, 0.05)
    soft(sbox("panel", 0.3, 0.17, 0.03, Mp, "nylon", p=6, bulge=0.02, n=16), 0.0008, 35)
    for k, x in enumerate((-0.08, 0.0, 0.08)):
        mag_pouch(f"mag{k}", Mp @ T(x, 0.012, 0.031))
    webbing_row("pals0", -0.14, 0.14, -0.064, Mp @ T(0, 0, 0.0145))
    if Q.lod == 0:
        for s in (1, -1):
            x0, x1 = (0.118, 0.146) if s > 0 else (-0.146, -0.118)
            for r, y in enumerate((0.02, -0.022)):
                webbing_row(f"wing{s}{r}", x0, x1, y, Mp @ T(0, 0, 0.0145))
    warp(list(P.objs), bend_y(0, zc - R, R))
    for s in (1, -1):
        pts, nrm = path(ctx.torso, [(s * 0.125, 1.212, 0.17), (s * 0.118, 1.3, 0.14), (s * 0.11, 1.4, 0.1), (s * 0.105, 1.455, -0.02), (s * 0.1, 1.4, -0.17), (s * 0.105, 1.28, -0.215), (s * 0.115, 1.16, -0.205)], 0.006)
        ribbon(f"yoke{s}", pts, nrm, 0.04, 0.0035, "strap")
        k0, k1 = int(len(pts) * 0.3), int(len(pts) * 0.62)
        soft(ribbon(f"pad{s}", [p + q * 0.004 for p, q in zip(pts[k0:k1], nrm[k0:k1])], nrm[k0:k1], 0.056, 0.009, "nylon"), 0.0008, 40)
        sr_buckle(f"yb{s}", at(pts[2], nrm[2], 0.004) @ face(nrm[2], pts[3] - pts[1]))
        pts2, nrm2 = path(ctx.torso, [(s * 0.15, 1.1, 0.16), (s * 0.2, 1.1, 0.06), (s * 0.19, 1.12, -0.08), (s * 0.12, 1.16, -0.2)], 0.005)
        ribbon(f"side{s}", pts2, nrm2, 0.025, 0.003, "strap")
        ladder_lock(f"sl{s}", at(pts2[2], nrm2[2], 0.003) @ face(nrm2[2], pts2[3] - pts2[1]))
    pts, nrm = path(ctx.torso, [(0.11, 1.33, -0.215), (0.0, 1.33, -0.225), (-0.11, 1.33, -0.215)], 0.009, sub=2)
    ribbon("hbar", pts, nrm, 0.03, 0.003, "strap")
    return P


# ---------------------------------------------------------------------------
# Back: packs, radio
# ---------------------------------------------------------------------------
BACK = [(0.98, -0.11), (1.08, -0.135), (1.2, -0.215), (1.3, -0.225), (1.38, -0.19), (1.46, -0.14)]
BACK_VEST = [(0.98, -0.12), (1.08, -0.15), (1.2, -0.235), (1.3, -0.245), (1.38, -0.205), (1.46, -0.15)]
VESTED = [False]


def back_z(y):
    """Back surface (z) at a height (gear.ts backZ), over the plate carrier while VESTED."""
    pts = BACK_VEST if VESTED[0] else BACK
    if y <= pts[0][0]:
        return pts[0][1]
    for i in range(1, len(pts)):
        if y <= pts[i][0]:
            t = (y - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0])
            return pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t
    return pts[-1][1]


def vest_variant(fn, name):
    def run(ctx):
        VESTED[0] = True
        try:
            P = fn(ctx)
        finally:
            VESTED[0] = False
        P.name = name
        return P

    return run


def pack_body(name, y0, y1, rx, t, role, n=16, rows=5):
    rows = rows if Q.lod == 0 else 3
    rings = []
    for i in range(rows + 1):
        u = i / rows
        y = y0 + (y1 - y0) * u
        edge = 0.84 + 0.16 * math.sin(u * math.pi) ** 0.35
        top = 1 - 0.1 * max(0.0, u - 0.8) / 0.2
        rings.append({"y": y, "rx": rx * edge * top, "rz": t / 2 * edge, "cz": back_z(y) - t / 2 - 0.004, "p": 3.6})
    o = loft(name, rings, seg(n, 10), role)
    soft(o, 0.0015, 22)
    return o


def pack_hydration(ctx):
    """Slim hydration carrier: zip round the top, bungee lacing, drink tube over the left shoulder."""
    P = Piece("pack_hydration")
    P.wear = 0.3
    t = 0.055
    pack_body("bladder", 1.04, 1.42, 0.11, t, "nylon", n=16, rows=4)
    zy = 1.395
    zz = back_z(zy) - t - 0.0035
    pts = catmull([V(-0.09, zy - 0.02, back_z(zy - 0.02) - t * 0.82), V(-0.05, zy, zz), V(0.05, zy, zz), V(0.09, zy - 0.02, back_z(zy - 0.02) - t * 0.82)], 3)
    ribbon("zip", pts, [V(0, 0.2, -1).normalized()] * len(pts), 0.008, 0.002, "strap")
    if Q.lod == 0:
        box("pull", 0.006, 0.02, 0.003, T(0.05, zy - 0.012, zz - 0.002), "metal", 0)
        for k, y in enumerate((1.31, 1.21, 1.11)):
            box(f"bung{k}", 0.16, 0.006, 0.004, T(0, y, back_z(y) - t - 0.003), "elastic", 0)
    pts, nrm = path(ctx.torso_vest, [(0.07, 1.44, -0.17), (0.09, 1.475, -0.08), (0.1, 1.47, 0.02), (0.11, 1.43, 0.09)], 0.012, sub=3)
    tube("tube", pts, 0.0055, "rubber", n=6)
    if Q.lod == 0:
        d = (pts[-1] - pts[-2]).normalized()
        cyl("valve", 0.0065, 0.022, T(*(pts[-1] + d * 0.01)) @ face(nrm[-1], d), "rubber", n=8)
    return P


def pack_assault(ctx):
    """Assault pack: zipped main compartment, 5-row PALS front, admin pocket, grab handle, side compression straps."""
    P = Piece("pack_assault")
    P.wear = 0.35
    t, rx = 0.15, 0.15
    pack_body("main", 1.0, 1.44, rx, t, "nylon", n=16, rows=5)
    fz = lambda y: back_z(y) - t - 0.004  # noqa: E731
    ns = 20 if Q.lod == 0 else 10
    zs = []
    for k in range(ns + 1):
        a = k / ns * math.tau
        y = 1.235 + math.cos(a) * 0.19
        zs.append(V(math.sin(a) * 0.128, y, fz(y) + 0.012 * abs(math.sin(a)) ** 4))
    ribbon("zipline", zs, [V(math.sin(k / ns * math.tau) * 0.4, 0, -1).normalized() for k in range(len(zs))], 0.009, 0.0025, "strap")
    nrows = 5 if Q.lod == 0 else 3
    for r in range(nrows):
        y = 1.36 - r * 0.0508 * (1 if Q.lod == 0 else 1.6)
        webbing_row(f"pals{r}", -0.095, 0.095, 0, T(0, y, fz(y) - 0.002, 0, math.pi, 0))
    soft(sbox("admin", 0.2, 0.15, 0.045, T(0, 1.1, fz(1.1) - 0.02), "nylon", p=5, bulge=0.06), 0.001, 40)
    zz = fz(1.17) - 0.0425
    ribbon("adminzip", catmull([V(-0.09, 1.168, zz + 0.004), V(0, 1.172, zz), V(0.09, 1.168, zz + 0.004)], 3), [V(0, 0.3, -1).normalized()] * 7, 0.007, 0.002, "strap")
    if Q.lod == 0:
        box("zpull", 0.007, 0.024, 0.003, T(0.03, 1.156, zz - 0.002), "metal", 0)
        box("mzpull", 0.007, 0.024, 0.003, T(0.128, 1.14, fz(1.14) + 0.006, 0, -0.9, 0), "metal", 0)
    hz = back_z(1.44) - t / 2 - 0.004
    ribbon("handle", catmull([V(-0.05, 1.436, hz), V(-0.03, 1.46, hz), V(0.03, 1.46, hz), V(0.05, 1.436, hz)], 3), [V(0, 1, 0)] * 10, 0.025, 0.006, "strap", back=True)
    for s in (1, -1):
        for k, y in enumerate((1.33, 1.13)):
            zc = back_z(y) - t / 2 - 0.004
            pts = catmull([V(s * 0.12, y, zc + t * 0.42), V(s * 0.152, y, zc + t * 0.18), V(s * 0.156, y, zc - t * 0.2), V(s * 0.12, y, zc - t * 0.5)], 2)
            ribbon(f"comp{s}{k}", pts, [V(s, 0, -0.3 * (i / len(pts))).normalized() for i in range(len(pts))], 0.02, 0.003, "strap")
            if k == 0 or Q.lod == 0:
                q = pts[len(pts) // 2]
                sr_buckle(f"cb{s}{k}", T(q.x + s * 0.004, q.y, q.z) @ T(0, 0, 0, 0, s * math.pi / 2, 0) @ T(0, 0, 0, 0, 0, math.pi / 2), w=0.02)
    return P


def pack_straps(ctx):
    """Shoulder straps for a pack worn without a plate carrier (padded, sternum strap)."""
    P = Piece("pack_straps")
    P.wear = 0.3
    for s in (1, -1):
        pts, nrm = path(ctx.torso, [(s * 0.09, 1.41, -0.215), (s * 0.1, 1.455, -0.1), (s * 0.105, 1.45, 0.02), (s * 0.115, 1.38, 0.115), (s * 0.122, 1.28, 0.145)], 0.007)
        soft(ribbon(f"pad{s}", pts, nrm, 0.062, 0.011, "nylon"), 0.001, 35)
        pts2, nrm2 = path(ctx.torso, [(s * 0.122, 1.29, 0.145), (s * 0.135, 1.2, 0.15), (s * 0.18, 1.1, 0.07), (s * 0.16, 1.04, -0.1)], 0.006, sub=2)
        ribbon(f"web{s}", pts2, nrm2, 0.025, 0.003, "strap")
        ladder_lock(f"ll{s}", at(pts2[1], nrm2[1], 0.004) @ face(nrm2[1], pts2[2] - pts2[0]))
    pts, nrm = path(ctx.torso, [(0.115, 1.345, 0.13), (0.0, 1.35, 0.148), (-0.115, 1.345, 0.13)], 0.015, sub=2)
    ribbon("sternum", pts, nrm, 0.02, 0.003, "strap")
    q, o = pts[len(pts) // 2], nrm[len(pts) // 2]
    sr_buckle("sb", at(q, o, 0.004) @ face(o, V(1, 0, 0)), w=0.02)
    return P


def radio(ctx):
    """AN/PRC-152-sized handheld in its pouch, worn on the back (faces -z). Local: centre of the radio."""
    P = Piece("radio")
    P.wear = 0.25
    Rz = T(0, 0, 0, 0, math.pi, 0)
    box("body", 0.062, 0.16, 0.035, Rz, "radio", 0.004)
    if Q.lod == 0:
        box("face", 0.05, 0.07, 0.003, Rz @ T(0, 0.03, 0.018), "plastic", 0)
        cyl("knob0", 0.008, 0.014, Rz @ T(-0.014, 0.087, 0), "rubber", n=8)
        cyl("knob1", 0.006, 0.012, Rz @ T(0.016, 0.086, 0.004), "rubber", n=8)
    cyl("conn", 0.007, 0.014, Rz @ T(0.012, 0.087, -0.006), "metal", n=8)
    pts = [(Rz @ V(0.012 + 0.004 * u * u, 0.094 + 0.34 * u, -0.006 - 0.035 * u * u).to_4d()).to_3d() for u in [i / 6 for i in range(7)]]
    tube("whip", pts, lambda u, i: 0.0062 - 0.0032 * u, "rubber", n=6)
    soft(sbox("pouch", 0.07, 0.12, 0.042, Rz @ T(0, -0.025, 0), "nylon", p=6, bulge=0.04), 0.0008, 45)
    ribbon("pstrap", [(Rz @ V(*q).to_4d()).to_3d() for q in ((0, 0.03, 0.022), (0, 0.06, 0.023), (0, 0.082, 0.012), (0, 0.086, 0.0), (0, 0.082, -0.012), (0, 0.05, -0.022))],
           [(Rz.to_3x3() @ V(*q)).normalized() for q in ((0, 0, 1), (0, 0.2, 1), (0, 0.7, 0.7), (0, 1, 0), (0, 0.7, -0.7), (0, 0, -1))], 0.02, 0.003, "strap")
    if Q.lod == 0:
        webbing_row("pp0", -0.03, 0.03, -0.045, Rz @ T(0, 0, 0.021))
    return P


def radio_mic(ctx):
    """Speaker-mic clipped to the left shoulder strap. Local: centre."""
    P = Piece("radio_mic")
    P.wear = 0.2
    box("mic", 0.042, 0.058, 0.018, T(), "radio", 0.0045)
    if Q.lod == 0:
        box("grille", 0.03, 0.028, 0.002, T(0, 0.008, 0.009), "rubber", 0)
        box("ptt", 0.008, 0.022, 0.006, T(0.022, 0.0, 0), "rubber", 0)
    m = 16 if Q.lod == 0 else 6
    pts = [V(-0.01 + 0.006 * math.cos(u * 14), -0.03 - 0.06 * u, -0.004 + 0.006 * math.sin(u * 14)) for u in [i / m for i in range(m + 1)]]
    tube("coil", pts, 0.0024, "rubber", n=4)
    box("clip", 0.02, 0.03, 0.004, T(0, 0.006, -0.011), "plastic", 0)
    return P


# ---------------------------------------------------------------------------
# Warden plate armour
# ---------------------------------------------------------------------------
def shell(o, thick=0.003):
    m = o.modifiers.new("Solid", "SOLIDIFY")
    m.thickness = thick
    m.offset = -1
    return bevel(o, 0.001, 1, 40)


def warden_chest(ctx):
    """Breastplate over the carrier: medial ridge, gilded rolled neck edge, rivets, leather side straps."""
    P = Piece("warden_chest")
    P.wear = 0.2
    n = seg(16, 10)
    rings = [
        {"y": 1.04, "rx": 0.15, "rz": 0.03, "cz": 0.2, "p": 3},
        {"y": 1.13, "rx": 0.166, "rz": 0.034, "cz": 0.21, "p": 3},
        {"y": 1.23, "rx": 0.172, "rz": 0.036, "cz": 0.205, "p": 3},
        {"y": 1.31, "rx": 0.165, "rz": 0.034, "cz": 0.188, "p": 3},
        {"y": 1.37, "rx": 0.13, "rz": 0.03, "cz": 0.165, "p": 3},
    ]
    if Q.lod:
        rings = [rings[0], rings[2], rings[4]]
    o = loft("plate", rings, n, "steel", fn=lambda i, j, v: V(v.x, v.y, v.z + (0.006 * math.exp(-(v.x / 0.035) ** 2) if v.z > rings[j]["cz"] else 0)))
    bevel(o, 0.003, 1, 35)
    pts = catmull([V(-0.12, 1.358, 0.188), V(0, 1.332, 0.206), V(0.12, 1.358, 0.188)], 4 if Q.lod == 0 else 2)
    tube("roll", pts, 0.0055, "trim", n=6)
    if Q.lod == 0:
        for s in (1, -1):
            for k, y in enumerate((1.1, 1.2, 1.29)):
                r = [r for r in rings if r["y"] >= y][0]
                cyl(f"rivet{s}{k}", 0.0045, 0.004, T(s * (r["rx"] - 0.016), y, r["cz"] + r["rz"] * 0.78 + 0.002, math.pi / 2), "trim", n=6, r2=0.003)
        for s in (1, -1):
            pts, nrm = path(ctx.torso_vest, [(s * 0.17, 1.2, 0.16), (s * 0.215, 1.2, 0.03), (s * 0.21, 1.2, -0.1), (s * 0.165, 1.2, -0.21)], 0.008, sub=2)
            ribbon(f"side{s}", pts, nrm, 0.028, 0.004, "leather")
            box(f"sbk{s}", 0.034, 0.032, 0.004, at(pts[1], nrm[1], 0.005) @ face(nrm[1], V(0, 1, 0)), "trim", 0.0012)
    return P


def warden_back(ctx):
    P = Piece("warden_back")
    P.wear = 0.2
    rings = [
        {"y": 1.06, "rx": 0.15, "rz": 0.03, "cz": -0.17, "p": 3},
        {"y": 1.24, "rx": 0.17, "rz": 0.035, "cz": -0.27, "p": 3},
        {"y": 1.38, "rx": 0.14, "rz": 0.03, "cz": -0.235, "p": 3},
    ]
    o = loft("plate", rings, seg(16, 10), "steelD")
    bevel(o, 0.003, 1, 35)
    tube("roll", catmull([V(-0.12, 1.37, -0.252), V(0, 1.385, -0.262), V(0.12, 1.37, -0.252)], 3 if Q.lod == 0 else 2), 0.005, "trim", n=6)
    return P


def warden_gorget(ctx):
    P = Piece("warden_gorget")
    P.wear = 0.2
    n = seg(20, 10)
    o = loft("gorget", [
        {"y": 1.368, "rx": 0.132, "rz": 0.132, "cz": -0.02},
        {"y": 1.41, "rx": 0.115, "rz": 0.115, "cz": -0.02},
        {"y": 1.445, "rx": 0.09, "rz": 0.092, "cz": -0.02},
    ], n, "steel", cap0=False, cap1=False)
    shell(o, 0.003)
    band("lip", 1.449, 0, -0.02, 0.093, 0.095, 0.008, 0.005, "trim", n=n)
    return P


def warden_pauldron(ctx, s):
    side = "L" if s > 0 else "R"
    P = Piece(f"warden_pauldron_{side}")
    P.wear = 0.2
    n = seg(12, 8)
    for k, (x, y, rx, ry, rz, tilt, role) in enumerate([(0.215, 1.39, 0.1, 0.075, 0.11, 0.5, "steel"), (0.25, 1.33, 0.09, 0.058, 0.1, 0.78, "steelD")]):
        rows = 3 if Q.lod == 0 else 2
        rings = []
        for j in range(rows + 1):
            a = max(j / rows * 1.25, 0.14)
            rings.append({"y": ry * math.cos(a) - ry * 0.25, "rx": rx * math.sin(a), "rz": rz * math.sin(a), "p": 2.2})
        rings.reverse()
        M = T(s * x, y, -0.02, 0, 0, -s * tilt)
        shell(loft(f"lame{k}", rings, n, role, M, cap0=False, cap1=True), 0.003)
        if k == 0:
            r0 = rings[0]
            band("edge", r0["y"], 0, 0, r0["rx"] + 0.001, r0["rz"] + 0.001, 0.007, 0.004, "trim", n=n, M=M)
    if Q.lod == 0:
        pts = catmull([V(s * 0.27, 1.3, 0.07), V(s * 0.3, 1.27, 0.0), V(s * 0.27, 1.3, -0.08)], 2)
        ribbon("lstrap", pts, [V(s, -0.3, 0).normalized()] * len(pts), 0.018, 0.003, "leather", back=True)
    return P


def warden_cuisse(ctx, s):
    side = "L" if s > 0 else "R"
    P = Piece(f"warden_cuisse_{side}")
    P.wear = 0.3
    o = loft("plate", [
        {"y": 0.64, "rx": 0.066, "rz": 0.018, "cz": 0.112, "cx": s * 0.1, "p": 2.6},
        {"y": 0.75, "rx": 0.078, "rz": 0.021, "cz": 0.127, "cx": s * 0.103, "p": 2.6},
        {"y": 0.85, "rx": 0.082, "rz": 0.02, "cz": 0.137, "cx": s * 0.105, "p": 2.6},
    ], seg(12, 8), "steel")
    bevel(o, 0.0025, 1, 35)
    for k, y in enumerate((0.69, 0.8)):
        if Q.lod and k:
            continue
        pts, nrm = path(ctx.leg[s], [(s * 0.04, y, 0.11), (s * 0.03, y, 0.03), (s * 0.06, y, -0.06), (s * 0.13, y, -0.06), (s * 0.17, y, 0.03), (s * 0.16, y, 0.1)], 0.005, leg_hint(s * 0.1, 0.02), sub=2)
        ribbon(f"strap{k}", pts, nrm, 0.02, 0.003, "leather")
        if Q.lod == 0:
            box(f"bk{k}", 0.026, 0.024, 0.005, at(pts[-3], nrm[-3], 0.004) @ face(nrm[-3], V(0, 1, 0)), "trim", 0.001)
    return P


def warden_tassets(ctx):
    P = Piece("warden_tassets")
    P.wear = 0.3
    for s in (1, -1):
        for k, (y, h) in enumerate(((0.905, 0.075), (0.835, 0.08))):
            if Q.lod and k:
                continue
            rings = [{"y": -h / 2, "rx": 0.068 + k * 0.004, "rz": 0.022, "p": 3}, {"y": h / 2, "rx": 0.064 + k * 0.004, "rz": 0.022, "p": 3}]
            o = loft(f"lame{s}{k}", rings, seg(10, 8), "steelD" if k else "steel", T(s * 0.085, y, 0.162 + k * 0.006, -0.12 - k * 0.06, 0, s * 0.06), cap0=False, cap1=False, fn=lambda i, j, v: V(v.x, v.y, abs(v.z) * 0.9))
            shell(o, 0.003)
        if Q.lod == 0:
            box(f"hang{s}", 0.02, 0.05, 0.004, T(s * 0.085, 0.935, 0.168, -0.1), "leather", 0)
    return P


def warden_belt(ctx):
    P = Piece("warden_belt")
    P.wear = 0.3
    N = 20 if Q.lod == 0 else 12
    pts = [V(math.sin(k / N * math.tau) * 0.2, 0.952, math.cos(k / N * math.tau) * 0.2) for k in range(N)]
    pts, nrm = ctx.waist.conform(pts, 0.006, [V(p.x, 0, p.z).normalized() for p in pts], smooth=3)
    ribbon("belt", pts, nrm, 0.048, 0.005, "leather", closed=True)
    q = pts[0]
    box("buckle", 0.06, 0.056, 0.006, T(q.x, q.y, q.z + 0.004), "trim", 0.002)
    if Q.lod == 0:
        box("tongue", 0.04, 0.044, 0.004, T(q.x, q.y, q.z + 0.007), "leather", 0)
    return P


# ---------------------------------------------------------------------------
# Belt kit and legs
# ---------------------------------------------------------------------------
def belt_pouches(ctx):
    """Dump pouch rolled up on the left hip, rip-away IFAK at the rear, a rifle-mag pouch front left."""
    P = Piece("belt_pouches")
    P.wear = 0.45
    M = T(0.205, 0.95, -0.06, 0, 0.35)
    soft(sbox("dump", 0.08, 0.1, 0.05, M, "nylon", p=3.4, bulge=0.16, rows=3), 0.0025, 30)
    band("roll", 0.03, 0, 0, 0.044, 0.028, 0.012, 0.005, "nylonD", n=12, M=M)
    if Q.lod == 0:
        snap("dsnap", M @ T(0, 0.03, -0.031, 0, math.pi, 0))
    M = T(0, 0.962, -0.148)
    soft(sbox("ifak", 0.13, 0.085, 0.05, M, "ifak", p=5, bulge=0.06), 0.001, 40)
    zp = catmull([V(-0.06, 0.04, -0.012), V(-0.03, 0.044, -0.02), V(0.03, 0.044, -0.02), V(0.06, 0.04, -0.012)], 2)
    ribbon("izip", [(M @ p.to_4d()).to_3d() for p in zp], [V(0, 1, -0.4).normalized()] * len(zp), 0.007, 0.002, "strap")
    for s in (1, -1):
        box(f"handle{s}", 0.012, 0.03, 0.006, M @ T(s * 0.069, 0.0, -0.005), "accent", 0)
    if Q.lod == 0:
        box("cross_v", 0.01, 0.03, 0.0015, M @ T(0, -0.004, -0.0262), "cloth", 0)
        box("cross_h", 0.03, 0.01, 0.0015, M @ T(0, -0.004, -0.0262), "cloth", 0)
    mag_pouch("mag", T(0.17, 0.96, 0.09, 0, -0.5), w=0.064, h=0.09, d=0.044)
    return P


def holster(ctx):
    """Drop-leg holster on the right thigh: platform, polymer shell and hood, pistol grip, two leg straps."""
    P = Piece("holster")
    P.wear = 0.4
    M = T(-0.185, 0.76, 0.01, 0, 0, 0.06)
    Rs = T(0, 0, 0, 0, -math.pi / 2, 0)
    soft(sbox("platform", 0.075, 0.17, 0.012, M @ T(0, 0, -0.004) @ Rs, "nylon", p=6, bulge=0.0, rows=1, n=12), 0.0008, 40)
    sbox("shell", 0.042, 0.16, 0.05, M @ T(-0.012, 0, 0) @ Rs, "polymer", p=4.5, bulge=0.02, rows=1, n=12, taper=0.18, ch=0.004)
    box("hood", 0.05, 0.03, 0.054, M @ T(-0.016, 0.098, 0.006) @ Rs, "polymer", 0.004)
    box("grip", 0.03, 0.068, 0.05, M @ T(-0.016, 0.115, -0.018, 0.18) @ Rs, "polymer", 0.004)
    box("slide", 0.026, 0.022, 0.06, M @ T(-0.016, 0.084, 0.024) @ Rs, "metal", 0.002)
    ribbon("hanger", [V(-0.175, 0.84, 0.012), V(-0.178, 0.88, 0.01), V(-0.18, 0.93, 0.005)], [V(-1, 0, 0)] * 3, 0.04, 0.003, "strap")
    for k, y in enumerate((0.8, 0.71)):
        pts, nrm = path(ctx.leg[-1], [(-0.16, y, 0.07), (-0.1, y, 0.105), (-0.04, y, 0.07), (-0.03, y, -0.02), (-0.08, y, -0.075), (-0.15, y, -0.06), (-0.175, y, -0.02)], 0.005, leg_hint(-0.1, 0.02), sub=2)
        ribbon(f"leg{k}", pts, nrm, 0.032, 0.0025, "elastic")
        i = 2
        sr_buckle(f"lb{k}", at(pts[i], nrm[i], 0.005) @ face(nrm[i], pts[i + 1] - pts[i - 1]) @ T(0, 0, 0, 0, 0, math.pi / 2), w=0.032)
    return P


def knee_pad(ctx, s):
    """Articulated knee pad: domed hard cap with a flex groove over a soft base, elastic strap and buckle."""
    side = "L" if s > 0 else "R"
    P = Piece(f"kneepad_{side}")
    P.wear = 0.7
    cx = s * 0.105
    n = seg(12, 8)

    def fz(y):
        return ctx.leg[s].surface(V(cx, y, 0.1), V(0, 0, 1))[0].z

    zb = {y: fz(y) for y in (0.42, 0.45, 0.48, 0.51, 0.545)}
    soft(loft("base", [
        {"y": 0.418, "rx": 0.042, "rz": 0.008, "cz": zb[0.42] + 0.007, "cx": cx, "p": 2.6},
        {"y": 0.45, "rx": 0.053, "rz": 0.014, "cz": zb[0.45] + 0.01, "cx": cx, "p": 2.6},
        {"y": 0.485, "rx": 0.055, "rz": 0.015, "cz": zb[0.48] + 0.011, "cx": cx, "p": 2.6},
        {"y": 0.52, "rx": 0.051, "rz": 0.013, "cz": zb[0.51] + 0.01, "cx": cx, "p": 2.6},
        {"y": 0.548, "rx": 0.038, "rz": 0.008, "cz": zb[0.545] + 0.007, "cx": cx, "p": 2.6},
    ], n, "foam"), 0.0008, 50)
    rings = [
        (0.425, 0.036, 0.008, 0.42, 0.016),
        (0.442, 0.05, 0.02, 0.45, 0.018),
        (0.472, 0.054, 0.026, 0.48, 0.02),
        (0.479, 0.052, 0.022, 0.48, 0.018),
        (0.486, 0.054, 0.026, 0.48, 0.02),
        (0.517, 0.049, 0.02, 0.51, 0.018),
        (0.538, 0.034, 0.008, 0.545, 0.016),
    ]
    if Q.lod:
        rings = [rings[0], rings[2], rings[6]]
    loft("cap", [{"y": y, "rx": rx, "rz": rz, "cz": zb[k] + dz, "cx": cx, "p": 2.2} for y, rx, rz, k, dz in rings], seg(16, 8), "kneecap")
    pts, nrm = path(ctx.leg[s], [(cx - s * 0.05, 0.452, zb[0.45]), (cx - s * 0.055, 0.452, 0.0), (cx, 0.452, -0.05), (cx + s * 0.055, 0.452, 0.0), (cx + s * 0.05, 0.452, zb[0.45])], 0.004, leg_hint(cx, 0.03), sub=3)
    ribbon("strap", pts, nrm, 0.028, 0.003, "elastic")
    i = len(pts) - 4
    sr_buckle("bk", at(pts[i], nrm[i], 0.004) @ face(nrm[i], pts[i + 1] - pts[i - 1]) @ T(0, 0, 0, 0, 0, math.pi / 2), w=0.025)
    return P


PIECES = [
    ("boonie", boonie),
    ("goggles_eyes", lambda c: goggles(c, False)),
    ("goggles_helmet", lambda c: goggles(c, True)),
    ("glasses", lambda c: eyewear(c, "glasses")),
    ("shades", lambda c: eyewear(c, "shades")),
    ("shemagh", shemagh),
    ("shemagh_tail", shemagh_tail),
    ("shemagh_tail_vest", lambda c: shemagh_tail(c, True)),
    ("chest_rig", chest_rig),
    ("pack_hydration", pack_hydration),
    ("pack_hydration_vest", vest_variant(pack_hydration, "pack_hydration_vest")),
    ("pack_assault", pack_assault),
    ("pack_assault_vest", vest_variant(pack_assault, "pack_assault_vest")),
    ("pack_straps", pack_straps),
    ("radio", radio),
    ("radio_mic", radio_mic),
    ("warden_chest", warden_chest),
    ("warden_back", warden_back),
    ("warden_gorget", warden_gorget),
    ("warden_pauldron_L", lambda c: warden_pauldron(c, 1)),
    ("warden_pauldron_R", lambda c: warden_pauldron(c, -1)),
    ("warden_cuisse_L", lambda c: warden_cuisse(c, 1)),
    ("warden_cuisse_R", lambda c: warden_cuisse(c, -1)),
    ("warden_tassets", warden_tassets),
    ("warden_belt", warden_belt),
    ("belt_pouches", belt_pouches),
    ("holster", holster),
    ("kneepad_L", lambda c: knee_pad(c, 1)),
    ("kneepad_R", lambda c: knee_pad(c, -1)),
]
