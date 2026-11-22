"""Sample-building render: a crop of a real map assembled from the kit, before / after.

    node --experimental-transform-types --import ./tests/register.mjs tests/archkitDump.ts crop.json x0 x1 z0 z1
    Blender -b --factory-startup -P art/blender/archkit/render_sample.py -- \
        --dump crop.json --kit <raw archkit.gltf (Blender export, PNG atlas)> --out <dir> [--samples 64]

The dump holds the map's merged box geometry inside the crop (three.js axes, vertex
tints; `kitfb:` buckets are the boxes the kit replaces) and every kit placement
(piece, world matrix, tint). "before" renders the boxes alone; "after" hides the
`kitfb:` stand-ins and instances the kit pieces exactly where the game draws them.
"""
import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

# three.js (Y up, -Z forward) -> Blender (Z up).
C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))

BASE = {"slate": (0.33, 0.35, 0.38), "stone": (0.78, 0.74, 0.66), "timber": (0.45, 0.36, 0.27), "setts": (0.5, 0.48, 0.45)}


def args():
    argv = sys.argv[sys.argv.index("--") + 1:]
    p = argparse.ArgumentParser()
    p.add_argument("--dump", required=True)
    p.add_argument("--kit", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--samples", type=int, default=64)
    return p.parse_args(argv)


def vc_material(name, base=(1, 1, 1), rough=0.85, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs["Factor"].default_value = 1
    mul.inputs[6].default_value = (*base, 1)
    nt.links.new(vc.outputs["Color"], mul.inputs[7])
    nt.links.new(mul.outputs[2], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    return m


def context_meshes(dump):
    out = []
    for m in dump["meshes"]:
        name = m["name"]
        pos, col = m["pos"], m["col"]
        n = len(pos) // 3
        verts = [(pos[i * 3], -pos[i * 3 + 2], pos[i * 3 + 1]) for i in range(n)]
        faces = [(i, i + 1, i + 2) for i in range(0, n, 3)]
        me = bpy.data.meshes.new(name)
        me.from_pydata(verts, [], faces)
        attr = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
        for i in range(n):
            attr.data[i].color = (col[i * 3], col[i * 3 + 1], col[i * 3 + 2], 1)
        me.update()
        o = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(o)
        layer = name.split("|")[0].replace("bh-layer:", "") if name.startswith("bh-layer:") else None
        mat = name.split(":")[-1]
        if layer:
            base = next((v for k, v in BASE.items() if k in layer), (0.7, 0.7, 0.7))
            o.data.materials.append(vc_material(f"m_{name}", base, 0.9))
        elif mat in ("metal_dark", "metal_painted", "metal"):
            o.data.materials.append(vc_material(f"m_{name}", (0.6, 0.6, 0.6), 0.5, 0.6))
        elif mat == "decal":
            o.hide_render = True  # alpha-cut decals: not worth a shader here
        else:
            o.data.materials.append(vc_material(f"m_{name}", (0.92, 0.9, 0.86), 0.9))
        o["fallback"] = "kitfb:" in name
        out.append(o)
    return out


def kit_sources(path):
    bpy.ops.import_scene.gltf(filepath=path)
    src = {o.name: o for o in bpy.context.selected_objects if o.type == "MESH"}
    atlas = bpy.data.materials.get("kit_atlas")
    nt = atlas.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    # glTF import may already multiply COLOR_0 in: rebuild atlas * AO * mix(1, tint, mask).
    any_mesh = next(iter(src.values()))
    cname = any_mesh.data.color_attributes[0].name if any_mesh.data.color_attributes else "Color"
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = cname
    info = nt.nodes.new("ShaderNodeObjectInfo")
    tint = nt.nodes.new("ShaderNodeMix")
    tint.data_type = "RGBA"
    nt.links.new(vc.outputs["Alpha"], tint.inputs["Factor"])
    tint.inputs[6].default_value = (1, 1, 1, 1)
    nt.links.new(info.outputs["Color"], tint.inputs[7])
    tex = next(n for n in nt.nodes if n.type == "TEX_IMAGE" and "baseColor" in (n.image.name if n.image else ""))
    m1 = nt.nodes.new("ShaderNodeMix")
    m1.data_type = "RGBA"
    m1.blend_type = "MULTIPLY"
    m1.inputs["Factor"].default_value = 1
    nt.links.new(tex.outputs["Color"], m1.inputs[6])
    nt.links.new(vc.outputs["Color"], m1.inputs[7])
    m2 = nt.nodes.new("ShaderNodeMix")
    m2.data_type = "RGBA"
    m2.blend_type = "MULTIPLY"
    m2.inputs["Factor"].default_value = 1
    nt.links.new(m1.outputs[2], m2.inputs[6])
    nt.links.new(tint.outputs[2], m2.inputs[7])
    nt.links.new(m2.outputs[2], bsdf.inputs["Base Color"])
    g = bpy.data.materials.get("kit_glass")
    if g:
        gb = next(n for n in g.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        gb.inputs["Alpha"].default_value = 0.4
        gb.inputs["Roughness"].default_value = 0.05
    for o in src.values():
        o.hide_render = True
        o.hide_viewport = True
    return src


def place(dump, src):
    objs = []
    for i, p in enumerate(dump["placements"]):
        s = src.get(p["piece"])
        if not s:
            continue
        e = p["m"]
        M = Matrix(((e[0], e[4], e[8], e[12]), (e[1], e[5], e[9], e[13]), (e[2], e[6], e[10], e[14]), (0, 0, 0, 1)))
        o = bpy.data.objects.new(f"k{i}_{p['piece']}", s.data)
        bpy.context.scene.collection.objects.link(o)
        o.matrix_world = C @ M @ C.inverted()
        o.color = (*p["tint"], 1)
        objs.append(o)
    return objs


def setup(samples):
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.samples = samples
    s.cycles.use_denoising = True
    s.cycles.device = "CPU"
    s.render.resolution_x, s.render.resolution_y = 1800, 1100
    s.view_settings.view_transform = "AgX"
    w = bpy.data.worlds.new("w")
    s.world = w
    w.use_nodes = True
    sky = w.node_tree.nodes.new("ShaderNodeTexSky")
    w.node_tree.links.new(sky.outputs["Color"], w.node_tree.nodes["Background"].inputs["Color"])
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.35
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.5
    sun.data.angle = math.radians(1.5)
    sun.rotation_euler = (math.radians(52), 0, math.radians(-35))
    s.collection.objects.link(sun)
    bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, -0.01))
    gnd = bpy.context.active_object
    gnd.data.materials.append(vc_material("ground", (0.32, 0.31, 0.27), 0.95))
    gnd.data.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    for d in gnd.data.color_attributes[0].data:
        d.color = (1, 1, 1, 1)
    return s


def camera(s, loc, target, lens=28):
    cam = bpy.data.objects.get("cam") or bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    if cam.name not in s.collection.objects:
        s.collection.objects.link(cam)
    cam.data.lens = lens
    cam.location = Vector(loc)
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
    s.camera = cam


def three(x, y, z):
    return (x, -z, y)


def main():
    a = args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(a.out, exist_ok=True)
    dump = json.load(open(a.dump))
    s = setup(a.samples)
    ctx = context_meshes(dump)
    src = kit_sources(a.kit)
    kit = place(dump, src)
    views = json.load(open(a.dump)).get("views") or [
        ("street", three(1.5, 1.9, 4.0), three(-3.0, 3.2, 17.0), 24),
        ("door", three(-6.2, 1.7, 8.6), three(-8.8, 1.9, 13.0), 30),
        ("roofs", three(4.0, 9.5, 2.0), three(0.0, 4.5, 18.0), 26),
    ]
    for mode in ("before", "after"):
        for o in ctx:
            if o["fallback"]:
                o.hide_render = mode == "after"
        for o in kit:
            o.hide_render = mode == "before"
        for name, loc, tgt, lens in views:
            camera(s, loc, tgt, lens)
            s.render.filepath = os.path.join(a.out, f"sample_{name}_{mode}.png")
            bpy.ops.render.render(write_still=True)
            print("SAMPLE_RENDER", s.render.filepath)


try:
    main()
except Exception as e:
    import traceback

    traceback.print_exc()
    print("SAMPLE_ERROR", e)
    sys.exit(1)
