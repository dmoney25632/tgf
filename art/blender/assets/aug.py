"""Steyr AUG A1 (5.56 bullpup), modelled from public reference dimensions.

Overall ~790 mm, 508 mm barrel, ~280 mm tall with mag, OD-green polymer stock,
integrated 1.5x optic / carry handle, folding vertical foregrip (deployed),
smoked transparent 30-round magazine behind the grip, closed-prong flash hider.
Bore axis at z = 0, muzzle at max +Y. Layout matches the game's procedural
buildAug (proc -Z * 0.963 == +Y here) so the length fit lines features up.
The stock, grip, trigger-guard loop and butt plate are lofted cages smoothed by a
level-2 Subdivision Surface (applied before the join). Two shipped meshes: `aug` (everything) and `mag`.
"""
import math

import bmesh
import bpy
from mathutils import Vector

from tgf import export, materials as M
from tgf.model import box, cut, cyl, profile, rotate, tube
from tgf import scene as sc

Y_MUZZLE = 0.51
OPTIC_Z = 0.066


def _ring(n, hw, zc, hz, x_of=None, exp_top=3.2, exp_bot=2.6):
    """Superellipse cross-section (x, z) with n verts (n % 4 == 0 puts verts on the axes)."""
    pts = []
    for k in range(n):
        t = 2 * math.pi * k / n
        c, s = math.cos(t), math.sin(t)
        e = exp_top if s >= 0 else exp_bot
        x = hw * math.copysign(abs(c) ** (2 / e), c)
        z = hz * math.copysign(abs(s) ** (2 / e), s)
        if x_of:
            x = x_of(x, z / hz if hz else 0.0)
        pts.append((x, zc + z))
    return pts


def _loft(name, rings, mat, levels=2, cap=True):
    """Skin a list of closed rings (each a list of 3D points, same count) into a quad cage
    and smooth it with a Subdivision Surface: a moulded, bulging shell instead of a slab."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    vs = [[bm.verts.new(p) for p in r] for r in rings]
    n = len(rings[0])
    for a, b in zip(vs, vs[1:]):
        for k in range(n):
            bm.faces.new((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]))
    if cap:
        bm.faces.new(vs[0][::-1])
        bm.faces.new(vs[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(mat)
    o.data.shade_smooth()
    m = o.modifiers.new("Subsurf", "SUBSURF")
    m.levels = levels
    m.render_levels = levels
    m.quality = 3
    return o


def _cut_after(target, cutter):
    """Boolean difference evaluated AFTER the subdivision (cut() would put it first)."""
    m = target.modifiers.new("Cut_" + cutter.name, "BOOLEAN")
    m.operation = "DIFFERENCE"
    m.object = cutter
    m.solver = "EXACT"
    cutter.hide_render = True
    cutter.hide_set(True)


def _sweep(name, path, half_w, half_t, mat, n=8, exp=3.0):
    """Rounded-rectangle tube swept along a (y, z) path in the YZ plane, subdivided smooth."""
    rings = []
    for i, (y, z) in enumerate(path):
        y0, z0 = path[max(i - 1, 0)]
        y1, z1 = path[min(i + 1, len(path) - 1)]
        ty, tz = y1 - y0, z1 - z0
        L = math.hypot(ty, tz)
        ny, nz = -tz / L, ty / L
        r = []
        for x, d in _ring(n, half_w, 0.0, half_t, exp_top=exp, exp_bot=exp):
            r.append((x, y + ny * d, z + nz * d))
        rings.append(r)
    return _loft(name, rings, mat)


def _smooth(t0, t1, t):
    t = min(1.0, max(0.0, (t - t0) / (t1 - t0)))
    return t * t * (3 - 2 * t)


def build(ctx):
    od = M.pbr("aug_polymer_od", "polymer_od", base=(0.036, 0.045, 0.02), scale=150)
    blk = M.pbr("aug_polymer_black", "polymer_black", scale=150)
    anod = M.pbr("aug_anodized", "anodized_black", base=(0.03, 0.031, 0.03), wear=0.5)
    barrel_m = M.pbr("aug_barrel", "parkerized", wear=0.7)
    steel = M.pbr("aug_steel", "steel_bare")
    rubber = M.pbr("aug_rubber", "rubber")
    glass = M.pbr("aug_glass", "glass_lens")
    red = M.pbr("aug_red", None, base=(0.35, 0.03, 0.02), metallic=0.0, roughness=0.5, wear=0.2)
    smoke = M.pbr("aug_mag_smoke", None, base=(0.075, 0.072, 0.062), metallic=0.0, roughness=0.18, wear=0.15, scale=200)
    brass = M.pbr("aug_brass_seen", None, base=(0.2, 0.135, 0.05), metallic=0.6, roughness=0.32, wear=0.0)
    parts = []
    add = parts.append

    # ---------------------------------------------------------------- stock
    # Moulded polymer shell: a low-poly superellipse cage lofted butt -> nose and smoothed by a
    # level-2 Subdivision Surface, so the cheeks bulge, the top rounds over into the receiver
    # and the belly tapers down into the grip. Doubled stations at the ends are support loops.
    # (y, z_top, z_bottom, half_width)
    st = [
        (-0.270, 0.004, -0.079, 0.0255),
        (-0.266, 0.010, -0.083, 0.0275),
        (-0.255, 0.017, -0.086, 0.0285),
        (-0.230, 0.022, -0.083, 0.0290),
        (-0.190, 0.025, -0.077, 0.0290),
        (-0.100, 0.026, -0.066, 0.0285),
        (-0.050, 0.026, -0.064, 0.0280),
        (-0.010, 0.026, -0.058, 0.0272),
        (0.025, 0.026, -0.042, 0.0265),
        (0.095, 0.025, -0.027, 0.0258),
        (0.114, 0.023, -0.024, 0.0250),
        (0.121, 0.019, -0.018, 0.0225),
        (0.124, 0.012, -0.010, 0.0180),
    ]

    def cheek(y):  # moulded cheek-weld swell over the rear half of the stock
        return 0.0042 * _smooth(-0.255, -0.215, y) * (1 - _smooth(-0.12, -0.075, y))

    rings = []
    for y, zt, zb, hw in st:
        sw = cheek(y)

        def xo(x, zn, sw=sw):
            bulge = sw * math.exp(-((zn - 0.3) / 0.45) ** 2)
            return math.copysign(abs(x) + bulge, x) if x else x

        rings.append([(x, y, z) for x, z in _ring(12, hw, (zt + zb) / 2, (zt - zb) / 2, xo, 3.6, 2.5)])
    stock = _loft("stock", rings, od)
    # Ejection port (right) right behind the mag, with the bolt face visible inside.
    _cut_after(stock, box("port_cut", (0.03, 0.045, 0.016), (0.036, -0.135, 0.004), bevel=0))
    export.apply_modifiers([stock])
    add(stock)
    add(box("bolt_face", (0.044, 0.05, 0.02), (0.0, -0.135, 0.004), steel, bevel=0.001))

    def surf_x(y, z, side):
        """Outer skin x of the smoothed stock at (y, z) on one side (raycast)."""
        ok, loc, *_ = stock.ray_cast(Vector((side * 0.2, y, z)), Vector((-side, 0, 0)))
        return loc.x if ok else side * 0.027

    # Parting seam between the stock halves: a fine bead following the skin on both sides.
    for side in (-1, 1):
        path = []
        for i in range(32):
            y = -0.262 + i * (0.38 / 31)
            z = -0.008
            path.append((surf_x(y, z, side) - side * 0.0002, y, z))
        rs = []
        for i, (x, y, z) in enumerate(path):
            rs.append([(x + side * 0.0006 * math.cos(a * math.pi / 2), y, z + 0.0006 * math.sin(a * math.pi / 2)) for a in range(4)])
        seam = _loft(f"seam{side}", rs, od, levels=0)
        add(seam)
    # Left side: closed ejection port cover (the rifle converts for lefties).
    xl = surf_x(-0.135, 0.003, -1)
    add(profile("port_cover_l", [(-0.16, -0.005), (-0.11, -0.005), (-0.106, 0.012), (-0.164, 0.012)], 0.003, (xl + 0.0008, 0, 0), blk, bevel=0.001))
    brings = []
    for y, zt, zb, hw in [(-0.262, 0.012, -0.082, 0.026), (-0.272, 0.013, -0.086, 0.0288),
                          (-0.2805, 0.009, -0.083, 0.027), (-0.2815, 0.004, -0.078, 0.022)]:
        brings.append([(x, y, z) for x, z in _ring(12, hw, (zt + zb) / 2, (zt - zb) / 2, None, 3.6, 2.8)])
    butt = _loft("butt_plate", brings, blk)
    add(butt)
    # Mag release (behind the well) and bolt release under the stock.
    add(box("mag_release", (0.022, 0.012, 0.006), (0, -0.1, -0.066), blk, bevel=0.0018))
    add(box("bolt_release", (0.012, 0.016, 0.004), (0, -0.2, -0.077), blk, bevel=0.0012))
    # Rear sling slot boss.
    add(cyl("sling_boss", 0.006, 0.064, (0, -0.25, -0.064), "X", blk, bevel=0.001, verts=16))

    # --------------------------------------------------- grip + hand guard
    # Grip: lofted, raked 11 deg, palm swell at the back, flared heel.
    rake = math.radians(11)
    dy, dz = -math.sin(rake), -math.cos(rake)
    grings = []
    for s_, hd, hw, sw in [(-0.12, 0.018, 0.016, 0.0), (0.0, 0.018, 0.0158, 0.0), (0.2, 0.0175, 0.0155, 0.002),
                           (0.45, 0.0175, 0.0158, 0.0035), (0.7, 0.0175, 0.0158, 0.003), (0.94, 0.0185, 0.016, 0.0),
                           (1.0, 0.016, 0.013, 0.0)]:
        cy, cz = 0.02 + dy * 0.098 * s_, -0.03 + dz * 0.098 * s_
        r = []
        for x, d in _ring(12, hw, 0.0, hd, exp_top=3.0, exp_bot=3.0):
            d2 = d - sw if d < 0 else d  # d < 0 = back strap: palm swell
            # depth axis is along the bore (perpendicular to the raked grip axis)
            r.append((x, cy - dz * d2, cz + dy * d2))
        grings.append(r)
    grip = _loft("grip", grings, od)
    add(grip)
    # The AUG's full-hand trigger guard: one continuous moulded loop, rounded section,
    # from inside the stock nose down and back into the grip heel.
    guard_path = [
        (0.094, -0.010), (0.106, -0.03), (0.107, -0.058), (0.1, -0.086), (0.084, -0.107),
        (0.056, -0.118), (0.022, -0.12), (-0.014, -0.116),
    ]
    add(_sweep("hand_guard", guard_path, 0.0125, 0.0085, od, n=8))
    trig = profile("trigger", [(0.05, -0.028), (0.056, -0.028), (0.054, -0.044), (0.047, -0.06), (0.043, -0.058), (0.049, -0.043)], 0.007, mat=blk, bevel=0.0013)
    add(trig)
    # Crossbolt safety through the stock above the trigger (red = fire side).
    add(cyl("safety", 0.0055, 0.064, (0, 0.058, -0.019), "X", blk, bevel=0.0012, verts=20))
    add(cyl("safety_red", 0.0056, 0.003, (-0.0315, 0.058, -0.019), "X", red, bevel=0.0006, verts=20))

    # ------------------------------------------------------------ receiver
    rec = profile("receiver", [(-0.076, 0.012), (0.118, 0.012), (0.118, 0.031), (-0.07, 0.031), (-0.078, 0.025)], 0.04, mat=anod, bevel=0.004)
    add(rec)
    # Charging-handle slot along the left of the receiver.
    cut(rec, box("ch_slot", (0.01, 0.14, 0.004), (-0.02, 0.04, 0.0265), bevel=0))
    # Barrel socket (front block ahead of the stock).
    front = box("rec_front", (0.042, 0.032, 0.052), (0, 0.131, 0.006), anod, bevel=0.007, seg=4)
    add(front)
    add(cyl("barrel_release", 0.0045, 0.006, (-0.022, 0.124, -0.008), "X", blk, bevel=0.001, verts=16))
    # Charging handle (left, forward) folded knob.
    add(box("ch_stem", (0.012, 0.008, 0.006), (-0.025, 0.112, 0.0265), steel, bevel=0.0012))
    add(cyl("ch_knob", 0.0055, 0.014, (-0.036, 0.112, 0.0265), "X", blk, bevel=0.0015, verts=16, r2=0.0048))

    # ------------------------------------------------------ barrel group
    add(cyl("barrel_collar", 0.0195, 0.016, (0, 0.155, 0.0), "Y", anod, bevel=0.002, verts=24))
    ring = cyl("lock_ring", 0.017, 0.012, (0, 0.168, 0.0), "Y", barrel_m, bevel=0.0015, verts=24)
    for i in range(6):
        k = box(f"lock_k{i}", (0.003, 0.014, 0.004), (0, 0.168, 0.0172), bevel=0)
        rotate(k, i * 60, "Y", (0, 0.168, 0))
        cut(ring, k)
    add(ring)
    bar, _ = tube("barrel_rear", 0.0125, 0.0028, 0.06, (0, 0.205, 0.0), "Y", barrel_m)
    add(bar)
    bar2, _ = tube("barrel", 0.0098, 0.0028, 0.234, (0, 0.348, 0.0), "Y", barrel_m)
    add(bar2)
    # Gas block with regulator knob on top, gas cylinder back to the receiver.
    gb = box("gas_block", (0.028, 0.028, 0.038), (0, 0.238, 0.008), barrel_m, bevel=0.005, seg=3)
    add(gb)
    add(cyl("gas_cyl", 0.0075, 0.075, (0, 0.2, 0.018), "Y", barrel_m, bevel=0.001, verts=20))
    add(cyl("gas_reg", 0.0085, 0.008, (0, 0.256, 0.018), "Y", steel, bevel=0.0012, verts=20))
    add(box("gas_reg_tab", (0.004, 0.006, 0.01), (0, 0.262, 0.026), steel, bevel=0.0008))
    # Bayonet lug under the gas block.
    add(box("bayo_lug", (0.008, 0.03, 0.008), (0, 0.24, -0.016), barrel_m, bevel=0.0012))

    # Folding vertical foregrip (deployed), hinged on a clamp under the barrel.
    vgy = 0.197
    add(box("vg_clamp", (0.026, 0.028, 0.02), (0, vgy, -0.012), anod, bevel=0.004))
    add(cyl("vg_pin", 0.0035, 0.03, (0, vgy - 0.006, -0.018), "X", steel, bevel=0.0006, verts=12))
    add(cyl("vg_neck", 0.011, 0.012, (0, vgy, -0.026), "Z", od, bevel=0.0015, verts=24))
    add(cyl("vg_body", 0.0135, 0.074, (0, vgy, -0.068), "Z", od, bevel=0.004, verts=20, r2=0.0122))
    for i in range(5):
        add(cyl(f"vg_ring{i}", 0.0142 - i * 0.0002, 0.0025, (0, vgy, -0.092 + i * 0.012), "Z", od, bevel=0.0009, verts=16))

    # Closed-prong flash hider with six slots.
    fh, _ = tube("flash_hider", 0.0115, 0.0072, 0.05, (0, Y_MUZZLE - 0.025, 0.0), "Y", barrel_m, verts=24)
    for i in range(3):
        s = box(f"fh_slot{i}", (0.003, 0.028, 0.03), (0, Y_MUZZLE - 0.024, 0.0), bevel=0)
        rotate(s, 30 + i * 60, "Y", (0, Y_MUZZLE - 0.024, 0))
        cut(fh, s)
    add(fh)

    # ---------------------------------------------- optic / carry handle
    handle = profile("handle", [(-0.066, 0.027), (0.112, 0.027), (0.108, 0.042), (0.09, 0.058), (-0.05, 0.058), (-0.064, 0.044)], 0.026, mat=anod, bevel=0.004)
    arch = [(-0.034, 0.02), (0.078, 0.02)]
    for i in range(0, 13):  # rounded-end slot: the carry-handle gap under the optic
        a = -math.pi / 2 + i / 12 * math.pi
        arch.append((0.064 + math.cos(a) * 0.012, 0.035 + math.sin(a) * 0.012))
    for i in range(0, 13):
        a = math.pi / 2 + i / 12 * math.pi
        arch.append((-0.02 + math.cos(a) * 0.012, 0.035 + math.sin(a) * 0.012))
    arch = arch[2:]
    cut(handle, profile("handle_gap", arch, 0.06, bevel=0))
    add(handle)
    add(cyl("optic_tube", 0.0165, 0.13, (0, 0.017, OPTIC_Z), "Y", anod, bevel=0.0015, verts=24))
    add(cyl("optic_cone", 0.0165, 0.012, (0, 0.088, OPTIC_Z), "Y", anod, bevel=0, verts=24, r2=0.021))
    obj, _ = tube("optic_bell", 0.0215, 0.0178, 0.024, (0, 0.104, OPTIC_Z), "Y", anod, verts=24)
    add(obj)
    add(cyl("lens_front", 0.0179, 0.002, (0, 0.1, OPTIC_Z), "Y", glass, bevel=0.0004, verts=24))
    add(cyl("eyepiece", 0.0182, 0.018, (0, -0.056, OPTIC_Z), "Y", anod, bevel=0.0015, verts=24))
    cup, _ = tube("eyecup", 0.0198, 0.0152, 0.016, (0, -0.072, OPTIC_Z), "Y", rubber, verts=24)
    add(cup)
    add(cyl("lens_rear", 0.0153, 0.002, (0, -0.067, OPTIC_Z), "Y", glass, bevel=0.0004, verts=32))
    # Emergency iron sights on the optic roof + adjustment caps.
    add(box("sight_rib", (0.007, 0.11, 0.004), (0, 0.017, OPTIC_Z + 0.017), anod, bevel=0.0012))
    add(box("sight_post", (0.0025, 0.004, 0.007), (0, 0.068, OPTIC_Z + 0.022), anod, bevel=0.0006))
    rn = box("sight_notch", (0.009, 0.005, 0.006), (0, -0.036, OPTIC_Z + 0.021), anod, bevel=0.0008)
    cut(rn, box("notch_cut", (0.0025, 0.01, 0.006), (0, -0.036, OPTIC_Z + 0.025), bevel=0))
    add(rn)
    for x in (-0.01, 0.01):
        add(cyl(f"scope_screw{x}", 0.0022, 0.004, (math.copysign(0.0132, x), 0.07, 0.044), "X", steel, bevel=0.0004, verts=12))

    # ------------------------------------------- magazine (separate mesh)
    y0, ztop, length, curve, depth = -0.058, -0.045, 0.185, 0.03, 0.056
    back, frontp = [], []
    n = 10
    for i in range(n + 1):
        t = i / n
        yc = y0 + curve * t * t
        z = ztop - length * t
        back.append((yc - depth / 2, z))
        frontp.append((yc + depth / 2 - (0.002 if t < 0.12 else 0.0), z))
    mag = profile("mag", back + frontp[::-1], 0.027, mat=smoke, bevel=0.0018)
    mparts = [mag]
    # Reinforcing ribs front/back.
    for side, sgn in ((back, -1), (frontp, 1)):
        rib_pts = [(p[0] + sgn * 0.0025, p[1]) for p in side[2:]] + [(p[0] - sgn * 0.001, p[1]) for p in side[2:][::-1]]
        mparts.append(profile(f"mag_spine{sgn}", rib_pts, 0.012, mat=smoke, bevel=0.001))
    # Rounds seen through the smoked walls: staggered brass on each side.
    for x in (-0.0136, 0.0136):
        for i in range(15):
            t = (0.11 + i * 0.056)
            if t > 0.92:
                break
            yc = y0 + curve * t * t + (0.003 if i % 2 else -0.003)
            z = ztop - length * t
            mparts.append(box(f"rnd{x}_{i}", (0.0006, 0.038, 0.0072), (x, yc - 0.004, z), brass, bevel=0))
            mparts.append(box(f"tip{x}_{i}", (0.0006, 0.01, 0.004), (x, yc + 0.02, z), brass, bevel=0))
    tb = y0 + curve
    plate = box("mag_plate", (0.031, depth + 0.008, 0.009), (0, tb, ztop - length - 0.003), blk, bevel=0.0025)
    mparts.append(plate)

    export.apply_modifiers(parts + mparts)
    body = sc.join(parts, "aug")
    magj = sc.join(mparts, "mag")
    sc.clean([body, magj], weighted_normals=True)
    return {"objects": [body, magj], "bake": True, "bake_size": 1024, "budget": 28000}
