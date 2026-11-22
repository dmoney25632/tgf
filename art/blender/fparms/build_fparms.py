"""Builds the first-person arms in Blender (headless).

    Blender -b --factory-startup -P art/blender/fparms/build_fparms.py -- --out <work dir> [--size 2048]

Writes into <work dir>:
    arms.json / arms.bin   skinned triangle mesh (glTF space: Y up), joints by
                           bone name; assemble.mjs turns it into the game asset
    fparms_color.png       albedo (tinted regions normalised to mean 0.25 linear)
    fparms_normal.png      tangent-space normal map (OpenGL, +Y up)
    fparms_orm.png         R region (0 sleeve, 1 glove, 0.5 untinted skin / watch),
                           G roughness, B metalness
    maps/*.png             debug views of the intermediate bakes
    fparms.blend           the scene, for inspection

Pipeline: geo.py rebuilds the right arm (wrist, cuff, hem, skin, watch) from
the Rocketbox-derived source; weights for new geometry are transferred from
the source mesh (Data Transfer, nearest face) and cleaned; UVs are packed with
the hands at the highest density, both arms sharing one layout (mirrored);
position / normal / region / AO maps are baked from the right arm and
features.py paints the materials procedurally in texel space (heights,
albedo, roughness); the height map is baked to the normal map through a Bump
node.
"""
import argparse
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import features  # noqa: E402
import geo  # noqa: E402

SOURCE = os.path.join(HERE, "source", "rocketbox_arms.glb")

# Texel density multipliers per region (relative; packed to fill the atlas).
DENSITY = {"sleeve": 0.9, "hem": 1.0, "glove": 1.75, "cuff": 1.4, "strap": 1.5, "skin": 1.35, "case": 1.2, "dial": 3.2, "wstrap": 1.3, "bezel": 1.6}


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    p.add_argument("--size", type=int, default=2048)
    p.add_argument("--samples", type=int, default=64)
    return p.parse_args(argv)


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def select_only(objs, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


# ---- Weights ------------------------------------------------------------------------------

def transfer_weights(target, source):
    """New vertices (no weights yet) take the source's weights at the nearest surface point."""
    for g in source.vertex_groups:
        if g.name not in target.vertex_groups:
            target.vertex_groups.new(name=g.name)
    new = [v.index for v in target.data.vertices if not v.groups]
    mask = target.vertex_groups.new(name="__xfer")
    mask.add(new, 1.0, "REPLACE")
    mod = target.modifiers.new("xfer", "DATA_TRANSFER")
    mod.object = source
    mod.use_vert_data = True
    mod.data_types_verts = {"VGROUP_WEIGHTS"}
    mod.vert_mapping = "POLYINTERP_NEAREST"
    mod.layers_vgroup_select_src = "ALL"
    mod.layers_vgroup_select_dst = "NAME"
    mod.mix_mode = "REPLACE"
    mod.vertex_group = "__xfer"
    select_only([target])
    bpy.ops.object.modifier_apply(modifier=mod.name)
    target.vertex_groups.remove(target.vertex_groups["__xfer"])
    return set(new)


def weight_matrix(obj):
    names = [g.name for g in obj.vertex_groups]
    W = np.zeros((len(obj.data.vertices), len(names)))
    for v in obj.data.vertices:
        for g in v.groups:
            W[v.index, g.group] = g.weight
    return names, W


def set_weights(obj, names, W):
    for gi, n in enumerate(names):
        g = obj.vertex_groups[n]
        g.remove(list(range(len(obj.data.vertices))))
        idx = np.nonzero(W[:, gi] > 0)[0]
        for i in idx:
            g.add([int(i)], float(W[i, gi]), "REPLACE")


def clean_weights(obj, free, iters=4, keep=4, floor=0.02):
    """Laplacian smoothing on the `free` vertices, then <= 4 influences, normalised."""
    names, W = weight_matrix(obj)
    n = len(obj.data.vertices)
    nb = [[] for _ in range(n)]
    for e in obj.data.edges:
        a, b = e.vertices
        nb[a].append(b)
        nb[b].append(a)
    free = np.array(sorted(free))
    for _ in range(iters):
        W2 = W.copy()
        for i in free:
            if nb[i]:
                W2[i] = 0.5 * W[i] + 0.5 * W[nb[i]].mean(0)
        W = W2
    # prune
    for i in range(n):
        row = W[i]
        order = np.argsort(-row)
        row[order[keep:]] = 0
        row[row < floor] = 0
        s = row.sum()
        if s > 0:
            W[i] = row / s
    set_weights(obj, names, W)


# ---- UVs -------------------------------------------------------------------------------------

def uv_islands(bm, uvl):
    """Faces grouped by UV connectivity."""
    parent = {f: f for f in bm.faces}

    def find(x):
        while parent[x] is not x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for e in bm.edges:
        lf = e.link_faces
        if len(lf) != 2:
            continue
        a, b = lf
        ua = {l.vert: l[uvl].uv.copy() for l in a.loops}
        ub = {l.vert: l[uvl].uv.copy() for l in b.loops}
        if all((ua[v] - ub[v]).length < 1e-6 for v in e.verts):
            ra, rb = find(a), find(b)
            if ra is not rb:
                parent[ra] = rb
    groups = {}
    for f in bm.faces:
        groups.setdefault(find(f), []).append(f)
    return list(groups.values())


def pack_uvs(objs, margin):
    # Uniform texel density from 3D area, then per-region multipliers, then pack.
    select_only(objs)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    for o in objs:
        bm = bmesh.from_edit_mesh(o.data)
        uvl = bm.loops.layers.uv.active
        for isl in uv_islands(bm, uvl):
            counts = {}
            for f in isl:
                counts[f.material_index] = counts.get(f.material_index, 0) + f.calc_area()
            reg = geo.REGIONS[max(counts, key=counts.get)]
            k = DENSITY[reg]
            loops = [l for f in isl for l in f.loops]
            c = sum((l[uvl].uv for l in loops), Vector((0, 0))) / len(loops)
            for l in loops:
                l[uvl].uv = c + (l[uvl].uv - c) * k
        bmesh.update_edit_mesh(o.data)
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, rotate_method="ANY", scale=True, merge_overlap=False, margin_method="FRACTION", margin=margin, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")


# ---- Baking --------------------------------------------------------------------------------------

def new_image(name, size, value=(0, 0, 0, 1), float_buffer=True, colorspace="Non-Color"):
    img = bpy.data.images.new(name, size, size, alpha=True, float_buffer=float_buffer)
    img.colorspace_settings.name = colorspace
    img.generated_color = value
    return img


def emit_material(name, build):
    """Material whose surface is an Emission fed by build(nodes, links) -> color socket."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(build(nt.nodes, nt.links), em.inputs["Color"])
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    return m


def with_materials(objs, mats_per_obj):
    saved = []
    for o, mats in zip(objs, mats_per_obj):
        saved.append([s.material for s in o.material_slots])
        for i, s in enumerate(o.material_slots):
            s.material = mats[i] if isinstance(mats, list) else mats
    return saved


def restore_materials(objs, saved):
    for o, mats in zip(objs, saved):
        for s, m in zip(o.material_slots, mats):
            s.material = m


def bake_target(mats, img):
    for m in mats:
        nt = m.node_tree
        n = nt.nodes.get("__bake") or nt.nodes.new("ShaderNodeTexImage")
        n.name = "__bake"
        n.image = img
        nt.nodes.active = n


def bake(objs, kind, img, mats, margin=24, **kw):
    bake_target(mats, img)
    select_only(objs)
    bpy.ops.object.bake(type=kind, margin=margin, margin_type="EXTEND", use_clear=True, **kw)


def pixels(img):
    w, h = img.size
    return np.array(img.pixels[:], np.float32).reshape(h, w, 4)


def bake_maps(objs, size, center, scale):
    """Position / normal / region / coverage maps (float, object space = world)."""
    out = {}
    # position: (P - center) / scale + 0.5
    def pos(N, L):
        g = N.new("ShaderNodeNewGeometry")
        v = N.new("ShaderNodeVectorMath")
        v.operation = "MULTIPLY_ADD"
        L.new(g.outputs["Position"], v.inputs[0])
        v.inputs[1].default_value = (1 / scale,) * 3
        v.inputs[2].default_value = tuple(0.5 - c / scale for c in center)
        return v.outputs[0]

    def nrm(N, L):
        g = N.new("ShaderNodeNewGeometry")
        v = N.new("ShaderNodeVectorMath")
        v.operation = "MULTIPLY_ADD"
        L.new(g.outputs["Normal"], v.inputs[0])
        v.inputs[1].default_value = (0.5, 0.5, 0.5)
        v.inputs[2].default_value = (0.5, 0.5, 0.5)
        return v.outputs[0]

    for key, fn in (("pos", pos), ("nrm", nrm)):
        m = emit_material(f"__{key}", fn)
        saved = with_materials(objs, [m] * len(objs))
        img = new_image(f"__{key}", size)
        bake(objs, "EMIT", img, [m], margin=0)
        out[key] = pixels(img)[..., :3]
        restore_materials(objs, saved)
    # region id per material slot (and coverage in alpha: unbaked texels keep alpha 0)
    regs = []
    for i, r in enumerate(geo.REGIONS):
        def rc(N, L, i=i):
            c = N.new("ShaderNodeRGB")
            c.outputs[0].default_value = ((i + 1) / 16, 1, 0, 1)
            return c.outputs[0]
        regs.append(emit_material(f"__reg{i}", rc))
    saved = with_materials(objs, [regs] * len(objs))
    img = new_image("__region", size, (0, 0, 0, 0))
    bake(objs, "EMIT", img, regs, margin=0)
    px = pixels(img)
    restore_materials(objs, saved)
    out["region"] = np.where(px[..., 1] > 0.5, np.round(px[..., 0] * 16) - 1, -1).astype(np.int32)
    out["pos"] = (out["pos"] - 0.5) * scale + np.array(center)
    out["nrm"] = out["nrm"] * 2 - 1
    return out


def bake_ao(obj, size, samples):
    m = emit_material("__ao_dummy", lambda N, L: N.new("ShaderNodeRGB").outputs[0])
    saved = with_materials([obj], [[m] * len(obj.material_slots)])
    img = new_image("__ao", size, (1, 1, 1, 1))
    bpy.context.scene.cycles.samples = samples
    bake([obj], "AO", img, [m], margin=0)
    restore_materials([obj], saved)
    return pixels(img)[..., 0]


def bake_normal_from_height(objs, H, size, out_path):
    """Tangent-space normal map of the low poly with the height map as bump (metres)."""
    hi = new_image("__height", size)
    hi.pixels.foreach_set(np.dstack([H, H, H, np.ones_like(H)]).astype(np.float32).ravel())
    m = bpy.data.materials.new("__bump")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = hi
    t.interpolation = "Cubic"
    b = nt.nodes.new("ShaderNodeBump")
    b.inputs["Strength"].default_value = 1.0
    b.inputs["Distance"].default_value = 1.0
    nt.links.new(t.outputs["Color"], b.inputs["Height"])
    nt.links.new(b.outputs["Normal"], bsdf.inputs["Normal"])
    saved = with_materials(objs, [m] * len(objs))
    img = new_image("fparms_normal", size, (0.5, 0.5, 1, 1))
    bpy.context.scene.cycles.samples = 4
    bake(objs, "NORMAL", img, [m], margin=0, normal_space="TANGENT")
    restore_materials(objs, saved)
    return pixels(img)[..., :3]


# ---- Export -----------------------------------------------------------------------------------------

def export_mesh(obj, joint_names, path_json):
    """Triangles with per-corner split (uv / normal) -> glTF-space arrays + joints by index in joint_names."""
    me = obj.data
    me.calc_loop_triangles()
    uvl = me.uv_layers.active.data
    cn = me.corner_normals
    vgn = [g.name for g in obj.vertex_groups]
    jidx = {n: i for i, n in enumerate(joint_names)}
    vw = []
    for v in me.vertices:
        gs = sorted(((g.weight, jidx[vgn[g.group]]) for g in v.groups if g.weight > 0 and vgn[g.group] in jidx), reverse=True)[:4]
        tot = sum(w for w, _ in gs) or 1.0
        gs = [(w / tot, j) for w, j in gs] + [(0.0, 0)] * (4 - len(gs))
        vw.append(gs)
    key2i = {}
    P, N, T, J, Wt, I = [], [], [], [], [], []
    for tri in me.loop_triangles:
        for li in tri.loops:
            vi = me.loops[li].vertex_index
            uv = uvl[li].uv
            n = cn[li].vector
            k = (vi, round(uv.x, 6), round(uv.y, 6), round(n.x, 4), round(n.y, 4), round(n.z, 4))
            idx = key2i.get(k)
            if idx is None:
                idx = len(P)
                key2i[k] = idx
                co = me.vertices[vi].co
                P.append((co.x, co.z, -co.y))
                N.append((n.x, n.z, -n.y))
                T.append((uv.x, 1.0 - uv.y))
                J.append([j for _, j in vw[vi]])
                Wt.append([w for w, _ in vw[vi]])
            I.append(idx)
    arrays = {
        "position": np.array(P, np.float32),
        "normal": np.array(N, np.float32),
        "uv": np.array(T, np.float32),
        "joints": np.array(J, np.uint16),
        "weights": np.array(Wt, np.float32),
        "index": np.array(I, np.uint32),
    }
    bin_path = path_json.replace(".json", ".bin")
    meta = {"joints": joint_names, "arrays": {}}
    off = 0
    with open(bin_path, "wb") as f:
        for k, a in arrays.items():
            b = a.tobytes()
            meta["arrays"][k] = {"offset": off, "length": len(b), "dtype": str(a.dtype), "shape": list(a.shape)}
            f.write(b)
            off += len(b)
            pad = (-off) % 4
            f.write(b"\0" * pad)
            off += pad
    with open(path_json, "w") as f:
        json.dump(meta, f)
    return len(I) // 3, len(P)


def save_png(arr, path, colorspace="sRGB"):
    """arr: (h, w, 3|4) float in [0, 1] (bottom-up rows, Blender convention)."""
    h, w = arr.shape[:2]
    if arr.shape[2] == 3:
        arr = np.dstack([arr, np.ones((h, w))])
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=False)
    img.colorspace_settings.name = "Non-Color" if colorspace != "sRGB" else "sRGB"
    img.pixels.foreach_set(np.clip(arr, 0, 1).astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()


# ---- Main ---------------------------------------------------------------------------------------------

def mirror_to_left(obj, name):
    """Copy of obj mirrored across X, vertex groups _R_ -> _L_, faces flipped."""
    o = obj.copy()
    o.data = obj.data.copy()
    o.name = name
    link(o)
    o.data.transform(Matrix.Scale(-1, 4, (1, 0, 0)))
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    bm.to_mesh(o.data)
    bm.free()
    for g in o.vertex_groups:  # swap sides (two passes: the names must not collide)
        if "_R_" in g.name:
            g.name = g.name.replace("_R_", "_L_") + "__tmp"
        elif "_L_" in g.name:
            g.name = g.name.replace("_L_", "_R_") + "__tmp"
    for g in o.vertex_groups:
        g.name = g.name.replace("__tmp", "")
    return o


def make_object(bm, name, materials):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    o = link(bpy.data.objects.new(name, me))
    for m in materials:
        o.data.materials.append(m)
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def main():
    a = args()
    os.makedirs(os.path.join(a.out, "maps"), exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 4

    joint_names, bind = geo.read_glb_skin(SOURCE)
    src, arm = geo.import_source(SOURCE)
    for p in src.data.polygons:
        p.use_smooth = True

    # Region materials (placeholders; the bakes swap them).
    mats = []
    for r in geo.REGIONS:
        m = bpy.data.materials.new(r)
        m.use_nodes = True
        mats.append(m)

    bm, fr, info = geo.build_right_arm(src, arm, bind)
    print("geometry", info)
    # Transfer source: the (slimmed) source right half.
    sb = geo.right_half(src)
    src_r = make_object(sb, "src_R", [])
    for g in src.vertex_groups:
        src_r.vertex_groups.new(name=g.name)
    # bmesh.to_mesh keeps the deform layer, vertex group names come from the object:
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    right = make_object(bm, "arm_R", mats)
    for g in src.vertex_groups:
        right.vertex_groups.new(name=g.name)
    new = transfer_weights(right, src_r)
    clean_weights(right, new)

    wb, Mw = geo.build_watch(fr)
    bmesh.ops.recalc_face_normals(wb, faces=wb.faces[:])
    watch = make_object(wb, "watch_R", mats)
    # Rigid: the skin's weights under the watch centre.
    names, W = weight_matrix(right)
    pos = np.array([v.co for v in right.data.vertices])
    skin_ix = {v for p in right.data.polygons if p.material_index == geo.region_index("skin") for v in p.vertices}
    cand = np.array(sorted(skin_ix))
    c = np.array(Mw.translation)
    near = cand[np.argsort(np.linalg.norm(pos[cand] - c, axis=1))[:6]]
    wrow = W[near].mean(0)
    order = np.argsort(-wrow)
    wrow[order[4:]] = 0
    wrow /= wrow.sum()
    for gi, n in enumerate(names):
        g = watch.vertex_groups.new(name=n)
        if wrow[gi] > 0:
            g.add(list(range(len(watch.data.vertices))), float(wrow[gi]), "REPLACE")
    print("watch weights", {names[i]: round(float(wrow[i]), 3) for i in np.nonzero(wrow)[0]})

    # Smooth by angle: hard edges on the watch, smooth cloth.
    for o, ang in ((right, 80), (watch, 40)):
        select_only([o])
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(ang))

    src.hide_render = True
    src_r.hide_render = True

    # UVs: both arms share the layout (the left is a mirror), the watch lives only on the left.
    margin = 10 / a.size
    pack_uvs([right, watch], margin)

    # Bakes from the right arm + watch (on the right, where its texels are computed).
    center = (fr.E + fr.Wr) / 2
    maps = bake_maps([right, watch], a.size, tuple(center), 1.6)
    watch.hide_render = True
    ao = bake_ao(right, a.size, a.samples)
    watch.hide_render = False
    maps["ao"] = np.where(maps["region"] >= 0, ao, 1.0)
    tex = features.paint(maps, fr, Mw, a.size, a.out)
    nrm = bake_normal_from_height([right, watch], tex["height"], a.size, None)
    tex["normal"] = features.finish_normal(nrm, maps["region"])
    save_png(tex["color"], os.path.join(a.out, "fparms_color.png"))
    save_png(tex["normal"], os.path.join(a.out, "fparms_normal.png"), "Non-Color")
    save_png(tex["orm"], os.path.join(a.out, "fparms_orm.png"), "Non-Color")

    # Final mesh: right arm + mirrored (right arm + watch) as the left.
    left = mirror_to_left(right, "arm_L")
    watch_l = mirror_to_left(watch, "watch_L")
    select_only([right, left, watch_l], right)
    bpy.ops.object.join()
    final = right
    final.name = "arms"
    tris, verts = export_mesh(final, joint_names, os.path.join(a.out, "arms.json"))
    print(f"exported {tris} triangles, {verts} vertices")
    bpy.data.objects.remove(watch)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(a.out, "fparms.blend"))


main()
