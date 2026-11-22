"""Procedural materials for the first-person arms, painted in texel space.

Every texel knows (from the bakes in build_fparms.py) its bind-pose position
and normal and its region; the garment details are functions of those, in
anatomical coordinates (forearm frame, hand frame, finger segments):

  glove   molded knuckle guard with flex grooves and a stitched border, padded
          proximal / middle finger backs, stretch-knit fourchettes between the
          fingers, synthetic-leather palm with a stitched reinforcement panel,
          reinforced fingertips, palm-to-back side seams with stitching
  cuff    neoprene band, bound rim with stitching, seam to the glove body,
          hook-and-loop closure tab with a stitched border and pull edge
  sleeve  ripstop weave, pushed-up compression folds, twist folds, underarm
          flat-felled seam, turned hem with two stitch rows
  skin    tone variation, pores, wrist creases, fine hair
  watch   bead-blasted steel case, bezel with minute ticks, matte dial with
          lume markers and hands, nylon strap

Outputs: height (metres, baked into the normal map through a Bump node),
albedo, roughness, metalness and the region mask (ORM red).
"""
import math
import os

import numpy as np

import geo

TAU = 2 * math.pi


# ---- Noise ---------------------------------------------------------------------------

def _hash(*ints):
    h = np.uint32(2166136261)
    for k, i in enumerate(ints):
        x = i.astype(np.int64).astype(np.uint32)
        h = (h ^ (x * np.uint32([0x9E3779B1, 0x85EBCA77, 0xC2B2AE3D, 0x27D4EB2F][k]))) * np.uint32(16777619)
        h ^= h >> np.uint32(15)
    h *= np.uint32(0x2C1B3C6D)
    h ^= h >> np.uint32(12)
    return (h & np.uint32(0xFFFFFF)).astype(np.float32) / np.float32(0xFFFFFF)


def _fade(t):
    return t * t * (3 - 2 * t)


def noise3(p, seed=0):
    """Value noise in [-1, 1] at points p (n, 3) (unit lattice)."""
    i = np.floor(p).astype(np.int64)
    f = _fade(p - i)
    s = np.full(len(p), seed, np.int64)
    out = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (f[:, 0] if dx else 1 - f[:, 0]) * (f[:, 1] if dy else 1 - f[:, 1]) * (f[:, 2] if dz else 1 - f[:, 2])
                out = out + w * _hash(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz, s)
    return out * 2 - 1


def noise2(p, seed=0):
    i = np.floor(p).astype(np.int64)
    f = _fade(p - i)
    s = np.full(len(p), seed, np.int64)
    out = 0
    for dx in (0, 1):
        for dy in (0, 1):
            w = (f[:, 0] if dx else 1 - f[:, 0]) * (f[:, 1] if dy else 1 - f[:, 1])
            out = out + w * _hash(i[:, 0] + dx, i[:, 1] + dy, s)
    return out * 2 - 1


def fbm3(p, octaves=4, seed=0, lac=2.03, gain=0.5):
    a, out, norm = 1.0, 0, 0
    for o in range(octaves):
        out = out + a * noise3(p, seed + o * 17)
        norm += a
        p = p * lac
        a *= gain
    return out / norm


def fbm2(p, octaves=4, seed=0, lac=2.07, gain=0.5):
    a, out, norm = 1.0, 0, 0
    for o in range(octaves):
        out = out + a * noise2(p, seed + o * 31)
        norm += a
        p = p * lac
        a *= gain
    return out / norm


def cells2(p, seed=0):
    """Distance to the nearest jittered cell point (Worley F1), cell size 1."""
    i = np.floor(p).astype(np.int64)
    best = np.full(len(p), 9.0, np.float32)
    s = np.full(len(p), seed, np.int64)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            cx, cy = i[:, 0] + dx, i[:, 1] + dy
            jx = _hash(cx, cy, s)
            jy = _hash(cx, cy, s + 7)
            d = np.hypot(cx + jx - p[:, 0], cy + jy - p[:, 1])
            best = np.minimum(best, d)
    return best


# ---- Shape helpers ---------------------------------------------------------------------------

def sat(x):
    return np.clip(x, 0.0, 1.0)


def smooth(a, b, x):
    t = sat((x - a) / (b - a))
    return t * t * (3 - 2 * t)


def plateau(d, edge):
    """1 inside (d < 0), 0 outside, rounded shoulder of width `edge`."""
    return smooth(edge, -edge, d)


def groove(d, width):
    """Rounded V groove profile (1 at d = 0)."""
    x = sat(1 - np.abs(d) / width)
    return x * x * (3 - 2 * x)


def rrect(x, y, hx, hy, r):
    """Signed distance to a rounded rectangle centred at 0."""
    qx = np.abs(x) - hx + r
    qy = np.abs(y) - hy + r
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r


def stitches(d, along, pitch=0.0034, dash=0.66, width=0.00055, height=0.00028):
    """Stitch line at d = 0: dashes along `along` (metres). Returns (height, mask)."""
    ph = np.mod(along / pitch, 1.0)
    on = smooth(0.0, 0.12, ph) * smooth(dash, dash - 0.12, ph)
    # each stitch is a rounded thread lying across... along the line
    across = sat(1 - (d / width) ** 2)
    m = on * across
    bulge = np.sqrt(np.clip(m, 0, 1))
    return bulge * height, m


# ---- Texel coordinates ----------------------------------------------------------------------------

class Texels:
    def __init__(self, maps, fr):
        reg = maps["region"]
        self.h, self.w = reg.shape
        self.valid = np.nonzero(reg.ravel() >= 0)[0]
        self.reg = reg.ravel()[self.valid]
        self.P = maps["pos"].reshape(-1, 3)[self.valid].astype(np.float64)
        N = maps["nrm"].reshape(-1, 3)[self.valid].astype(np.float64)
        self.N = N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-8)
        self.ao = maps["ao"].ravel()[self.valid]
        ys, xs = np.divmod(self.valid, self.w)
        self.uv = np.stack([(xs + 0.5) / self.w, (ys + 0.5) / self.h], 1)
        self.fr = fr
        v = lambda x: np.array(x, np.float64)
        q = self.P - v(fr.E)
        self.t = q @ v(fr.ax) / fr.L
        d = q @ v(fr.dors) - fr.cd
        w = q @ v(fr.ew)
        self.theta = np.arctan2(w, d)
        self.r = np.hypot(d, w)
        # metres per texel (isotropic after average_islands_scale), per region
        self.mpt = {}

    def is_(self, *names):
        ids = [geo.region_index(n) for n in names]
        return np.isin(self.reg, ids)


def metres_per_texel(maps, region_id):
    """Median 3D distance between horizontally adjacent texels of one region."""
    reg = maps["region"]
    P = maps["pos"]
    a = (reg[:, :-1] == region_id) & (reg[:, 1:] == region_id)
    d = np.linalg.norm(P[:, 1:] - P[:, :-1], axis=2)[a]
    return float(np.median(d)) if d.size else 1e-3


# ---- Regions ------------------------------------------------------------------------------------------

def finger_coords(T, fr, sel):
    """Nearest finger segment per texel (glove): finger, segment, tau (0..1), along (m), phi, dist."""
    B = fr.B
    p = fr.prefix
    v = lambda x: np.array(x, np.float64)
    P = T.P[sel]
    best = np.full(len(P), 1e9)
    out = {k: np.zeros(len(P)) for k in ("f", "s", "tau", "len", "phi", "dist", "along")}
    hY = v(fr.hY)
    hX = v(fr.hX)
    thumb_up = hY * 0.55 - hX * 0.83
    thumb_up /= np.linalg.norm(thumb_up)
    for f in range(5):
        joints = [B[f"{p}Finger{f}"], B[f"{p}Finger{f}1"], B[f"{p}Finger{f}2"], B[f"{p}Finger{f}Tip"]]
        acc_len = 0.0
        for s in range(3):
            a, b = v(joints[s]), v(joints[s + 1])
            ab = b - a
            L = np.linalg.norm(ab)
            u = ab / L
            tau = ((P - a) @ u) / L
            tc = np.clip(tau, 0, 1)
            near = a + tc[:, None] * ab
            d = np.linalg.norm(P - near, axis=1)
            # prefer segments past their start (fingers): penalise tau < 0
            score = d + np.maximum(0, -tau) * L * 0.6
            take = score < best
            best = np.where(take, score, best)
            up = thumb_up if f == 0 else hY
            up = up - u * (up @ u)
            up /= np.linalg.norm(up)
            side = np.cross(u, up)
            rel = P - near
            phi = np.arctan2(rel @ side, rel @ up)
            for k, val in (("f", f), ("s", s), ("tau", tau), ("len", L), ("phi", phi), ("dist", d), ("along", acc_len + tau * L)):
                out[k] = np.where(take, val, out[k])
            acc_len += L
    return out


def paint_glove(T, fr, sel, H, A, R, M, mpt):
    v = lambda x: np.array(x, np.float64)
    P = T.P[sel]
    N = T.N[sel]
    q = P - v(fr.Wr)
    hx, hy, hz = q @ v(fr.hX), q @ v(fr.hY), q @ v(fr.hZ)
    ndors = N @ v(fr.hY)
    fc = finger_coords(T, fr, sel)
    f, s, tau, phi = fc["f"], fc["s"], fc["tau"], fc["phi"]
    # knuckles (MCP) in hand coordinates
    K = [v(fr.B[f"{fr.prefix}Finger{i}"]) - v(fr.Wr) for i in range(1, 5)]
    kx = np.array([k @ v(fr.hX) for k in K])
    kz = np.array([k @ v(fr.hZ) for k in K])
    order = np.argsort(kx)
    kx, kz = kx[order], kz[order]
    zk = np.interp(hx, kx, kz)
    on_finger = (f >= 1) & ((s >= 1) | (tau > 0.12)) & (fc["dist"] < 0.016)
    on_thumb = (f == 0) & (s >= 1) & (fc["dist"] < 0.017)
    dorsal = ndors > 0.25
    palm = ndors < -0.25
    h = np.zeros(len(P))
    a = np.ones(len(P))
    rough = np.full(len(P), 0.78)

    # Base fabrics: back = stretch softshell (fine twill), palm = synthetic suede (grain).
    uvm = T.uv[sel] * T.w * mpt  # metres in UV space
    twill = np.sin((uvm[:, 0] + uvm[:, 1]) * TAU / 0.0007)
    grain = cells2(uvm / 0.0009, 3)
    suede = fbm2(uvm / 0.0012, 3, 5)
    back_tex = twill * 0.000018 + fbm2(uvm / 0.004, 2, 1) * 0.00003
    palm_tex = -grain * 0.00005 + suede * 0.00002
    wpalm = smooth(0.2, -0.3, ndors)
    h += back_tex * (1 - wpalm) + palm_tex * wpalm
    a *= 1 + 0.05 * fbm3(P / 0.01, 3, 2) - 0.06 * wpalm
    rough = np.where(wpalm > 0.5, 0.82 + 0.05 * suede, 0.72 + 0.04 * twill)

    # Knuckle guard: molded TPR band across the MCP joints (back of the hand only).
    xc = (kx[0] - 0.012 + kx[-1] + 0.010) / 2
    hwid = (kx[-1] + 0.010 - (kx[0] - 0.012)) / 2
    zrel = hz - zk + 0.0045
    d_guard = rrect(hx - xc, zrel, hwid, 0.0125, 0.0065)
    gmask = plateau(d_guard, 0.0007) * smooth(0.0, 0.35, ndors) * (~on_finger | (tau < 0.2))
    bumps = np.zeros(len(P))
    for i in range(4):
        bumps = np.maximum(bumps, sat(1 - ((hx - kx[i]) ** 2 + (hz - kz[i] + 0.001) ** 2) / 0.0085 ** 2))
    flex = np.zeros(len(P))
    for i in range(3):
        flex = np.maximum(flex, groove(hx - (kx[i] + kx[i + 1]) / 2, 0.0011))
    rib = groove(zrel + 0.0065, 0.0008)
    hguard = 0.0021 + 0.0009 * bumps ** 0.7 - 0.0009 * flex - 0.0004 * rib
    h += gmask * hguard
    a *= 1 - 0.22 * gmask
    rough = rough * (1 - gmask) + gmask * (0.5 - 0.08 * bumps)
    # stitched border around the guard (2.5 mm out)
    st_h, st_m = stitches(d_guard - 0.0024, hx * 1.0 + zrel * 1.0)
    st_m *= smooth(0.0, 0.3, ndors)
    h += st_h * smooth(0.0, 0.3, ndors)
    h -= 0.00018 * groove(d_guard - 0.0024, 0.0011) * smooth(0.0, 0.3, ndors)
    stitch_mask = st_m

    # Finger backs: pads on the proximal and middle segments, grooves around them.
    fl = fc["len"]
    for seg, (hw, hh) in ((0, (0.33, 0.0062)), (1, (0.30, 0.0055))):
        selp = on_finger & (s == seg) & (f >= 1)
        rf = 0.0095
        x_ = (tau - 0.52) * fl
        y_ = phi * rf
        dp = rrect(x_, y_, hw * fl, hh, 0.0028)
        pm = plateau(dp, 0.0005) * selp
        h += pm * (0.0014 - 0.0003 * groove(x_, 0.0007))
        h -= 0.00025 * groove(dp - 0.0012, 0.0007) * selp
        a *= 1 - 0.2 * pm
        rough = rough * (1 - pm) + pm * 0.52
    # thumb back pad
    selp = on_thumb & (fc["s"] == 1)
    dp = rrect((tau - 0.5) * fl, phi * 0.0105, 0.3 * fl, 0.0058, 0.0026)
    pm = plateau(dp, 0.0005) * selp
    h += pm * 0.0012
    a *= 1 - 0.2 * pm
    rough = rough * (1 - pm) + pm * 0.52

    # Fourchettes: stretch knit along the finger sides, seams + stitches each side.
    fingerish = on_finger | on_thumb
    side = np.abs(np.abs(phi) - math.pi / 2)
    fmask = smooth(0.42, 0.34, side) * fingerish
    knit = np.sin(fc["along"] * TAU / 0.0011) * 0.00005 + np.sin(phi * 9.5 * TAU) * 0.00002
    h = h * (1 - fmask) + fmask * (knit + h * 0.2)
    a *= 1 + 0.08 * fmask
    rough = rough * (1 - fmask) + fmask * 0.88
    for edge in (0.40, -0.40):
        dd = (side - abs(edge)) * 0.0095
        sh, sm = stitches(dd + 0.0011, fc["along"], pitch=0.003)
        h += (sh - 0.00022 * groove(dd, 0.0007)) * fingerish
        stitch_mask = np.maximum(stitch_mask, sm * fingerish)

    # Fingertips: reinforced caps (seam ring before the tip, palm side panel to the nail).
    tipsel = fingerish & (s == 2)
    dring = (tau - 0.18) * fl
    ring = groove(dring, 0.0007) * tipsel
    h -= 0.0003 * ring
    sh, sm = stitches(dring - 0.0013, phi * 0.009, pitch=0.0028)
    h += sh * tipsel
    stitch_mask = np.maximum(stitch_mask, sm * tipsel)
    capm = smooth(0.17, 0.2, tau) * tipsel
    a *= 1 - 0.1 * capm
    rough = rough * (1 - capm) + capm * 0.68
    # finger joint creases on the palm side (flex lines)
    for jt in (0.0, 1.0):
        cr = groove((tau - jt) * fl, 0.0012) * fingerish * smooth(-0.1, -0.5, ndors)
        h -= 0.0004 * cr
        a *= 1 - 0.12 * cr

    # Palm reinforcement panel: heel of the palm + thumb crotch, stitched outline.
    palm_body = palm & ~fingerish
    px_ = hx
    pz_ = hz
    heel = rrect(px_ - (kx[-1] * 0.45), pz_ - 0.025, 0.026, 0.020, 0.012)
    crotch = rrect(px_ - (kx[0] - 0.006), pz_ - 0.048, 0.012, 0.022, 0.008)
    dpal = np.minimum(heel, crotch)
    pmk = plateau(dpal, 0.0006) * smooth(-0.15, -0.5, ndors)
    h += pmk * 0.0007
    a *= 1 - 0.12 * pmk
    rough = rough * (1 - pmk) + pmk * 0.62
    sh, sm = stitches(dpal + 0.0022, px_ + pz_, pitch=0.003)
    w_ = smooth(-0.15, -0.5, ndors)
    h += sh * w_
    stitch_mask = np.maximum(stitch_mask, sm * w_)
    # palm flex creases
    for zc, xs in ((kz.mean() - 0.012, 0.0), (kz.mean() - 0.03, 0.01)):
        cr = groove(pz_ - zc - 0.08 * (px_ - xs), 0.0013) * palm_body
        h -= 0.00035 * cr

    # Side seams of the hand body (back panel to palm panel, where the normal turns).
    seam_d = ndors * 0.012
    sidebody = ~fingerish & (np.abs(ndors) < 0.35)
    sh, sm = stitches(seam_d - 0.0018, hz + hy, pitch=0.0032)
    h += (sh - 0.0003 * groove(seam_d, 0.0008)) * sidebody
    stitch_mask = np.maximum(stitch_mask, sm * sidebody)

    # Stitch thread: lighter, a bit glossier.
    a = a * (1 + 0.55 * stitch_mask)
    rough = rough * (1 - stitch_mask) + stitch_mask * 0.6
    # wear: dusty / scuffed high points
    wear = fbm3(P / 0.006, 3, 9)
    a *= 1 + 0.06 * wear
    H[sel] += h
    A[sel] *= a
    R[sel] = rough
    M[sel] = 0


def paint_cuff(T, fr, sel, H, A, R, M, mpt, regname):
    P = T.P[sel]
    t, th = T.t[sel], T.theta[sel]
    along = th * 0.03
    uvm = T.uv[sel] * T.w * mpt
    neo = fbm2(uvm / 0.0008, 3, 11) * 0.00003 + np.sin(uvm[:, 0] * TAU / 0.0009) * 0.00001
    h = neo.copy()
    a = 1 + 0.04 * fbm3(P / 0.01, 3, 4)
    rough = np.full(len(P), 0.8)
    if regname == "cuff":
        # rim binding (8 mm), stitched
        dm = (t - geo.CUFF_END_T) * fr.L
        bind = smooth(0.0085, 0.0075, dm)
        h += bind * np.sin(along * TAU / 0.0006) * 0.00002 + bind * 0.0003
        a *= 1 - 0.08 * bind
        sh, sm = stitches(dm - 0.0062, along)
        h += sh - 0.0002 * groove(dm - 0.0085, 0.0006)
        # seam to the glove body
        ds = (geo.CUFF_SEAM_T - t) * fr.L
        sh2, sm2 = stitches(ds - 0.003, along)
        h += sh2 - 0.00025 * groove(ds - 0.0008, 0.0008)
        sm = np.maximum(sm, sm2)
        # a few soft compression wrinkles around the wrist
        wr = np.sin(t * fr.L * TAU / 0.009 + 1.5 * fbm3(P / 0.02, 2, 3)) * smooth(0.97, 1.0, t) * smooth(1.06, 1.03, t)
        h += 0.00025 * wr
        # liner (inside of the rim) darker
        liner = (T.N[sel] * 0).sum(1)  # placeholder 0
        del liner
    else:
        # closure tab: loop fabric face, stitched border, pull edge
        th0, th1 = math.radians(18), math.radians(86)
        t0, t1 = 0.938, 0.992
        rmid = 0.034
        x = (th - (th0 + th1) / 2) * rmid
        y = (t - (t0 + t1) / 2) * fr.L
        d = rrect(x, y, (th1 - th0) / 2 * rmid, (t1 - t0) / 2 * fr.L, 0.004)
        loops = fbm2(uvm / 0.00045, 2, 13)
        h += loops * 0.00004
        sh, sm = stitches(d + 0.0022, x + y)
        h += sh - 0.0002 * groove(d + 0.0035, 0.0008)
        # embossed chevrons on the pull end
        px = x - (th1 - th0) / 2 * rmid * 0.62
        chev = groove(np.abs(y) * 0.8 + px * 1.0 - 0.0, 0.0009) + groove(np.abs(y) * 0.8 + px * 1.0 - 0.003, 0.0009)
        h += 0.00025 * chev * smooth(0.003, -0.001, d + 0.003)
        rough = np.full(len(P), 0.7)
        a *= 0.85
    a *= 1 + 0.5 * sm
    rough = rough * (1 - sm) + sm * 0.6
    H[sel] += h
    A[sel] *= a
    R[sel] = rough
    M[sel] = 0


def paint_sleeve(T, fr, sel, H, A, R, M, mpt, hem_sel):
    P = T.P[sel]
    t, th, r = T.t[sel], T.theta[sel], T.r[sel]
    uvm = T.uv[sel] * T.w * mpt
    # ripstop: fine plain weave + reinforcement grid every 5 mm
    gx = np.abs(np.mod(uvm[:, 0] / 0.005 + 0.5, 1.0) - 0.5) * 0.005
    gy = np.abs(np.mod(uvm[:, 1] / 0.005 + 0.5, 1.0) - 0.5) * 0.005
    grid = np.maximum(groove(gx, 0.00035), groove(gy, 0.00035))
    weave = np.sin(uvm[:, 0] * TAU / 0.0005) * np.sin(uvm[:, 1] * TAU / 0.0005)
    h = grid * 0.00006 + weave * 0.000008
    a = 1 + 0.05 * grid
    warp = fbm3(P / 0.03, 3, 21)
    # pushed-up compression folds near the hem
    s = t * fr.L + 0.006 * warp + 0.004 * np.sin(th * 2 + warp * 2)
    lam = 0.017
    tri = np.abs(np.mod(s / lam, 1.0) - 0.5) * 2  # 0 at crest, 1 in the valley
    fold = (1 - tri) ** 1.6
    amp = 0.0019 * smooth(0.42, 0.66, t) * (0.7 + 0.3 * fbm3(P / 0.02, 2, 5))
    h += amp * (fold - 0.4)
    # twist folds along the forearm
    tw = np.sin((t * fr.L * 0.9 + th * 0.012 * 3.0) * TAU / 0.04 + 2.0 * warp)
    h += 0.0011 * tw * smooth(0.05, 0.25, t) * smooth(0.6, 0.4, t)
    # elbow crease folds (inside of the elbow) and soft upper-arm folds
    ins = smooth(1.4, 2.6, np.abs(th))
    h += 0.0016 * np.sin(t * fr.L * TAU / 0.014 + 3 * warp) * ins * smooth(-0.2, -0.05, t) * smooth(0.22, 0.1, t)
    h += 0.0012 * fbm3(P / 0.045, 3, 31) * smooth(0.1, -0.1, t)
    # underarm flat-felled seam (ulnar / ventral)
    ths = 2.35
    dth = (np.mod(th - ths + math.pi, TAU) - math.pi) * r
    seam_band = groove(dth, 0.0045)
    h += 0.00035 * seam_band
    st = np.zeros(len(P))
    for off in (-0.0035, 0.0035):
        sh, sm = stitches(dth - off, t * fr.L, pitch=0.0032)
        h += sh * (t > -0.05)
        st = np.maximum(st, sm * (t > -0.05))
    h -= 0.0003 * groove(dth, 0.0008)
    # hem: two stitch rows and the turned edge's thickness
    dh = (geo.HEM_T - t) * fr.L
    hem = smooth(0.026, 0.024, dh) * (t > 0.5)
    h += hem * 0.0004
    for off in (0.005, 0.021):
        sh, sm = stitches(dh - off, th * r, pitch=0.003)
        h += sh * (t > 0.5)
        st = np.maximum(st, sm * (t > 0.5))
    a *= 1 + 0.06 * fbm3(P / 0.025, 3, 41)
    # abrasion on fold crests, dirt in the valleys
    a *= 1 + 0.08 * (fold - 0.5) * smooth(0.42, 0.66, t)
    a *= 1 + 0.45 * st
    rough = 0.86 - 0.05 * grid - 0.06 * st
    if hem_sel is not None:
        hh = hem_sel[sel]
        h = np.where(hh, grid * 0.00006 + 0.0003 + 0.00006 * np.sin(th * r * TAU / 0.0006), h)
        a = np.where(hh, a * 0.95, a)
    H[sel] += h
    A[sel] *= a
    R[sel] = rough
    M[sel] = 0


SKIN = np.array([0.32, 0.185, 0.125])  # linear albedo (sRGB ~ 154 119 99)


def paint_skin(T, fr, sel, H, A, R, M, mpt, col):
    P = T.P[sel]
    t, th = T.t[sel], T.theta[sel]
    uvm = T.uv[sel] * T.w * mpt
    pores = cells2(uvm / 0.00045, 17)
    h = -0.00002 * (1 - sat(pores * 2.2)) + 0.00001 * fbm2(uvm / 0.0015, 3, 19)
    # transverse wrist creases (inner wrist)
    inner = smooth(1.8, 2.6, np.abs(th))
    for tc in (0.905, 0.92):
        h -= 0.00012 * groove((t - tc) * fr.L + 0.0015 * fbm3(P / 0.01, 2, 7), 0.0006) * inner
    # fine skin lines along the arm
    h += 0.00001 * np.sin((uvm[:, 0] * 0.3 + uvm[:, 1]) * TAU / 0.0006)
    var = fbm3(P / 0.012, 4, 23)
    red = fbm3(P / 0.03, 3, 29)
    c = SKIN[None, :] * (1 + 0.07 * var[:, None]) * np.array([1.0 + 0.05 * red, 1.0 - 0.02 * red, 1.0 - 0.03 * red]).T
    # dorsal: slightly darker, tanned; hair strokes
    dorsal = smooth(1.2, 0.4, np.abs(th))
    c *= (1 - 0.08 * dorsal)[:, None]
    hair_uv = np.stack([uvm[:, 0] * 1.0, uvm[:, 1] * 0.12], 1)
    hair = sat((noise2(hair_uv / 0.0005, 37) - 0.6) * 4) * dorsal
    c *= (1 - 0.12 * hair)[:, None]
    col[sel] = c
    R[sel] = 0.52 + 0.06 * var - 0.08 * inner
    M[sel] = 0
    H[sel] += h


def paint_watch(T, sel, Mw, H, R, M, col, mpt, region):
    Minv = np.array(Mw.inverted())
    p = (np.c_[T.P[sel], np.ones(sel.sum())] @ Minv.T)[:, :3]
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    # The watch is painted on the right arm and the game wears its mirror on the left wrist:
    # paint the face pre-mirrored (12 and 6 swapped, crown stays at 3) so it reads clockwise there.
    y = -y
    rr = np.hypot(x, y)
    ang = np.arctan2(x, y)  # 0 at 12 o'clock (+y, toward the strap), clockwise toward +x (3 o'clock, the crown)
    c = np.zeros((sel.sum(), 3))
    rough = np.zeros(sel.sum())
    metal = np.zeros(sel.sum())
    h = np.zeros(sel.sum())
    uvm = T.uv[sel] * T.w * mpt
    if region == "case":
        blast = fbm2(uvm / 0.00012, 2, 51)
        c[:] = np.array([0.50, 0.50, 0.49]) * (1 + 0.05 * blast)[:, None]
        rough[:] = 0.34 + 0.05 * blast
        metal[:] = 1
        h += 0.000004 * blast
    elif region == "bezel":
        c[:] = 0.03
        rough[:] = 0.3
        metal[:] = 0.7
        a60 = np.mod(ang / TAU * 60 + 0.5, 1.0) - 0.5
        tick = groove(a60 * TAU / 60 * rr, 0.00028) * smooth(0.0165, 0.0172, rr)
        a12 = np.mod(ang / TAU * 12 + 0.5, 1.0) - 0.5
        big = groove(a12 * TAU / 12 * rr, 0.0006) * smooth(0.0158, 0.0166, rr)
        tri = (np.abs(ang) < 0.09 * (rr - 0.0155) / 0.0025) * (rr > 0.0155) * 1.0
        paint = np.maximum(np.maximum(tick, big), tri)
        c = c * (1 - paint[:, None]) + paint[:, None] * np.array([0.8, 0.8, 0.78])
        rough = rough * (1 - paint) + paint * 0.5
        metal = metal * (1 - paint)
        # coin edge
        h += 0.00004 * np.sin(ang * 120) * smooth(0.0172, 0.0178, rr)
    elif region == "dial":
        c[:] = 0.022
        rough[:] = 0.07  # crystal on top
        lume = np.array([0.72, 0.8, 0.66])
        a12 = np.mod(ang / TAU * 12 + 0.5, 1.0) - 0.5
        bars = (np.abs(a12 * TAU / 12 * rr) < 0.0007) & (rr > 0.0108) & (rr < 0.0142)
        at12 = (np.abs(ang) < 0.12) & (rr > 0.0105) & (rr < 0.0143) & (np.abs(np.abs(ang * rr) - 0.0009) < 0.0005)
        bars = (bars & (np.abs(ang) > 0.2)) | at12
        a60 = np.mod(ang / TAU * 60 + 0.5, 1.0) - 0.5
        mins = (np.abs(a60 * TAU / 60 * rr) < 0.00018) & (rr > 0.0147) & (rr < 0.0153)

        def hand(angle, length, width, tail=0.002):
            dx, dy = math.sin(angle), math.cos(angle)
            al = x * dx + y * dy
            ac = np.abs(x * dy - y * dx)
            wdt = width * (1 - 0.5 * sat(al / length))
            return (al > -tail) & (al < length) & (ac < wdt / 2)

        hr = hand(TAU * (10 + 10 / 60) / 12, 0.0085, 0.0018)
        mn = hand(TAU * 10 / 60, 0.0128, 0.0013)
        sec = hand(TAU * 38 / 60, 0.0135, 0.0004, tail=0.004)
        cap = rr < 0.0011
        paint = (bars | hr | mn).astype(float)
        c = c * (1 - paint[:, None]) + paint[:, None] * lume
        c[mins] = 0.6
        c[sec | cap] = np.array([0.55, 0.12, 0.06])
        h += 0.00008 * paint + 0.00004 * (sec | cap)
        h += -0.00003 * rr / 0.016  # domed crystal reads in the reflection
    else:  # strap: olive nylon, ribbed across its width, stitched edges
        rib = np.sin(uvm[:, 1] * TAU / 0.0007) * 0.00003 + np.sin(uvm[:, 0] * TAU / 0.00035) * 0.00001
        c[:] = np.array([0.055, 0.06, 0.04]) * (1 + 0.1 * fbm2(uvm / 0.002, 2, 61))[:, None]
        rough[:] = 0.82
        h += rib
    col[sel] = c
    R[sel] = rough
    M[sel] = metal
    H[sel] += h


# ---- Assembly ----------------------------------------------------------------------------------------

def dilate(img, valid, iters=24):
    """Fill invalid texels from valid neighbours (repeated 4-neighbour max-coverage pass)."""
    img = img.copy()
    v = valid.copy()
    for _ in range(iters):
        acc = np.zeros_like(img)
        cnt = np.zeros(v.shape, np.float32)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            sv = np.roll(v, (dy, dx), (0, 1))
            si = np.roll(img, (dy, dx), (0, 1))
            acc[sv] += si[sv]
            cnt += sv
        new = (~v) & (cnt > 0)
        if not new.any():
            break
        if img.ndim == 3:
            img[new] = acc[new] / cnt[new][:, None]
        else:
            img[new] = acc[new] / cnt[new]
        v = v | new
    return img, v


def paint(maps, fr, Mw, size, out_dir):
    T = Texels(maps, fr)
    n = len(T.valid)
    H = np.zeros(n)
    A = np.ones(n)
    R = np.full(n, 0.8)
    M = np.zeros(n)
    col = np.zeros((n, 3))
    mpt = {r: metres_per_texel(maps, geo.region_index(r)) for r in geo.REGIONS}
    print("metres per texel", {k: round(v * 1000, 3) for k, v in mpt.items()})

    glove = T.is_("glove")
    paint_glove(T, fr, glove, H, A, R, M, mpt["glove"])
    for rn in ("cuff", "strap"):
        paint_cuff(T, fr, T.is_(rn), H, A, R, M, mpt[rn], rn)
    sleeve = T.is_("sleeve", "hem")
    paint_sleeve(T, fr, sleeve, H, A, R, M, mpt["sleeve"], T.is_("hem"))
    paint_skin(T, fr, T.is_("skin"), H, A, R, M, mpt["skin"], col)
    for rn in ("case", "bezel", "dial", "wstrap"):
        paint_watch(T, T.is_(rn), Mw, H, R, M, col, mpt[rn], rn)

    # Ambient occlusion into the albedo (soft), cavities from the height.
    ao = np.clip(T.ao, 0, 1) ** 0.6
    tinted = T.is_("glove", "cuff", "strap", "sleeve", "hem")
    gl = T.is_("glove", "cuff", "strap")
    sl = T.is_("sleeve", "hem")
    alb = np.zeros((n, 3))
    alb[tinted] = (A[tinted] * ao[tinted])[:, None] * np.array([1.0, 0.99, 0.97])
    # normalise: mean linear albedo 0.25 per tinted region (the runtime tints it)
    for m_ in (gl, sl):
        mean = alb[m_].mean(0)
        alb[m_] *= 0.25 / mean.mean()
    untinted = ~tinted
    alb[untinted] = col[untinted] * ao[untinted][:, None]
    mask = np.where(gl, 1.0, np.where(sl, 0.0, 0.5))

    h, w = maps["region"].shape
    valid = (maps["region"] >= 0)

    def to_img(vals, ch):
        img = np.zeros((h * w, ch)) if ch > 1 else np.zeros(h * w)
        img[T.valid] = vals
        img = img.reshape((h, w, ch) if ch > 1 else (h, w))
        img, _ = dilate(img, valid)
        return img

    lin = to_img(alb, 3)
    srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(np.clip(lin, 0, None), 1 / 2.4) - 0.055)
    # unbaked background: the tint midpoint
    bg = ~dilate(np.zeros((h, w)), valid)[1]
    mid = 1.055 * 0.25 ** (1 / 2.4) - 0.055
    srgb[bg] = mid
    Hm = to_img(H, 1)
    Hm[bg] = 0
    rough = to_img(R, 1)
    rough[bg] = 0.8
    metal = to_img(M, 1)
    metal[bg] = 0
    msk = to_img(mask, 1)
    msk[bg] = 0
    msk = np.where(msk > 0.75, 1.0, np.where(msk < 0.25, 0.0, 0.5))
    orm = np.dstack([msk, np.clip(rough, 0.04, 1), np.clip(metal, 0, 1)])
    # debug views
    dbg = os.path.join(out_dir, "maps")
    os.makedirs(dbg, exist_ok=True)
    np.save(os.path.join(dbg, "height.npy"), Hm.astype(np.float32))
    return {"color": srgb, "orm": orm, "height": Hm, "valid": valid}


def finish_normal(nrm, region):
    valid = region >= 0
    n, _ = dilate(nrm, valid)
    bg = ~dilate(np.zeros(region.shape), valid)[1]
    n[bg] = (0.5, 0.5, 1.0)
    return n
