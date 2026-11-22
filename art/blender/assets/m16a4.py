"""Colt M16A4, modelled from public reference dimensions.

Configured like the game's built gun (buildAR "m16a4"): flat-top upper with a
compact prism (ACOG-style) sight on the rail and no carry handle, KAC-style
quad-rail handguard, A2 front sight base, A2 birdcage, fixed A2 stock, 30-rd
aluminium STANAG magazine.

Reference: overall 1003 mm, 508 mm (20 in) barrel, upper ~24 mm wide, magazine
22.5 mm wide x 63 mm deep. Metres, +Z up, muzzle toward +Y, bore axis on z = 0.
Two shipped meshes: `m16a4` (everything) and `mag`.
"""
import math

import bmesh
import bpy
from mathutils import Vector

from tgf import export, materials as M
from tgf import scene as sc
from tgf.model import _bevel, _obj, array, box, cut, cyl, profile, rotate, tube

# Key stations along the bore (y, metres).
Y_BUTT = -0.455
Y_REC_R = -0.150  # rear of upper / lower
Y_REC_F = 0.040  # front of upper
Y_RAS_F = 0.342
Y_FSB = 0.380
Y_BARREL = 0.508
Y_MUZZLE = 0.550
RAIL_TOP = 0.026  # picatinny top above bore
SIGHT_Z = 0.060  # optic axis above bore
MAG_Y = -0.0135  # magazine centre (front/back) at the top


# ---------------------------------------------------------------- local helpers
def section(name, pts, y0, y1, mat=None, bevel=0.001, seg=2, x=0.0):
    """Extrude a front-view outline (list of (x, z)) along +Y from y0 to y1."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    vs = [bm.verts.new((px + x, y0, pz)) for px, pz in pts]
    f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    moved = [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=Vector((0, y1 - y0, 0)), verts=moved)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    return _bevel(_obj(name, me, mat), bevel, seg)


def lathe(name, prof, mat=None, x=0.0, z=0.0, segs=24, bevel=0.0006, seg=2, ring=False):
    """Revolve a (radius, y) profile around a line parallel to Y through (x, z).
    Points with radius 0 close the solid on the axis. ring=True treats the profile
    as a closed loop (outer then inner surface): a hollow shell open along the axis."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rings = []
    for r, y in prof:
        if r < 1e-7:
            rings.append([bm.verts.new((x, y, z))])
        else:
            rings.append([bm.verts.new((x + r * math.cos(2 * math.pi * i / segs), y, z + r * math.sin(2 * math.pi * i / segs))) for i in range(segs)])
    pairs = list(zip(rings, rings[1:])) + ([(rings[-1], rings[0])] if ring else [])
    for a, b in pairs:
        if len(a) == 1 and len(b) == 1:
            continue
        if len(a) == 1:
            for i in range(segs):
                bm.faces.new((a[0], b[i], b[(i + 1) % segs]))
        elif len(b) == 1:
            for i in range(segs):
                bm.faces.new((a[i], b[0], a[(i + 1) % segs]))
        else:
            for i in range(segs):
                bm.faces.new((a[i], b[i], b[(i + 1) % segs], a[(i + 1) % segs]))
    for cap in (() if ring else (rings[0], rings[-1])):
        if len(cap) > 2:
            bm.faces.new(cap)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    return _bevel(_obj(name, me, mat), bevel, seg)


def taper_x(o, y0, k0, y1, k1):
    """Scale an object's X (width) linearly from k0 at y0 to k1 at y1 (base mesh, before modifiers)."""
    for v in o.data.vertices:
        t = min(1.0, max(0.0, (v.co.y - y0) / (y1 - y0)))
        v.co.x *= k0 + (k1 - k0) * t
    o.data.update()


def rail(name, y0, y1, top, mat, rot=0.0, pivot_z=0.0):
    """MIL-STD-1913 rail: dovetail base plus cross-slotted teeth (10 mm pitch).
    Built pointing up with its top at `top`, then rotated `rot` degrees about Y."""
    t = top
    base = section(name + "_base", [
        (-0.0082, t - 0.0094), (0.0082, t - 0.0094), (0.0082, t - 0.0075), (0.0106, t - 0.0045), (0.0097, t - 0.003),
        (-0.0097, t - 0.003), (-0.0106, t - 0.0045), (-0.0082, t - 0.0075),
    ], y0, y1, mat, bevel=0.0004, seg=1)
    n = int((y1 - y0) / 0.01)
    c0 = y0 + ((y1 - y0) - (n - 1) * 0.01) / 2
    tooth = section(name + "_teeth", [(-0.0097, t - 0.0031), (0.0097, t - 0.0031), (0.0079, t), (-0.0079, t)], c0 - 0.0024, c0 + 0.0024, mat, bevel=0)
    array(tooth, n, 0.01, axis=1)
    out = [base, tooth]
    if rot:
        for o in out:
            rotate(o, rot, "Y", (0, 0, pivot_z))
    return out


def ring_x(name, r_out, r_in, thick, at, mat):
    """Sling swivel loop (axis along X)."""
    return tube(name, r_out, r_in, thick, at, "X", mat, verts=16)[0]


def build(ctx):
    anod = M.pbr("m16_anodized", "anodized_black", wear=0.6)
    park = M.pbr("m16_parkerized", "parkerized", wear=0.7)
    steel = M.pbr("m16_steel", "blued_steel")
    poly = M.pbr("m16_polymer", "polymer_black", base=(0.016, 0.016, 0.017), roughness=0.7, scale=140)
    lens = M.pbr("m16_lens", "glass_lens")
    magm = M.pbr("m16_mag", "anodized_black", base=(0.05, 0.051, 0.054), roughness=0.5, wear=0.8)
    brass = M.pbr("m16_brass", "brass")
    parts = []
    add = parts.append
    addl = parts.extend

    # ------------------------------------------------------------ upper receiver
    # Rounded-shoulder section running into the integral flat-top rail.
    upper = section("upper", [
        (-0.0118, -0.0215), (0.0118, -0.0215), (0.0118, 0.006), (0.0098, 0.0150), (0.0078, 0.0188),
        (-0.0078, 0.0188), (-0.0098, 0.0150), (-0.0118, 0.006),
    ], Y_REC_R, Y_REC_F, anod, bevel=0.0012, seg=2)
    add(upper)
    addl(rail("upper_rail", Y_REC_R + 0.002, Y_REC_F - 0.002, RAIL_TOP, anod))
    # Ejection port (right side) with the bolt carrier showing through.
    cut(upper, box("port_cut", (0.008, 0.054, 0.017), (0.0125, -0.046, -0.001), bevel=0))
    add(box("carrier", (0.003, 0.056, 0.0155), (0.0082, -0.046, -0.001), steel, bevel=0.0006))
    add(cyl("bolt_head", 0.0058, 0.002, (0.0095, -0.026, -0.001), "X", steel, bevel=0.0004, verts=16))
    add(box("carrier_key", (0.002, 0.014, 0.004), (0.0098, -0.052, 0.003), steel, bevel=0.0004))
    # Dust cover, swung open below the port.
    dc = box("dust_cover", (0.0012, 0.054, 0.016), (0.0128, -0.046, -0.0175), anod, bevel=0.0004)
    rotate(dc, -14, "Y", (0.0122, 0, -0.0095))
    add(dc)
    add(cyl("dc_hinge", 0.0011, 0.06, (0.0122, -0.046, -0.0105), "Y", steel, bevel=0, verts=8))
    # Brass deflector behind the port.
    add(profile("deflector", [(-0.093, -0.006), (-0.072, -0.006), (-0.072, 0.008), (-0.083, 0.0165), (-0.093, 0.0135)], 0.007, (0.0135, 0, 0), anod, bevel=0.0015))
    # Forward assist: housing boss angled out to the right, plunger at its rear.
    fa_c = (0.0135, -0.112, 0.004)
    fa = cyl("fa_housing", 0.0075, 0.04, fa_c, "Y", anod, bevel=0.0012, verts=20)
    rotate(fa, 22, "Z", fa_c)
    add(fa)
    s, c = math.sin(math.radians(22)), math.cos(math.radians(22))
    fa_end = (fa_c[0] + 0.021 * s, fa_c[1] - 0.021 * c, fa_c[2])
    plunger = cyl("fa_plunger", 0.0062, 0.010, fa_end, "Y", steel, bevel=0.0012, verts=20)
    rotate(plunger, 22, "Z", fa_end)
    add(plunger)
    # Charging handle latch in a notch at the top rear.
    cut(upper, box("ch_notch", (0.0125, 0.012, 0.009), (0, Y_REC_R + 0.004, 0.0135), bevel=0))
    add(box("ch_shaft", (0.0115, 0.02, 0.0065), (0, Y_REC_R + 0.006, 0.0135), anod, bevel=0.0008))
    add(profile("ch_tee", [(-0.1535, 0.0098), (-0.1475, 0.0098), (-0.1475, 0.0172), (-0.1535, 0.0172)], 0.036, mat=anod, bevel=0.0018))
    add(box("ch_latch", (0.006, 0.010, 0.004), (-0.016, -0.149, 0.0145), anod, bevel=0.0009))
    # Upper/lower parting shadow lip.
    add(box("upper_lip", (0.0244, 0.19, 0.002), (0, (Y_REC_R + Y_REC_F) / 2, -0.0212), anod, bevel=0.0005))

    # ------------------------------------------------------------ lower receiver
    lower = profile("lower", [
        (Y_REC_R, -0.0215), (Y_REC_R, -0.034), (-0.141, -0.045), (0.026, -0.045), (0.034, -0.037),
        (0.044, -0.031), (0.044, -0.0215),
    ], 0.0224, mat=anod, bevel=0.0013)
    add(lower)
    # Rear take-down / buffer tower boss.
    add(profile("tower", [(Y_REC_R, -0.0215), (Y_REC_R, -0.040), (-0.142, -0.046), (-0.128, -0.046), (-0.128, -0.0215)], 0.0244, mat=anod, bevel=0.0018))
    # Magazine well with flared mouth; pocket for the magazine.
    well = profile("magwell", [(-0.058, -0.031), (-0.059, -0.071), (0.031, -0.071), (0.028, -0.031)], 0.028, mat=anod, bevel=0.0016)
    flare = profile("magwell_flare", [(-0.061, -0.069), (-0.0605, -0.077), (0.0335, -0.077), (0.033, -0.069)], 0.031, mat=anod, bevel=0.0012)
    for o in (well, flare):
        cut(o, box(f"{o.name}_pocket", (0.0236, 0.0644, 0.06), (0, MAG_Y, -0.090), bevel=0), hide=True)
        add(o)
    # Bolt catch (left) and mag catch fence + button (right).
    add(profile("bolt_catch", [(-0.064, -0.026), (-0.048, -0.026), (-0.048, -0.034), (-0.058, -0.040), (-0.064, -0.038)], 0.003, (-0.0127, 0, 0), steel, bevel=0.0007))
    add(profile("magcatch_fence", [(-0.074, -0.030), (-0.058, -0.030), (-0.058, -0.046), (-0.066, -0.047)], 0.003, (0.0125, 0, 0), anod, bevel=0.0009))
    add(cyl("magcatch_btn", 0.0044, 0.004, (0.0135, -0.0655, -0.037), "X", steel, bevel=0.0008, verts=16))
    # Selector (left) with lever pointing at SAFE, pins.
    add(cyl("selector", 0.0048, 0.003, (-0.0125, -0.114, -0.030), "X", steel, bevel=0.0006, verts=16))
    add(box("selector_lever", (0.0035, 0.016, 0.0045), (-0.0145, -0.107, -0.030), steel, bevel=0.0010))
    for nm, y, z, r in (("pivot_pin", 0.036, -0.027, 0.0032), ("takedown_pin", -0.137, -0.030, 0.0032), ("trig_pin", -0.074, -0.037, 0.0018), ("ham_pin", -0.093, -0.035, 0.0018)):
        add(cyl(nm, r, 0.0236 if r > 0.003 else 0.0228, (0, y, z), "X", steel, bevel=0.0005, verts=12))

    # Trigger guard (U-loop) and trigger.
    tg = profile("trigger_guard", [(-0.058, -0.044), (-0.058, -0.064), (-0.063, -0.0685), (-0.102, -0.0685), (-0.106, -0.064), (-0.106, -0.044)], 0.0115, mat=anod, bevel=0.0012)
    cut(tg, profile("tg_inner", [(-0.0615, -0.040), (-0.0615, -0.0615), (-0.0645, -0.0645), (-0.1005, -0.0645), (-0.1025, -0.061), (-0.1025, -0.040)], 0.03, bevel=0))
    add(tg)
    add(profile("trigger", [(-0.0745, -0.044), (-0.0738, -0.050), (-0.0724, -0.0552), (-0.0702, -0.0592), (-0.0716, -0.0610),
                            (-0.0742, -0.0572), (-0.0760, -0.0515), (-0.0770, -0.044)], 0.0052, mat=steel, bevel=0.0008))

    # A2 pistol grip, raked 25 deg, single finger swell, palm swell.
    rake = math.radians(25)
    d = (-math.sin(rake), -math.cos(rake))
    n = (math.cos(rake), -math.sin(rake))
    top = (-0.113, -0.036)
    glen = 0.112
    front, back = [], []
    N = 14
    for i in range(N + 1):
        t = i / N
        cy, cz = top[0] + d[0] * glen * t, top[1] + d[1] * glen * t
        bump = 0.0042 * math.exp(-((t - 0.42) / 0.11) ** 2) - 0.0012 * math.exp(-((t - 0.22) / 0.08) ** 2)
        fw = 0.0165 + bump + (0.002 if t > 0.95 else 0)
        bw = 0.0185 + 0.0032 * math.sin(math.pi * min(1, t * 1.1)) + (0.0015 if t > 0.95 else 0)
        front.append((cy + n[0] * fw, cz + n[1] * fw))
        back.append((cy - n[0] * bw, cz - n[1] * bw))
    grip = profile("grip", front + back[::-1], 0.030, mat=poly, bevel=0.0085, seg=4)
    add(grip)
    add(cyl("grip_screw", 0.0028, 0.002, (0, top[0] + d[0] * glen, top[1] + d[1] * glen - 0.002), "Z", steel, bevel=0.0004, verts=12))

    # ------------------------------------------------------------ A2 fixed stock
    stock = profile("stock", [
        (Y_REC_R - 0.001, 0.0085), (Y_REC_R - 0.001, -0.0225), (-0.170, -0.0285), (-0.405, -0.0985), (-0.428, -0.1065),
        (-0.447, -0.1075), (-0.447, 0.0215), (-0.300, 0.0205), (-0.185, 0.0195), (-0.170, 0.0175),
    ], 0.040, mat=poly, bevel=0.004, seg=3)
    taper_x(stock, Y_REC_R, 0.84, -0.30, 1.0)
    add(stock)
    # Moulding seam and sling swivel.
    add(profile("stock_seam", [(-0.180, -0.0215), (-0.440, -0.084), (-0.440, -0.081), (-0.180, -0.0185)], 0.0412, mat=poly, bevel=0.0006))
    add(ring_x("swivel_r", 0.0095, 0.0068, 0.0035, (0, -0.414, -0.1125), park))
    add(box("swivel_r_base", (0.008, 0.012, 0.008), (0, -0.414, -0.1035), park, bevel=0.0012))
    # Butt plate with trapdoor and horizontal serrations.
    bp = profile("butt_plate", [(-0.447, 0.0225), (-0.4545, 0.0205), (-0.4565, -0.1045), (-0.447, -0.1090)], 0.0408, mat=park, bevel=0.0022, seg=2)
    sr = box("bp_serr", (0.05, 0.004, 0.0018), (0, -0.4568, -0.090), bevel=0)
    array(sr, 12, 0.0085, axis=2)
    cut(bp, sr)
    add(bp)
    add(box("trapdoor", (0.028, 0.0012, 0.042), (0, -0.4452, -0.036), park, bevel=0.0005))

    # ------------------------------------------------------------ barrel, handguard, front end
    add(lathe("delta_ring", [(0.0, Y_REC_F), (0.0185, Y_REC_F), (0.0205, Y_REC_F + 0.004), (0.0215, Y_REC_F + 0.012), (0.0, Y_REC_F + 0.012)], park, segs=28))
    # Quad rail (RAS): rounded body, four rails, end rings.
    ras_c = -0.001
    ras0, ras1 = Y_REC_F + 0.011, Y_RAS_F
    body = section("ras", [
        (-0.022, ras_c - 0.016), (-0.017, ras_c - 0.0205), (0.017, ras_c - 0.0205), (0.022, ras_c - 0.016),
        (0.022, ras_c + 0.016), (0.017, ras_c + 0.0205), (-0.017, ras_c + 0.0205), (-0.022, ras_c + 0.016),
    ], ras0, ras1, anod, bevel=0.0012)
    # Cooling ports on the four corner bevels.
    for k in range(5):
        y = ras0 + 0.05 + k * 0.05
        for sx in (-1, 1):
            for sz in (-1, 1):
                h = cyl(f"ras_port{k}{sx}{sz}", 0.0036, 0.012, (sx * 0.0205, y, ras_c + sz * 0.0185), "Z", bevel=0, verts=8)
                rotate(h, sx * sz * 45, "Y", (sx * 0.0205, y, ras_c + sz * 0.0185))
                cut(body, h)
    add(body)
    for nm, r in (("ras_top", 0), ("ras_r", 90), ("ras_l", -90), ("ras_bot", 180)):
        top_ = RAIL_TOP if r == 0 else ras_c + 0.0225 + 0.0062
        addl(rail(nm, ras0 + 0.004, ras1 - 0.004, top_, anod, rot=r, pivot_z=ras_c))
    add(section("ras_cap", [
        (-0.0235, ras_c - 0.017), (-0.0175, ras_c - 0.022), (0.0175, ras_c - 0.022), (0.0235, ras_c - 0.017),
        (0.0235, ras_c + 0.016), (0.0175, ras_c + 0.0215), (-0.0175, ras_c + 0.0215), (-0.0235, ras_c + 0.016),
    ], ras1 - 0.008, ras1, anod, bevel=0.0015))
    add(lathe("hg_cap", [(0.0, ras1), (0.0165, ras1), (0.0160, ras1 + 0.006), (0.0115, ras1 + 0.010), (0.0, ras1 + 0.010)], park, segs=24))

    barrel = tube("barrel", 0.0093, 0.0029, Y_BARREL - Y_REC_F, (0, (Y_BARREL + Y_REC_F) / 2, 0), "Y", park, verts=24)[0]
    add(barrel)
    add(cyl("gas_tube", 0.0024, 0.06, (0, Y_FSB - 0.035, 0.0125), "Y", steel, bevel=0, verts=10))

    # A2 front sight base: barrel sleeve, gas block, triangular tower, protective ears, square post.
    fs0, fs1 = Y_FSB - 0.017, Y_FSB + 0.017
    add(lathe("fsb_sleeve", [(0.0, fs0), (0.0128, fs0), (0.0138, fs0 + 0.003), (0.0138, fs1 - 0.003), (0.0128, fs1), (0.0, fs1)], park, segs=24, bevel=0.0007))
    add(section("fsb_gasblock", [(-0.0085, 0.006), (0.0085, 0.006), (0.0085, 0.017), (-0.0085, 0.017)], fs0 + 0.002, fs1 - 0.006, park, bevel=0.0015))
    tower = section("fsb_tower", [(-0.0125, 0.010), (0.0125, 0.010), (0.0062, 0.040), (0.0055, 0.0435), (-0.0055, 0.0435), (-0.0062, 0.040)], Y_FSB - 0.008, Y_FSB + 0.008, park, bevel=0.0013)
    # The tower is also tapered fore and aft (front face leans back).
    for v in tower.data.vertices:
        h = (v.co.z - 0.010) / 0.0335
        v.co.y = Y_FSB + (v.co.y - Y_FSB) * (1.25 - 0.45 * h) + 0.002 * h
    tower.data.update()
    add(tower)
    for sx in (-1, 1):
        add(profile(f"fsb_ear{sx}", [(Y_FSB - 0.006, 0.038), (Y_FSB + 0.008, 0.038), (Y_FSB + 0.006, 0.0525), (Y_FSB - 0.004, 0.0525)], 0.0028, (sx * 0.0068, 0, 0), park, bevel=0.0009))
    add(cyl("fsb_detent", 0.0038, 0.005, (0, Y_FSB + 0.001, 0.0445), "Z", steel, bevel=0.0005, verts=14))
    add(box("fs_post", (0.0022, 0.0022, 0.009), (0, Y_FSB + 0.001, 0.0505), steel, bevel=0.0003))
    # Bayonet lug + front sling swivel underneath.
    add(box("bayo_lug", (0.0075, 0.018, 0.012), (0, Y_FSB + 0.010, -0.0175), park, bevel=0.0012))
    add(box("swivel_f_base", (0.006, 0.010, 0.010), (0, Y_FSB - 0.010, -0.0165), park, bevel=0.0012))
    add(ring_x("swivel_f", 0.0095, 0.0068, 0.0035, (0, Y_FSB - 0.010, -0.0285), park))
    # Front sight pins.
    for y in (fs0 + 0.006, fs1 - 0.008):
        add(cyl(f"fsb_pin{y}", 0.0016, 0.0285, (0, y, 0.004), "X", steel, bevel=0.0003, verts=10))

    # A2 birdcage flash hider: five slots, closed bottom, crush washer behind.
    add(lathe("crush_washer", [(0.0, Y_BARREL - 0.006), (0.0098, Y_BARREL - 0.006), (0.0098, Y_BARREL - 0.003), (0.0, Y_BARREL - 0.003)], steel, segs=20, bevel=0.0003))
    hl = Y_MUZZLE - (Y_BARREL - 0.003)
    hider = tube("hider", 0.0111, 0.0060, hl, (0, Y_BARREL - 0.003 + hl / 2, 0), "Y", park, verts=28)[0]
    for i, a in enumerate((0, 60, -60, 120, -120)):
        sl = box(f"hider_slot{i}", (0.0034, 0.024, 0.012), (0, Y_BARREL + 0.020, 0.010), bevel=0)
        rotate(sl, a, "Y", (0, 0, 0))
        cut(hider, sl)
    add(hider)

    # ------------------------------------------------------------ prism sight (ACOG-style) on a flat-top mount
    o0, o1 = -0.152, -0.004
    add(section("optic_mount", [(-0.0132, 0.0185), (-0.0108, 0.0185), (-0.0108, 0.0232), (0.0108, 0.0232), (0.0108, 0.0185), (0.0132, 0.0185),
                                (0.0132, 0.034), (0.0095, 0.0405), (-0.0095, 0.0405), (-0.0132, 0.034)], -0.118, -0.042, anod, bevel=0.0012))
    for y in (-0.104, -0.056):
        add(cyl(f"mount_knob{y}", 0.0062, 0.006, (-0.0162, y, 0.028), "X", anod, bevel=0.0012, verts=16))
        add(cyl(f"mount_bolt{y}", 0.0028, 0.004, (0.0142, y, 0.028), "X", steel, bevel=0.0005, verts=10))
    # Housing and tube are shells around a clear sight bore (ocular r 12.8 mm widening to the
    # objective's 18.5 mm): nothing crosses the axis between the two lenses.
    housing = section("optic_housing", [(-0.0165, 0.039), (0.0165, 0.039), (0.0178, 0.057), (0.0125, 0.0765), (-0.0125, 0.0765), (-0.0178, 0.057)], -0.112, -0.046, anod, bevel=0.003, seg=3)
    cut(housing, cyl("housing_bore", 0.0130, 0.070, (0, -0.079, SIGHT_Z), "Y", bevel=0, verts=32, r2=0.0175))
    add(housing)
    add(lathe("optic_tube", [
        (0.0135, o0), (0.0172, o0), (0.0178, o0 + 0.004), (0.0178, o0 + 0.024), (0.0162, o0 + 0.030),
        (0.0150, o0 + 0.040), (0.0150, -0.105), (0.0185, -0.046), (0.0200, -0.040), (0.0205, -0.020), (0.0225, -0.012), (0.0228, o1),
        (0.0192, o1), (0.0185, o1 - 0.008), (0.0175, -0.040), (0.0132, -0.100), (0.0128, -0.105), (0.0128, o0 + 0.006),
    ], anod, z=SIGHT_Z, segs=32, bevel=0.0008, ring=True))
    add(cyl("lens_ocular", 0.0128, 0.0006, (0, o0 + 0.0064, SIGHT_Z), "Y", lens, bevel=0, verts=24))
    add(cyl("lens_objective", 0.0184, 0.0006, (0, o1 - 0.0084, SIGHT_Z), "Y", lens, bevel=0, verts=28))
    # Elevation (top) and windage (right) adjuster caps.
    add(cyl("turret_e_base", 0.0085, 0.004, (0, -0.079, 0.0780), "Z", anod, bevel=0.0008, verts=20))
    add(cyl("turret_e", 0.0072, 0.009, (0, -0.079, 0.0838), "Z", anod, bevel=0.0012, verts=20))
    add(cyl("turret_w_base", 0.0085, 0.004, (0.0188, -0.079, 0.059), "X", anod, bevel=0.0008, verts=20))
    add(cyl("turret_w", 0.0072, 0.009, (0.0246, -0.079, 0.059), "X", anod, bevel=0.0012, verts=20))
    # Tritium/fibre housing strip on top behind the turret.
    add(box("optic_fiber", (0.006, 0.026, 0.004), (0, -0.102, 0.0775), anod, bevel=0.0012))

    # ------------------------------------------------------------ magazine (separate mesh)
    L, depth, curve, w = 0.183, 0.0624, 0.026, 0.0225
    ztop = -0.024
    back, front = [], []
    for i in range(11):
        t = i / 10
        zc = curve * t * t
        back.append((MAG_Y + zc - depth / 2, ztop - L * t))
        front.append((MAG_Y + zc + depth / 2 - (0.002 if t < 0.05 else 0), ztop - L * t))
    mag = profile("mag", back + front[::-1], w, mat=magm, bevel=0.0012)
    # Stamped reinforcing panel on each side.
    pb, pf = [], []
    for i in range(9):
        t = 0.30 + 0.62 * i / 8
        zc = curve * t * t
        pb.append((MAG_Y + zc - depth * 0.30, ztop - L * t))
        pf.append((MAG_Y + zc + depth * 0.30, ztop - L * t))
    panel = profile("mag_panel", pb + pf[::-1], w + 0.0016, mat=magm, bevel=0.0007)
    # Floor plate, angled to the curve.
    ang = math.degrees(math.atan(2 * curve / L))
    fy = MAG_Y + curve
    fp = box("mag_floor", (w + 0.003, depth + 0.006, 0.006), (0, fy, ztop - L - 0.002), magm, bevel=0.0018)
    rotate(fp, ang, "X", (0, fy, ztop - L))
    rnd = cyl("mag_round", 0.0047, 0.044, (0.0026, MAG_Y + 0.004, ztop + 0.0018), "Y", brass, bevel=0.0004, verts=12, r2=None)
    tip = cyl("mag_tip", 0.0047, 0.012, (0.0026, MAG_Y + 0.032, ztop + 0.0018), "Y", brass, bevel=0.0003, verts=12, r2=0.0015)
    mag_parts = [mag, panel, fp, rnd, tip]

    export.apply_modifiers(parts + mag_parts)
    body_o = sc.join(parts, "m16a4")
    mag_o = sc.join(mag_parts, "mag")
    sc.clean([body_o, mag_o], weighted_normals=True)
    return {"objects": [body_o, mag_o], "bake": True, "bake_size": 1024, "budget": 30000}
