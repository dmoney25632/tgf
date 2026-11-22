"""FN P90 (5.7x28 mm PDW, bullpup), modelled from public reference dimensions.

Overall 500 mm, barrel 264 mm, height ~210 mm with the sight, width ~55 mm.
Front = +Y, bore axis at z = 0, muzzle at y = +0.25.
Signature features: sculpted one-piece polymer body with thumbhole and trigger
opening, front hand stop, 50-round magazine lying flat on top, ring reflex
sight housing over the front of the mag, ambidextrous charging handles,
rotary selector under the trigger, downward ejection chute behind the grip.
Two shipped meshes: `p90` (everything) and `mag` (split off so reloads move it).
"""
import math

from tgf import export, materials as M
from tgf.model import box, cut, cyl, profile, rotate, tube, array
from tgf import scene as sc


def rrect(cy, cz, w, h, r, n=5):
    """Rounded rectangle outline in (y, z), counter-clockwise."""
    r = min(r, w / 2, h / 2)
    pts = []
    for (ox, oz, a0) in ((w / 2 - r, h / 2 - r, 0), (-(w / 2 - r), h / 2 - r, 90), (-(w / 2 - r), -(h / 2 - r), 180), (w / 2 - r, -(h / 2 - r), 270)):
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append((cy + ox + r * math.cos(a), cz + oz + r * math.sin(a)))
    return pts


# Side-view cage for the body: columns (y) and rows (z). Bottom z per column;
# None = short nose column (rows 0..3 only).
_C = [-0.251, -0.232, -0.2, -0.165, -0.13, -0.099, -0.068, -0.037, -0.013, 0.01, 0.031, 0.063, 0.1, 0.12, 0.14, 0.165, 0.19]
_R = [0.03, 0.0, -0.02, -0.04, -0.057, -0.076, -0.095, None]
_BOT = [-0.062, -0.08, -0.09, -0.099, -0.108, -0.114, -0.118, -0.121, -0.122, -0.12, -0.114, -0.112, -0.112, -0.118, -0.115, None, None]
_HOLES = {(j, k) for j in (4, 5, 6) for k in (4, 5)} | {(j, k) for j in (10, 11, 12) for k in (4, 5)}


def _cage_yz(j, k):
    y, z = _C[j], _R[k]
    bot = _BOT[j]
    if k == 7:
        z = bot
    if j <= 3 and k >= 4:  # butt: rows spread down to the sloping bottom
        z = -0.04 + (bot + 0.04) * (k - 3) / 4
    # Grip rake: the grip loop leans back toward the bottom.
    if 4 <= j <= 12 and z < -0.05:
        y += (z + 0.05) * 0.3
    # Front hand stop hooks forward and down.
    if j == 14 and k >= 4:
        y += {4: 0.003, 5: 0.008, 6: 0.014, 7: 0.017}[k]
    if j == 13 and k >= 6:
        y += {6: 0.005, 7: 0.01}[k]
    # Nose and butt shaping.
    if j == 15 and k == 3:
        z = -0.041
    if j == 16:
        y, z = {0: (0.181, 0.026), 1: (0.191, 0.004), 2: (0.191, -0.016), 3: (0.184, -0.031)}[k]
    if j == 0:
        y += {0: 0.005, 7: 0.004}.get(k, 0.0)
    return y, z


def _half_width(y, z):
    hw = 0.026
    if z < -0.035:  # lower body narrows toward the bottom
        t = min(1.0, (-0.035 - z) / 0.085)
        hw -= 0.0052 * t
    hw += 0.0014 * math.exp(-((z + 0.022) / 0.02) ** 2)  # rounded cheeks
    if y > 0.1:  # nose tapers
        hw *= 1.0 - 0.16 * min(1.0, (y - 0.1) / 0.09)
    if y < -0.225:  # soft butt
        hw *= 1.0 - 0.05 * min(1.0, (-0.225 - y) / 0.03)
    return hw


def body_shell(name, mat, level=2, decimate=0.68):
    import bpy
    import bmesh
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    nrows = [8 if b is not None else 4 for b in _BOT]
    V = {}
    for j in range(len(_C)):
        for k in range(nrows[j]):
            y, z = _cage_yz(j, k)
            V[(j, k)] = bm.verts.new((0.0, y, z))
    faces = []
    for j in range(len(_C) - 1):
        for k in range(min(nrows[j], nrows[j + 1]) - 1):
            if (j, k) in _HOLES:
                continue
            faces.append(bm.faces.new([V[(j, k)], V[(j + 1, k)], V[(j + 1, k + 1)], V[(j, k + 1)]]))
    # Layered extrusion across X: u = -1 (left cheek), support loops at +-0.72, +1.
    us = [-1.0, -0.72, 0.72, 1.0]
    layer = {v: us[0] for v in bm.verts}
    cap = faces
    for u in us[1:]:
        ext = bmesh.ops.extrude_face_region(bm, geom=cap)
        nv = {e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)}
        for v in nv:
            layer[v] = u
        cap = [f for f in ext["geom"] if isinstance(f, bmesh.types.BMFace) and all(v in nv for v in f.verts)]
    for v in bm.verts:
        u = layer.get(v, us[-1])
        v.co.x = u * _half_width(v.co.y, v.co.z)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(mat)
    sub = o.modifiers.new("Subsurf", "SUBSURF")
    sub.levels = level
    sub.render_levels = level
    dec = o.modifiers.new("Decimate", "DECIMATE")
    dec.ratio = decimate
    export.apply_modifiers([o])
    o.data.shade_smooth()
    return o


def build(ctx):
    poly = M.pbr("p90_polymer", "polymer_black", base=(0.019, 0.019, 0.02), wear=0.08, scale=140)
    grey = M.pbr("p90_grey", "polymer_black", base=(0.05, 0.05, 0.052), wear=0.1, scale=140)
    steel = M.pbr("p90_blued", "blued_steel")
    park = M.pbr("p90_parkerized", "parkerized", wear=0.5)
    smoke = M.pbr("p90_mag_smoke", "polymer_black", base=(0.045, 0.035, 0.022), roughness=0.4, wear=0.05, scale=90)
    lens = M.pbr("p90_lens", "glass_lens")
    red = M.pbr("p90_reticle", None, base=(0.85, 0.06, 0.03), metallic=0.0, roughness=0.3, wear=0.0)
    parts = []
    add = parts.append

    # ---- Body: one moulded shell. A low-poly quad cage (side-view grid with the
    # thumbhole and trigger opening left out) is extruded across the width in
    # layers (support loops near each cheek), pinched toward the bottom and the
    # nose, then Catmull-Clark subdivided so every edge and opening rolls over.
    body = body_shell("body", poly)
    add(body)
    # Shallow mag bed between the rails.
    cut(body, box("mag_bed", (0.0445, 0.40, 0.03), (0, -0.04, 0.0345), bevel=0))
    # Charging handle slots on both sides, ahead of the trigger.
    cut(body, box("ch_slot", (0.07, 0.085, 0.0055), (0, 0.13, -0.012), bevel=0))
    # Ejection chute, bottom of the butt behind the thumbhole.
    cut(body, box("eject_port", (0.02, 0.03, 0.03), (0, -0.17, -0.1), bevel=0))
    add(box("eject_floor", (0.022, 0.032, 0.004), (0, -0.17, -0.083), grey, bevel=0.0008))

    # Ribbed butt plate moulded into the rounded rear.
    pad_g = box("pad_groove", (0.07, 0.012, 0.0028), (0, -0.2535, 0.008), bevel=0)
    array(pad_g, 6, -0.0105, axis=2)
    cut(body, pad_g)

    # Ambidextrous magazine latch at the rear of the mag.
    add(profile("mag_latch", [(-0.247, 0.019), (-0.229, 0.019), (-0.229, 0.027), (-0.234, 0.035), (-0.247, 0.035)], 0.04, mat=grey, bevel=0.0025))
    add(box("latch_tab", (0.044, 0.007, 0.005), (0, -0.24, 0.033), grey, bevel=0.0015))

    # Trigger and rotary selector disc under it.
    add(profile("trigger", [(0.034, -0.054), (0.042, -0.054), (0.04, -0.072), (0.043, -0.087), (0.038, -0.089), (0.032, -0.073)], 0.007, mat=grey, bevel=0.0013))
    sel = cyl("selector", 0.011, 0.005, (0, 0.036, -0.1115), "Z", grey, bevel=0.0012, verts=28)
    add(sel)
    for i in range(8):
        kn = box(f"sel_k{i}", (0.003, 0.004, 0.008), (0, 0.036 + 0.0115, -0.1115), bevel=0)
        rotate(kn, i * 45, "Z", (0, 0.036, -0.1115))
        cut(sel, kn)
    add(box("sel_tab", (0.004, 0.012, 0.004), (0, 0.028, -0.1155), grey, bevel=0.0012))


    # ---- Barrel, bushing, flash hider.
    add(cyl("barrel_bush", 0.0135, 0.012, (0, 0.196, 0.0), "Y", poly, bevel=0.002, verts=28))
    add(tube("barrel", 0.0085, 0.0034, 0.03, (0, 0.212, 0.0), "Y", steel, verts=24)[0])
    fh = tube("flash_hider", 0.0115, 0.0034, 0.036, (0, 0.232, 0.0), "Y", park, verts=28)[0]
    for i in range(6):
        sl = box(f"fh_slot{i}", (0.0035, 0.022, 0.012), (0, 0.238, 0.011), bevel=0)
        rotate(sl, i * 60, "Y", (0, 0.238, 0))
        cut(fh, sl)
    add(fh)
    add(tube("fh_crown", 0.0105, 0.0034, 0.004, (0, 0.2505, 0.0), "Y", park, verts=28)[0])

    # ---- Ambidextrous charging handles (both sides, in the slots).
    for sx in (-1, 1):
        add(cyl(f"ch_stem{sx}", 0.0035, 0.012, (sx * 0.026, 0.152, -0.012), "X", grey, bevel=0.0006, verts=12))
        add(cyl(f"ch_knob{sx}", 0.006, 0.0055, (sx * 0.0295, 0.152, -0.012), "X", grey, bevel=0.0018, verts=20))

    # ---- Ring reflex sight housing over the front of the magazine.
    hs = []
    hp = [(0.052, 0.022), (0.056, 0.05), (0.07, 0.081), (0.084, 0.089), (0.158, 0.089), (0.172, 0.081), (0.18, 0.06), (0.18, 0.022)]
    roof = profile("sight_roof", hp, 0.05, mat=poly, bevel=0.008, seg=3)
    cut(roof, box("sight_tunnel", (0.0445, 0.16, 0.0315), (0, 0.115, 0.03475), bevel=0))
    cut(roof, cyl("sight_bore", 0.0128, 0.2, (0, 0.11, 0.064), "Y", bevel=0, verts=32))
    add(roof)
    # Window rims and lens with the ring reticle.
    for y in (0.0545, 0.1775):
        add(tube(f"sight_rim{y}", 0.0145, 0.0125, 0.004, (0, y, 0.064), "Y", grey, verts=24)[0])
    add(cyl("sight_lens", 0.0123, 0.0015, (0, 0.12, 0.064), "Y", lens, bevel=0, verts=32))
    add(tube("reticle_ring", 0.0046, 0.0038, 0.0006, (0, 0.1212, 0.064), "Y", red, verts=28)[0])
    add(cyl("reticle_dot", 0.0007, 0.0006, (0, 0.1212, 0.064), "Y", red, bevel=0, verts=8))
    # Backup iron sights moulded on each side of the housing.
    for x in (-0.017, 0.017):
        add(box(f"bus_rear{x}", (0.005, 0.008, 0.0055), (x, 0.09, 0.0895), poly, bevel=0.0015))
        add(box(f"bus_front{x}", (0.0035, 0.005, 0.005), (x, 0.152, 0.0893), poly, bevel=0.0012))
    # Sight adjustment knob (right side).
    add(cyl("sight_adj", 0.0045, 0.004, (0.0262, 0.13, 0.074), "X", grey, bevel=0.0009, verts=16))

    # Sling attachment points.
    for y in (-0.235, 0.16):
        add(tube(f"sling{y}", 0.0055, 0.003, 0.056, (0, y, -0.035), "X", park, verts=12)[0])

    # ---- Magazine (separate mesh): smoky translucent-look body lying on top,
    # 50 rounds across it, feed tower and lips at the rear.
    mag = profile("mag", [
        (-0.222, 0.021), (0.15, 0.021), (0.156, 0.026), (0.156, 0.044), (0.15, 0.049),
        (-0.205, 0.049), (-0.222, 0.042),
    ], 0.043, mat=smoke, bevel=0.003, seg=3)
    for x in (-0.0215, 0.0215):
        cut(mag, box(f"mag_win{x}", (0.003, 0.312, 0.019), (x, -0.035, 0.0345), bevel=0))
    mparts = [mag]
    # Visible brass inside the clear walls: round bases showing at the side windows.
    brass = M.pbr("p90_brass", "brass")
    for x in (-0.0216, 0.0216):
        strip = profile(f"mag_brass{x}", [(-0.19, 0.026), (0.12, 0.026), (0.12, 0.043), (-0.19, 0.043)], 0.0012, (x * 0.965, 0, 0), brass, bevel=0)
        gro = box(f"brass_gap{x}", (0.006, 0.0025, 0.03), (x * 0.965, -0.186, 0.034), bevel=0)
        array(gro, 37, 0.0085, axis=1)
        cut(strip, gro)
        mparts.append(strip)
    # Darker end caps (follower/feed end and front cap).
    mparts.append(profile("mag_feed", [(-0.226, 0.02), (-0.2, 0.02), (-0.2, 0.05), (-0.212, 0.051), (-0.226, 0.044)], 0.044, mat=poly, bevel=0.004))
    mparts.append(box("mag_cap", (0.046, 0.012, 0.03), (0, 0.15, 0.035), poly, bevel=0.0025))

    export.apply_modifiers(parts + mparts)
    body = sc.join(parts, "p90")
    magj = sc.join(mparts, "mag")
    sc.clean([body, magj], weighted_normals=True)
    return {"objects": [body, magj], "bake": True, "bake_size": 1024, "budget": 26000}
