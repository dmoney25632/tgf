"""Third-person guns, step 2 (Blender, headless; run by build.mjs).

    Blender -b --factory-startup -P art/blender/tpguns/build_tp.py -- \
        --src <extract dir> --out public/assets/weapons/tp/model.gltf --previews <dir> [--only m4a1,akm] [--atlas 2048]

For every gun extract.ts wrote (OBJ in the third-person rifle frame: butt at
the origin, +Z to the muzzle, +Y up, metres):

  1. rebuilds its source materials (the first-person PBR textures);
  2. welds and decimates a copy to the third-person budget (~2.4-3.4k
     triangles for the gun, ~250 for its magazine) plus a ~1k LOD1 for the mid
     distance band, smooth-by-angle shading;
  3. unwraps every low-poly gun into ONE shared atlas (uniform texel density
     across all guns) and bakes the high-poly onto it, selected-to-active:
     base colour (2048), roughness + metallic packed glTF-style and a
     tangent-space normal map (1024) that carries the detail decimation took
     away;
  4. exports one glTF whose top-level nodes are <kind>, <kind>_mag and
     <kind>_lod1, all on the one material;
  5. renders a contact sheet with the hand anchors marked (red: strong hand,
     green: support hand, yellow: magazine well, blue: muzzle).

Only this folder's code; nothing from art/blender/tgf is modified (the bake
helpers are adapted from tgf/bake.py).
"""
import argparse
import json
import math
import os
import subprocess
import sys
import tempfile
import time

import bmesh
import bpy
from mathutils import Matrix, Vector


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--src", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--previews", required=True)
    p.add_argument("--only", default="")
    p.add_argument("--atlas", type=int, default=2048)
    p.add_argument("--report", default="")
    p.add_argument("--node", default="node")
    return p.parse_args(argv)


def log(*a):
    print("[tpguns]", *a, flush=True)


# three.js (Y up) -> Blender (Z up), the OBJ importer's default mapping.
def to_bl(v):
    return Vector((v[0], -v[2], v[1]))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.unit_settings.system = "METRIC"
    s.unit_settings.scale_length = 1.0
    return s


def select(objs, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


def tri_count(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


# ---- Source materials ----------------------------------------------------------------

def _img(path, colorspace):
    if not path or not os.path.exists(path):
        return None
    im = bpy.data.images.load(path, check_existing=True)
    im.colorspace_settings.name = colorspace
    return im


def source_material(name, info):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    col = info.get("color", [1, 1, 1, 1])
    base = _img(info.get("baseColor"), "sRGB")
    if base:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = base
        if col[:3] != [1, 1, 1]:
            mix = nt.nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs["Factor"].default_value = 1
            nt.links.new(t.outputs["Color"], mix.inputs[6])
            mix.inputs[7].default_value = (col[0], col[1], col[2], 1)
            nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
        else:
            nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = (col[0], col[1], col[2], 1)
    mr = _img(info.get("mr"), "Non-Color")
    met, rough = info.get("metallic", 1), info.get("roughness", 1)
    if mr:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = mr
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(t.outputs["Color"], sep.inputs["Color"])
        for ch, sock, f in (("Green", "Roughness", rough), ("Blue", "Metallic", met)):
            if f != 1:
                mul = nt.nodes.new("ShaderNodeMath")
                mul.operation = "MULTIPLY"
                mul.inputs[1].default_value = f
                nt.links.new(sep.outputs[ch], mul.inputs[0])
                nt.links.new(mul.outputs[0], bsdf.inputs[sock])
            else:
                nt.links.new(sep.outputs[ch], bsdf.inputs[sock])
    else:
        bsdf.inputs["Metallic"].default_value = met
        bsdf.inputs["Roughness"].default_value = rough
    nrm = _img(info.get("normal"), "Non-Color")
    if nrm:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = nrm
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(t.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def import_part(path, name, mats):
    before = set(bpy.data.objects)
    bpy.ops.wm.obj_import(filepath=path, forward_axis="NEGATIVE_Z", up_axis="Y")
    objs = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    if not objs:
        return None
    select(objs)
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    # The importer leaves its axis conversion on the object: bake it into the mesh
    # so the exported nodes carry no transform (the runtime reads raw geometry).
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # usemtl mN -> rebuilt PBR material N.
    for slot in o.material_slots:
        nm = slot.material.name if slot.material else "m0"
        idx = int(nm.split(".")[0][1:]) if nm.startswith("m") and nm.split(".")[0][1:].isdigit() else 0
        key = f"{name}_src{idx}"
        slot.material = bpy.data.materials.get(key) or source_material(key, mats[min(idx, len(mats) - 1)] if mats else {})
    return o


# ---- Low poly ------------------------------------------------------------------------

def make_low(high, name, target):
    low = high.copy()
    low.data = high.data.copy()
    low.name = name
    low.data.name = name
    bpy.context.scene.collection.objects.link(low)
    bm = bmesh.new()
    bm.from_mesh(low.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0004)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(low.data)
    bm.free()
    if low.data.has_custom_normals:
        select([low])
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    tris = tri_count(low)
    if tris > target:
        m = low.modifiers.new("Decimate", "DECIMATE")
        m.decimate_type = "COLLAPSE"
        m.ratio = target / tris
        m.use_collapse_triangulate = True
        select([low])
        bpy.ops.object.modifier_apply(modifier=m.name)
    # The UVs get rebuilt for the atlas.
    while low.data.uv_layers:
        low.data.uv_layers.remove(low.data.uv_layers[0])
    low.data.uv_layers.new(name="atlas")
    select([low])
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40), keep_sharp_edges=True)
    low.data.materials.clear()
    return low


def decimated_copy(low, name, ratio):
    o = low.copy()
    o.data = low.data.copy()
    o.name = name
    o.data.name = name
    bpy.context.scene.collection.objects.link(o)
    m = o.modifiers.new("Decimate", "DECIMATE")
    m.decimate_type = "COLLAPSE"
    m.ratio = ratio
    m.use_collapse_triangulate = True
    select([o])
    bpy.ops.object.modifier_apply(modifier=m.name)
    return o


def _uv_islands(me):
    """Per-face atlas island id (faces joined across edges whose UVs match at both ends)."""
    uv = me.uv_layers.active.data
    par = list(range(len(me.polygons)))

    def find(i):
        while par[i] != i:
            par[i] = par[par[i]]
            i = par[i]
        return i

    edges = {}
    for p in me.polygons:
        n = p.loop_total
        for j in range(n):
            l0, l1 = p.loop_start + j, p.loop_start + (j + 1) % n
            v0, v1 = me.loops[l0].vertex_index, me.loops[l1].vertex_index
            u0, u1 = tuple(uv[l0].uv), tuple(uv[l1].uv)
            k = (min(v0, v1), max(v0, v1))
            side = {v0: u0, v1: u1}
            if k in edges:
                q, other = edges[k]
                if all((side[v][0] - other[v][0]) ** 2 + (side[v][1] - other[v][1]) ** 2 < 1e-12 for v in k):
                    par[find(p.index)] = find(q)
            else:
                edges[k] = (p.index, side)
    return [find(i) for i in range(len(me.polygons))]


def simplified_copy(low, name, target, node):
    """LOD1 through meshoptimizer (simplify.mjs) instead of Blender's COLLAPSE.

    Collapse stalls on some sources (hk416, p90, g36, scarl, m1014 stopped at
    ~1.5-2.3k, and what it did collapse tore the receivers apart): edges shared
    by 3+ faces (fins, overlapping panels), cracks a little too wide for
    make_low's weld and the many atlas seams leave it few valid collapses.

    Here a copy is welded at 1 mm (cracks stop being borders) and simplified
    on positions alone, so seams don't pin anything; meshoptimizer never moves
    a vertex, so every LOD1 corner is a low-poly vertex. Each kept triangle is
    then textured from ONE atlas island: one that holds all three corners when
    there is one (their exact UVs), else the island of the low-poly face
    nearest its centre, with corners outside that island placed by that
    face's own UV mapping, extended. A triangle never interpolates between
    two islands, so there are no smeared texels across the atlas."""
    from mathutils.bvhtree import BVHTree
    from mathutils.geometry import barycentric_transform

    src = low.data.copy()
    bm = bmesh.new()
    bm.from_mesh(src)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.001)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])
    bm.to_mesh(src)
    bm.free()
    island = _uv_islands(src)
    uv = src.uv_layers.active.data
    vuv = [dict() for _ in src.vertices]  # vertex -> {island: uv}
    for p in src.polygons:
        for li in p.loop_indices:
            vuv[src.loops[li].vertex_index].setdefault(island[p.index], tuple(uv[li].uv))
    io = os.path.join(tempfile.gettempdir(), f"tpguns_{os.getpid()}_{name}.json")
    with open(io, "w") as f:
        json.dump({"pos": [c for v in src.vertices for c in v.co], "idx": [v for p in src.polygons for v in p.vertices], "target": int(target)}, f)
    try:
        subprocess.run([node, os.path.join(os.path.dirname(os.path.abspath(__file__)), "simplify.mjs"), io], check=True)
        with open(io) as f:
            res = json.load(f)
    finally:
        os.remove(io)
    bvh = BVHTree.FromPolygons([v.co for v in src.vertices], [tuple(p.vertices) for p in src.polygons])
    tris, tuvs, seen = [], [], set()
    for t in range(0, len(res["idx"]), 3):
        c = res["idx"][t:t + 3]
        k = min((c[0], c[1], c[2]), (c[1], c[2], c[0]), (c[2], c[0], c[1]))  # same winding = duplicate
        if len(set(c)) < 3 or k in seen:
            continue
        seen.add(k)
        co = [src.vertices[i].co for i in c]
        near = bvh.find_nearest((co[0] + co[1] + co[2]) / 3)[2]
        common = set(vuv[c[0]]) & set(vuv[c[1]]) & set(vuv[c[2]])
        isl = island[near] if not common or island[near] in common else min(common)
        fp = src.polygons[near]
        fco = [src.vertices[v].co for v in fp.vertices]
        fuv = [Vector((*uv[li].uv, 0.0)) for li in fp.loop_indices]
        out = []
        for i, p in zip(c, co):
            if isl in vuv[i]:
                out.append(vuv[i][isl])
            else:
                q = barycentric_transform(p, *fco, *fuv)
                out.append((q.x, q.y))
        tris.append(c)
        tuvs.append(out)
    used = sorted({i for c in tris for i in c})
    remap = {v: n for n, v in enumerate(used)}
    me = bpy.data.meshes.new(name)
    me.from_pydata([src.vertices[v].co.copy() for v in used], [], [[remap[i] for i in c] for c in tris])
    lay = me.uv_layers.new(name="atlas")
    for li, u in enumerate(u for tu in tuvs for u in tu):
        lay.data[li].uv = u
    bpy.data.meshes.remove(src)
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    select([o])
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40), keep_sharp_edges=True)
    log(f"{name}: meshopt {tri_count(low)} -> {tri_count(o)} tris (target {int(target)}, error {res['error']:.4f})")
    return o


def atlas_unwrap(lows):
    select(lows)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=True, margin_method="FRACTION", margin=0.004, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")


# ---- Bake (adapted from tgf/bake.py: selected-to-active, shared atlas) -------------

def _image(name, size, colorspace, color=(0, 0, 0, 1)):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = colorspace
    img.generated_color = color
    return img


def _swap_inputs(objs, socket):
    """Route a Principled input into Emission on every source material so it bakes as a colour."""
    saved = []
    done = set()
    for o in objs:
        for slot in o.material_slots:
            m = slot.material
            if not m or m.name in done:
                continue
            done.add(m.name)
            nt = m.node_tree
            bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
            out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
            src = bsdf.inputs[socket]
            emit = nt.nodes.new("ShaderNodeEmission")
            if src.is_linked:
                nt.links.new(src.links[0].from_socket, emit.inputs["Color"])
            else:
                v = src.default_value
                emit.inputs["Color"].default_value = (v, v, v, 1) if isinstance(v, float) else v
            old = out.inputs["Surface"].links[0].from_socket
            nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
            saved.append((nt, out, old, emit))
    return saved


def _restore(saved):
    for nt, out, old, emit in saved:
        nt.links.new(old, out.inputs["Surface"])
        nt.nodes.remove(emit)


def bake_atlas(pairs, size, out_dir):
    """pairs: [(high, low)]. All lows share one material whose active image node is the bake target."""
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.device = "CPU"
    s.cycles.samples = 4
    s.render.bake.margin = 6
    bake_mat = bpy.data.materials.new("tp_bake")
    bake_mat.use_nodes = True
    target = bake_mat.node_tree.nodes.new("ShaderNodeTexImage")
    bake_mat.node_tree.nodes.active = target
    for _, low in pairs:
        low.data.materials.clear()
        low.data.materials.append(bake_mat)
    half = max(256, size // 2)
    base = _image("tp_baseColor", size, "sRGB", (0.1, 0.1, 0.1, 1))
    rough = _image("tp_r", half, "Non-Color", (0.6, 0.6, 0.6, 1))
    metal = _image("tp_m", half, "Non-Color")
    normal = _image("tp_normal", half, "Non-Color", (0.5, 0.5, 1, 1))
    highs = [h for h, _ in pairs]
    jobs = [("DIFFUSE", base, None, {"pass_filter": {"COLOR"}}), ("EMIT", rough, "Roughness", {}), ("EMIT", metal, "Metallic", {}), ("NORMAL", normal, None, {"normal_space": "TANGENT"})]
    for kind, img, socket, kw in jobs:
        t0 = time.time()
        target.image = img
        saved = _swap_inputs(highs, socket) if socket else []
        for high, low in pairs:
            ext = max(0.004, 0.012 * max(low.dimensions))
            select([high, low], active=low)
            bpy.ops.object.bake(type=kind, use_selected_to_active=True, cage_extrusion=ext, max_ray_distance=ext * 2.5, margin=6, use_clear=False, **kw)
        _restore(saved)
        log(f"baked {img.name} ({kind}) in {time.time() - t0:.1f} s")
    mr = _image("tp_metallicRoughness", half, "Non-Color")
    import numpy as np
    rp = np.empty(half * half * 4, dtype=np.float32)
    mp = np.empty(half * half * 4, dtype=np.float32)
    rough.pixels.foreach_get(rp)
    metal.pixels.foreach_get(mp)
    px = np.ones(half * half * 4, dtype=np.float32)
    px[1::4] = rp[0::4]
    px[2::4] = mp[0::4]
    mr.pixels.foreach_set(px)
    os.makedirs(out_dir, exist_ok=True)
    for img in (base, normal, mr):
        img.filepath_raw = os.path.join(out_dir, img.name + ".png")
        img.file_format = "PNG"
        img.save()
    # The shipped material: one glTF PBR material on every gun.
    m = bpy.data.materials.new("tp_gun")
    m.use_nodes = True
    m.use_backface_culling = True  # exported single-sided
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tb = nt.nodes.new("ShaderNodeTexImage")
    tb.image = base
    nt.links.new(tb.outputs["Color"], bsdf.inputs["Base Color"])
    tm = nt.nodes.new("ShaderNodeTexImage")
    tm.image = mr
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(tm.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    tn = nt.nodes.new("ShaderNodeTexImage")
    tn.image = normal
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    return m


# ---- Preview contact sheet -----------------------------------------------------------

def contact_sheet(guns, info, path, cell=(640, 300)):
    import numpy as np
    s = bpy.context.scene
    s.render.engine = "BLENDER_EEVEE"
    s.render.resolution_x, s.render.resolution_y = cell
    s.render.film_transparent = False
    world = bpy.data.worlds.new("w")
    s.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.5, 0.52, 0.55, 1)
    bg.inputs["Strength"].default_value = 1.0
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-60))
    s.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.type = "ORTHO"
    s.collection.objects.link(cam)
    s.camera = cam
    marks = {}
    for nm, col in (("R", (1, 0, 0, 1)), ("L", (0, 1, 0, 1)), ("W", (1, 1, 0, 1)), ("M", (0, 0.3, 1, 1))):
        mm = bpy.data.materials.new(f"mark{nm}")
        mm.use_nodes = True
        b = next(n for n in mm.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        b.inputs["Base Color"].default_value = col
        b.inputs["Emission Color"].default_value = col
        b.inputs["Emission Strength"].default_value = 2
        marks[nm] = mm
    cells = []
    kinds = list(guns.keys())
    for kind in kinds:
        objs = guns[kind]
        for o in s.objects:
            if o.type == "MESH":
                o.hide_render = True
        tmp = []
        for o in objs:
            o.hide_render = False
        g = info[kind]

        def ball(pos, key, r=0.009):
            bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=to_bl(pos), segments=10, ring_count=6)
            b = bpy.context.active_object
            b.data.materials.append(marks[key])
            tmp.append(b)

        def axis(m, key):
            # Anchor frame: X (index -> pinky) drawn as a short bar.
            p = Vector((m[12], m[13], m[14]))
            x = Vector((m[0], m[1], m[2]))
            for k in range(1, 4):
                ball(p + x * 0.012 * k, key, 0.004)
        ball(g["gripR"]["m"][12:15], "R")
        axis(g["gripR"]["m"], "R")
        ball(g["gripL"]["m"][12:15], "L")
        axis(g["gripL"]["m"], "L")
        ball(g["muzzle"], "M")
        if g.get("mag"):
            ball(g["mag"]["well"], "W")
        L = g["length"]
        cam.data.ortho_scale = L * 1.15
        # Gun's left side (soldier's left = three +X = Blender +X), looking along -X.
        cam.location = Vector((1.5, -L / 2, 0.0))
        cam.rotation_euler = (math.radians(90), 0, math.radians(90))
        s.render.filepath = path + f".{kind}.png"
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(s.render.filepath)
        a = np.empty(cell[0] * cell[1] * 4, dtype=np.float32)
        img.pixels.foreach_get(a)
        cells.append(a.reshape(cell[1], cell[0], 4))
        bpy.data.images.remove(img)
        os.remove(s.render.filepath)
        for b in tmp:
            bpy.data.objects.remove(b)
    cols = 3
    rows = (len(cells) + cols - 1) // cols
    sheet = np.ones((rows * cell[1], cols * cell[0], 4), dtype=np.float32)
    for i, c in enumerate(cells):
        r = rows - 1 - i // cols  # Blender images are bottom-up
        sheet[r * cell[1]:(r + 1) * cell[1], (i % cols) * cell[0]:(i % cols + 1) * cell[0]] = c
    out = bpy.data.images.new("sheet", cols * cell[0], rows * cell[1], alpha=True)
    out.pixels.foreach_set(sheet.ravel())
    out.filepath_raw = path
    out.file_format = "PNG"
    out.save()
    log("contact sheet", path, "order:", ", ".join(kinds))


# ---- Main ----------------------------------------------------------------------------

LOD1_RATIO = 0.36


def body_budget(length):
    return int(max(2400, min(3400, 2400 + 1100 * (length - 0.6))))


def main():
    a = args()
    reset()
    with open(os.path.join(a.src, "index.json")) as f:
        info = json.load(f)["guns"]
    only = [k for k in a.only.split(",") if k]
    kinds = [k for k in info if not only or k in only]
    pairs, ship, guns, report = [], [], {}, {}
    for kind in kinds:
        d = os.path.join(a.src, kind)
        with open(os.path.join(d, "materials.json")) as f:
            mats = json.load(f)
        high = import_part(os.path.join(d, "body.obj"), f"{kind}_high", mats)
        low = make_low(high, kind, body_budget(info[kind]["length"]))
        pairs.append((high, low))
        objs = [low]
        mag = None
        if os.path.exists(os.path.join(d, "mag.obj")):
            mh = import_part(os.path.join(d, "mag.obj"), f"{kind}_maghigh", mats)
            mag = make_low(mh, f"{kind}_mag", 260)
            pairs.append((mh, mag))
            objs.append(mag)
        guns[kind] = objs
        report[kind] = {"tris": tri_count(low), "magTris": tri_count(mag) if mag else 0}
        log(f"{kind}: {tri_count(high)} -> {tri_count(low)} tris (+ mag {report[kind]['magTris']})")
    atlas_unwrap([lo for _, lo in pairs])
    out_dir = os.path.dirname(os.path.abspath(a.out))
    mat = bake_atlas(pairs, a.atlas, out_dir)
    for kind, objs in guns.items():
        # LOD1 ~36% of the body. Blender's collapse is kept where it gets there
        # (its output is what those guns shipped with); where it stalls well
        # short, meshoptimizer takes over (see simplified_copy).
        target = round(LOD1_RATIO * tri_count(objs[0]))
        lod = decimated_copy(objs[0], f"{kind}_lod1", LOD1_RATIO)
        if tri_count(lod) > target * 1.15:
            log(f"{kind}_lod1: collapse stalled at {tri_count(lod)} tris")
            bpy.data.objects.remove(lod)
            lod = simplified_copy(objs[0], f"{kind}_lod1", target, a.node)
        report[kind]["lod1Tris"] = tri_count(lod)
        objs.append(lod)
    for objs in guns.values():
        for o in objs:
            o.data.materials.clear()
            o.data.materials.append(mat)
            ship.append(o)
    for h, _ in pairs:
        h.hide_render = True
    # Export (the node runner converts the PNGs and runs the KTX2 / meshopt encoder).
    select(ship)
    bpy.ops.export_scene.gltf(filepath=a.out, export_format="GLTF_SEPARATE", use_selection=True, export_apply=True, export_yup=True,
                              export_texcoords=True, export_normals=True, export_tangents=False, export_materials="EXPORT",
                              export_image_format="AUTO", export_animations=False, export_extras=False)
    log("exported", a.out)
    os.makedirs(a.previews, exist_ok=True)
    for o in bpy.data.objects:
        if o.type == "MESH" and (o.name.endswith("_high") or o.name.endswith("_maghigh") or o.name.endswith("_lod1")):
            o.hide_render = True
    contact_sheet({k: [o for o in v if not o.name.endswith("_lod1")] for k, v in guns.items()}, info, os.path.join(a.previews, "tp_guns.png"))
    if a.report:
        with open(a.report, "w") as f:
            json.dump(report, f, indent=1)
    print("TP_REPORT", json.dumps(report))


try:
    main()
except SystemExit:
    raise
except Exception as e:
    import traceback

    traceback.print_exc()
    print("TP_ERROR", e)
    sys.exit(1)
