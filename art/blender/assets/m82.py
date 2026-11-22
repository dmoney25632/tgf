"""Barrett M82A1 (.50 BMG), scoped, bipod and carry handle folded, modelled from public reference dimensions.

Overall 1448 mm, 737 mm fluted barrel, receiver ~74 mm wide, 10-round box magazine.
Front = +Y, bore axis on z = 0, muzzle at the max +Y. Positions are written as
d = distance behind the muzzle (Y = MZ - d) so they read like the spec sheet.
Two shipped meshes: `m82` (everything) and `mag` (split off so reloads move it).
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

from tgf import export, materials as M
from tgf import scene as sc
from tgf.model import _bevel, _obj, array, box, cut, cyl, profile, rotate, tube

MZ = 0.80  # muzzle Y


def Y(d):
    return MZ - d


# ---------------------------------------------------------------- local helpers
def zext(name, pts, z0, z1, mat=None, bevel=0.0015, seg=3):
    """Plan-view outline [(x, y)] extruded along Z from z0 to z1."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    f = bm.faces.new([bm.verts.new((x, y, z0)) for x, y in pts])
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    bmesh.ops.translate(bm, vec=Vector((0, 0, z1 - z0)), verts=[e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    return _bevel(_obj(name, me, mat), bevel, seg)


def yext(name, pts, y0, y1, mat=None, bevel=0.0015, seg=3):
    """Cross-section outline [(x, z)] extruded along Y from y0 to y1."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    f = bm.faces.new([bm.verts.new((x, y0, z)) for x, z in pts])
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    bmesh.ops.translate(bm, vec=Vector((0, y1 - y0, 0)), verts=[e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    return _bevel(_obj(name, me, mat), bevel, seg)


def lathe(name, pts, mat=None, at=(0.0, 0.0), seg=32, sharp=40):
    """Surface of revolution about a Y-parallel axis through (x, z) = at. pts = [(r, y)], ends at r = 0."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    vs = [bm.verts.new((r, y, 0.0)) for r, y in pts]
    es = [bm.edges.new((vs[i], vs[i + 1])) for i in range(len(vs) - 1)]
    bmesh.ops.spin(bm, geom=vs + es, cent=(0, 0, 0), axis=(0, 1, 0), steps=seg, angle=2 * math.pi, use_duplicate=False)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.translate(bm, vec=Vector((at[0], 0, at[1])), verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    o = _obj(name, me, mat)
    me.shade_smooth()
    try:
        me.set_sharp_from_angle(angle=math.radians(sharp))
    except Exception:
        pass
    return o


def rod(name, p0, p1, r, mat=None, verts=12, bevel=0.0006):
    """Cylinder between two points."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    o = cyl(name, r, d.length, (0, 0, 0), "Z", mat, bevel=bevel, verts=verts)
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    o.data.transform(Matrix.Translation((p0 + p1) / 2) @ q.to_matrix().to_4x4())
    o.data.update()
    return o


def stadium(yc, zc, length, height, n=6):
    """Side-view rounded slot outline [(y, z)]."""
    r = height / 2
    h = length / 2 - r
    pts = []
    for i in range(n + 1):
        a = -math.pi / 2 + math.pi * i / n
        pts.append((yc + h + r * math.cos(a), zc + r * math.sin(a)))
    for i in range(n + 1):
        a = math.pi / 2 + math.pi * i / n
        pts.append((yc - h + r * math.cos(a), zc + r * math.sin(a)))
    return pts


def build(ctx):
    metal = M.pbr("m82_parkerized", "parkerized", wear=0.7)
    dark = M.pbr("m82_phosphate", "parkerized", base=(0.028, 0.029, 0.031), wear=0.45)
    barrel_m = M.pbr("m82_barrel", "blued_steel", wear=0.35)
    steel = M.pbr("m82_steel", "steel_bare", roughness=0.36)
    poly = M.pbr("m82_polymer", "polymer_black", scale=160)
    rubber = M.pbr("m82_rubber", "rubber", scale=200)
    scope_m = M.pbr("m82_scope", "anodized_black", wear=0.35)
    glass = M.pbr("m82_glass", "glass_lens")
    parts = []
    add = parts.append

    # ------------------------------------------------------------ upper receiver
    # Big stamped steel upper: perforated barrel shroud in front, receiver behind,
    # one straight top line from the barrel bushing to the cheek rest.
    UT, UB, UW = 0.038, -0.042, 0.074
    up = profile("upper", [
        (Y(0.51), -0.028), (Y(0.51), 0.022), (Y(0.53), UT), (Y(1.30), UT), (Y(1.31), UT - 0.012),
        (Y(1.31), UB + 0.01), (Y(1.30), UB), (Y(0.53), UB),
    ], UW, mat=metal, bevel=0.004, seg=2)
    add(up)
    # Hollow the shroud so the cooling ports open onto the barrel, not into solid metal.
    cut(up, box("shroud_cavity", (UW - 0.012, 0.335, 0.062), (0, Y(0.69), -0.003), bevel=0))
    cut(up, cyl("bushing_hole", 0.0215, 0.05, (0, Y(0.51), 0), "Y", bevel=0, verts=28))
    # Cooling ports: a row of long rounded slots down each side of the shroud.
    ports = profile("port_cut", stadium(Y(0.575), 0.006, 0.036, 0.022, n=5), 0.12, bevel=0)
    array(ports, 6, -0.05, axis=1)
    cut(up, ports)
    # Small round vents along the lower edge of the shroud.
    vents = cyl("vent_cut", 0.0055, 0.12, (0, Y(0.585), -0.027), "X", bevel=0, verts=12)
    array(vents, 6, -0.05, axis=1)
    cut(up, vents)
    # Ejection port (right side), with the bolt face visible inside.
    cut(up, box("eject_cut", (0.014, 0.085, 0.03), (UW / 2, Y(0.935), 0.004), bevel=0))
    add(box("bolt_face", (0.006, 0.082, 0.026), (UW / 2 - 0.007, Y(0.935), 0.004), steel, bevel=0.001))
    # Charging handle slot + handle (right side, behind the port).
    cut(up, box("ch_slot", (0.01, 0.075, 0.008), (UW / 2, Y(1.06), 0.0), bevel=0))
    add(box("ch_stem", (0.02, 0.012, 0.008), (UW / 2 + 0.006, Y(1.03), 0.0), steel, bevel=0.0015))
    add(cyl("ch_knob", 0.008, 0.018, (UW / 2 + 0.022, Y(1.03), 0.0), "X", poly, bevel=0.0025, verts=16))
    # Pressed side stiffening ridges along the receiver.
    for x in (-UW / 2 - 0.0008, UW / 2 + 0.0008):
        add(box(f"ridge{x}", (0.003, 0.30, 0.006), (x, Y(1.12), 0.024), metal, bevel=0.0012))
        add(box(f"ridge_f{x}", (0.003, 0.32, 0.005), (x, Y(0.69), 0.03), metal, bevel=0.001))
    # Barrel bushing at the shroud nose.
    add(tube("bushing", 0.0285, 0.0212, 0.014, (0, Y(0.512), 0), "Y", dark, verts=24)[0])

    # Picatinny rail along the top.
    r0, r1 = 0.70, 1.20
    rl = yext("rail", [(-0.0105, UT - 0.001), (0.0105, UT - 0.001), (0.0105, UT + 0.004), (0.0085, UT + 0.0065), (0.0105, UT + 0.009),
                       (0.0105, UT + 0.011), (-0.0105, UT + 0.011), (-0.0105, UT + 0.009), (-0.0085, UT + 0.0065), (-0.0105, UT + 0.004)],
              Y(r1), Y(r0), dark, bevel=0.0006, seg=1)
    slot_c = box("rail_slot", (0.03, 0.0052, 0.004), (0, Y(r0 + 0.008), UT + 0.0115), bevel=0)
    array(slot_c, int((r1 - r0 - 0.012) / 0.01), -0.01, axis=1)
    cut(rl, slot_c)
    add(rl)
    for d in (r0 + 0.02, r1 - 0.02):
        add(cyl(f"rail_screw{d}", 0.0032, 0.003, (0, Y(d), UT + 0.0115), "Z", steel, bevel=0, verts=10))

    # Carry handle, folded flat on the shroud ahead of the scope.
    for x in (-0.024, 0.024):
        add(rod(f"ch_arm{x}", (x, Y(0.69), UT + 0.006), (x, Y(0.575), UT + 0.006), 0.0045, steel, verts=10))
        add(box(f"ch_pivot{x}", (0.012, 0.02, 0.014), (x, Y(0.69), UT + 0.004), dark, bevel=0.002))
    add(rod("ch_grip", (-0.026, Y(0.575), UT + 0.006), (0.026, Y(0.575), UT + 0.006), 0.0085, poly, verts=16, bevel=0.002))

    # ------------------------------------------------------------ barrel + brake
    add(cyl("barrel_in", 0.021, 0.44, (0, Y(0.73), 0), "Y", barrel_m, bevel=0, verts=24))
    bar = cyl("barrel", 0.0208, 0.36, (0, Y(0.325), 0), "Y", barrel_m, bevel=0.0008, verts=24, r2=0.0178)
    add(bar)
    # Six flutes on the exposed barrel.
    for i in range(6):
        f = cyl(f"flute{i}", 0.0032, 0.25, (0, Y(0.33), 0.0212), "Y", bevel=0, verts=10)
        rotate(f, i * 60 + 30, "Y", (0, Y(0.33), 0))
        cut(bar, f)
    # Brake collar + lock.
    add(cyl("brake_collar", 0.023, 0.028, (0, Y(0.165), 0), "Y", dark, bevel=0.002, verts=28))
    add(box("brake_lock", (0.012, 0.016, 0.008), (0, Y(0.165), 0.024), steel, bevel=0.0012))
    # Double-chamber arrowhead brake: plan view is the arrowhead, chevron baffles inside.
    hw = 0.046
    brake = zext("brake", [(-0.015, Y(0.0)), (0.015, Y(0.0)), (hw, Y(0.05)), (hw, Y(0.142)), (hw - 0.006, Y(0.152)),
                           (-hw + 0.006, Y(0.152)), (-hw, Y(0.142)), (-hw, Y(0.05))], -0.031, 0.031, dark, bevel=0.003, seg=3)
    cut(brake, zext("win_f", [(0, Y(0.028)), (0.07, Y(0.05)), (0.07, Y(0.088)), (0, Y(0.07)), (-0.07, Y(0.088)), (-0.07, Y(0.05))], -0.022, 0.022, bevel=0))
    cut(brake, zext("win_r", [(0, Y(0.085)), (0.07, Y(0.103)), (0.07, Y(0.14)), (0, Y(0.128)), (-0.07, Y(0.14)), (-0.07, Y(0.103))], -0.022, 0.022, bevel=0))
    for sz in (1, -1):  # nose chamfers top and bottom
        ch = box(f"brake_ch{sz}", (0.2, 0.1, 0.04), (0, Y(0.04) + 0.05, sz * (0.031 + 0.02)), bevel=0)
        rotate(ch, -16 * sz, "X", (0, Y(0.04), sz * 0.031))
        cut(brake, ch)
    cut(brake, cyl("brake_bore", 0.0095, 0.2, (0, Y(0.08), 0), "Y", bevel=0, verts=20))
    add(brake)

    # ------------------------------------------------------------ lower receiver
    LW = 0.066
    low = profile("lower", [
        (Y(0.83), -0.03), (Y(1.28), -0.03), (Y(1.29), 0.04), (Y(1.36), 0.044), (Y(1.36), -0.135),
        (Y(1.335), -0.137), (Y(1.16), -0.082), (Y(1.0), -0.076), (Y(0.995), -0.082), (Y(0.845), -0.082), (Y(0.83), -0.065),
    ], LW, mat=metal, bevel=0.004, seg=3)
    cut(low, box("magwell", (0.054, 0.152, 0.1), (0, Y(0.92), -0.075), bevel=0))
    add(low)
    # Magwell lip (flared mouth).
    add(box("mw_lip_f", (LW + 0.004, 0.008, 0.01), (0, Y(0.838), -0.078), metal, bevel=0.002))
    add(box("mw_lip_r", (LW + 0.004, 0.008, 0.01), (0, Y(1.002), -0.077), metal, bevel=0.002))
    # Cross pins tying the upper to the lower.
    for d in (0.87, 1.02, 1.15, 1.27):
        add(cyl(f"pin{d}", 0.0042, UW + 0.004, (0, Y(d), -0.035), "X", steel, bevel=0, verts=12))
    # Mag catch behind the magwell.
    add(box("mag_catch", (0.03, 0.01, 0.016), (0, Y(1.008), -0.09), steel, bevel=0.0015))
    # Trigger guard + trigger.
    tg = profile("trigger_guard", [(Y(1.0), -0.076), (Y(1.0), -0.112), (Y(1.008), -0.116), (Y(1.085), -0.116), (Y(1.09), -0.082)], 0.014, mat=metal, bevel=0.002)
    cut(tg, profile("tg_hole", [(Y(1.007), -0.07), (Y(1.007), -0.108), (Y(1.012), -0.111), (Y(1.078), -0.111), (Y(1.083), -0.07)], 0.05, bevel=0))
    add(tg)
    tpts = []
    for i in range(7):
        s = i / 6
        tpts.append((Y(1.04 + math.sin(s * 1.4) * 0.008 - 0.002), -0.074 - s * 0.028))
    for i in range(6, -1, -1):
        s = i / 6
        tpts.append((Y(1.04 + math.sin(s * 1.4) * 0.008 + 0.004 - s * 0.0015), -0.074 - s * 0.028))
    add(profile("trigger", tpts, 0.007, mat=steel, bevel=0.001, seg=2))
    # Pistol grip: raked back, palm swell and finger grooves.
    rake, glen, gd = 0.32, 0.118, 0.046
    gy0, gz0 = 1.112, -0.076
    sd, cz = math.sin(rake), -math.cos(rake)
    gp = []
    for i in range(9):  # back edge, top -> bottom
        s = i / 8
        sw = math.sin(s * math.pi) * 0.005
        gp.append((Y(gy0 + gd / 2 + sd * glen * s + sw), gz0 + cz * glen * s))
    gp.append((Y(gy0 + gd / 2 + sd * glen + 0.003), gz0 + cz * glen - 0.006))
    gp.append((Y(gy0 - gd / 2 + sd * glen - 0.004), gz0 + cz * glen - 0.006))
    for i in range(12, -1, -1):  # front edge, bottom -> top, finger grooves
        s = i / 12
        ridge = 0.0035 * abs(math.sin(s * math.pi * 3)) if 0 < i < 12 else 0
        gp.append((Y(gy0 - gd / 2 + sd * glen * s + ridge), gz0 + cz * glen * s))
    gp.append((Y(gy0 - gd / 2 - 0.004), gz0 + 0.006))
    gp.append((Y(gy0 + gd / 2 + 0.006), gz0 + 0.006))
    grip = profile("grip", gp, 0.036, mat=poly, bevel=0.007, seg=3)
    add(grip)
    # Safety selector on the left above the grip.
    add(cyl("safety", 0.008, 0.004, (-LW / 2 - 0.002, Y(1.10), -0.05), "X", steel, bevel=0.001, verts=18))
    add(box("safety_lever", (0.004, 0.022, 0.006), (-LW / 2 - 0.004, Y(1.09), -0.044), steel, bevel=0.0012))

    # Butt: steel butt plate, thick rubber recoil pad, cheek rest on top.
    add(box("butt_plate", (0.072, 0.022, 0.182), (0, Y(1.372), -0.0455), dark, bevel=0.004))
    add(box("recoil_pad", (0.07, 0.066, 0.176), (0, Y(1.415), -0.046), rubber, bevel=0.014, seg=3))
    add(box("cheek_rest", (0.062, 0.15, 0.016), (0, Y(1.235), UT + 0.006), poly, bevel=0.005, seg=3))
    # Rear monopod folded along the bottom of the butt, with the socket at the rear.
    add(cyl("mono_socket", 0.011, 0.03, (0, Y(1.32), -0.135), "Z", dark, bevel=0.002, verts=18))
    ang = math.atan2(0.137 - 0.082, 1.335 - 1.16)
    add(rod("mono_leg", (0, Y(1.32), -0.142), (0, Y(1.19), -0.142 + 0.13 * math.tan(ang)), 0.007, steel, verts=14))
    add(box("mono_foot", (0.04, 0.03, 0.008), (0, Y(1.185), -0.106), rubber, bevel=0.003))
    add(rod("mono_knob", (-0.016, Y(1.32), -0.135), (0.016, Y(1.32), -0.135), 0.0055, steel, verts=12))

    # ------------------------------------------------------------ bipod (folded back)
    add(box("bipod_clamp", (UW + 0.008, 0.034, 0.016), (0, Y(0.545), UB - 0.004), dark, bevel=0.003))
    add(cyl("bipod_pivot", 0.006, UW + 0.02, (0, Y(0.545), UB - 0.01), "X", steel, bevel=0.0008, verts=14))
    for x in (-0.026, 0.026):
        add(rod(f"bp_tube{x}", (x, Y(0.55), UB - 0.013), (x, Y(0.72), UB - 0.014), 0.0078, metal, verts=14))
        add(rod(f"bp_inner{x}", (x, Y(0.72), UB - 0.014), (x, Y(0.80), UB - 0.015), 0.0058, steel, verts=12))
        add(box(f"bp_collar{x}", (0.02, 0.012, 0.02), (x, Y(0.715), UB - 0.014), dark, bevel=0.002))
        add(box(f"bp_foot{x}", (0.026, 0.05, 0.01), (x * 1.08, Y(0.815), UB - 0.017), dark, bevel=0.003))
    for x in (-0.026, 0.026):
        add(rod(f"bp_spring{x}", (x, Y(0.555), UB - 0.004), (x, Y(0.62), UB - 0.008), 0.0035, steel, verts=8))

    # ------------------------------------------------------------ scope (10x, 30 mm tube)
    ZS = 0.082
    at = (0.0, ZS)
    add(lathe("scope_body", [
        (0, Y(0.779)), (0.0238, Y(0.779)), (0.0246, Y(0.765)), (0.0283, Y(0.765)), (0.0283, Y(0.838)), (0.0268, Y(0.848)),
        (0.0152, Y(0.874)), (0.0152, Y(1.005)), (0.0172, Y(1.026)), (0.0197, Y(1.042)), (0.0197, Y(1.088)), (0.017, Y(1.093)),
        (0.0162, Y(1.088)), (0, Y(1.088)),
    ], scope_m, at=at, seg=28))
    add(cyl("obj_glass", 0.0238, 0.001, (0, Y(0.7785), ZS), "Y", glass, bevel=0, verts=32))
    add(cyl("eye_glass", 0.0162, 0.001, (0, Y(1.0875), ZS), "Y", glass, bevel=0, verts=28))
    add(lathe("sunshade_ring", [(0, Y(0.80)), (0.0288, Y(0.80)), (0.0288, Y(0.808)), (0, Y(0.808))], dark, at=at, seg=32))
    add(lathe("eyecup", [(0, Y(1.094)), (0.0175, Y(1.094)), (0.021, Y(1.092)), (0.0213, Y(1.108)), (0.0185, Y(1.112)), (0.016, Y(1.108)), (0, Y(1.108))], rubber, at=at, seg=28))
    pr = cyl("power_ring", 0.0207, 0.02, (0, Y(1.056), ZS), "Y", dark, bevel=0, verts=36)
    add(pr)
    for i in range(12):  # grip ribs on the power ring
        b = box(f"pr_rib{i}", (0.003, 0.016, 0.004), (0, Y(1.056), ZS + 0.0215), bevel=0)
        rotate(b, i * 30, "Y", (0, Y(1.056), ZS))
        cut(pr, b)
    add(box("pr_lever", (0.005, 0.008, 0.01), (0.0215, Y(1.056), ZS + 0.006), scope_m, bevel=0.0015))
    # Saddle + turrets: elevation on top, windage right, side focus left.
    add(box("saddle", (0.036, 0.056, 0.036), (0, Y(0.935), ZS), scope_m, bevel=0.007, seg=2))
    add(cyl("elev_base", 0.0125, 0.012, (0, Y(0.935), ZS + 0.022), "Z", scope_m, bevel=0.001, verts=24))
    el = cyl("elev_cap", 0.0145, 0.016, (0, Y(0.935), ZS + 0.035), "Z", dark, bevel=0.0018, verts=28)
    add(cyl("elev_line", 0.0148, 0.002, (0, Y(0.935), ZS + 0.029), "Z", scope_m, bevel=0, verts=28))
    add(el)
    add(cyl("wind_base", 0.0115, 0.01, (0.022, Y(0.935), ZS), "X", scope_m, bevel=0.001, verts=24))
    add(cyl("wind_cap", 0.013, 0.013, (0.032, Y(0.935), ZS), "X", dark, bevel=0.0016, verts=24))
    add(cyl("focus_base", 0.0115, 0.01, (-0.022, Y(0.935), ZS), "X", scope_m, bevel=0.001, verts=24))
    add(cyl("focus_knob", 0.0165, 0.012, (-0.032, Y(0.935), ZS), "X", dark, bevel=0.0018, verts=28))
    # Rings + clamp bases on the rail.
    for d in (0.888, 0.99):
        add(tube(f"ring{d}", 0.0198, 0.015, 0.018, (0, Y(d), ZS), "Y", scope_m, verts=24)[0])
        add(box(f"ring_base{d}", (0.028, 0.022, 0.022), (0, Y(d), UT + 0.011 + 0.009), scope_m, bevel=0.003))
        add(cyl(f"ring_bolt{d}", 0.0042, 0.034, (0, Y(d), UT + 0.015), "X", steel, bevel=0, verts=12))
        add(box(f"ring_nut{d}", (0.006, 0.012, 0.012), (0.018, Y(d), UT + 0.015), steel, bevel=0.0015))
        for x in (-0.019, 0.019):
            add(box(f"ring_split{d}{x}", (0.006, 0.018, 0.004), (x, Y(d), ZS), scope_m, bevel=0.001))
            for dy in (-0.005, 0.005):
                add(cyl(f"ring_screw{d}{x}{dy}", 0.0022, 0.004, (x * 1.12, Y(d) + dy, ZS), "X", steel, bevel=0, verts=6))

    # ------------------------------------------------------------ magazine (separate mesh)
    mag = profile("mag", [(Y(0.848), -0.038), (Y(0.992), -0.038), (Y(0.992), -0.156), (Y(0.848), -0.156)], 0.052, mat=metal, bevel=0.0025)
    rib = box("mag_rib", (0.07, 0.11, 0.004), (0, Y(0.92), -0.108), bevel=0)
    array(rib, 2, -0.022, axis=2)
    cut(mag, rib)
    mbase = box("mag_base", (0.058, 0.152, 0.011), (0, Y(0.92), -0.1605), dark, bevel=0.003)
    mspine = box("mag_spine", (0.012, 0.006, 0.1), (0, Y(0.992), -0.108), metal, bevel=0.0015)

    export.apply_modifiers(parts + [mag, mbase, mspine])
    body = sc.join(parts, "m82")
    magj = sc.join([mag, mbase, mspine], "mag")
    sc.clean([body, magj], weighted_normals=True)
    return {"objects": [body, magj], "bake": True, "bake_size": 1024, "budget": 30000}
