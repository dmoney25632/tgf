"""Modular architecture kit: geometry helpers, atlas cells, UV + AO baking.

Conventions (Blender, metres, Z up). Every piece is authored at its real
size with its origin on the OUTER FACE of the wall it hangs on:
    +X  along the wall (left -> right seen from the street)
    +Y  out of the wall, toward the street (exports to glTF -Z)
    +Z  up
Openings (windows, doors) put the origin at the bottom centre of the hole;
1 m modules (cornices, gutters, railings, copings) span x in [-0.5, 0.5].

Materials: all opaque faces share ONE atlas material (`kit_atlas`): a
2048 px sheet of 4 x 4 surface cells (1.25 m of real surface each). Faces keep
an integer `cell` attribute while they are modelled; `map_uvs` projects
every face into its cell in metres. Glass and lamp bulbs are the only
other materials. Per-piece ambient occlusion is baked into the `Col`
corner colour (RGB); its alpha is the tint mask (1 = the instance colour
tints this surface: painted timber, stone and render trims; 0 = keep the
texture colour: iron, brick, slate, hessian).
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

# ---- Atlas cells ---------------------------------------------------------------------------
CELLS = [
    "stone", "rubble_wall", "render", "concrete",
    "timber_paint", "timber_raw", "iron", "zinc",
    "sheet_paint", "brick", "slate", "clay",
    "hessian", "debris", "dark", "oak",
]
CELL = {n: i for i, n in enumerate(CELLS)}
GRID = 4
CELL_M = 1.25         # metres of surface per cell (2048 px sheet: 410 px/m; 1k twin: 205 px/m)
PAD = 0.03            # inset of the usable area inside a cell (m), against mip bleed
TINT_MASK = {
    "stone": 1.0, "rubble_wall": 1.0, "render": 1.0, "concrete": 1.0,
    "timber_paint": 1.0, "timber_raw": 0.0, "iron": 0.0, "zinc": 0.0,
    "sheet_paint": 1.0, "brick": 0.0, "slate": 0.0, "clay": 0.0,
    "hessian": 0.0, "debris": 0.0, "dark": 0.0, "oak": 0.0,
}
# Grain / run direction follows the member (long axis along U) only for these.
DIRECTIONAL = {CELL[n] for n in ("timber_paint", "timber_raw", "oak", "iron", "zinc")}
GLASS = "glass"
LAMP = "lamp"


def cell_rect(i):
    """UV rect (u0, v0, u1, v1) of cell i, row 0 at the top of the image."""
    col, row = i % GRID, i // GRID
    s = 1.0 / GRID
    return col * s, 1.0 - (row + 1) * s, (col + 1) * s, 1.0 - row * s


# ---- Build context --------------------------------------------------------------------------
class Kit:
    """Collects the parts of one piece at one LOD."""

    def __init__(self, lod):
        self.lod = lod
        self.parts = []

    @property
    def fine(self):
        return self.lod == 0

    # Mesh creation ------------------------------------------------------------------------
    def _obj(self, name, bm, cell, bevel, seg=2, smooth=False):
        me = bpy.data.meshes.new(name)
        lay = bm.faces.layers.int.get("cell") or bm.faces.layers.int.new("cell")
        cid = -1 if cell in (GLASS, LAMP) else CELL[cell]
        for f in bm.faces:
            f[lay] = cid
            f.material_index = 1 if cell == GLASS else 2 if cell == LAMP else 0
        bm.to_mesh(me)
        bm.free()
        o = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(o)
        for m in materials():
            o.data.materials.append(m)
        if bevel > 0 and self.lod == 0:
            b = o.modifiers.new("Bevel", "BEVEL")
            b.width = bevel
            b.segments = seg
            b.limit_method = "ANGLE"
            b.angle_limit = math.radians(35)
            b.harden_normals = True
            b.miter_outer = "MITER_ARC"
            o.data.shade_smooth()
            w = o.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL")
            w.keep_sharp = True
        elif smooth:
            o.data.shade_smooth()
        else:
            o.data.shade_flat()
        self.parts.append(o)
        return o

    def box(self, name, size, at, cell, bevel=0.006, seg=2, rot=None, detail=False):
        """Axis-aligned box (size x, y, z) centred at `at`; `rot` = (deg, axis) about its centre.
        `detail` parts (bolts, hinges) are dropped from LOD1."""
        if detail and not self.fine:
            return None
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
        if rot:
            bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(rot[0]), 3, rot[1]))
        bmesh.ops.translate(bm, vec=Vector(at), verts=bm.verts)
        # Thin parts (bars, battens, straps) get a single chamfer: same read, half the triangles.
        return self._obj(name, bm, cell, min(bevel, min(size) * 0.3), 1 if sorted(size)[1] < 0.09 else seg)

    def prism(self, name, pts, x0, x1, cell, bevel=0.004, seg=2, detail=False):
        """Extrude a closed (y, z) section outline from x0 to x1 (mouldings, sills, copings)."""
        if detail and not self.fine:
            return None
        bm = bmesh.new()
        vs = [bm.verts.new((x0, y, z)) for y, z in pts]
        f = bm.faces.new(vs)
        ext = bmesh.ops.extrude_face_region(bm, geom=[f])
        moved = [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]
        bmesh.ops.translate(bm, vec=Vector((x1 - x0, 0, 0)), verts=moved)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return self._obj(name, bm, cell, bevel, seg)

    def prism_z(self, name, pts, z0, z1, cell, bevel=0.004, seg=2, detail=False):
        """Extrude a closed (x, y) plan outline from z0 up to z1."""
        if detail and not self.fine:
            return None
        bm = bmesh.new()
        vs = [bm.verts.new((x, y, z0)) for x, y in pts]
        f = bm.faces.new(vs)
        ext = bmesh.ops.extrude_face_region(bm, geom=[f])
        moved = [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]
        bmesh.ops.translate(bm, vec=Vector((0, 0, z1 - z0)), verts=moved)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return self._obj(name, bm, cell, bevel, seg)

    def prism_y(self, name, pts, y0, y1, cell, bevel=0.004, seg=2, detail=False):
        """Extrude a closed (x, z) elevation outline from y0 to y1 (panels, brackets, arches)."""
        if detail and not self.fine:
            return None
        bm = bmesh.new()
        vs = [bm.verts.new((x, y0, z)) for x, z in pts]
        f = bm.faces.new(vs)
        ext = bmesh.ops.extrude_face_region(bm, geom=[f])
        moved = [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]
        bmesh.ops.translate(bm, vec=Vector((0, y1 - y0, 0)), verts=moved)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return self._obj(name, bm, cell, bevel, seg)

    def cyl(self, name, r, a, b, cell, verts=None, r2=None, bevel=0.0, detail=False, caps=True):
        """Cylinder (or cone, r2) from point a to point b."""
        if detail and not self.fine:
            return None
        n = verts or (16 if self.fine else 8)
        a, b = Vector(a), Vector(b)
        d = b - a
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=caps, segments=n, radius1=r, radius2=r if r2 is None else r2, depth=d.length)
        rot = d.to_track_quat("Z", "Y").to_matrix().to_4x4()
        bmesh.ops.transform(bm, matrix=rot, verts=bm.verts)
        bmesh.ops.translate(bm, vec=(a + b) / 2, verts=bm.verts)
        return self._obj(name, bm, cell, bevel, 1, smooth=True)

    def pillow(self, name, size, at, cell, yaw=0.0):
        """Sandbag: superellipsoid with tied, pinched ends and a sagging belly."""
        seg = (12, 6) if self.fine else (6, 3)
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=seg[0], v_segments=seg[1], radius=1.0)

        def f(x, e):
            return math.copysign(abs(x) ** e, x)

        for v in bm.verts:
            x, y, z = v.co
            x, y, z = f(x, 0.45), f(y, 0.55), f(z, 0.8)
            z *= 1 - 0.28 * abs(x) ** 6
            y *= 1 - 0.18 * abs(x) ** 6
            v.co = Vector((x * size[0] / 2, y * size[1] / 2, z * size[2] / 2))
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(yaw, 3, "Z"))
        bmesh.ops.translate(bm, vec=Vector(at), verts=bm.verts)
        return self._obj(name, bm, cell, 0, smooth=True)

    def rock(self, name, size, at, cell, seed):
        """Irregular rubble lump (displaced icosphere)."""
        import random

        rr = random.Random(seed)
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=2 if self.fine else 1, radius=1.0)  # 80 / 20 faces
        k = [rr.uniform(0.6, 1.3) for _ in range(6)]
        for v in bm.verts:
            x, y, z = v.co
            j = 1 + 0.18 * math.sin(x * 3.1 * k[0] + k[1] * 4) * math.cos(y * 2.7 * k[2]) + 0.1 * math.sin(z * 5 * k[3])
            # Flatten the bottom so lumps sit.
            zz = max(z, -0.55)
            v.co = Vector((x * j * size[0] / 2, y * j * size[1] / 2, zz * j * size[2] / 2))
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(rr.uniform(0, 6.28), 3, "Z"))
        bmesh.ops.translate(bm, vec=Vector(at), verts=bm.verts)
        o = self._obj(name, bm, cell, 0)
        o.data.shade_flat()
        return o


# ---- Materials ------------------------------------------------------------------------------
_MATS = {}


def materials():
    """[kit_atlas, kit_glass, kit_lamp] (created once; atlas images wired in by build)."""
    if not _MATS:
        a = bpy.data.materials.new("kit_atlas")
        a.use_nodes = True
        g = bpy.data.materials.new("kit_glass")
        g.use_nodes = True
        bsdf = g.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = (0.03, 0.04, 0.045, 1)
        bsdf.inputs["Roughness"].default_value = 0.04
        bsdf.inputs["Alpha"].default_value = 0.38
        lamp = bpy.data.materials.new("kit_lamp")
        lamp.use_nodes = True
        lb = lamp.node_tree.nodes["Principled BSDF"]
        lb.inputs["Base Color"].default_value = (1.0, 0.78, 0.45, 1)
        lb.inputs["Emission Color"].default_value = (1.0, 0.7, 0.38, 1)
        lb.inputs["Emission Strength"].default_value = 4.0
        lb.inputs["Roughness"].default_value = 0.3
        _MATS.update(atlas=a, glass=g, lamp=lamp)
    return [_MATS["atlas"], _MATS["glass"], _MATS["lamp"]]


# ---- Assembly --------------------------------------------------------------------------------
def finish(k, name):
    """Apply modifiers, join the parts into one object named `name`."""
    if not k.parts:
        raise ValueError(f"{name}: no parts")
    dg = bpy.context.evaluated_depsgraph_get()
    for o in k.parts:
        if o.modifiers:
            me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
            o.modifiers.clear()
            o.data = me
    bpy.ops.object.select_all(action="DESELECT")
    for o in k.parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = k.parts[0]
    if len(k.parts) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.00005)
    bm.to_mesh(o.data)
    bm.free()
    return o


def map_uvs(o):
    """Project every face into its atlas cell (metres -> cell), long axis along U."""
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    lay = bm.faces.layers.int.get("cell")
    uvl = bm.loops.layers.uv.verify()
    use = CELL_M - 2 * PAD
    for f in bm.faces:
        cid = f[lay] if lay else 0
        n = f.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        if az >= ax and az >= ay:
            pts = [(l.vert.co.x, l.vert.co.y * (1 if n.z > 0 else -1)) for l in f.loops]
        elif ay >= ax:
            pts = [(l.vert.co.x * (1 if n.y > 0 else -1), l.vert.co.z) for l in f.loops]
        else:
            pts = [(l.vert.co.y * (-1 if n.x > 0 else 1), l.vert.co.z) for l in f.loops]
        us = [p[0] for p in pts]
        vs = [p[1] for p in pts]
        eu, ev = max(us) - min(us), max(vs) - min(vs)
        if ev > eu * 1.15 and cid in DIRECTIONAL:
            # Long axis along U so timber grain / metal runs follow the member.
            pts = [(v, -u) for u, v in pts]
            us = [p[0] for p in pts]
            vs = [p[1] for p in pts]
            eu, ev = ev, eu

        def place(vals, ext):
            lo = min(vals)
            off = math.floor(lo / use) * use
            if max(vals) - off > use:
                off = lo
            s = 1.0 if ext <= use else use / ext
            return [(x - off) * s for x in vals]

        uu, vv = place(us, eu), place(vs, ev)
        if cid < 0:
            u0, v0 = 0.0, 0.0
            for l, a, b in zip(f.loops, uu, vv):
                l[uvl].uv = (a / CELL_M * 0.25, b / CELL_M * 0.25)
            continue
        r = cell_rect(cid)
        for l, a, b in zip(f.loops, uu, vv):
            l[uvl].uv = (r[0] + (PAD + a) / CELL_M * (r[2] - r[0]), r[1] + (PAD + b) / CELL_M * (r[3] - r[1]))
    bm.to_mesh(me)
    bm.free()


def bake_ao(o, occluders=(), samples=48, distance=0.35, floor=0.32):
    """Bake per-corner ambient occlusion into `Col` (RGB) and write the tint mask (alpha)."""
    me = o.data
    for a in list(me.color_attributes):
        me.color_attributes.remove(a)
    ca = me.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
    me.color_attributes.active_color = ca
    me.color_attributes.render_color_index = 0
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.samples = samples
    s.cycles.device = "CPU"
    s.render.bake.target = "VERTEX_COLORS"
    if not s.world:
        s.world = bpy.data.worlds.new("w")
    s.world.light_settings.distance = distance
    for x in bpy.context.view_layer.objects:
        x.select_set(False)
    live = [x for x in occluders if x]
    for x in live:
        x.hide_render = False
    o.hide_render = False
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.bake(type="AO")
    for x in live:
        x.hide_render = True
    # Soften (AO only darkens toward `floor`) and add the tint mask in alpha.
    mi = [p.material_index for p in me.polygons]
    lay = me.attributes.get("cell")
    cells = [lay.data[i].value for i in range(len(me.polygons))] if lay else [0] * len(me.polygons)
    for p in me.polygons:
        cid = cells[p.index]
        mask = TINT_MASK[CELLS[cid]] if cid >= 0 and mi[p.index] == 0 else 0.0
        for li in p.loop_indices:
            c = ca.data[li].color
            v = floor + (1 - floor) * c[0]
            ca.data[li].color = (v, v, v, mask)


def tri_count(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


# ---- Bake context (occluders not exported) ---------------------------------------------------
def _cube_obj(name, size, at):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(at), verts=bm.verts)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def wall_with_hole(name, w, h, z0=-1.0, z1=None, T=0.35, L=4.0):
    """Bake occluder: a wall slab (outer face on y = 0, thickness into -y) from z0 to z1
    with a w x h hole whose bottom is at z = 0. Hidden from renders; never exported."""
    z1 = z1 if z1 is not None else h + 1.2
    o = _cube_obj(name, (L, T, z1 - z0), (0, -T / 2, (z0 + z1) / 2))
    if w > 0 and h > 0:
        lo = -0.05 if z0 > -0.01 else 0.0
        ho = _cube_obj(name + "_hole", (w, T * 3, h - lo), (0, -T / 2, (h + lo) / 2))
        m = o.modifiers.new("hole", "BOOLEAN")
        m.object = ho
        m.operation = "DIFFERENCE"
        m.solver = "EXACT"
        dg = bpy.context.evaluated_depsgraph_get()
        o.data = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
        o.modifiers.clear()
        bpy.data.objects.remove(ho)
    o.hide_render = True
    return o


def ground_plane(name, size=6.0):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size / 2)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.hide_render = True
    return o
