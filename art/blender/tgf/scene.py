"""Scene helpers: reset, import sources, clean meshes into game-ready shape."""
import math
import os

import bpy
import bmesh
from mathutils import Vector


def reset():
    """Empty scene in metres (1 unit = 1 m)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.unit_settings.system = "METRIC"
    s.unit_settings.scale_length = 1.0
    return s


def import_source(path):
    """Import FBX / OBJ / glTF / glb / .blend (appends all objects). Returns the new objects."""
    before = set(bpy.data.objects)
    ext = os.path.splitext(path)[1].lower()
    if ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=path)
    elif ext in (".gltf", ".glb"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".blend":
        with bpy.data.libraries.load(path) as (src, dst):
            dst.objects = list(src.objects)
        for o in dst.objects:
            if o is not None:
                bpy.context.scene.collection.objects.link(o)
    else:
        raise ValueError(f"unsupported source: {path}")
    return [o for o in bpy.data.objects if o not in before]


def meshes(objs=None):
    return [o for o in (objs or bpy.context.scene.objects) if o.type == "MESH"]


def apply_transforms(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def bounds(objs):
    lo = Vector((math.inf,) * 3)
    hi = Vector((-math.inf,) * 3)
    for o in meshes(objs):
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    return lo, hi


def fit_length(objs, length, axis=1):
    """Uniformly scale so the extent along `axis` (Blender Y = game -Z barrel) equals `length` metres."""
    lo, hi = bounds(objs)
    cur = hi[axis] - lo[axis]
    if cur <= 0:
        return
    k = length / cur
    for o in objs:
        if o.parent is None:
            o.scale *= k
            o.location *= k


def clean(objs, merge_dist=0.0001, weighted_normals=True):
    """Merge doubles, drop loose geometry, recalc normals outward, weighted normals for hard-surface."""
    for o in meshes(objs):
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=merge_dist)
        loose = [v for v in bm.verts if not v.link_edges]
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(o.data)
        bm.free()
        if weighted_normals and not any(m.type == "WEIGHTED_NORMAL" for m in o.modifiers):
            o.data.shade_smooth()
            m = o.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL")
            m.keep_sharp = True


def tri_count(objs=None):
    dg = bpy.context.evaluated_depsgraph_get()
    n = 0
    for o in meshes(objs):
        me = o.evaluated_get(dg).to_mesh()
        n += sum(len(p.vertices) - 2 for p in me.polygons)
        o.evaluated_get(dg).to_mesh_clear()
    return n


def join(objs, name):
    """Join meshes into one object (fewer draw calls); returns it."""
    ms = meshes(objs)
    bpy.ops.object.select_all(action="DESELECT")
    for o in ms:
        o.select_set(True)
    bpy.context.view_layer.objects.active = ms[0]
    bpy.ops.object.join()
    ms[0].name = name
    return ms[0]
