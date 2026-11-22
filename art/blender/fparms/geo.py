"""Geometry for the first-person arms (right arm; the left one is its mirror).

Starts from the Rocketbox-derived arms (source/rocketbox_arms.glb, the mesh
scripts/fparms/build.mjs used to ship) and rebuilds the wrist:

  - the runtime's old sleeve slimming (twist bones scaled 0.86 across the
    forearm) is baked into the vertices, so rig.ts no longer scales anything
  - the sleeve is cut back to a pushed-up hem (turned edge with thickness),
    tapered onto the forearm over its last centimetres
  - the glove is cut at the base of the hand and gets a real cuff: tapered
    neoprene band, rolled rim with thickness, a hook-and-loop closure tab
  - bare skin (forearm / wrist) between hem and cuff
  - a field watch (case, bezel, dial, crown, lugs, strap) worn face-in on the
    wrist; built on the right arm, moved to the left one by the mirror

Units are metres, Blender space (Z up) as imported. Everything is described
in a forearm frame: t = 0 at the elbow joint, t = 1 at the wrist joint (along
the forearm axis), theta = 0 on the back of the forearm (dorsal), +pi/2 on the
little-finger (ulnar) side.
"""
import json
import math
import struct

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # glTF Y-up -> Blender Z-up

# Layout along the forearm (t: elbow 0 -> wrist joint 1; forearm ~0.26 m).
HEM_T = 0.71          # sleeve hem (pushed up)
GLOVE_CUT_T = 1.04    # glove faces below this are dropped (hidden under the cuff)
CUFF_SEAM_T = 1.066   # where the cuff is sewn onto the glove body
CUFF_END_T = 0.925    # glove cuff edge
WATCH_T = 0.825       # watch centre
SLEEVE_SLIM = 0.86    # what rig.ts used to apply at runtime (twist bones)

# Region ids (material slots; baked as the "region" map).
REGIONS = ["sleeve", "hem", "glove", "cuff", "strap", "skin", "case", "dial", "wstrap", "bezel"]


def region_index(name):
    return REGIONS.index(name)


# ---- Source ------------------------------------------------------------------------

def read_glb_skin(path):
    """Joint names and bind (world) matrices of the glb's skin, in Blender space."""
    with open(path, "rb") as f:
        data = f.read()
    jlen = struct.unpack_from("<I", data, 12)[0]
    js = json.loads(data[20:20 + jlen])
    bin_off = 20 + jlen + 8
    skin = js["skins"][0]
    acc = js["accessors"][skin["inverseBindMatrices"]]
    bv = js["bufferViews"][acc["bufferView"]]
    off = bin_off + bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    ibm = np.frombuffer(data, np.float32, acc["count"] * 16, off).reshape(-1, 4, 4).transpose(0, 2, 1)
    names = [js["nodes"][j]["name"] for j in skin["joints"]]
    Cn = np.array(C)
    bind = {n: Cn @ np.linalg.inv(m.astype(np.float64)) for n, m in zip(names, ibm)}
    return names, bind


def import_source(path):
    bpy.ops.import_scene.gltf(filepath=path)
    mesh = next(o for o in bpy.data.objects if o.type == "MESH" and o.vertex_groups)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o is not mesh:
            bpy.data.objects.remove(o)
    return mesh, arm


class Frame:
    """Forearm / hand frame of one side (right) at bind pose."""

    def __init__(self, arm, side="R"):
        B = {b.name: (arm.matrix_world @ b.head_local) for b in arm.data.bones}
        self.B = B
        p = f"Bip01_{side}_"
        self.E = B[p + "Forearm"]
        self.Wr = B[p + "Hand"]
        self.L = (self.Wr - self.E).length
        self.ax = (self.Wr - self.E).normalized()
        k1, k4 = B[p + "Finger1"], B[p + "Finger4"]
        Z = ((k1 + k4) / 2 - self.Wr).normalized()
        across = (k4 - k1).normalized()
        Y = Z.cross(across)  # out of the palm (right hand, rig.ts)
        d = -(Y - self.ax * Y.dot(self.ax))
        self.dors = d.normalized()
        self.ew = self.ax.cross(self.dors).normalized()
        if self.ew.dot(across) < 0:
            self.ew = -self.ew
        # Hand frame (for the glove features): X across (index -> pinky), Y dorsal, Z to the knuckles.
        self.hZ = Z
        hy = -Y
        hy = (hy - Z * hy.dot(Z)).normalized()
        self.hY = hy
        self.hX = hy.cross(Z).normalized()
        if self.hX.dot(across) < 0:
            self.hX = -self.hX
        self.prefix = p
        # Skin cross-section centre offset (the bones sit nearer the back of the arm).
        self.cd = -0.008

    def t_of(self, P):
        return (P - self.E).dot(self.ax) / self.L

    def polar(self, P):
        q = P - self.E
        t = q.dot(self.ax) / self.L
        d = q.dot(self.dors) - self.cd
        w = q.dot(self.ew)
        return t, math.atan2(w, d), math.hypot(d, w)

    def point(self, t, theta, r):
        return self.E + self.ax * (t * self.L) + self.dors * (self.cd + r * math.cos(theta)) + self.ew * (r * math.sin(theta))

    def normal(self, theta):
        return (self.dors * math.cos(theta) + self.ew * math.sin(theta)).normalized()


def skin_axes(fr, t):
    """Semi-axes (dorsal-ventral, radial-ulnar) of the bare forearm at t."""
    u = max(0.0, (1.0 - t) * fr.L)  # metres from the wrist joint toward the elbow
    return 0.0200 + 0.052 * u, 0.0290 + 0.060 * u


def ellipse_r(a, b, theta, n=2.4):
    """Superellipse radius (n > 2: a slightly boxy forearm section)."""
    c, s = abs(math.cos(theta)), abs(math.sin(theta))
    return 1.0 / ((c / a) ** n + (s / b) ** n) ** (1.0 / n)


def skin_r(fr, t, theta):
    a, b = skin_axes(fr, t)
    return ellipse_r(a, b, theta)


def cuff_r(fr, t, theta):
    """Outer radius of the glove cuff (neoprene over the wrist, slight flare at the edge)."""
    flare = 0.0012 * max(0.0, min(1.0, (0.975 - t) / 0.05))
    return skin_r(fr, min(t, 0.985), theta) + 0.0032 + flare


# ---- Helpers ---------------------------------------------------------------------------

def smoothstep(a, b, x):
    x = min(1.0, max(0.0, (x - a) / (b - a)))
    return x * x * (3 - 2 * x)


def boundary_loops(bm, verts=None):
    """Closed boundary edge loops as ordered vertex lists."""
    edges = [e for e in bm.edges if e.is_boundary and (verts is None or (e.verts[0] in verts and e.verts[1] in verts))]
    adj = {}
    for e in edges:
        a, b = e.verts
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
    seen = set()
    loops = []
    for v0 in adj:
        if v0 in seen:
            continue
        loop = [v0]
        seen.add(v0)
        prev, cur = None, v0
        while True:
            nxt = [x for x in adj[cur] if x is not prev and x not in seen]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            loop.append(cur)
            seen.add(cur)
        loops.append(loop)
    return loops


def orient_loop(fr, loop):
    """Ring sorted by increasing theta (start anywhere), as [(vert, theta, r)]."""
    pol = [(v, *fr.polar(v.co)[1:]) for v in loop]
    # direction: theta should increase along the list
    inc = sum(math.sin(pol[(i + 1) % len(pol)][1] - pol[i][1]) for i in range(len(pol)))
    if inc < 0:
        pol.reverse()
    i0 = min(range(len(pol)), key=lambda i: (pol[i][1] - math.pi) % (2 * math.pi))  # start at the ventral seam
    return pol[i0:] + pol[:i0]


def unwrap_theta(thetas):
    """Monotonic thetas (radians) starting near -pi (ventral seam) for UVs."""
    out = []
    base = thetas[0]
    acc = 0.0
    prev = base
    for th in thetas:
        d = (th - prev + math.pi) % (2 * math.pi) - math.pi
        acc += d
        out.append(base + acc)
        prev = th
    return out


def add_ring_strip(bm, ring_a, ring_b, uv_a, uv_b, uvl, mat, closed=True):
    """Quads between two equal-length vertex rings, with per-loop UVs (uv lists hold n + 1 entries: the seam repeats)."""
    n = len(ring_a)
    faces = []
    for i in range(n if closed else n - 1):
        j = (i + 1) % n
        vs = [ring_a[i], ring_a[j], ring_b[j], ring_b[i]]
        uvs = [uv_a[i], uv_a[i + 1], uv_b[i + 1], uv_b[i]]
        try:
            f = bm.faces.new(vs)
        except ValueError:
            continue
        f.material_index = mat
        for loop, uv in zip(f.loops, uvs):
            loop[uvl].uv = uv
        faces.append(f)
    return faces


# ---- Build -------------------------------------------------------------------------------

def bake_sleeve_slim(mesh, bind):
    """v' = sum_b w_b M_b v with M_b the runtime twist-bone scale (old rig.ts), so the shape stays."""
    names = [g.name for g in mesh.vertex_groups]
    S = np.diag([1.0, SLEEVE_SLIM, SLEEVE_SLIM, 1.0])
    M = {}
    for n in names:
        if "ForeTwist" in n:
            Bw = bind[n]
            M[n] = Bw @ S @ np.linalg.inv(Bw)
    for v in mesh.data.vertices:
        acc = np.zeros(4)
        tot = 0.0
        p = np.array([*v.co, 1.0])
        for g in v.groups:
            n = names[g.group]
            acc += g.weight * (M[n] @ p if n in M else p)
            tot += g.weight
        if tot > 0:
            v.co = Vector((acc / tot)[:3])


def right_half(mesh):
    bm = bmesh.new()
    bm.from_mesh(mesh.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().x >= 0], context="FACES")
    return bm


def components(bm):
    comp = {}
    out = []
    for f in bm.faces:
        if f in comp:
            continue
        st = [f]
        comp[f] = len(out)
        group = []
        while st:
            x = st.pop()
            group.append(x)
            for e in x.edges:
                for y in e.link_faces:
                    if y not in comp:
                        comp[y] = len(out)
                        st.append(y)
        out.append(group)
    return out


def build_right_arm(src_mesh, arm, bind):
    """Returns (bmesh of the rebuilt right arm, frame, info dict)."""
    fr = Frame(arm, "R")
    bake_sleeve_slim(src_mesh, bind)
    bm = right_half(src_mesh)
    uvl = bm.loops.layers.uv.active
    comps = components(bm)
    comps.sort(key=len)
    # Largest two: glove (reaches the fingertips: max t) and sleeve; drop the rest (tiny strap patch).
    big = comps[-2:]
    tmax = [max(fr.t_of(v.co) for f in c for v in f.verts) for c in big]
    glove, sleeve = (big[0], big[1]) if tmax[0] > tmax[1] else (big[1], big[0])
    small = [f for c in comps[:-2] for f in c]
    bmesh.ops.delete(bm, geom=small, context="FACES")
    for f in glove:
        f.material_index = region_index("glove")
    for f in sleeve:
        f.material_index = region_index("sleeve")
    glove_set, sleeve_set = set(glove), set(sleeve)
    info = {}

    def cut(faces, t, keep_distal):
        geom = list({x for f in faces for x in (f, *f.edges, *f.verts)})
        co = fr.E + fr.ax * (t * fr.L)
        res = bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=co, plane_no=fr.ax, clear_inner=keep_distal, clear_outer=not keep_distal)
        return res

    cut(sleeve, HEM_T, keep_distal=False)
    glove_r = measure_radii(bm, fr, glove, [CUFF_SEAM_T, 1.062, 1.055, 1.048, 1.04])
    bmesh.ops.delete(bm, geom=[f for f in glove if f.is_valid and min(fr.t_of(v.co) for v in f.verts) < GLOVE_CUT_T], context="FACES")
    bm.faces.ensure_lookup_table()
    bm.verts.ensure_lookup_table()
    # Remove loose bits left by the cuts.
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")

    def plane_loops(T):
        on = {v for v in bm.verts if abs(fr.t_of(v.co) - T) < 1e-4}
        return boundary_loops(bm, on)

    hem_loops = plane_loops(HEM_T)
    info["hem_loops"] = [len(lp) for lp in hem_loops]
    hem = max(hem_loops, key=len)

    taper_sleeve(bm, fr)
    build_hem(bm, fr, hem, uvl)
    build_cuff(bm, fr, glove_r, uvl)
    build_skin(bm, fr, uvl)
    build_closure_tab(bm, fr, uvl)
    bm.normal_update()
    return bm, fr, info


def taper_sleeve(bm, fr):
    """Pull the last centimetres of the sleeve onto the forearm (a pushed-up sleeve sits snug)."""
    for v in bm.verts:
        f = v.link_faces[0] if v.link_faces else None
        if f is None or f.material_index != region_index("sleeve"):
            continue
        t, th, r = fr.polar(v.co)
        if t < 0.45:
            continue
        rs = skin_r(fr, t, th)
        want = rs + 0.0055 + 0.03 * max(0.0, HEM_T - t)
        k = smoothstep(0.45, HEM_T, t) ** 1.2
        r2 = r + (want - r) * k if r > want else r
        r2 = max(r2, rs + 0.0045)
        v.co = fr.point(t, th, r2)


def ring_points(fr, ring, t, rfun):
    return [fr.point(t, th, rfun(th)) for (_, th, _) in ring]


def build_rings(bm, fr, base_ring, specs, uvl, mat, u_scale):
    """Extrudes rings from an existing boundary ring.

    base_ring: oriented [(vert, theta, r)]; specs: [(t, rfun(theta, r0))]
    UVs: u = unwrapped theta x u_scale, v = cumulative distance along the profile.
    """
    thetas = unwrap_theta([th for (_, th, _) in base_ring])
    us = [th * u_scale for th in thetas]
    us.append(us[0] + 2 * math.pi * u_scale)
    prev = [v for (v, _, _) in base_ring]
    prev_co = [v.co.copy() for v in prev]
    vacc = [0.0] * len(prev)
    rings = [prev]
    faces = []
    for (t, rfun) in specs:
        cur = []
        for i, (v0, th, r0) in enumerate(base_ring):
            cur.append(bm.verts.new(fr.point(t, th, rfun(th, r0))))
        nvacc = [vacc[i] + (cur[i].co - prev_co[i]).length for i in range(len(cur))]
        uv_a = [Vector((us[i], vacc[i])) for i in range(len(prev))] + [Vector((us[-1], vacc[0]))]
        uv_b = [Vector((us[i], nvacc[i])) for i in range(len(cur))] + [Vector((us[-1], nvacc[0]))]
        faces += add_ring_strip(bm, prev, cur, uv_a, uv_b, uvl, mat)
        prev, prev_co, vacc = cur, [v.co.copy() for v in cur], nvacc
        rings.append(cur)
    return rings, faces


def build_hem(bm, fr, loop, uvl):
    ring = orient_loop(fr, loop)
    m = region_index("hem")
    # Turned hem: a rolled edge with fabric thickness, then the inside face going up the arm.
    specs = [
        (HEM_T + 0.0035, lambda th, r0: r0 + 0.0006),
        (HEM_T + 0.0075, lambda th, r0: r0 - 0.0010),
        (HEM_T + 0.0080, lambda th, r0: r0 - 0.0030),
        (HEM_T + 0.0040, lambda th, r0: r0 - 0.0042),
        (HEM_T - 0.05, lambda th, r0: max(r0 - 0.0045, skin_r(fr, HEM_T - 0.05, th) + 0.0008)),
    ]
    build_rings(bm, fr, ring, specs, uvl, m, u_scale=0.045)


CUFF_N = 48


def measure_radii(bm, fr, faces, ts, n=CUFF_N):
    """Outer radius of `faces` per (t, theta) sample (rays from the axis outward)."""
    from mathutils.bvhtree import BVHTree
    verts = list({v for f in faces for v in f.verts})
    idx = {v: i for i, v in enumerate(verts)}
    tree = BVHTree.FromPolygons([v.co.copy() for v in verts], [[idx[v] for v in f.verts] for f in faces])
    out = {}
    for t in ts:
        row = []
        for i in range(n):
            th = -math.pi + 2 * math.pi * i / n
            o = fr.point(t, th, 0.0)
            d = fr.normal(th)
            # first hit from the axis outward: the hand body (not the thumb beside it)
            hit = tree.ray_cast(o, d, 0.12)
            row.append((hit[0] - o).length if hit[0] is not None else 0.0)
        # fill misses from neighbours
        for i in range(n):
            if row[i] == 0.0:
                row[i] = max(row[(i - 1) % n], row[(i + 1) % n], 0.02)
        out[t] = row
    return out


def build_cuff(bm, fr, glove_r, uvl, n=CUFF_N):
    """Neoprene cuff sewn onto the glove body at CUFF_SEAM_T, over the wrist to CUFF_END_T."""
    m = region_index("cuff")
    thetas = [-math.pi + 2 * math.pi * i / n for i in range(n)]
    gt = sorted(glove_r)

    def gr(t, i):
        # glove radius at t (clamped to the measured range)
        t = min(max(t, gt[0]), gt[-1])
        for a, b in zip(gt, gt[1:]):
            if a <= t <= b:
                s = (t - a) / (b - a)
                return glove_r[a][i] * (1 - s) + glove_r[b][i] * s
        return glove_r[gt[0]][i]

    def body(t, i):
        th = thetas[i]
        tgt = cuff_r(fr, t, th)
        s = smoothstep(CUFF_SEAM_T - 0.004, 1.0, t)
        s = 1.0 - s if False else s
        k = smoothstep(1.064, 0.995, t)
        base = gr(t, i) + 0.0013
        r = base + (tgt - base) * k
        if t >= GLOVE_CUT_T:
            r = max(r, gr(t, i) + 0.0011)
        return r

    profile = [(CUFF_SEAM_T, lambda i: gr(CUFF_SEAM_T, i) + 0.0001)]
    for t in (1.062, 1.052, 1.038, 1.02, 1.0, 0.98, 0.96, 0.942):
        profile.append((t, lambda i, t=t: body(t, i)))
    profile += [
        (CUFF_END_T + 0.002, lambda i: cuff_r(fr, CUFF_END_T, thetas[i]) + 0.0004),
        (CUFF_END_T - 0.0005, lambda i: cuff_r(fr, CUFF_END_T, thetas[i]) - 0.0012),
        (CUFF_END_T + 0.001, lambda i: cuff_r(fr, CUFF_END_T, thetas[i]) - 0.0030),
        (CUFF_END_T + 0.03, lambda i: skin_r(fr, CUFF_END_T + 0.03, thetas[i]) + 0.0006),
    ]
    rings = [[bm.verts.new(fr.point(t, thetas[i], rf(i))) for i in range(n)] for (t, rf) in profile]
    rmean = 0.03
    us = [(th + math.pi) * rmean for th in thetas] + [2 * math.pi * rmean]
    vacc = 0.0
    for k in range(len(rings) - 1):
        d = sum((rings[k + 1][i].co - rings[k][i].co).length for i in range(n)) / n
        add_ring_strip(bm, rings[k], rings[k + 1], [Vector((u, vacc)) for u in us], [Vector((u, vacc + d)) for u in us], uvl, m)
        vacc += d


def build_skin(bm, fr, uvl, n=32):
    m = region_index("skin")
    ts = [HEM_T - 0.055, HEM_T - 0.01, 0.745, 0.78, 0.815, 0.85, 0.885, 0.92, 0.955, 0.99]
    thetas = [-math.pi + 2 * math.pi * i / n for i in range(n)]
    rings = []
    for t in ts:
        rings.append([bm.verts.new(fr.point(t, th, skin_r(fr, t, th))) for th in thetas])
    us = [(th + math.pi) * 0.03 for th in thetas] + [2 * math.pi * 0.03]
    for k in range(len(rings) - 1):
        va, vb = ts[k] * fr.L, ts[k + 1] * fr.L
        add_ring_strip(bm, rings[k], rings[k + 1], [Vector((u, va)) for u in us], [Vector((u, vb)) for u in us], uvl, m)


def build_closure_tab(bm, fr, uvl):
    """Hook-and-loop closure tab on the back / little-finger side of the cuff."""
    m = region_index("strap")
    nx, ny = 10, 6
    th0, th1 = math.radians(18), math.radians(86)
    t0, t1 = 0.938, 0.992
    lift = 0.0021

    def surf(t, th, h):
        return fr.point(t, th, cuff_r(fr, t, th) + h)

    # Top grid with rounded corners (corner points pulled in).
    top = []
    for j in range(ny + 1):
        row = []
        for i in range(nx + 1):
            u, v = i / nx, j / ny
            # round the corners: superellipse squeeze
            cu, cv = 2 * u - 1, 2 * v - 1
            k = (abs(cu) ** 6 + abs(cv) ** 6) ** (1 / 6)
            s = 1.0 if k < 1e-6 else min(1.0, max(abs(cu), abs(cv)) / k)
            cu, cv = cu * s, cv * s
            th = th0 + (cu * 0.5 + 0.5) * (th1 - th0)
            t = t0 + (cv * 0.5 + 0.5) * (t1 - t0)
            # pull tab end slightly raised
            h = lift + 0.0008 * smoothstep(0.75, 1.0, u)
            row.append(bm.verts.new(surf(t, th, h)))
        top.append(row)
    rmid = cuff_r(fr, 0.965, (th0 + th1) / 2)
    su = (th1 - th0) * rmid
    sv = (t1 - t0) * fr.L
    for j in range(ny):
        for i in range(nx):
            vs = [top[j][i], top[j][i + 1], top[j + 1][i + 1], top[j + 1][i]]
            f = bm.faces.new(vs)
            f.material_index = m
            for loop, (a, b) in zip(f.loops, [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]):
                loop[uvl].uv = Vector((a / nx * su, b / ny * sv))
    # Side wall down to the cuff surface.
    border = [top[0][i] for i in range(nx)] + [top[j][nx] for j in range(ny)] + [top[ny][i] for i in range(nx, 0, -1)] + [top[j][0] for j in range(ny, 0, -1)]
    low = []
    for v in border:
        t, th, r = fr.polar(v.co)
        low.append(bm.verts.new(fr.point(t, th, cuff_r(fr, t, th) - 0.0006)))
    n = len(border)
    per = 2 * (su + sv)
    acc = [0.0]
    for i in range(1, n + 1):
        acc.append(acc[-1] + (border[i % n].co - border[i - 1].co).length)
    for i in range(n):
        j = (i + 1) % n
        f = bm.faces.new([border[j], border[i], low[i], low[j]])
        f.material_index = m
        u0, u1 = su * 1.2 + acc[i], su * 1.2 + acc[i + 1]
        for loop, uv in zip(f.loops, [(u1, 0.004), (u0, 0.004), (u0, 0.0), (u1, 0.0)]):
            loop[uvl].uv = Vector(uv)
    del per


# ---- Watch ---------------------------------------------------------------------------------

def build_watch(fr, uvl_name="UVMap"):
    """Field watch on the right wrist, face-in (ventral). Returns (bmesh, local frame matrix)."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new(uvl_name)
    th_c = math.pi  # ventral
    t_c = WATCH_T
    # Local frame: origin on the skin at the watch centre, z out of the wrist, x along the forearm (to the hand), y around.
    nrm = fr.normal(th_c)
    o = fr.point(t_c, th_c, skin_r(fr, t_c, th_c))
    x = fr.ax
    y = nrm.cross(x).normalized()
    Mf = Matrix((x, y, nrm)).transposed().to_4x4()
    Mf.translation = o

    def W(p):
        return Mf @ Vector(p)

    mat = {k: region_index(k) for k in ("case", "dial", "wstrap", "bezel")}

    # Strap: band around the wrist (width along x), 1.6 mm thick.
    half_w = 0.010
    n = 36
    thetas = [-math.pi / 2 + 2 * math.pi * i / n for i in range(n)]  # seam on the back of the wrist (under nothing visible)
    def band(dt, h):
        t = t_c + dt / fr.L
        return [bm.verts.new(fr.point(t, th, skin_r(fr, t, th) + h)) for th in thetas]
    rings = [band(-half_w, 0.0002), band(-half_w, 0.0017), band(half_w, 0.0017), band(half_w, 0.0002)]
    circ = 2 * math.pi * skin_r(fr, t_c, 0.0)
    us = [i / n * circ for i in range(n + 1)]
    vs = [0.0, 0.0016, 0.0016 + 2 * half_w, 0.0032 + 2 * half_w]
    for k in range(3):
        add_ring_strip(bm, rings[k], rings[k + 1], [Vector((u, vs[k])) for u in us], [Vector((u, vs[k + 1])) for u in us], uvl, mat["wstrap"])
    # inner face of the band (closes it)
    add_ring_strip(bm, rings[3], rings[0], [Vector((u, vs[3])) for u in us], [Vector((u, vs[3] + 0.02)) for u in us], uvl, mat["wstrap"])

    # Case: lathe profile (r, z) around the local z axis, 40 segments.
    R = 0.0190
    prof = [  # (r, z, region)
        (R - 0.0035, 0.0012, "case"),
        (R - 0.0006, 0.0016, "case"),
        (R, 0.0032, "case"),
        (R + 0.0002, 0.0072, "case"),
        (R - 0.0004, 0.0086, "case"),
        (R - 0.0006, 0.0090, "bezel"),
        (R - 0.0012, 0.0104, "bezel"),
        (R - 0.0034, 0.0110, "bezel"),
        (R - 0.0040, 0.0108, "dial"),
        (0.0, 0.0115, "dial"),
    ]
    seg = 32
    lathe = []
    for (r, z, _) in prof:
        ring = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            ring.append(bm.verts.new(W((r * math.cos(a), r * math.sin(a), z))) if r > 0 else None)
        if r == 0:
            ring = [bm.verts.new(W((0, 0, z)))]
        lathe.append(ring)
    sl = 0.0
    vcoord = [0.0]
    for k in range(1, len(prof)):
        sl += math.hypot(prof[k][0] - prof[k - 1][0], prof[k][1] - prof[k - 1][1])
        vcoord.append(sl)
    for k in range(len(prof) - 1):
        region = prof[k + 1][2]
        a, b = lathe[k], lathe[k + 1]
        for i in range(seg):
            j = (i + 1) % seg
            if region == "dial":
                # dial: planar UVs (top view), so the face texture is drawn in local x / y
                if len(b) == 1:
                    vs_ = [a[i], a[j], b[0]]
                else:
                    vs_ = [a[i], a[j], b[j], b[i]]
                f = bm.faces.new(vs_)
                f.material_index = mat["dial"]
                for loop in f.loops:
                    p = Mf.inverted() @ loop.vert.co
                    loop[uvl].uv = Vector((p.x, p.y))
                continue
            vs_ = [a[i], a[j], b[j], b[i]]
            f = bm.faces.new(vs_)
            f.material_index = mat[region]
            c = 2 * math.pi * R
            for loop, (uu, vv) in zip(f.loops, [(i, k), (i + 1, k), (i + 1, k + 1), (i, k + 1)]):
                loop[uvl].uv = Vector((uu / seg * c, vcoord[vv]))
    # case back (bottom) closes the lathe
    f = bm.faces.new(list(reversed(lathe[0])))
    f.material_index = mat["case"]
    for loop in f.loops:
        p = Mf.inverted() @ loop.vert.co
        loop[uvl].uv = Vector((p.x + 0.05, p.y))

    # Lugs (4) and crown.
    def box(cx, cy, cz, sx, sy, sz, region):
        vs_ = [bm.verts.new(W((cx + dx * sx, cy + dy * sy, cz + dz * sz))) for dx in (-1, 1) for dy in (-1, 1) for dz in (-1, 1)]
        quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
        for q in quads:
            f = bm.faces.new([vs_[i] for i in q])
            f.material_index = mat[region]
            for loop in f.loops:
                p = Mf.inverted() @ loop.vert.co
                loop[uvl].uv = Vector((p.x * 0.5 + p.z + 0.08, p.y * 0.5 + p.z))
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(sx * 0.0078, sy * (R + 0.0030), 0.0052, 0.0016, 0.0040, 0.0022, "case")
    # crown at 3 o'clock (toward the hand)
    cr_seg = 12
    cr = []
    for xx in (R - 0.0005, R + 0.0032):
        cr.append([bm.verts.new(W((xx, 0.0022 * math.cos(2 * math.pi * i / cr_seg), 0.0052 + 0.0022 * math.sin(2 * math.pi * i / cr_seg)))) for i in range(cr_seg)])
    for i in range(cr_seg):
        j = (i + 1) % cr_seg
        f = bm.faces.new([cr[0][i], cr[0][j], cr[1][j], cr[1][i]])
        f.material_index = mat["case"]
        for loop, (uu, vv) in zip(f.loops, [(i, 0), (i + 1, 0), (i + 1, 1), (i, 1)]):
            loop[uvl].uv = Vector((0.1 + uu * 0.0012, vv * 0.0035))
    f = bm.faces.new(cr[1])
    f.material_index = mat["case"]
    for loop in f.loops:
        p = Mf.inverted() @ loop.vert.co
        loop[uvl].uv = Vector((0.12 + p.y, p.z))
    bm.normal_update()
    return bm, Mf
