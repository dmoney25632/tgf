"""The modular architecture kit: every piece at real size (see ak_lib for axes).

Canonical sizes (the game scales pieces to the actual opening / run):
    windows   W 1.00 x H 1.40 (origin bottom centre of the hole, outer face)
    doors     opening 1.10 x 2.20; leaves 1.00 x 2.15 with the origin ON THE HINGE
    shopfront 2.40 x 2.50
    modules   1.00 m along X (cornices, courses, gutters, railings, copings, walls)
Gameplay heights (the movement code uses the same numbers):
    LOW    = 1.00 m  low cover, vaultable (0.9-1.1)
    MANTLE = 1.80 m  mantle ledge (<= 1.9); anything taller is not climbable
Low-cover and mantle pieces share one visual language: a pale dressed
capstone on every vaultable top, a bull-nosed concrete coping with a steel
nosing on every mantle ledge.
"""
import math
import random

from mathutils import Matrix, Vector

from ak_lib import GLASS, LAMP

WIN_W, WIN_H = 1.0, 1.4
DOOR_W, DOOR_H = 1.1, 2.2
LEAF_W, LEAF_H, LEAF_T = 1.0, 2.15, 0.045
SHOP_W, SHOP_H = 2.4, 2.5
LOW, MANTLE = 1.0, 1.8


# ---- helpers ----------------------------------------------------------------------------------

def xform(parts, m):
    for o in parts:
        if o is not None:
            o.data.transform(m)


def rot(parts, deg, axis, pivot):
    p = Vector(pivot)
    xform(parts, Matrix.Translation(p) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-p))


def mirror_x(parts):
    """Mirror across x = 0 (flips winding: normals are recalculated on join)."""
    for o in parts:
        if o is None:
            continue
        o.data.transform(Matrix.Scale(-1, 4, (1, 0, 0)))
        o.data.flip_normals()


def since(k):
    return len(k.parts)


def new(k, i):
    return k.parts[i:]


def arc(cx, cz, r, a0, a1, n):
    return [(cx + r * math.cos(a0 + (a1 - a0) * i / n), cz + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]


# ---- Windows ----------------------------------------------------------------------------------

def _sash(k, x0, x1, z0, z1, y0, y1, bars, cell, name):
    """Casement sash: stiles, rails, glazing bars, a glass pane behind the bars."""
    s, rb = 0.05, 0.075
    k.box(f"{name}_sl", (s, y1 - y0, z1 - z0), ((x0 + s / 2), (y0 + y1) / 2, (z0 + z1) / 2), cell, 0.008)
    k.box(f"{name}_sr", (s, y1 - y0, z1 - z0), ((x1 - s / 2), (y0 + y1) / 2, (z0 + z1) / 2), cell, 0.008)
    k.box(f"{name}_rt", (x1 - x0 - 2 * s, y1 - y0, s), ((x0 + x1) / 2, (y0 + y1) / 2, z1 - s / 2), cell, 0.008)
    k.box(f"{name}_rb", (x1 - x0 - 2 * s, y1 - y0, rb), ((x0 + x1) / 2, (y0 + y1) / 2, z0 + rb / 2), cell, 0.008)
    gz0, gz1 = z0 + rb, z1 - s
    for i in range(1, bars + 1):
        z = gz0 + (gz1 - gz0) * i / (bars + 1)
        k.box(f"{name}_bar{i}", (x1 - x0 - 2 * s, 0.028, 0.022), ((x0 + x1) / 2, y1 - 0.016, z), cell, 0.006)
    k.box(f"{name}_glass", (x1 - x0 - 2 * s + 0.02, 0.006, gz1 - gz0 + 0.02), ((x0 + x1) / 2, (y0 + y1) / 2 - 0.004, (gz0 + gz1) / 2), GLASS, 0)


def _casement(k, broken=False):
    W, H = WIN_W, WIN_H
    f, y0, y1 = 0.07, -0.2, -0.11
    c = "timber_paint"
    # Outer frame: jambs, head, a sloped bottom rail that sheds water.
    for sx in (-1, 1):
        k.box(f"jamb{sx}", (f, y1 - y0, H - 0.012), (sx * (W / 2 - f / 2), (y0 + y1) / 2, H / 2), c, 0.01)
    k.box("head", (W - 2 * f, y1 - y0, f), (0, (y0 + y1) / 2, H - f / 2 - 0.006), c, 0.01)
    k.prism("bottom", [(y0, 0.006), (y1 + 0.03, 0.006), (y1 + 0.03, 0.03), (y1 - 0.01, 0.075), (y0, 0.075)], -W / 2 + f, W / 2 - f, c, 0.006)
    tz = H * 0.72
    k.box("transom", (W - 2 * f, y1 - y0 + 0.02, 0.07), (0, (y0 + y1) / 2 + 0.01, tz), c, 0.01)
    # Top light: fixed pane with one bar.
    k.box("tl_bar", (0.022, 0.028, H - f - tz - 0.035), (0, y1 - 0.016, (tz + H - f) / 2), c, 0.006)
    k.box("tl_glass", (W - 2 * f + 0.02, 0.006, H - f - tz - 0.05), (0, (y0 + y1) / 2, (tz + H - f) / 2 + 0.005), GLASS, 0)
    # Two casements below the transom (left one swung in on the broken unit).
    sy0, sy1 = y0 + 0.012, y1 - 0.004
    mid = 0.0
    i0 = since(k)
    _sash(k, -W / 2 + f, mid, 0.075, tz - 0.035, sy0, sy1, 2, c, "sashL")
    left = new(k, i0)
    if broken:
        # Glass gone from the left sash, which hangs open into the room.
        for o in left:
            if o.name.startswith("sashL_glass") or o.name.startswith("sashL_bar1"):
                o.data.clear_geometry()
        rot(left, 38, "Z", (-W / 2 + f, sy0, 0))
    i1 = since(k)
    _sash(k, mid, W / 2 - f, 0.075, tz - 0.035, sy0, sy1, 2, c, "sashR")
    if broken:
        right = new(k, i1)
        for o in right:
            if o.name.startswith("sashR_glass"):
                o.data.clear_geometry()
        # Shards left in the corners of the right sash.
        for (x, z, w, h, a) in ((0.1, 0.16, 0.16, 0.22, 12), (W / 2 - f - 0.1, 0.5, 0.12, 0.28, -20), (0.08, tz - 0.12, 0.14, 0.1, 30)):
            k.box(f"shard{x}{z}", (w, 0.005, h), (x, (sy0 + sy1) / 2, z), GLASS, 0, rot=(a, "Y"))
    # Espagnolette bar + handle on the meeting stile.
    k.box("espag", (0.012, 0.012, tz - 0.2), (0.03, sy1 + 0.008, tz / 2), "iron", 0.003, detail=True)
    k.box("handle", (0.02, 0.05, 0.11), (0.035, sy1 + 0.03, tz * 0.55), "iron", 0.006, detail=True)


def win_casement(k):
    _casement(k)


def win_casement_broken(k):
    _casement(k, broken=True)


def win_sill(k):
    """Dressed stone sill: weathered (sloped) top, nose 65 mm proud, drip groove beneath."""
    L = WIN_W + 0.24
    pts = [(-0.22, -0.11), (0.025, -0.11), (0.03, -0.095), (0.04, -0.095), (0.045, -0.11), (0.065, -0.11), (0.065, -0.035), (0.0, 0.004), (-0.1, 0.006), (-0.22, 0.006)]
    k.prism("sill", pts, -L / 2, L / 2, "stone", 0.008)


def win_lintel(k):
    """Stone lintel over the opening (its soffit forms the head of the reveal)."""
    L = WIN_W + 0.3
    k.prism("lintel", [(-0.3, -0.004), (0.03, -0.004), (0.03, 0.2), (-0.3, 0.2)], -L / 2, L / 2, "stone", 0.012, seg=1)
    if k.fine:
        # Chiselled margin line (tooling) across the face.
        k.box("lintel_margin", (L - 0.08, 0.004, 0.012), (0, 0.031, 0.17), "stone", 0, detail=True)


def win_lintel_key(k):
    """Flat arch of voussoirs with a proud keystone."""
    L = WIN_W + 0.36
    n = 7
    for i in range(n):
        x0 = -L / 2 + L * i / n + 0.004
        x1 = -L / 2 + L * (i + 1) / n - 0.004
        fan = lambda x: x * 0.18
        key = i == n // 2
        top = 0.3 if key else 0.24
        pts = [(x0, -0.004), (x1, -0.004), (x1 + fan(x1), top), (x0 + fan(x0), top)]
        k.prism_y(f"vous{i}", pts, -0.3, 0.05 if key else 0.03, "stone", 0.01, seg=1)


def win_surround(k):
    """Moulded architrave: jambs with a stepped profile, a corniced head with ears."""
    W, H = WIN_W, WIN_H
    prof = [(0.0, -0.01), (0.14, -0.01), (0.14, 0.022), (0.11, 0.035), (0.03, 0.035), (0.015, 0.025), (0.0, 0.025)]
    for sx in (-1, 1):
        pts = [(sx * (W / 2 + px), py) for px, py in prof]
        if sx < 0:
            pts.reverse()
        k.prism_z(f"jamb{sx}", pts, 0.0, H + 0.004, "stone", 0.005)
    head = [(-0.01, 0.0), (0.04, 0.0), (0.04, 0.12), (0.06, 0.14), (0.075, 0.16), (0.075, 0.19), (-0.01, 0.19)]
    k.prism("head", head, -W / 2 - 0.2, W / 2 + 0.2, "stone", 0.005)
    k.box("ear_l", (0.06, 0.04, 0.08), (-W / 2 - 0.17, 0.02, -0.03), "stone", 0.006, detail=True)
    k.box("ear_r", (0.06, 0.04, 0.08), (W / 2 + 0.17, 0.02, -0.03), "stone", 0.006, detail=True)


def _board_leaf(k, x0, x1, z0, z1, y0, t, name, braces=True, cell="timber_paint", outside_boards=True):
    """Board-and-batten shutter leaf lying in the wall plane: boards on y0..y0+t,
    ledges + Z braces on the +y face (the face seen when folded back)."""
    w = x1 - x0
    n = 3
    for i in range(n):
        bx0 = x0 + w * i / n + 0.003
        bx1 = x0 + w * (i + 1) / n - 0.003
        k.box(f"{name}_b{i}", (bx1 - bx0, t, z1 - z0), ((bx0 + bx1) / 2, y0 + t / 2, (z0 + z1) / 2), cell, 0.006)
    if braces:
        lz = [z0 + 0.12, (z0 + z1) / 2, z1 - 0.12]
        for j, z in enumerate(lz):
            k.box(f"{name}_ledge{j}", (w - 0.04, 0.022, 0.1), ((x0 + x1) / 2, y0 + t + 0.011, z), cell, 0.006)
        for j in range(2):
            za, zb = lz[j] + 0.05, lz[j + 1] - 0.05
            length = math.hypot(w - 0.12, zb - za)
            ang = math.degrees(math.atan2(zb - za, w - 0.12))
            k.box(f"{name}_brace{j}", (length, 0.02, 0.08), ((x0 + x1) / 2, y0 + t + 0.01, (za + zb) / 2), cell, 0.006, rot=(-ang, "Y"))


def _strap(k, x_hinge, xdir, z, y, name, length=0.38):
    k.box(f"{name}", (length, 0.006, 0.035), (x_hinge + xdir * length / 2, y, z), "iron", 0.002, detail=not k.fine)
    k.cyl(f"{name}_kn", 0.009, (x_hinge, y, z - 0.03), (x_hinge, y, z + 0.03), "iron", detail=True)


def _louvre_leaf(k, x0, x1, z0, z1, y0, t, name, cell="timber_paint"):
    """Louvred leaf: frame + angled slats."""
    s = 0.05
    k.box(f"{name}_sl", (s, t, z1 - z0), (x0 + s / 2, y0 + t / 2, (z0 + z1) / 2), cell, 0.006)
    k.box(f"{name}_sr", (s, t, z1 - z0), (x1 - s / 2, y0 + t / 2, (z0 + z1) / 2), cell, 0.006)
    k.box(f"{name}_rt", (x1 - x0 - 2 * s, t, 0.06), ((x0 + x1) / 2, y0 + t / 2, z1 - 0.03), cell, 0.006)
    k.box(f"{name}_rb", (x1 - x0 - 2 * s, t, 0.09), ((x0 + x1) / 2, y0 + t / 2, z0 + 0.045), cell, 0.006)
    k.box(f"{name}_rm", (x1 - x0 - 2 * s, t, 0.05), ((x0 + x1) / 2, y0 + t / 2, (z0 + z1) / 2), cell, 0.006)
    pitch = 0.055 if k.fine else 0.11
    z = z0 + 0.1
    i = 0
    while z < z1 - 0.07:
        if abs(z - (z0 + z1) / 2) > 0.04:
            k.box(f"{name}_sl{i}", (x1 - x0 - 2 * s, 0.008, 0.06 if k.fine else 0.11), ((x0 + x1) / 2, y0 + t / 2, z), cell, 0.002, seg=1, rot=(35, "X"))
        z += pitch
        i += 1


def _shutters_open(k, louvre):
    W, H = WIN_W, WIN_H
    sw = W / 2 + 0.02
    for sx in (-1, 1):
        xa = sx * (W / 2 + 0.1)
        xb = xa + sx * sw
        x0, x1 = min(xa, xb), max(xa, xb)
        if louvre:
            _louvre_leaf(k, x0, x1, 0.01, H - 0.01, 0.012, 0.035, f"leaf{sx}")
        else:
            _board_leaf(k, x0, x1, 0.01, H - 0.01, 0.012, 0.03, f"leaf{sx}")
        for z in (0.16, H - 0.16):
            _strap(k, xa - sx * 0.02, sx, z, 0.07, f"strap{sx}{z}")
        # Shutter dog holding the leaf back.
        k.box(f"dog{sx}", (0.012, 0.05, 0.09), (xb + sx * 0.03, 0.025, H * 0.25), "iron", 0.003, detail=True)


def shutters_open(k):
    _shutters_open(k, False)


def louvres_open(k):
    _shutters_open(k, True)


def _shutters_closed(k, louvre):
    """Both leaves shut in the reveal, a locking bar across: reads as 'closed, no way in'."""
    W, H = WIN_W, WIN_H
    y0, t = -0.07, 0.035
    for sx in (-1, 1):
        x0, x1 = sorted((0.003 * sx, sx * (W / 2 - 0.005)))
        if louvre:
            _louvre_leaf(k, x0, x1, 0.008, H - 0.008, y0, t, f"leaf{sx}")
        else:
            _board_leaf(k, x0, x1, 0.008, H - 0.008, y0, t, f"leaf{sx}", braces=False)
        for z in (0.18, H - 0.18):
            k.box(f"strap{sx}{z}", (0.3, 0.006, 0.035), (sx * (W / 2 - 0.17), y0 + t + 0.003, z), "iron", 0.002, detail=True)
    k.box("bar", (W + 0.08, 0.02, 0.05), (0, y0 + t + 0.014, H * 0.48), "iron", 0.004)
    for sx in (-1, 1):
        k.box(f"keeper{sx}", (0.03, 0.06, 0.08), (sx * (W / 2 + 0.03), y0 + t + 0.02, H * 0.48), "iron", 0.004, detail=True)
    k.box("padlock", (0.05, 0.025, 0.06), (0.06, y0 + t + 0.035, H * 0.48 - 0.05), "iron", 0.006, detail=True)


def shutters_closed(k):
    _shutters_closed(k, False)


def louvres_closed(k):
    _shutters_closed(k, True)


def shutter_hanging(k):
    """One leaf folded back, the other torn off its lower hinge and hanging askew."""
    W, H = WIN_W, WIN_H
    sw = W / 2 + 0.02
    xa = -(W / 2 + 0.1)
    _board_leaf(k, xa - sw, xa, 0.01, H - 0.01, 0.012, 0.03, "leafL")
    _strap(k, xa + 0.02, -1, 0.16, 0.07, "strapL0")
    _strap(k, xa + 0.02, -1, H - 0.16, 0.07, "strapL1")
    i0 = since(k)
    _board_leaf(k, W / 2 + 0.1, W / 2 + 0.1 + sw, 0.01, H - 0.01, 0.03, 0.03, "leafR", braces=True)
    leaf = new(k, i0)
    rot(leaf, -24, "Y", (W / 2 + 0.12, 0.05, H - 0.12))
    _strap(k, W / 2 + 0.08, 1, H - 0.16, 0.07, "strapR")


def win_boarded(k):
    """Planks nailed across the opening: a closed, non-enterable read."""
    W, H = WIN_W, WIN_H
    rr = random.Random(7)
    zs = [0.12, 0.45, 0.8, 1.15]
    for i, z in enumerate(zs):
        a = rr.uniform(-5, 5)
        k.box(f"plank{i}", (W + 0.28, 0.025, 0.17 + rr.uniform(-0.02, 0.02)), (rr.uniform(-0.03, 0.03), 0.016, z + 0.05), "timber_raw", 0.006, rot=(a, "Y"))
        for sx in (-1, 1):
            k.box(f"nail{i}{sx}", (0.012, 0.006, 0.012), (sx * (W / 2 + 0.07), 0.03, z + 0.05), "iron", 0.002, detail=True)
    length = math.hypot(W, H * 0.8)
    k.box("diag", (length, 0.022, 0.15), (0, 0.04, H / 2), "timber_raw", 0.006, rot=(math.degrees(math.atan2(H * 0.8, W)), "Y"))
    k.box("void", (W - 0.01, 0.01, H - 0.01), (0, -0.2, H / 2), "dark", 0)


def win_bricked(k):
    """Opening bricked up flush-ish (set back 50 mm), rough mortar fillet at the edges."""
    W, H = WIN_W, WIN_H
    k.box("infill", (W - 0.004, 0.12, H - 0.004), (0, -0.11, H / 2), "brick", 0.004, seg=1)
    if k.fine:
        for sx in (-1, 1):
            k.box(f"fillet{sx}", (0.03, 0.02, H - 0.01), (sx * (W / 2 - 0.016), -0.045, H / 2), "render", 0.006)


def win_bars(k):
    """Ground-floor security grille: round bars through two flat rails, set in the reveal."""
    W, H = WIN_W, WIN_H
    y = -0.05
    n = 6
    for i in range(n):
        x = -W / 2 + W * (i + 0.5) / n
        k.cyl(f"bar{i}", 0.009, (x, y, 0.0), (x, y, H), "iron", verts=8 if k.fine else 5)
    for z in (0.2, H - 0.2):
        k.box(f"rail{z}", (W, 0.01, 0.045), (0, y + 0.01, z), "iron", 0.003)


# ---- Doors ---------------------------------------------------------------------------------------

def door_frame(k):
    """Jamb linings, frame + stop round the leaf, a stone threshold (reveal 0.3 m+)."""
    W, H = DOOR_W, DOOR_H
    c = "timber_paint"
    for sx in (-1, 1):
        k.box(f"lining{sx}", (0.025, 0.27, H - 0.006), (sx * (W / 2 - 0.0125 - 0.003), -0.165, H / 2), c, 0.005)
        k.box(f"frame{sx}", (0.06, 0.08, H - 0.006), (sx * (W / 2 - 0.03 - 0.003), -0.17, H / 2), c, 0.008)
        k.box(f"arch{sx}", (0.07, 0.02, H + 0.07), (sx * (W / 2 + 0.035), 0.01, (H + 0.07) / 2), c, 0.006)
    k.box("head_lining", (W - 0.006, 0.27, 0.025), (0, -0.165, H - 0.0155), c, 0.005)
    k.box("head_frame", (W - 0.12, 0.08, 0.06), (0, -0.17, H - 0.036), c, 0.008)
    k.box("arch_head", (W + 0.14, 0.02, 0.07), (0, 0.01, H + 0.035), c, 0.006)
    k.prism("threshold", [(-0.3, -0.06), (0.04, -0.06), (0.04, 0.006), (0.0, 0.02), (-0.3, 0.02)], -W / 2 - 0.02, W / 2 + 0.02, "stone", 0.006)


def door_surround(k):
    """Stone architrave with plinth blocks, a frieze with keystone and a moulded hood."""
    W, H = DOOR_W, DOOR_H
    prof = [(0.0, -0.01), (0.2, -0.01), (0.2, 0.04), (0.17, 0.06), (0.05, 0.06), (0.03, 0.045), (0.0, 0.045)]
    for sx in (-1, 1):
        pts = [(sx * (W / 2 + px), py) for px, py in prof]
        if sx < 0:
            pts.reverse()
        k.prism_z(f"jamb{sx}", pts, 0.32, H + 0.004, "stone", 0.006)
        k.box(f"plinth{sx}", (0.23, 0.09, 0.32), (sx * (W / 2 + 0.105), 0.035, 0.16), "stone", 0.01)
    k.box("frieze", (W + 0.4, 0.05, 0.24), (0, 0.015, H + 0.12), "stone", 0.008)
    k.prism_y("key", [(-0.08, H - 0.02), (0.08, H - 0.02), (0.1, H + 0.26), (-0.1, H + 0.26)], -0.01, 0.085, "stone", 0.008)
    hood = [(-0.01, 0.0), (0.06, 0.0), (0.09, 0.03), (0.17, 0.06), (0.19, 0.08), (0.19, 0.13), (0.2, 0.14), (-0.01, 0.14)]
    k.prism("hood", hood, -W / 2 - 0.34, W / 2 + 0.34, "stone", 0.006)
    xform(k.parts[-1:], Matrix.Translation((0, 0, H + 0.24)))


def _hinges(k, z0, z1, n=3):
    for i in range(n):
        z = z0 + (z1 - z0) * (i / (n - 1) if n > 1 else 0.5)
        k.cyl(f"hinge{i}", 0.008, (0.0, 0.0, z - 0.05), (0.0, 0.0, z + 0.05), "iron", verts=8, detail=True)


def door_leaf_panel(k):
    """Four-panel (raised and fielded) door leaf. Origin on the hinge axis at the bottom;
    the leaf runs along +X, the outside face is +Y. Rotate about Z to open."""
    W, H, T = LEAF_W, LEAF_H, LEAF_T
    c = "timber_paint"
    st, tr, lr, br, mu = 0.12, 0.12, 0.2, 0.22, 0.1
    x0, x1 = 0.01, W - 0.005
    k.box("stile_h", (st, T, H), (x0 + st / 2, 0, H / 2), c, 0.006)
    k.box("stile_l", (st, T, H), (x1 - st / 2, 0, H / 2), c, 0.006)
    iw = x1 - x0 - 2 * st
    k.box("rail_t", (iw, T, tr), ((x0 + x1) / 2, 0, H - tr / 2), c, 0.006)
    k.box("rail_l", (iw, T, lr), ((x0 + x1) / 2, 0, 0.95), c, 0.006)
    k.box("rail_b", (iw, T, br), ((x0 + x1) / 2, 0, br / 2), c, 0.006)
    k.box("muntin_u", (mu, T, H - tr - 0.95 - lr / 2), ((x0 + x1) / 2, 0, (H - tr + 0.95 + lr / 2) / 2), c, 0.006)
    k.box("muntin_d", (mu, T, 0.95 - lr / 2 - br), ((x0 + x1) / 2, 0, (0.95 - lr / 2 + br) / 2), c, 0.006)
    pw = (iw - mu) / 2
    for (za, zb) in ((0.95 + lr / 2, H - tr), (br, 0.95 - lr / 2)):
        for side in (-1, 1):
            cx = (x0 + x1) / 2 + side * (mu / 2 + pw / 2)
            # Panel (thin) + raised field on both faces.
            k.box(f"panel{za}{side}", (pw + 0.01, T * 0.45, zb - za + 0.01), (cx, 0, (za + zb) / 2), c, 0.003)
            for face in (-1, 1):
                k.box(f"field{za}{side}{face}", (pw - 0.07, 0.012, zb - za - 0.07), (cx, face * (T * 0.225 + 0.004), (za + zb) / 2), c, 0.006 if k.fine else 0, seg=1)
    # Knob, escutcheon, letter plate on the outside; knob inside too.
    for face in (-1, 1):
        k.cyl(f"knob{face}", 0.028, (x1 - 0.07, face * T / 2, 0.98), (x1 - 0.07, face * (T / 2 + 0.06), 0.98), "iron", verts=12, r2=0.022)
    k.box("escutcheon", (0.04, 0.006, 0.1), (x1 - 0.07, T / 2 + 0.003, 0.86), "iron", 0.002, detail=True)
    k.box("letter", (0.26, 0.008, 0.06), ((x0 + x1) / 2, T / 2 + 0.004, 0.95), "iron", 0.003, detail=True)
    _hinges(k, 0.25, H - 0.25)


def door_leaf_plank(k):
    """Ledged and braced plank door (barns, back doors). Origin on the hinge, leaf along +X."""
    W, H, T = LEAF_W, LEAF_H, 0.04
    n = 6
    for i in range(n):
        bx0 = 0.01 + (W - 0.015) * i / n + 0.003
        bx1 = 0.01 + (W - 0.015) * (i + 1) / n - 0.003
        k.box(f"board{i}", (bx1 - bx0, 0.028, H), ((bx0 + bx1) / 2, 0.006, H / 2), "oak", 0.005)
    lz = [0.25, 1.05, H - 0.25]
    for j, z in enumerate(lz):
        k.box(f"ledge{j}", (W - 0.06, 0.03, 0.15), (W / 2, -0.022, z), "oak", 0.006)
    for j in range(2):
        za, zb = lz[j] + 0.08, lz[j + 1] - 0.08
        length = math.hypot(W - 0.2, zb - za)
        ang = math.degrees(math.atan2(zb - za, W - 0.2))
        k.box(f"brace{j}", (length, 0.028, 0.12), (W / 2, -0.021, (za + zb) / 2), "oak", 0.006, rot=(ang, "Y"))
    for z in (0.25, H - 0.25):
        k.box(f"strap{z}", (0.62, 0.006, 0.045), (0.31, 0.023, z), "iron", 0.002)
    k.cyl("ring", 0.05, (W - 0.12, 0.022, 1.0), (W - 0.12, 0.03, 1.0), "iron", verts=12, detail=True)
    k.box("latch", (0.12, 0.012, 0.03), (W - 0.12, 0.026, 1.12), "iron", 0.003, detail=True)
    _hinges(k, 0.25, H - 0.25, 2)


def door_leaf_metal(k):
    """Pressed-steel door: perimeter frame, two stiffener swages, lever handle, lock."""
    W, H, T = LEAF_W, LEAF_H, 0.05
    c = "sheet_paint"
    k.box("sheet", (W - 0.015, T * 0.6, H), (0.01 + (W - 0.015) / 2, 0, H / 2), c, 0.004)
    for face in (-1, 1):
        y = face * (T * 0.3 + 0.006)
        k.box(f"fr_t{face}", (W - 0.015, 0.012, 0.06), (0.01 + (W - 0.015) / 2, y, H - 0.03), c, 0.004)
        k.box(f"fr_b{face}", (W - 0.015, 0.012, 0.08), (0.01 + (W - 0.015) / 2, y, 0.04), c, 0.004)
        k.box(f"fr_h{face}", (0.06, 0.012, H), (0.04, y, H / 2), c, 0.004)
        k.box(f"fr_l{face}", (0.06, 0.012, H), (W - 0.035, y, H / 2), c, 0.004)
        for z in (0.75, 1.45):
            k.box(f"swage{face}{z}", (W - 0.2, 0.008, 0.05), (W / 2, y, z), c, 0.004)
        k.box(f"lever{face}", (0.13, 0.025, 0.022), (W - 0.13, face * (T * 0.3 + 0.04), 1.02), "iron", 0.005)
        k.box(f"rose{face}", (0.05, 0.012, 0.16), (W - 0.08, face * (T * 0.3 + 0.012), 0.98), "iron", 0.003, detail=True)
    k.box("kick", (W - 0.1, 0.004, 0.2), (W / 2, T * 0.3 + 0.014, 0.18), "zinc", 0.002, detail=True)
    _hinges(k, 0.2, H - 0.2)


def door_step(k):
    """Single bull-nosed stone step in front of a door (origin: bottom centre at the wall)."""
    L = DOOR_W + 0.4
    pts = [(-0.04, 0.0), (0.4, 0.0)] + arc(0.4 - 0.03, 0.12 - 0.03, 0.03, 0.0, math.pi / 2, 4 if k.fine else 1)[:] + [(-0.04, 0.12)]
    k.prism("step", pts, -L / 2, L / 2, "stone", 0.006)


def door_lamp(k):
    """Wall lantern on a scrolled bracket: marks an enterable door (its bulb is emissive)."""
    k.box("plate", (0.1, 0.02, 0.18), (0, 0.01, 0), "iron", 0.004)
    k.box("arm", (0.025, 0.3, 0.025), (0, 0.16, 0.05), "iron", 0.006)
    k.cyl("stay", 0.008, (0, 0.02, -0.07), (0, 0.24, 0.045), "iron", verts=6)
    cx, cy, cz = 0, 0.3, -0.12
    s = 0.075
    for sx in (-1, 1):
        for sy in (-1, 1):
            k.box(f"post{sx}{sy}", (0.012, 0.012, 0.24), (cx + sx * s, cy + sy * s, cz), "iron", 0.003)
    k.prism_z("roof", [(cx - s - 0.02, cy - s - 0.02), (cx + s + 0.02, cy - s - 0.02), (cx + s + 0.02, cy + s + 0.02), (cx - s - 0.02, cy + s + 0.02)], cz + 0.12, cz + 0.14, "iron", 0.004)
    k.cyl("cap", 0.1, (cx, cy, cz + 0.14), (cx, cy, cz + 0.22), "iron", verts=4 if not k.fine else 4, r2=0.015)
    k.box("base", (2 * s + 0.03, 2 * s + 0.03, 0.025), (cx, cy, cz - 0.12), "iron", 0.004)
    k.box("hook", (0.012, 0.012, 0.06), (cx, cy, cz + 0.2), "iron", 0, detail=True)
    for ax, sz in (("x", (2 * s, 0.004, 0.22)), ("y", (0.004, 2 * s, 0.22))):
        for sg in (-1, 1):
            at = (cx, cy + sg * s, cz) if ax == "x" else (cx + sg * s, cy, cz)
            k.box(f"pane{ax}{sg}", sz, at, GLASS, 0)
    k.cyl("bulb", 0.035, (cx, cy, cz - 0.08), (cx, cy, cz + 0.02), LAMP, verts=10, r2=0.02)


def shopfront(k):
    """Shop front in a 2.4 x 2.5 opening: stall riser, posts, mullions, transom lights,
    glass, and a fascia sign band on the wall above."""
    W, H = SHOP_W, SHOP_H
    y0, y1 = -0.24, -0.14
    c = "timber_paint"
    k.box("riser", (W - 0.01, 0.1, 0.5), (0, -0.2, 0.25), c, 0.008)
    for i, x in enumerate((-W / 2 + 0.2, 0.0, W / 2 - 0.2)):
        if k.fine:
            k.box(f"riser_p{i}", (0.6, 0.012, 0.3), (x * 0.6 if i != 1 else 0, -0.145, 0.25), c, 0.006)
    k.prism("stallboard", [(-0.26, 0.48), (-0.08, 0.48), (-0.08, 0.5), (-0.13, 0.545), (-0.26, 0.545)], -W / 2, W / 2, c, 0.006)
    for sx in (-1, 1):
        k.box(f"post{sx}", (0.09, y1 - y0, H - 0.5), (sx * (W / 2 - 0.045 - 0.003), (y0 + y1) / 2, (H + 0.5) / 2), c, 0.008)
    for x in (-W / 6, W / 6):
        k.box(f"mullion{x}", (0.06, y1 - y0, H - 0.55), (x, (y0 + y1) / 2, (H + 0.55) / 2), c, 0.008)
    tz = H - 0.45
    k.box("transom", (W - 0.18, y1 - y0 + 0.02, 0.07), (0, (y0 + y1) / 2, tz), c, 0.008)
    k.box("head", (W - 0.18, y1 - y0, 0.08), (0, (y0 + y1) / 2, H - 0.044), c, 0.008)
    for i in range(3):
        xa = -W / 2 + 0.09 + (W - 0.18) * i / 3
        xb = -W / 2 + 0.09 + (W - 0.18) * (i + 1) / 3
        k.box(f"glass{i}", (xb - xa, 0.008, tz - 0.6), ((xa + xb) / 2, (y0 + y1) / 2, (tz + 0.55) / 2), GLASS, 0)
        k.box(f"tglass{i}", (xb - xa, 0.008, H - tz - 0.12), ((xa + xb) / 2, (y0 + y1) / 2, (tz + H - 0.08) / 2), GLASS, 0)
        if k.fine:
            for j in range(1, 3):
                xm = xa + (xb - xa) * j / 3
                k.box(f"tbar{i}{j}", (0.02, 0.03, H - tz - 0.12), (xm, y1 - 0.01, (tz + H - 0.08) / 2), c, 0.005)
    # Fascia: sign board on the wall above with a cornice, consoles at the ends.
    k.box("fascia", (W + 0.5, 0.05, 0.46), (0, 0.025, H + 0.29), c, 0.01)
    k.prism("fascia_cornice", [(-0.01, 0.0), (0.07, 0.0), (0.1, 0.03), (0.12, 0.05), (0.12, 0.08), (-0.01, 0.08)], -W / 2 - 0.3, W / 2 + 0.3, c, 0.005)
    xform(k.parts[-1:], Matrix.Translation((0, 0, H + 0.52)))
    for sx in (-1, 1):
        k.prism_y(f"console{sx}", [(sx * (W / 2 + 0.16) - 0.06, H - 0.3), (sx * (W / 2 + 0.16) + 0.06, H - 0.3), (sx * (W / 2 + 0.16) + 0.07, H + 0.6), (sx * (W / 2 + 0.16) - 0.07, H + 0.6)], -0.005, 0.11, c, 0.01)


def roller_box(k):
    """Roller-shutter housing above a 2.4 m opening, with guide channels down both sides."""
    W, H = SHOP_W, SHOP_H
    k.box("housing", (W + 0.24, 0.3, 0.34), (0, 0.15, H + 0.17), "sheet_paint", 0.01)
    k.box("lip", (W + 0.24, 0.04, 0.03), (0, 0.29, H + 0.015), "sheet_paint", 0.004)
    for sx in (-1, 1):
        x = sx * (W / 2 + 0.035)
        k.box(f"guide{sx}", (0.07, 0.07, H), (x, 0.035, H / 2), "zinc", 0.004)
        k.box(f"slot{sx}", (0.025, 0.04, H - 0.01), (x - sx * 0.022, 0.05, H / 2), "dark", 0, detail=True)


def roller_slats(k):
    """0.5 m of roller-shutter curtain (6 interlocking slats), 2.4 m wide: stacked to any height."""
    W = SHOP_W
    pitch = 0.5 / 6
    for i in range(6):
        z = i * pitch
        prof = [(0.03, z + 0.004), (0.045, z + 0.02), (0.05, z + pitch * 0.5), (0.045, z + pitch - 0.02), (0.03, z + pitch - 0.004), (0.022, z + pitch - 0.004), (0.022, z + 0.004)]
        k.prism(f"slat{i}", prof, -W / 2, W / 2, "sheet_paint", 0.002, seg=1)


def roller_bottom(k):
    """Bottom rail of a roller shutter with lifting handles and a lock."""
    W = SHOP_W
    k.box("rail", (W, 0.05, 0.06), (0, 0.04, 0.03), "zinc", 0.005)
    for x in (-W / 3, W / 3):
        k.box(f"handle{x}", (0.12, 0.03, 0.02), (x, 0.075, 0.09), "iron", 0.005, detail=True)
    k.box("lock", (0.05, 0.02, 0.05), (0, 0.07, 0.03), "iron", 0.004, detail=True)


# ---- Trims and courses (1 m modules) --------------------------------------------------------------

def cornice(k):
    """Eaves cornice: bed mould, corona with a drip, cymatium. 0.34 m tall, 0.19 m proud."""
    p = [(-0.03, 0.0), (0.025, 0.0), (0.025, 0.025), (0.045, 0.035), (0.06, 0.05), (0.07, 0.07), (0.076, 0.09), (0.165, 0.105)]
    p += [(0.165, 0.112), (0.18, 0.112), (0.18, 0.21), (0.19, 0.215), (0.19, 0.235)]
    p += [(0.185, 0.25), (0.172, 0.268), (0.155, 0.285), (0.135, 0.3), (0.118, 0.318), (0.105, 0.335), (0.1, 0.345), (-0.03, 0.345)]
    if not k.fine:
        p = [p[0], p[1], p[6], p[7], p[10], p[12], p[-2], p[-1]]
    k.prism("cornice", p, -0.5 + 0.002, 0.5 - 0.002, "stone", 0.004)


def string_course(k):
    p = [(-0.03, 0.0), (0.035, 0.0), (0.06, 0.03), (0.065, 0.085), (0.06, 0.1), (0.045, 0.12), (0.03, 0.15), (-0.03, 0.15)]
    k.prism("course", p, -0.5 + 0.002, 0.5 - 0.002, "stone", 0.005)


def plinth_course(k):
    p = [(-0.03, 0.0), (0.055, 0.0), (0.055, 0.52), (0.04, 0.55), (0.012, 0.6), (-0.03, 0.6)]
    k.prism("plinth", p, -0.5 + 0.002, 0.5 - 0.002, "stone", 0.006)


def _quoin(k, L):
    k.box("block", (L - 0.004, 0.06, 0.296), (0, 0.02, 0.15), "stone", 0.014, seg=1)
    if k.fine:
        # Rock-faced boss inside the chamfered margin.
        k.box("boss", (L - 0.07, 0.012, 0.23), (0, 0.054, 0.15), "stone", 0.01, seg=2)


def quoin_long(k):
    _quoin(k, 0.56)


def quoin_short(k):
    _quoin(k, 0.3)


def corbel(k):
    """Scrolled console bracket (0.13 wide, 0.3 tall, 0.16 proud)."""
    n = 6 if k.fine else 2
    pts = [(-0.02, 0.3), (0.16, 0.3)] + arc(0.06, 0.255, 0.1, 0.0, -math.pi / 2, n) + [(0.03, 0.0), (-0.02, 0.0)]
    k.prism("corbel", pts, -0.065, 0.065, "stone", 0.006)


# ---- Eaves, rainwater, roofs -------------------------------------------------------------------------

def gutter(k):
    """1 m of 125 mm half-round gutter with a bracket; origin at the back top edge (fascia line)."""
    r, t = 0.0625, 0.0035
    n = 10 if k.fine else 5
    outer = arc(0.0675, 0.0, r, math.pi, 2 * math.pi, n)
    inner = arc(0.0675, 0.0, r - t, 2 * math.pi, math.pi, n)
    k.prism("gutter", outer + inner, -0.5, 0.5, "zinc", 0)
    k.cyl("bead", 0.006, (-0.5, 0.0675 + r, 0.002), (0.5, 0.0675 + r, 0.002), "zinc", verts=6)
    if k.fine:
        band = arc(0.0675, 0.0, r + 0.004, math.pi, 2 * math.pi, 8) + arc(0.0675, 0.0, r, 2 * math.pi, math.pi, 8)
        k.prism("bracket", band, -0.015, 0.015, "iron", 0)
        k.box("bracket_arm", (0.03, 0.012, 0.004), (0, -0.002, 0.002), "iron", 0)


def downpipe(k):
    """1 m of 75 mm downpipe 60 mm off the wall, socket and fixing band at the top."""
    y = 0.065
    k.cyl("pipe", 0.0375, (0, y, 0.0), (0, y, 1.0), "zinc", verts=12 if k.fine else 6)
    k.cyl("socket", 0.042, (0, y, 0.92), (0, y, 1.0), "zinc", verts=12 if k.fine else 6)
    if k.fine:
        k.box("ear", (0.12, 0.012, 0.03), (0, 0.022, 0.96), "iron", 0.003)
        k.box("spacer", (0.02, 0.03, 0.03), (0, 0.012, 0.96), "iron", 0.003)


def downpipe_shoe(k):
    """Bottom of a downpipe: a shoe kicking the water away from the wall foot."""
    y = 0.065
    k.cyl("pipe", 0.0375, (0, y, 0.12), (0, y, 0.5), "zinc", verts=12 if k.fine else 6)
    k.cyl("shoe", 0.0375, (0, y, 0.135), (0, y + 0.13, 0.03), "zinc", verts=12 if k.fine else 6)


def downpipe_head(k):
    """Hopper head under the gutter outlet."""
    pts = [(-0.12, 0.0), (0.12, 0.0), (0.1, 0.17), (-0.1, 0.17)]
    k.prism_y("hopper", pts, 0.0, 0.15, "zinc", 0.004)
    xform(k.parts[-1:], Matrix.Translation((0, 0, -0.17)))
    k.prism_z("rim", [(-0.13, 0.0), (0.13, 0.0), (0.13, 0.16), (-0.13, 0.16)], 0.0, 0.02, "zinc", 0.004)
    k.cyl("neck", 0.0375, (0, 0.065, -0.17), (0, 0.065, -0.3), "zinc", verts=12 if k.fine else 6)


def fascia(k):
    k.box("fascia", (1.0 - 0.003, 0.025, 0.2), (0, 0.0125, -0.1), "timber_paint", 0.005)


def ridge_clay(k):
    """1 m of half-round clay ridge tiles (two 0.5 m tiles) bedded on mortar; origin at the apex."""
    r, t = 0.12, 0.016
    n = 10 if k.fine else 5
    for i, x0 in enumerate((-0.5, 0.0)):
        rr = r + (0.006 if i else 0)
        outer = arc(0.0, -0.03, rr, 0.0, math.pi, n)
        inner = arc(0.0, -0.03, rr - t, math.pi, 0.0, n)
        pts = [(y, z) for y, z in outer + inner]
        k.prism(f"tile{i}", pts, x0 + 0.003, x0 + 0.5 - 0.003, "clay", 0)
    for sy in (-1, 1):
        k.box(f"bed{sy}", (1.0, 0.05, 0.05), (0, sy * 0.1, -0.05), "render", 0.01, detail=False)


def _roof_panel(k, cell, exposure, slab, joints, seed):
    """1 m x 1 m of roof covering in a wall-like frame: X along the eaves, Z up the slope,
    Y out of the roof. Each course is tipped so its tail rests on the course below."""
    rr = random.Random(seed)
    n = int(round(1.0 / exposure))
    for c in range(n):
        z0 = c * exposure
        top = z0 + exposure + 0.03
        i0 = since(k)
        if k.fine:
            stag = (c % 2) * 0.5 / joints
            xs = [-0.5] + [-0.5 + stag + i / joints for i in range(joints + 1) if -0.49 < -0.5 + stag + i / joints < 0.49] + [0.5]
            for i in range(len(xs) - 1):
                k.box(f"s{c}_{i}", (xs[i + 1] - xs[i] - 0.004, slab, exposure + 0.03), ((xs[i] + xs[i + 1]) / 2, slab / 2 + 0.002 + rr.uniform(0, 0.003), z0 + (exposure + 0.03) / 2), cell, 0)
        else:
            k.box(f"c{c}", (1.0, slab, exposure + 0.03), (0, slab / 2 + 0.002, z0 + (exposure + 0.03) / 2), cell, 0)
        rot(new(k, i0), math.degrees(math.atan2(slab, exposure)), "X", (0, 0.002, top))


def roof_slate(k):
    _roof_panel(k, "slate", 0.2, 0.012, 4, 3)


def roof_clay(k):
    """1 m x 1 m of clay pantiles: S-profile courses (0.33 m exposure, 4 rolls per metre)."""
    n = 3
    waves = 4
    seg = 6 if k.fine else 3
    for c in range(n):
        z0 = c / n
        top = []
        for i in range(waves * seg + 1):
            x = -0.5 + i / (waves * seg)
            ph = (x + 0.5) * waves * 2 * math.pi
            top.append((x, 0.035 + 0.028 * math.sin(ph) + 0.01 * math.sin(2 * ph)))
        bottom = [(x, y - 0.014) for x, y in reversed(top)]
        i0 = since(k)
        k.prism_z(f"course{c}", top + bottom, z0, z0 + 1 / n + 0.04, "clay", 0)
        rot(new(k, i0), 3.0, "X", (0, 0.0, z0 + 1 / n + 0.04))


def chimney_stack(k):
    """1 m of brick stack 0.62 x 0.5 (stacked; set into the roof)."""
    k.box("stack", (0.62, 0.5, 1.0), (0, 0, 0.5), "brick", 0.006, seg=1)


def chimney_stack_stone(k):
    k.box("stack", (0.66, 0.54, 1.0), (0, 0, 0.5), "rubble_wall", 0.008, seg=1)


def chimney_cap(k):
    """Oversailing courses, sloped flaunching and two clay pots on top of a stack."""
    k.box("course1", (0.7, 0.58, 0.08), (0, 0, 0.04), "brick", 0.006, seg=1)
    k.box("course2", (0.78, 0.66, 0.08), (0, 0, 0.12), "brick", 0.006, seg=1)
    k.prism_z("slab", [(-0.4, -0.34), (0.4, -0.34), (0.4, 0.34), (-0.4, 0.34)], 0.16, 0.22, "concrete", 0.008)
    k.prism_z("flaunch", [(-0.32, -0.27), (0.32, -0.27), (0.32, 0.27), (-0.32, 0.27)], 0.22, 0.27, "render", 0.02, seg=2)
    for x in (-0.15, 0.15):
        k.cyl(f"pot{x}", 0.11, (x, 0, 0.25), (x, 0, 0.62), "clay", r2=0.09, verts=12 if k.fine else 6)
        k.cyl(f"rim{x}", 0.11, (x, 0, 0.6), (x, 0, 0.65), "clay", verts=12 if k.fine else 6)
        k.cyl(f"flue{x}", 0.075, (x, 0, 0.63), (x, 0, 0.652), "dark", verts=10 if k.fine else 5)


# ---- Balconies ------------------------------------------------------------------------------------

def balcony_slab(k):
    """2.0 x 1.0 cantilevered slab: top at z = 0, moulded nosing, two scrolled consoles."""
    W, D = 2.0, 1.0
    k.box("slab", (W, D, 0.14), (0, D / 2, -0.07), "concrete", 0.01)
    k.prism("nose", [(D - 0.01, -0.16), (D + 0.04, -0.16), (D + 0.04, -0.12), (D + 0.02, -0.1), (D + 0.02, -0.01), (D - 0.01, -0.01)], -W / 2 - 0.02, W / 2 + 0.02, "concrete", 0.006)
    for sx in (-1, 1):
        pts = [(0.0, -0.14), (0.7, -0.14), (0.62, -0.2), (0.4, -0.3), (0.2, -0.42), (0.06, -0.5), (0.0, -0.5)]
        k.prism(f"console{sx}", [(y, z) for y, z in pts], sx * 0.7 - 0.07, sx * 0.7 + 0.07, "concrete", 0.01)


def balcony_rail(k):
    """1 m of wrought-iron railing, 1.0 m tall: handrail, base rail, balusters with collars."""
    H = 1.0
    k.box("toprail", (1.0, 0.045, 0.012), (0, 0, H - 0.03), "iron", 0.003)
    k.cyl("handrail", 0.022, (-0.5, 0, H - 0.012), (0.5, 0, H - 0.012), "iron", verts=10 if k.fine else 5)
    k.box("base", (1.0, 0.04, 0.012), (0, 0, 0.09), "iron", 0.003)
    k.box("mid", (1.0, 0.02, 0.01), (0, 0, 0.24), "iron", 0.002, detail=True)
    n = 9
    for i in range(n):
        x = -0.5 + (i + 0.5) / n
        k.box(f"bal{i}", (0.014, 0.014, H - 0.1), (x, 0, 0.05 + (H - 0.1) / 2), "iron", 0.002)
        if k.fine and i % 2 == 0:
            k.cyl(f"col{i}", 0.016, (x, 0, 0.56), (x, 0, 0.6), "iron", verts=8)


def balcony_post(k):
    k.box("post", (0.05, 0.05, 1.05), (0, 0, 0.525), "iron", 0.005)
    k.cyl("finial", 0.03, (0, 0, 1.05), (0, 0, 1.11), "iron", verts=8, r2=0.012)


# ---- Steps --------------------------------------------------------------------------------------

def steps_3(k):
    """Three-riser stone stoop (0.51 m) in front of a door, rubble cheek walls with copings."""
    W = 1.4
    for i in range(3):
        d = 0.9 - 0.3 * i
        z1 = 0.17 * (i + 1)
        pts = [(-0.04, 0.0), (d, 0.0), (d, z1 - 0.025), (d - 0.025, z1), (-0.04, z1)]
        k.prism(f"step{i}", pts, -W / 2, W / 2, "stone", 0.006)
    for sx in (-1, 1):
        x = sx * (W / 2 + 0.14)
        k.prism_y(f"cheek{sx}", [(x - 0.14, 0.0), (x + 0.14, 0.0), (x + 0.14, 0.6), (x - 0.14, 0.6)], -0.04, 0.92, "rubble_wall", 0.01)
        k.box(f"cope{sx}", (0.34, 0.98, 0.08), (x, 0.45, 0.64), "stone", 0.01)


def step_block(k):
    k.prism("step", [(0.0, 0.0), (0.35, 0.0), (0.35, 0.15), (0.33, 0.17), (0.0, 0.17)], -0.5 + 0.002, 0.5 - 0.002, "stone", 0.006)


# ---- Gameplay-height cover ---------------------------------------------------------------------------

def coping_low(k):
    """Vault marker: pale dressed capstone (1 m x 0.5 m x 0.12 m), cambered top, drip grooves.
    Origin bottom centre; it sits on top of any low-cover wall (top at LOW)."""
    p = [(-0.25, 0.0), (-0.22, 0.0), (-0.215, 0.012), (-0.205, 0.0), (0.205, 0.0), (0.215, 0.012), (0.22, 0.0), (0.25, 0.0), (0.25, 0.085), (0.12, 0.11), (0.0, 0.12), (-0.12, 0.11), (-0.25, 0.085)]
    if not k.fine:
        p = [(-0.25, 0.0), (0.25, 0.0), (0.25, 0.085), (0.0, 0.12), (-0.25, 0.085)]
    k.prism("cope", [(y, z) for y, z in p], -0.5 + 0.003, 0.5 - 0.003, "stone", 0.008)


def coping_mantle(k):
    """Mantle marker: bull-nosed concrete coping with a steel nosing on both edges, 0.1 m tall,
    overhanging 40 mm (a hand-hold line you can read from across the street)."""
    n = 4 if k.fine else 1
    front = arc(0.25, 0.05, 0.05, -math.pi / 2, math.pi / 2, n)
    back = arc(-0.25, 0.05, 0.05, math.pi / 2, 3 * math.pi / 2, n)
    k.prism("cope", [(y, z) for y, z in front + back], -0.5 + 0.003, 0.5 - 0.003, "concrete", 0.004)
    for sy in (-1, 1):
        k.box(f"nosing{sy}", (1.0 - 0.006, 0.012, 0.03), (0, sy * 0.296, 0.015), "iron", 0.002)


def lowwall(k):
    """1 m of rubble-stone wall, 0.45 thick, battered, with its capstone: top at LOW (1.0 m)."""
    h = LOW - 0.12
    k.prism_y("wall", [(-0.5 + 0.002, 0.0), (0.5 - 0.002, 0.0), (0.5 - 0.002, h), (-0.5 + 0.002, h)], -0.225, 0.225, "rubble_wall", 0.012, seg=1)
    i0 = since(k)
    coping_low(k)
    xform(new(k, i0), Matrix.Translation((0, 0, h)))


def wall_mantle(k):
    """1 m of rubble wall with the mantle coping: top at MANTLE (1.8 m)."""
    h = MANTLE - 0.1
    k.prism_y("wall", [(-0.5 + 0.002, 0.0), (0.5 - 0.002, 0.0), (0.5 - 0.002, h), (-0.5 + 0.002, h)], -0.25, 0.25, "rubble_wall", 0.012, seg=1)
    i0 = since(k)
    coping_mantle(k)
    xform(new(k, i0), Matrix.Translation((0, 0, h)))


def sandbag_row(k):
    """1 m of sandbag wall, 0.6 m deep, six courses to LOW (1.0 m), stretcher / header bond."""
    rr = random.Random(11)
    ch = LOW / 6
    for c in range(6):
        z = c * ch + ch / 2
        if c % 2 == 0:
            for i, x in enumerate((-0.25, 0.25)):
                for y in (-0.15, 0.15):
                    k.pillow(f"bag{c}{i}{y}", (0.52, 0.31, ch * 1.12), (x + rr.uniform(-0.02, 0.02), y, z), "hessian", rr.uniform(-0.06, 0.06))
        else:
            for x in (-0.34, 0.0, 0.34):
                k.pillow(f"bag{c}{x}", (0.62, 0.34, ch * 1.12), (x, rr.uniform(-0.02, 0.02), z), "hessian", math.pi / 2 + rr.uniform(-0.06, 0.06))


def crate_cover(k):
    """1 m wooden crate (vault height): planked faces, corner and edge battens."""
    s = 1.0
    k.box("core", (s - 0.04, s - 0.04, s - 0.04), (0, 0, s / 2), "timber_raw", 0.004)
    b = 0.07
    for x in (-1, 1):
        for y in (-1, 1):
            k.box(f"post{x}{y}", (b, b, s), (x * (s / 2 - b / 2), y * (s / 2 - b / 2), s / 2), "timber_raw", 0.008)
    for z in (b / 2, s - b / 2):
        for y in (-1, 1):
            k.box(f"rx{z}{y}", (s - 2 * b, b, b), (0, y * (s / 2 - b / 2), z), "timber_raw", 0.008)
        for x in (-1, 1):
            k.box(f"ry{z}{x}", (b, s - 2 * b, b), (x * (s / 2 - b / 2), 0, z), "timber_raw", 0.008)
    for y in (-1, 1):
        length = math.hypot(s - 2 * b, s - 2 * b)
        k.box(f"diag{y}", (length, 0.025, b * 0.9), (0, y * (s / 2 - 0.0125), s / 2), "timber_raw", 0.006, rot=(45, "Y"))
        if k.fine:
            for i in range(1, 4):
                k.box(f"gap{y}{i}", (s - 0.06, 0.006, 0.006), (0, y * (s / 2 - 0.018), i * s / 4), "dark", 0)


def rubble_low(k):
    """Rubble mound (1.6 x 1.2, 0.9 m): broken masonry lumps and brick bits, vaultable."""
    rr = random.Random(5)
    lumps = [((0.0, 0.0, 0.0), (1.1, 0.9, 0.9)), ((-0.45, 0.2, 0.0), (0.7, 0.6, 0.55)), ((0.5, -0.15, 0.0), (0.7, 0.7, 0.6))]
    for i, (p, s) in enumerate(lumps):
        k.rock(f"core{i}", s, p, "debris", 30 + i)
    for i in range(10 if k.fine else 5):
        a = rr.uniform(0, 6.28)
        rad = rr.uniform(0.35, 0.75)
        p = (math.cos(a) * rad, math.sin(a) * rad * 0.7, rr.uniform(0.0, 0.25))
        sz = rr.uniform(0.18, 0.35)
        k.rock(f"lump{i}", (sz, sz * 0.8, sz * 0.6), p, "stone" if i % 3 else "debris", 50 + i)
    for i in range(6 if k.fine else 2):
        a = rr.uniform(0, 6.28)
        k.box(f"brick{i}", (0.215, 0.1, 0.065), (math.cos(a) * 0.6, math.sin(a) * 0.45, rr.uniform(0.15, 0.5)), "brick", 0.004, rot=(rr.uniform(-40, 40), "X"))
    k.box("beam", (1.5, 0.12, 0.1), (0.1, 0.1, 0.55), "timber_raw", 0.008, rot=(18, "Y"))


def fence_timber(k):
    """1 m of picket fence at LOW: a post, two rails, six pointed pales."""
    k.box("post", (0.09, 0.09, LOW + 0.05), (-0.5 + 0.045, -0.06, (LOW + 0.05) / 2), "timber_raw", 0.008)
    for z in (0.22, 0.78):
        k.box(f"rail{z}", (1.0, 0.03, 0.08), (0, -0.03, z), "timber_raw", 0.006)
    for i in range(6):
        x = -0.5 + 0.12 + i * 0.16
        k.prism_y(f"pale{i}", [(x - 0.035, 0.04), (x + 0.035, 0.04), (x + 0.035, LOW - 0.06), (x, LOW), (x - 0.035, LOW - 0.06)], 0.0, 0.022, "timber_raw", 0.004)


# ---- Registry ---------------------------------------------------------------------------------------
# name: (builder, bake context). Context: ("hole", w, h, y_bottom) wall with an opening,
# ("wall",) plain wall behind, ("ground",) ground plane under, ("wallground",) both, None.

PIECES = {
    "win_casement": (win_casement, ("hole", WIN_W, WIN_H, 0.0)),
    "win_casement_broken": (win_casement_broken, ("hole", WIN_W, WIN_H, 0.0)),
    "win_sill": (win_sill, ("hole", WIN_W, WIN_H, 0.0)),
    "win_lintel": (win_lintel, ("hole", WIN_W, WIN_H, 0.0)),
    "win_lintel_key": (win_lintel_key, ("hole", WIN_W, WIN_H, 0.0)),
    "win_surround": (win_surround, ("hole", WIN_W, WIN_H, 0.0)),
    "shutters_open": (shutters_open, ("hole", WIN_W, WIN_H, 0.0)),
    "louvres_open": (louvres_open, ("hole", WIN_W, WIN_H, 0.0)),
    "shutters_closed": (shutters_closed, ("hole", WIN_W, WIN_H, 0.0)),
    "louvres_closed": (louvres_closed, ("hole", WIN_W, WIN_H, 0.0)),
    "shutter_hanging": (shutter_hanging, ("hole", WIN_W, WIN_H, 0.0)),
    "win_boarded": (win_boarded, ("hole", WIN_W, WIN_H, 0.0)),
    "win_bricked": (win_bricked, ("hole", WIN_W, WIN_H, 0.0)),
    "win_bars": (win_bars, ("hole", WIN_W, WIN_H, 0.0)),
    "door_frame": (door_frame, ("hole", DOOR_W, DOOR_H, 0.0)),
    "door_surround": (door_surround, ("hole", DOOR_W, DOOR_H, 0.0)),
    "door_leaf_panel": (door_leaf_panel, None),
    "door_leaf_plank": (door_leaf_plank, None),
    "door_leaf_metal": (door_leaf_metal, None),
    "door_step": (door_step, ("wallground",)),
    "door_lamp": (door_lamp, ("wall",)),
    "shopfront": (shopfront, ("hole", SHOP_W, SHOP_H, 0.0)),
    "roller_box": (roller_box, ("hole", SHOP_W, SHOP_H, 0.0)),
    "roller_slats": (roller_slats, None),
    "roller_bottom": (roller_bottom, None),
    "cornice": (cornice, ("wall",)),
    "string_course": (string_course, ("wall",)),
    "plinth_course": (plinth_course, ("wallground",)),
    "quoin_long": (quoin_long, ("wall",)),
    "quoin_short": (quoin_short, ("wall",)),
    "corbel": (corbel, ("wall",)),
    "gutter": (gutter, None),
    "downpipe": (downpipe, ("wall",)),
    "downpipe_shoe": (downpipe_shoe, ("wallground",)),
    "downpipe_head": (downpipe_head, ("wall",)),
    "fascia": (fascia, None),
    "ridge_clay": (ridge_clay, None),
    "roof_slate": (roof_slate, None),
    "roof_clay": (roof_clay, None),
    "chimney_stack": (chimney_stack, None),
    "chimney_stack_stone": (chimney_stack_stone, None),
    "chimney_cap": (chimney_cap, None),
    "balcony_slab": (balcony_slab, ("wall",)),
    "balcony_rail": (balcony_rail, None),
    "balcony_post": (balcony_post, None),
    "steps_3": (steps_3, ("wallground",)),
    "step_block": (step_block, ("ground",)),
    "coping_low": (coping_low, None),
    "coping_mantle": (coping_mantle, None),
    "lowwall": (lowwall, ("ground",)),
    "wall_mantle": (wall_mantle, ("ground",)),
    "sandbag_row": (sandbag_row, ("ground",)),
    "crate_cover": (crate_cover, ("ground",)),
    "rubble_low": (rubble_low, ("ground",)),
    "fence_timber": (fence_timber, ("ground",)),
}
