"""LODs, glTF export and preview renders."""
import math
import os

import bpy
from mathutils import Vector

from . import scene as sc


def apply_modifiers(objs):
    """Bake bevels / weighted normals / subdivision into the mesh before export."""
    dg = bpy.context.evaluated_depsgraph_get()
    for o in sc.meshes(objs):
        if not o.modifiers:
            continue
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
        o.modifiers.clear()
        o.data = me


def add_lod(obj, ratio, suffix):
    """Decimated copy named <obj>_<suffix> (hidden from export unless asked)."""
    lod = obj.copy()
    lod.data = obj.data.copy()
    lod.name = f"{obj.name}_{suffix}"
    bpy.context.scene.collection.objects.link(lod)
    m = lod.modifiers.new("Decimate", "DECIMATE")
    m.ratio = ratio
    return lod


def export_gltf(path, objs):
    """Separate .gltf + .bin + PNG textures (the KTX2 step converts textures and meshopt-packs)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLTF_SEPARATE",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_animations=False,
        export_extras=True,
    )


def render_previews(objs, out_dir, name, size=768, samples=24):
    """Three-quarter, side and first-person-ish renders under a studio light (Cycles, CPU)."""
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.samples = samples
    s.cycles.device = "CPU"
    s.render.resolution_x = size
    s.render.resolution_y = int(size * 0.6)
    s.render.film_transparent = False
    world = bpy.data.worlds.new("preview") if not s.world else s.world
    s.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.32, 0.33, 0.35, 1)
    bg.inputs["Strength"].default_value = 0.6

    lo, hi = sc.bounds(objs)
    c = (lo + hi) / 2
    r = max((hi - lo).length, 0.05)

    key = bpy.data.objects.new("key", bpy.data.lights.new("key", "AREA"))
    key.data.energy = 120 * r * r
    key.data.size = r
    key.location = c + Vector((r, -r, r * 1.2))
    s.collection.objects.link(key)
    rim = bpy.data.objects.new("rim", bpy.data.lights.new("rim", "AREA"))
    rim.data.energy = 60 * r * r
    rim.data.size = r
    rim.location = c + Vector((-r * 1.2, r, r * 0.6))
    s.collection.objects.link(rim)
    for l in (key, rim):
        l.rotation_euler = (c - l.location).to_track_quat("-Z", "Y").to_euler()

    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = 50
    s.collection.objects.link(cam)
    s.camera = cam
    os.makedirs(out_dir, exist_ok=True)
    # 50 mm lens: ~1.6 r keeps the whole asset in frame.
    views = {
        "three_quarter": Vector((r * 1.25, -r * 0.95, r * 0.45)),
        "side": Vector((r * 1.7, 0, 0.02 * r)),
        "pov": Vector((0.03 * r, -r * 0.95, r * 0.16)),
    }
    paths = []
    for view, off in views.items():
        cam.location = c + off
        cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
        p = os.path.join(out_dir, f"{name}_{view}.png")
        s.render.filepath = p
        bpy.ops.render.render(write_still=True)
        paths.append(p)
    for o in (key, rim, cam):
        bpy.data.objects.remove(o)
    return paths


def report(objs):
    lo, hi = sc.bounds(objs)
    size = hi - lo
    return {
        "triangles": sc.tri_count(objs),
        "size_m": [round(v, 4) for v in size],
        "objects": [o.name for o in objs],
        "materials": sorted({s.material.name for o in sc.meshes(objs) for s in o.material_slots if s.material}),
        "angle_check": math.isfinite(size.length),
    }
