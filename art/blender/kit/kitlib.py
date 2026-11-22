"""Modelling helpers for the soldier kit (art/blender/kit/build_kit.py).

Everything is authored in the game's soldier bind space, the same numbers
src/game/ai/soldier/gear.ts uses: metres, three.js axes (+Y up, +Z the
soldier's forward, +X the soldier's left). Each helper builds its mesh in
those coordinates and converts to Blender space (x, -z, y) when it creates
the object, so the glTF exporter (+Y up) writes the numbers back unchanged.

Kept separate from art/blender/tgf (shared by the weapon scripts): the kit
needs body fitting (straps conformed to the Rocketbox bodies), soft fabric
shapes and per-vertex bakes instead of texture bakes.
"""
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector, noise
from mathutils.bvhtree import BVHTree

# three (x, y, z) -> Blender (x, -z, y), and back.
C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
CI = C.inverted()


class Quality:
    """LOD being built: 0 near (bevels, small hardware), 1 mid (coarser rings, no bevels / tiny parts)."""

    lod = 0


Q = Quality()


def seg(n, lo=4):
    """Ring / arc segment count for the current LOD (kept a multiple of 4 for symmetric superellipses)."""
    if Q.lod == 0:
        return n
    return max(lo, int(round(n * 0.5 / 4)) * 4)


def V(x, y, z):
    return Vector((x, y, z))


def T(x=0.0, y=0.0, z=0.0, rx=0.0, ry=0.0, rz=0.0, sx=1.0, sy=1.0, sz=1.0):
    """three.js Matrix4.compose with Euler 'XYZ' (R = Rx * Ry * Rz), in three space."""
    r = Matrix.Rotation(rx, 4, "X") @ Matrix.Rotation(ry, 4, "Y") @ Matrix.Rotation(rz, 4, "Z")
    return Matrix.Translation((x, y, z)) @ r @ Matrix.Diagonal((sx, sy, sz, 1.0))


# ---------------------------------------------------------------------------
# Materials: one per palette role. The game maps the material name (k_<role>)
# to a palette paint (gear.ts ROLE table); the colours here are only for the
# Blender previews.
# ---------------------------------------------------------------------------
PREVIEW = {
    "nylon": (0.11, 0.1, 0.07, 0.85, 0.0),
    "nylonD": (0.07, 0.065, 0.045, 0.85, 0.0),
    "webbing": (0.085, 0.08, 0.055, 0.88, 0.0),
    "strap": (0.05, 0.048, 0.04, 0.9, 0.0),
    "elastic": (0.035, 0.034, 0.03, 0.95, 0.0),
    "molle": (0.11, 0.1, 0.07, 0.85, 0.0),
    "hat": (0.12, 0.12, 0.08, 0.95, 0.0),
    "hatband": (0.08, 0.08, 0.055, 0.95, 0.0),
    "cloth": (0.4, 0.34, 0.24, 0.98, 0.0),
    "clothD": (0.3, 0.26, 0.18, 0.98, 0.0),
    "rubber": (0.012, 0.012, 0.013, 0.7, 0.0),
    "plastic": (0.022, 0.024, 0.025, 0.5, 0.0),
    "polymer": (0.018, 0.019, 0.02, 0.45, 0.0),
    "hardware": (0.02, 0.02, 0.021, 0.55, 0.0),
    "metal": (0.06, 0.065, 0.07, 0.4, 0.7),
    "frame": (0.03, 0.03, 0.03, 0.6, 0.0),
    "glass": (0.025, 0.04, 0.05, 0.08, 0.6),
    "rim": (0.02, 0.02, 0.02, 0.35, 0.3),
    "lens": (0.05, 0.05, 0.05, 0.05, 0.0),
    "foam": (0.01, 0.01, 0.01, 0.98, 0.0),
    "steel": (0.12, 0.12, 0.13, 0.42, 0.55),
    "steelD": (0.07, 0.07, 0.075, 0.42, 0.55),
    "trim": (0.3, 0.2, 0.06, 0.35, 0.6),
    "leather": (0.06, 0.035, 0.02, 0.75, 0.0),
    "ifak": (0.12, 0.05, 0.04, 0.85, 0.0),
    "kneecap": (0.03, 0.03, 0.028, 0.6, 0.0),
    "radio": (0.025, 0.028, 0.026, 0.5, 0.0),
    "accent": (0.5, 0.06, 0.04, 0.8, 0.0),
}


def mat(role):
    name = "k_" + role
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    r, g, b, rough, metal = PREVIEW[role]
    m.diffuse_color = (r, g, b, 1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    nt = m.node_tree
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs[0].default_value = 1.0
    mul.inputs[6].default_value = (r, g, b, 1)
    nt.links.new(vc.outputs["Color"], mul.inputs[7])
    nt.links.new(mul.outputs[2], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    return m


# ---------------------------------------------------------------------------
# Object creation
# ---------------------------------------------------------------------------
class Piece:
    """Collects the objects of one shipped kit piece (joined on finish)."""

    current = None

    def __init__(self, name):
        self.name = name
        self.objs = []
        self.soft = set()  # objects that get fabric noise
        self.wear = 0.2  # base dust amount
        Piece.current = self


def _obj(name, bm, role, M=None, smooth=True):
    if M is not None:
        bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    bmesh.ops.transform(bm, matrix=C, verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(mat(role))
    if smooth:
        o.data.shade_smooth()
    if Piece.current is not None:
        Piece.current.objs.append(o)
    return o


def bevel(o, width, segments=2, angle=32):
    """Real bevel + weighted normals (LOD0 only)."""
    if Q.lod or width <= 0:
        return o
    m = o.modifiers.new("Bevel", "BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    m.angle_limit = math.radians(angle)
    m.harden_normals = False
    m.miter_outer = "MITER_ARC"
    w = o.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL")
    w.keep_sharp = True
    return o


def soft(o, amp=0.0012, freq=38.0):
    """Mark an object for fabric noise (slight puckering / folds after modifiers)."""
    if Piece.current is not None:
        Piece.current.soft.add((o.name, amp, freq))
    return o


def box(name, w, h, d, M, role, bv=0.003, bseg=1):
    """Box w (x) * h (y) * d (z), centred, placed by M (three space)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(w, h, d), verts=bm.verts)
    o = _obj(name, bm, role, M)
    return bevel(o, bv, bseg)


def _ring_pts(r, n):
    rx, rz = r["rx"], r["rz"]
    cx, cz = r.get("cx", 0.0), r.get("cz", 0.0)
    p = r.get("p", 2.0)
    e = 2.0 / p
    out = []
    for i in range(n):
        a = (i / n) * math.tau
        s, c = math.sin(a), math.cos(a)
        x = math.copysign(abs(s) ** e, s) * rx
        z = math.copysign(abs(c) ** e, c) * rz
        out.append(V(cx + x, r["y"], cz + z))
    return out


def loft(name, rings, n, role, M=None, cap0=True, cap1=True, bv=0.0, bseg=2, fn=None):
    """Superellipse rings along y (gear.ts loft): {y, rx, rz, cx, cz, p}. fn(i, j, v) may move vertices."""
    bm = bmesh.new()
    rows = []
    for j, r in enumerate(rings):
        pts = _ring_pts(r, n)
        if fn:
            pts = [fn(i, j, v) for i, v in enumerate(pts)]
        rows.append([bm.verts.new(v) for v in pts])
    for j in range(len(rows) - 1):
        a, b = rows[j], rows[j + 1]
        for i in range(n):
            bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    if cap0:
        bm.faces.new(list(reversed(rows[0])))
    if cap1:
        bm.faces.new(rows[-1])
    o = _obj(name, bm, role, M)
    return bevel(o, bv, bseg)


def sbox(name, w, h, d, M, role, p=5.0, bulge=0.12, rows=2, n=12, bv=0.004, bseg=2, taper=0.0, fn=None, ch=None):
    """Soft rounded box (pouch / pack body): superellipse section bulging at mid height, with
    chamfer rings at top and bottom instead of a bevel modifier (stitched, rolled seams; cheap)."""
    rows = rows if Q.lod == 0 else 1
    c = ch if ch is not None else min(0.006, h * 0.12, d * 0.2)
    k0 = 1 - c / max(min(w, d), 1e-3) * 1.4
    rings = [{"y": -h / 2, "rx": w / 2 * k0, "rz": d / 2 * k0, "p": p}]
    for j in range(rows + 1):
        t = j / rows
        y = -h / 2 + c + (h - 2 * c) * t
        k = 1.0 + bulge * math.sin(t * math.pi) ** 0.8 if 0 < j < rows else 1.0
        tp = 1.0 - taper * t
        rings.append({"y": y, "rx": w / 2 * k * tp, "rz": d / 2 * (1 + (k - 1) * 1.6), "p": p})
    rings.append({"y": h / 2, "rx": w / 2 * k0 * (1 - taper), "rz": d / 2 * k0, "p": p})
    return loft(name, rings, seg(n, 8), role, M, fn=fn)


def cyl(name, r, h, M, role, n=12, r2=None, bv=0.0, caps=True):
    """Cylinder along y, centred."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, segments=seg(n, 6), radius1=r, radius2=r if r2 is None else r2, depth=h)
    bmesh.ops.transform(bm, matrix=Matrix.Rotation(-math.pi / 2, 4, "X"), verts=bm.verts)  # z-axis cone -> y axis
    o = _obj(name, bm, role, M)
    return bevel(o, bv, 1)


def torus(name, R, r, M, role, n=16, m=6):
    bm = bmesh.new()
    vs = []
    n, m = seg(n, 8), max(4, m if Q.lod == 0 else m // 2 + 1)
    for i in range(n):
        a = i / n * math.tau
        row = []
        for j in range(m):
            b = j / m * math.tau
            rr = R + r * math.cos(b)
            row.append(bm.verts.new((rr * math.cos(a), r * math.sin(b), rr * math.sin(a))))
        vs.append(row)
    for i in range(n):
        for j in range(m):
            bm.faces.new((vs[i][j], vs[(i + 1) % n][j], vs[(i + 1) % n][(j + 1) % m], vs[i][(j + 1) % m]))
    return _obj(name, bm, role, M)


# ---------------------------------------------------------------------------
# Straps / webbing
# ---------------------------------------------------------------------------
def catmull(pts, sub):
    """Catmull-Rom resample of a polyline (sub points per span)."""
    if len(pts) < 3 or sub <= 1:
        return [p.copy() for p in pts]
    out = []
    P = [pts[0] * 2 - pts[1]] + list(pts) + [pts[-1] * 2 - pts[-2]]
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(sub):
            t = k / sub
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-2].copy())
    return out


def ribbon(name, pts, outs, width, thick, role, closed=False, bv=0.0, twist=None, back=False):
    """Flat strap of `width` x `thick` along pts (three space); outs = outward normal per point."""
    n = len(pts)
    bm = bmesh.new()
    st = []
    for i in range(n):
        if closed:
            tng = (pts[(i + 1) % n] - pts[(i - 1) % n]).normalized()
        else:
            tng = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        o = outs[i].normalized()
        o = (o - tng * o.dot(tng)).normalized()
        s = tng.cross(o).normalized() * (width / 2)
        if twist:
            s = s * twist[i]
        p = pts[i]
        st.append([bm.verts.new(p + s), bm.verts.new(p - s), bm.verts.new(p - s - o * thick), bm.verts.new(p + s - o * thick)])
    spans = n if closed else n - 1
    for i in range(spans):
        a, b = st[i], st[(i + 1) % n]
        for k in range(4):
            if k == 2 and not back:
                continue  # the face against the body is never seen
            bm.faces.new((a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k]))
    if not closed:
        bm.faces.new(list(reversed(st[0])))
        bm.faces.new(st[-1])
    o = _obj(name, bm, role)
    return bevel(o, bv, 1, angle=40)


def band(name, y, cx, cz, rx, rz, h, t, role, n=24, tilt=0.0, M=None, fn=None, bevel_band=False):
    """Closed elliptical band (strap around a head / limb): height h, thickness t (inward)."""
    n = seg(n, 10)
    bm = bmesh.new()
    rows = []
    for yy, inset in ((y - h / 2, 0.0), (y + h / 2, 0.0), (y + h / 2, t), (y - h / 2, t)):
        row = []
        for i in range(n):
            a = i / n * math.tau
            v = V(cx + math.sin(a) * (rx - inset), yy + math.cos(a) * tilt, cz + math.cos(a) * (rz - inset))
            if fn:
                v = fn(i, v, inset)
            row.append(bm.verts.new(v))
        rows.append(row)
    for j in range(4):
        a, b = rows[j], rows[(j + 1) % 4]
        for i in range(n):
            bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    o = _obj(name, bm, role, M)
    return bevel(o, min(t, h) * 0.3, 1, angle=40) if bevel_band else o


def webbing_row(name, x0, x1, y, M, role="webbing", h=0.0254, t=0.0022, pitch=0.0381, bulge=0.0018, z=0.0):
    """One PALS row (1" webbing) lying on a panel's +z face (panel frame M), bar-tacked every 1.5",
    the strap standing proud between tacks so a channel opens up. Tacks are marked for the vertex bake."""
    nch = max(1, int(round((x1 - x0) / pitch)))
    sub = 2
    bm = bmesh.new()
    tack = bm.verts.layers.float.new("tack")
    cols = []
    total = nch * sub
    for k in range(total + 1):
        u = k / total
        x = x0 + (x1 - x0) * u
        ph = (k % sub) / sub
        lift = bulge * math.sin(ph * math.pi) if Q.lod == 0 else 0.0
        zz = z + t + lift
        col = [bm.verts.new(V(x, y - h / 2, z)), bm.verts.new(V(x, y - h / 2, zz)), bm.verts.new(V(x, y + h / 2, zz)), bm.verts.new(V(x, y + h / 2, z))]
        for v in col:
            v[tack] = 1.0 if (k % sub == 0 and Q.lod == 0) else 0.0
        cols.append(col)
    for k in range(total):
        a, b = cols[k], cols[k + 1]
        for j in range(3):
            bm.faces.new((a[j], b[j], b[j + 1], a[j + 1]))
    bm.faces.new((cols[0][0], cols[0][1], cols[0][2], cols[0][3]))
    bm.faces.new((cols[-1][3], cols[-1][2], cols[-1][1], cols[-1][0]))
    return _obj(name, bm, role, M)


# ---------------------------------------------------------------------------
# Hardware
# ---------------------------------------------------------------------------
def sr_buckle(name, M, w=0.025, role="hardware"):
    """Side-release buckle (female body + male tongue with squeeze arms) for w-wide webbing, along local y, face +z."""
    if Q.lod:
        return [box(name, w + 0.008, 0.05, 0.008, M, role, 0)]
    return [
        box(name + "_f", w + 0.008, 0.028, 0.009, M @ T(0, 0.012, 0), role, 0.002, 1),
        box(name + "_m", w + 0.011, 0.022, 0.007, M @ T(0, -0.014, 0), role, 0.0016, 1),
    ]


def ladder_lock(name, M, w=0.025, role="hardware"):
    if Q.lod:
        return []
    out = [box(name + "_bar", w + 0.006, 0.006, 0.006, M @ T(0, 0.004, 0.002), role, 0.0015, 1)]
    out.append(box(name + "_tab", w + 0.004, 0.012, 0.003, M @ T(0, -0.004, 0.0035, -0.35), role, 0, 1))
    return out


def snap(name, M, r=0.0055, role="metal"):
    """Press-stud / grommet dome."""
    if Q.lod:
        return None
    return cyl(name, r, 0.0025, M @ T(0, 0, 0, math.pi / 2), role, n=10, r2=r * 0.7)


# ---------------------------------------------------------------------------
# Body fitting (three space BVH of the Rocketbox bodies)
# ---------------------------------------------------------------------------
def load_obj(path, keep=None):
    """OBJ written by extract_body.mjs (three space). Returns {part: (verts, faces)}."""
    parts, cur, base, vs = {}, None, 0, []
    for line in open(path):
        if line.startswith("o "):
            cur = line[2:].strip()
            parts[cur] = ([], [])
            base = len(vs)
        elif line.startswith("v "):
            p = tuple(map(float, line.split()[1:4]))
            vs.append(p)
            parts[cur][0].append(p)
        elif line.startswith("f "):
            idx = [int(t.split("/")[0]) - 1 - base for t in line.split()[1:]]
            parts[cur][1].append(idx)
    if keep:
        parts = {k: v for k, v in parts.items() if k in keep}
    return parts


class Body:
    """Union of body surfaces for fitting straps (outermost surface wins)."""

    def __init__(self, files, keep=("body",), side=0, ymax=9.0, xmax=9.0):
        """side: +1 / -1 keeps only that half (x > 0 is the soldier's left), e.g. one leg;
        xmax drops faces further out (the arms, for torso straps)."""
        self.trees = []
        for f in files:
            for k, (verts, faces) in load_obj(f, keep).items():
                if side or ymax < 9 or xmax < 9:
                    faces = [
                        fc for fc in faces
                        if sum(verts[i][0] for i in fc) * side >= 0.0 and min(verts[i][1] for i in fc) < ymax and abs(sum(verts[i][0] for i in fc) / len(fc)) < xmax
                    ]
                self.trees.append(BVHTree.FromPolygons(verts, faces))

    def surface(self, p, hint=None):
        """Outermost body surface near p: (point, normal). With a hint (outward direction) the
        surface is found by casting in from outside along -hint (stable over collars, between legs)."""
        if hint is not None:
            h = hint.normalized()
            o = p + h * 0.2
            best = None
            for t in self.trees:
                loc, nrm, _, d = t.ray_cast(o, -h, 0.45)
                if loc is not None and (best is None or d < best[2]):
                    best = (loc, nrm.normalized(), d)
            if best is not None:
                loc, nrm, _ = best
                if nrm.dot(h) < 0:
                    nrm = -nrm
                return loc, (nrm + h).normalized()
        best = None
        for t in self.trees:
            loc, nrm, _, d = t.find_nearest(p, 0.25)
            if loc is not None and (best is None or d < best[2]):
                best = (loc, nrm.normalized(), d)
        if best is None:
            return p.copy(), (hint or V(0, 0, 1)).normalized()
        return best[0], best[1]

    def conform(self, pts, offset, hints=None, smooth=2):
        """Projects a strap path onto the outermost body surface, `offset` out along the normal."""
        out, nrms = [], []
        for i, p in enumerate(pts):
            loc, n = self.surface(p, hints[i] if hints else None)
            out.append(loc + n * offset)
            nrms.append(n)
        for _ in range(smooth):
            nrms = [((nrms[max(i - 1, 0)] + nrms[i] * 2 + nrms[min(i + 1, len(nrms) - 1)]) / 4).normalized() for i in range(len(nrms))]
            out = [out[0]] + [(out[i - 1] + out[i] * 2 + out[i + 1]) / 4 for i in range(1, len(out) - 1)] + [out[-1]]
        return out, nrms


# ---------------------------------------------------------------------------
# Finishing: modifiers, fabric noise, UVs, per-vertex bake (AO, seams, wear)
# ---------------------------------------------------------------------------
def apply_modifiers(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        if not o.modifiers:
            continue
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
        o.modifiers.clear()
        o.data = me


def _noise_obj(o, amp, freq):
    me = o.data
    me.calc_loop_triangles() if hasattr(me, "calc_loop_triangles") else None
    for v in me.vertices:
        p = CI @ v.co
        k = noise.noise(p * freq) * 0.7 + noise.noise(p * freq * 2.3 + V(3.1, 1.7, 0.4)) * 0.3
        v.co = v.co + v.normal * (k * amp)
    me.update()


def box_uv(o, offset=(0.0, 0.0)):
    """Per-face box projection in metres (three axes), like GeoBuilder: the uber shader's weave,
    folds, camo and PALS rows run at real scale and follow each face without smearing."""
    me = o.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers[0].data
    ox, oy = offset
    for poly in me.polygons:
        n = CI.to_3x3() @ poly.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        for li in poly.loop_indices:
            p = CI @ me.vertices[me.loops[li].vertex_index].co
            if ay >= ax and ay >= az:
                u, v = p.x, p.z
            elif ax >= az:
                u, v = p.z, p.y
            else:
                u, v = p.x, p.y
            uv[li].uv = (u + ox, v + oy)


def _hemi(n, k, count):
    """Deterministic cosine-weighted hemisphere direction k of count around n."""
    a = (k + 0.5) / count
    r = math.sqrt(a)
    phi = k * 2.399963229728653  # golden angle
    t = n.orthogonal().normalized()
    b = n.cross(t)
    return (t * (r * math.cos(phi)) + b * (r * math.sin(phi)) + n * math.sqrt(max(0.0, 1 - a))).normalized()


def bake_vertex(o, occluders, wear=0.2, hard_v=frozenset(), rays=24, dist=0.07):
    """Per-vertex colour attribute 'Col' (exported as COLOR_0):
    rgb = ambient occlusion against the piece and the body, darker in concave seams,
          lighter on convex edges of hard parts (handled wear);
    a   = dust / wear amount for the uber shader (aWear): more in occluded creases."""
    me = o.data
    tree = BVHTree.FromObject(o, bpy.context.evaluated_depsgraph_get())
    nv = len(me.vertices)
    # Convexity from neighbouring vertices.
    conv = [0.0] * nv
    cnt = [0] * nv
    for e in me.edges:
        a, b = e.vertices
        va, vb = me.vertices[a], me.vertices[b]
        d = vb.co - va.co
        L = d.length
        if L < 1e-6:
            continue
        conv[a] += -va.normal.dot(d) / L
        conv[b] += vb.normal.dot(d) / L
        cnt[a] += 1
        cnt[b] += 1
    rgb, alpha = [], []
    for i, v in enumerate(me.vertices):
        p = v.co + v.normal * 0.0012
        n = v.normal
        occ = 0.0
        for k in range(rays):
            dvec = _hemi(n, k, rays)
            hit = None
            best = dist
            for t in [tree] + occluders:
                h = t.ray_cast(p, dvec, best)
                if h[0] is not None:
                    best = h[3]
                    hit = h
            if hit is not None:
                occ += 1.0 - best / dist
        occ /= rays
        ao = 1.0 - 0.9 * min(1.0, occ * 1.6)
        c = conv[i] / max(cnt[i], 1)
        if i in hard_v:
            k = ao * (1.0 + max(0.0, c - 0.2) * 0.6)
            w = 0.6
        else:
            k = ao * (1.0 - max(0.0, -c - 0.2) * 0.35)
            w = 1.0
        rgb.append(k)
        alpha.append(min(1.0, w * wear * (0.6 + 1.2 * (1 - ao))))
    # Bar tacks on PALS webbing: darker stitch bands.
    ta = me.attributes.get("tack")
    if ta is not None and ta.domain == "POINT":
        for i in range(nv):
            if ta.data[i].value > 0.5:
                rgb[i] *= 0.62
    attr = me.color_attributes.get("Col") or me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    for i in range(nv):
        attr.data[i].color = (rgb[i], rgb[i], rgb[i], alpha[i])
    me.color_attributes.active_color = attr
    try:
        me.color_attributes.render_color_index = me.color_attributes.find("Col")
    except Exception:
        pass


def finish(piece, occluders, hard_roles=(), uv_offset=(0.0, 0.0), name=None):
    """Applies modifiers, fabric noise, UVs and the vertex bake; joins into one object named piece.name."""
    objs = piece.objs
    apply_modifiers(objs)
    if os.environ.get("KIT_VERBOSE"):
        print("KIT_PARTS", name or piece.name, sorted(((tris(o), o.name) for o in objs), reverse=True)[:8])
    soft = {n: (a, f) for n, a, f in piece.soft}
    for o in objs:
        if o.name in soft:
            _noise_obj(o, *soft[o.name])
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name or piece.name
    o.data.name = o.name
    me = o.data
    # Merge coincident verts per material island only (keeps hard edges where normals split on export).
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.00005)
    bm.to_mesh(me)
    bm.free()
    box_uv(o, uv_offset)
    hard_idx = {i for i, s in enumerate(o.material_slots) if s.material and s.material.name[2:] in hard_roles}
    hard_v = set()
    for poly in me.polygons:
        if poly.material_index in hard_idx:
            hard_v.update(poly.vertices)
    bake_vertex(o, occluders, wear=piece.wear, hard_v=hard_v)
    return o


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)
