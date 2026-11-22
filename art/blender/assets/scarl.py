"""FN SCAR-L (Mk 16 STD) in FDE, modelled from public reference dimensions.

Configured like the game's procedural SCAR (buildScar): stock extended, A2-style
flash hider, both iron sights folded down, low tube red dot on the top rail.
~880 mm overall (stock extended), 14" barrel, ~38 mm upper, STANAG 30-rd mag.
Front = +Y, bore axis at z = 0, muzzle at max +Y.
Two shipped meshes: `scarl` (everything) and `mag` (split off so reloads move it).
"""
import math

import bmesh
import bpy
from mathutils import Vector

from tgf import export, materials as M
from tgf import scene as sc
from tgf.model import _bevel, _obj, array, box, cut, cyl, profile, rotate


# --- local helpers ----------------------------------------------------------

def lathe(name, pts, x=0.0, z=0.0, mat=None, verts=24, bevel=0.0005, seg=2, closed=False):
    """Revolve (r, y) points around an axis parallel to Y through (x, z)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rings = []
    for r, y in pts:
        if r < 1e-7:
            rings.append([bm.verts.new((x, y, z))])
        else:
            rings.append([bm.verts.new((x + r * math.cos(2 * math.pi * i / verts), y, z + r * math.sin(2 * math.pi * i / verts))) for i in range(verts)])
    pairs = list(zip(rings, rings[1:]))
    if closed:
        pairs.append((rings[-1], rings[0]))
    for a, b in pairs:
        if len(a) == 1 and len(b) == 1:
            continue
        if len(a) == 1:
            for i in range(verts):
                bm.faces.new((a[0], b[(i + 1) % verts], b[i]))
        elif len(b) == 1:
            for i in range(verts):
                bm.faces.new((a[i], a[(i + 1) % verts], b[0]))
        else:
            for i in range(verts):
                bm.faces.new((a[i], a[(i + 1) % verts], b[(i + 1) % verts], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    return _bevel(_obj(name, me, mat), bevel, seg)


def xsec(name, pts, y0, y1, mat=None, bevel=0.001, seg=2):
    """Extrude a cross-section outline of (x, z) points along Y from y0 to y1."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    f = bm.faces.new([bm.verts.new((x, y0, z)) for x, z in pts])
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    moved = [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=Vector((0, y1 - y0, 0)), verts=moved)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    return _bevel(_obj(name, me, mat), bevel, seg)


def intersect(target, other):
    m = target.modifiers.new("Isect_" + other.name, "BOOLEAN")
    m.operation = "INTERSECT"
    m.object = other
    m.solver = "EXACT"
    target.modifiers.move(len(target.modifiers) - 1, 0)
    other.hide_render = True
    other.hide_set(True)
    return other


def mirror_x(half):
    """(x, z) half outline on +x, top to bottom -> full closed outline."""
    return [(x, z) for x, z in half] + [(-x, z) for x, z in reversed(half)]


def picatinny(name, y0, y1, mat, slots=True):
    """MIL-STD-1913 rail along Y, base at z = 0, centred on x = 0 (place it after)."""
    half = [(0.0080, 0.0076), (0.0080, 0.0070), (0.0106, 0.0045), (0.0106, 0.0039), (0.0078, 0.0016), (0.0078, -0.0006)]
    r = xsec(name, mirror_x(half), y0, y1, mat, bevel=0.0004, seg=1)
    cutters = []
    if slots:
        n = int((y1 - y0) / 0.01)
        first = (y0 + y1) / 2 - (n - 1) * 0.005
        c = box(name + "_slots", (0.03, 0.0053, 0.008), (0, first, 0.0056), bevel=0)
        array(c, n, 0.01, axis=1)
        cut(r, c)
        cutters.append(c)
    return r, cutters


def place(objs, rot=(0, 0, 0), loc=(0, 0, 0)):
    for o in objs:
        o.rotation_euler = tuple(math.radians(a) for a in rot)
        o.location = loc


def bake_transform(objs):
    """Apply object transforms so every shipped part has identity matrices before joining."""
    sc.apply_transforms(objs)


# --- build -------------------------------------------------------------------

def build(ctx):
    fde = M.pbr("scar_fde_alu", "anodized_black", base=(0.18, 0.128, 0.068), metallic=0.25, roughness=0.58, wear=0.4, scale=90)
    poly = M.pbr("scar_fde_poly", "polymer_tan", base=(0.158, 0.121, 0.072), roughness=0.66, scale=150)
    black = M.pbr("scar_black_poly", "polymer_black", scale=150)
    anod = M.pbr("scar_anod", "anodized_black", wear=0.45)
    steel = M.pbr("scar_parkerized", "parkerized", wear=0.5)
    blued = M.pbr("scar_blued", "blued_steel")
    rubber = M.pbr("scar_rubber", "rubber", scale=200)
    glass = M.pbr("scar_glass", "glass_lens")
    magm = M.pbr("scar_mag", "anodized_black", base=(0.045, 0.045, 0.048), wear=0.7)
    brass = M.pbr("scar_brass", "brass")

    parts = []
    add = parts.append
    rotated = []  # parts placed via object transforms (applied before join)

    RAIL = 0.0224   # top of the upper / base of the top rail
    RT = RAIL + 0.0076  # rail top (0.030 above bore, like the procedural gun)

    # ---------------- Upper receiver (monolithic aluminium) ----------------
    up = profile("upper", [(-0.09, RAIL), (0.29, RAIL), (0.29, -0.019), (0.287, -0.022), (0.11, -0.022), (0.102, -0.025),
                           (-0.075, -0.025), (-0.09, -0.019)], 0.038, mat=fde, bevel=0.0015)
    intersect(up, xsec("upper_x", [(-0.0155, RAIL + 0.002), (0.0155, RAIL + 0.002), (0.0192, 0.0165), (0.0192, -0.0235),
                                   (0.0175, -0.027), (-0.0175, -0.027), (-0.0192, -0.0235), (-0.0192, 0.0165)], -0.1, 0.3, bevel=0))
    # Charging-handle slots (both sides, handle is swappable) and the side ejection port.
    for sx in (-1, 1):
        cut(up, box(f"ch_slot{sx}", (0.008, 0.165, 0.0048), (sx * 0.0195, 0.062, 0.0075), bevel=0))
    cut(up, box("port_cut", (0.012, 0.052, 0.015), (0.0215, 0.03, -0.0065), bevel=0))
    add(up)
    # Bolt carrier visible in the port, slot back-plates.
    add(box("bolt_face", (0.004, 0.05, 0.013), (0.014, 0.03, -0.0065), steel, bevel=0.0006))
    for sx in (-1, 1):
        add(box(f"slot_back{sx}", (0.003, 0.163, 0.0046), (sx * 0.0168, 0.062, 0.0075), black, bevel=0))
    # Brass deflector bump behind the port.
    add(profile("deflector", [(-0.012, -0.016), (0.006, -0.016), (0.004, 0.006), (-0.006, 0.006), (-0.014, -0.004)], 0.008, (0.0205, 0, 0), fde, bevel=0.0022))
    # Barrel-retention cross bolts (left, lower front of receiver section) and rear end plate screws.
    for y in (0.108, 0.13):
        add(cyl(f"tbolt{y}", 0.0036, 0.004, (-0.0198, y, -0.014), "X", steel, bevel=0.0006, verts=12))
    add(cyl("tbolt_r", 0.0032, 0.003, (0.0195, 0.12, -0.014), "X", steel, bevel=0.0005, verts=12))

    # Top rail (full length) + side rails at 3/9 and a bottom rail on the forend.
    r, cs = picatinny("rail_top", -0.09, 0.29, fde)
    place([r] + cs, loc=(0, 0, RAIL))
    add(r)
    rotated += [r] + cs
    for sx in (-1, 1):
        r, cs = picatinny(f"rail_side{sx}", 0.17, 0.285, fde)
        place([r] + cs, rot=(0, 90 * sx, 0), loc=(sx * 0.0186, 0, -0.004))
        add(r)
        rotated += [r] + cs
    r, cs = picatinny("rail_bot", 0.15, 0.285, fde)
    place([r] + cs, rot=(0, 180, 0), loc=(0, 0, -0.0215))
    add(r)
    rotated += [r] + cs

    # Non-reciprocating charging handle (left, forward rest), folding knob on a stem.
    add(box("ch_stem", (0.006, 0.012, 0.004), (-0.0215, 0.142, 0.0075), steel, bevel=0.0008))
    knob = lathe("ch_knob", [(0, -0.0235), (0.0042, -0.0235), (0.0042, -0.027), (0.0066, -0.029), (0.0066, -0.041), (0.005, -0.043), (0, -0.043)], mat=black, verts=14)
    place([knob], rot=(0, -12, -90), loc=(0, 0.142, 0.0075))  # lathe axis Y -> -X (left)
    add(knob)
    rotated.append(knob)

    # Stock hinge block at the rear of the upper.
    add(box("hinge_block", (0.036, 0.022, 0.044), (0, -0.1, 0.0), poly, bevel=0.004, seg=3))
    add(cyl("hinge_pin", 0.0045, 0.05, (0.0175, -0.1, 0.0), "Z", steel, bevel=0.0008, verts=14))
    add(box("hinge_latch", (0.006, 0.012, 0.016), (-0.019, -0.1, 0.006), steel, bevel=0.0012))

    # ---------------- Lower receiver (polymer FDE) ----------------
    low = profile("lower", [(-0.074, -0.0235), (0.112, -0.0235), (0.112, -0.032), (0.104, -0.04), (0.098, -0.052), (0.1, -0.066),
                            (0.096, -0.074), (0.016, -0.074), (0.012, -0.068), (0.008, -0.052), (0.004, -0.048), (-0.064, -0.048),
                            (-0.074, -0.046), (-0.088, -0.034), (-0.089, -0.0215)], 0.036, mat=poly, bevel=0.0022)
    cut(low, box("magwell_open", (0.0275, 0.068, 0.014), (0, 0.053, -0.074), bevel=0))
    # Flared magwell lip.
    for sx in (-1, 1):
        cut(low, box(f"lower_side{sx}", (0.002, 0.09, 0.026), (sx * 0.018, 0.056, -0.054), bevel=0))
    add(low)
    # Trigger guard (integral), trigger.
    tg = profile("tguard", [(-0.054, -0.047), (0.009, -0.047), (0.009, -0.064), (0.002, -0.0715), (-0.046, -0.0715),
                            (-0.053, -0.066)], 0.012, mat=poly, bevel=0.0018)
    cut(tg, profile("tg_in", [(-0.048, -0.045), (0.004, -0.045), (0.004, -0.0625), (0.0, -0.067), (-0.043, -0.067), (-0.048, -0.063)], 0.03, bevel=0))
    add(tg)
    add(profile("trigger", [(-0.016, -0.046), (-0.022, -0.046), (-0.024, -0.054), (-0.021, -0.063), (-0.019, -0.062), (-0.0195, -0.054)], 0.006, mat=blued, bevel=0.001))
    # Ambi selector, mag release, bolt catch, takedown pins.
    for sx in (-1, 1):
        add(cyl(f"sel_hub{sx}", 0.0058, 0.003, (sx * 0.0195, -0.046, -0.032), "X", steel, bevel=0.0007, verts=16))
        lev = box(f"sel_lev{sx}", (0.003, 0.02, 0.0055), (sx * 0.0212, -0.04, -0.032), black, bevel=0.0012)
        rotate(lev, -25, "X", (0, -0.046, -0.032))
        add(lev)
        add(cyl(f"pin_r{sx}", 0.0032, 0.0015, (sx * 0.0186, -0.062, -0.031), "X", steel, bevel=0.0004, verts=12))
        add(cyl(f"pin_f{sx}", 0.0032, 0.0015, (sx * 0.0186, 0.106, -0.029), "X", steel, bevel=0.0004, verts=12))
    add(cyl("mag_rel", 0.0048, 0.003, (0.019, 0.004, -0.04), "X", black, bevel=0.0008, verts=14))
    add(box("mag_rel_l", (0.003, 0.012, 0.008), (-0.0192, 0.004, -0.041), black, bevel=0.001))
    add(box("bolt_catch", (0.003, 0.016, 0.009), (-0.0192, -0.004, -0.031), steel, bevel=0.0012))

    # Pistol grip (A2-style, single finger swell), raked 17 degrees.
    gy, gz = -0.068, -0.047
    g = [(0.021, 0.006), (0.017, -0.008), (0.015, -0.024), (0.0205, -0.034), (0.0155, -0.045), (0.0165, -0.075), (0.019, -0.094),
         (0.0145, -0.101), (-0.016, -0.101), (-0.0205, -0.094), (-0.0225, -0.06), (-0.0205, -0.022), (-0.0195, -0.006), (-0.028, 0.006)]
    grip = profile("grip", [(gy + u, gz + v) for u, v in g], 0.03, mat=poly, bevel=0.0055, seg=3)
    for i in range(7):
        st = box(f"grip_groove{i}", (0.04, 0.005, 0.0024), (0, gy - 0.0235, gz - 0.03 - i * 0.008), bevel=0)
        rotate(st, -17.2, "X", (0, gy, gz))
        cut(grip, st)
    rotate(grip, -17.2, "X", (0, gy, gz))
    add(grip)

    # ---------------- Stock (side-folding, telescoping) ----------------
    add(box("stock_arm", (0.028, 0.09, 0.032), (0, -0.155, 0.004), poly, bevel=0.004))
    stock = profile("stock", [(-0.17, 0.025), (-0.296, 0.026), (-0.318, 0.018), (-0.322, -0.068), (-0.302, -0.07), (-0.262, -0.046),
                              (-0.2, -0.021), (-0.17, -0.016)], 0.034, mat=poly, bevel=0.004, seg=3)
    intersect(stock, xsec("stock_x", [(-0.012, 0.032), (0.012, 0.032), (0.0175, 0.02), (0.0175, -0.08), (-0.0175, -0.08), (-0.0175, 0.02)], -0.34, -0.16, bevel=0))
    cut(stock, profile("stock_hole", [(-0.225, 0.004), (-0.288, 0.006), (-0.296, -0.002), (-0.297, -0.05), (-0.288, -0.052), (-0.24, -0.026), (-0.226, -0.014)], 0.05, bevel=0))
    add(stock)
    # Thin web inside the cut-out (stock is skeletal, not see-through).
    add(profile("stock_web", [(-0.224, 0.006), (-0.29, 0.008), (-0.298, -0.054), (-0.238, -0.026)], 0.012, mat=poly, bevel=0))
    # Adjustable cheek riser, adjustment lever, rubber butt pad.
    add(profile("cheek", [(-0.18, 0.024), (-0.186, 0.032), (-0.296, 0.034), (-0.302, 0.026)], 0.028, mat=poly, bevel=0.004, seg=3))
    add(box("cheek_btn", (0.03, 0.008, 0.006), (0, -0.19, 0.026), steel, bevel=0.0012))
    add(box("adj_lever", (0.014, 0.026, 0.005), (0, -0.182, -0.0135), black, bevel=0.0015))
    pad = profile("butt_pad", [(-0.3195, 0.02), (-0.333, 0.02), (-0.334, -0.071), (-0.3245, -0.072)], 0.034, mat=rubber, bevel=0.003, seg=3)
    add(pad)

    # ---------------- Barrel, gas block, flash hider ----------------
    add(lathe("barrel", [(0, 0.28), (0.0098, 0.28), (0.0098, 0.33), (0.0088, 0.334), (0.0086, 0.49), (0, 0.49)], mat=blued, verts=20))
    add(box("gas_block", (0.03, 0.026, 0.03), (0, 0.302, 0.002), fde, bevel=0.003, seg=3))
    add(cyl("gas_plug", 0.0055, 0.016, (0, 0.322, 0.012), "Y", steel, bevel=0.0008, verts=14))
    add(box("regulator", (0.016, 0.004, 0.012), (0, 0.331, 0.012), steel, bevel=0.0012))
    add(box("gb_pin", (0.034, 0.005, 0.005), (0, 0.296, -0.008), steel, bevel=0.0012))
    fh = lathe("flash_hider", [(0.0045, 0.488), (0.0092, 0.488), (0.0108, 0.492), (0.0108, 0.5), (0.0112, 0.502), (0.0112, 0.545),
                               (0.0098, 0.546), (0.0062, 0.546)], mat=steel, verts=24, closed=True)
    for i in range(5):
        c = box(f"fh_slot{i}", (0.0032, 0.032, 0.01), (0, 0.533, 0.0105), bevel=0)
        rotate(c, 72 * i, "Y", (0, 0, 0))
        cut(fh, c)
    add(fh)

    # ---------------- Folding iron sights (both folded flat) ----------------
    add(profile("rs_base", [(-0.089, RT - 0.004), (-0.061, RT - 0.004), (-0.063, RT + 0.006), (-0.086, RT + 0.008)], 0.024, mat=fde, bevel=0.0015))
    for sx in (-1, 1):
        add(profile(f"rs_ear{sx}", [(-0.086, RT + 0.006), (-0.072, RT + 0.006), (-0.076, RT + 0.013), (-0.084, RT + 0.013)], 0.004, (sx * 0.01, 0, 0), fde, bevel=0.0008))
    rl = box("rs_leaf", (0.015, 0.024, 0.0035), (0, -0.074, RT + 0.0085), anod, bevel=0.0008)
    cut(rl, cyl("rs_ap", 0.0022, 0.01, (0, -0.066, RT + 0.0085), "Z", bevel=0))
    add(rl)
    add(cyl("rs_spring", 0.003, 0.018, (0, -0.088, RT + 0.008), "X", steel, bevel=0.0005, verts=12))
    add(profile("fs_base", [(0.262, RT - 0.004), (0.288, RT - 0.004), (0.286, RT + 0.007), (0.266, RT + 0.008)], 0.022, mat=fde, bevel=0.0015))
    for sx in (-1, 1):
        add(profile(f"fs_ear{sx}", [(0.266, RT + 0.007), (0.282, RT + 0.007), (0.279, RT + 0.015), (0.269, RT + 0.015)], 0.0035, (sx * 0.0092, 0, 0), fde, bevel=0.0008))
    add(box("fs_leaf", (0.011, 0.022, 0.0035), (0, 0.273, RT + 0.0095), anod, bevel=0.0008))
    add(box("fs_post", (0.0025, 0.008, 0.0028), (0, 0.283, RT + 0.0122), anod, bevel=0.0004))

    # ---------------- Red dot (34 mm tube, centre on the sight line) ----------------
    OZ, OY = 0.062, 0.02
    add(lathe("rd_tube", [(0.0148, -0.0105), (0.0178, -0.0105), (0.0182, -0.008), (0.0182, -0.003), (0.0168, -0.001), (0.0168, 0.039),
                          (0.0184, 0.042), (0.0186, 0.0505), (0.0174, 0.0508), (0.0154, 0.0508)], z=OZ, mat=anod, verts=28, closed=True))
    add(cyl("rd_lens_f", 0.0153, 0.0016, (0, 0.046, OZ), "Y", glass, bevel=0, verts=28))
    add(cyl("rd_lens_r", 0.0149, 0.0016, (0, -0.006, OZ), "Y", glass, bevel=0, verts=28))
    # Turret housing: a saddle wrapped around the tube (bored out, so the sight axis stays clear).
    hs = box("rd_housing", (0.026, 0.026, 0.026), (0, OY - 0.001, OZ + 0.006), anod, bevel=0.0045, seg=3)
    cut(hs, cyl("rd_housing_bore", 0.0163, 0.04, (0, OY - 0.001, OZ), "Y", bevel=0, verts=28))
    add(hs)
    add(lathe("rd_elev", [(0, 0), (0.0066, 0), (0.0066, 0.008), (0.0058, 0.009), (0, 0.009)], mat=anod, verts=16))
    place([parts[-1]], rot=(90, 0, 0), loc=(0, OY - 0.001, OZ + 0.0175))  # axis Y -> +Z
    rotated.append(parts[-1])
    add(lathe("rd_wind", [(0, 0), (0.0066, 0), (0.0066, 0.008), (0.0058, 0.009), (0, 0.009)], mat=anod, verts=16))
    place([parts[-1]], rot=(0, 0, -90), loc=(0.0165, OY - 0.001, OZ))  # axis Y -> +X
    rotated.append(parts[-1])
    add(lathe("rd_bright", [(0, 0), (0.0078, 0), (0.0078, 0.009), (0.0068, 0.0105), (0, 0.0105)], mat=anod, verts=18))
    place([parts[-1]], rot=(0, 0, 90), loc=(-0.0165, OY + 0.002, OZ))  # axis Y -> -X
    rotated.append(parts[-1])
    # Mount: riser + rail clamp jaws + cross-bolt nut.
    add(profile("rd_riser", [(-0.004, RT - 0.0005), (0.044, RT - 0.0005), (0.040, RT + 0.008), (0.034, OZ - 0.0158), (0.002, OZ - 0.0158),
                             (-0.002, RT + 0.008)], 0.022, mat=anod, bevel=0.0015))
    for sx in (-1, 1):
        add(box(f"rd_jaw{sx}", (0.004, 0.034, 0.0078), (sx * 0.0128, OY, RT - 0.0029), anod, bevel=0.001))
    add(cyl("rd_nut", 0.0045, 0.005, (0.0172, OY, RT - 0.003), "X", steel, bevel=0.0008, verts=6))
    add(box("rd_lever", (0.003, 0.03, 0.006), (0.0205, OY - 0.008, RT - 0.003), anod, bevel=0.0012))

    # ---------------- Magazine (STANAG 30, separate mesh) ----------------
    def mag_c(t):
        return 0.051 + 0.04 * t * t, -0.03 - 0.172 * t

    def mag_n(t):
        dy, dz = 0.08 * t, -0.172
        L = math.hypot(dy, dz)
        return -dz / L, dy / L  # forward-pointing normal

    def mag_outline(t0, t1, half, n=10, lip=0.0):
        back, front = [], []
        for i in range(n + 1):
            t = t0 + (t1 - t0) * i / n
            (cy, cz), (ny, nz) = mag_c(t), mag_n(t)
            back.append((cy - ny * half, cz - nz * half))
            front.append((cy + ny * (half - (lip if t < 0.04 else 0)), cz + nz * half))
        return back + front[::-1]

    mparts = []
    mg = profile("mag", mag_outline(0, 1, 0.031), 0.023, mat=magm, bevel=0.0016)
    mparts.append(mg)
    # Pressed side panels (the USGI mag's raised flats) and a front/back spine.
    for sx in (-1, 1):
        mparts.append(profile(f"mag_panel{sx}", mag_outline(0.3, 0.93, 0.024, n=8), 0.002, (sx * 0.0115, 0, 0), magm, bevel=0.0006))
    for sx in (-1, 1):
        mparts.append(profile(f"mag_rib{sx}", mag_outline(0.24, 0.27, 0.027, n=2), 0.0012, (sx * 0.0115, 0, 0), magm, bevel=0.0004))
    by, bz = mag_c(1.0)
    fp = box("mag_floor", (0.027, 0.07, 0.008), (0, by + 0.003, bz - 0.002), black, bevel=0.002, seg=3)
    rotate(fp, math.degrees(math.atan(0.08 / 0.172)), "X", (0, by, bz))
    mparts.append(fp)
    # Feed lips + top round.
    for sx in (-1, 1):
        mparts.append(box(f"mag_lip{sx}", (0.003, 0.04, 0.004), (sx * 0.0095, 0.046, -0.029), magm, bevel=0.0008))
    mparts.append(lathe("round", [(0, 0.024), (0.0048, 0.024), (0.0048, 0.058), (0.0029, 0.064), (0.0028, 0.072), (0.0012, 0.0795), (0, 0.08)], 0.0022, -0.0265, brass, verts=12))

    # Apply transforms on placed parts, then modifiers, then join.
    # (Rotated parts keep their object transforms; join bakes them into the upper's space.)
    export.apply_modifiers(parts + mparts)
    body = sc.join(parts, "scarl")
    magj = sc.join(mparts, "mag")
    sc.clean([body, magj], weighted_normals=True)
    return {"objects": [body, magj], "bake": True, "bake_size": 1024, "budget": 30000}
