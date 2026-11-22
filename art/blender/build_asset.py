"""Headless entry point:  Blender -b -P art/blender/build_asset.py -- --id <id> --script <py> --out <gltf> [...]

The asset script (art/blender/assets/<id>.py) defines `build(ctx) -> dict`:
    {
      "objects": [bpy objects to ship],        # required
      "bake": True,                             # flatten procedural materials to textures
      "bake_size": 1024,
      "lods": [0.5, 0.2],                       # optional extra decimated copies (exported too)
      "budget": 20000,                          # max triangles (LOD0), checked after export
    }
Axis convention (Blender, Z-up): the barrel / front points +Y, top is +Z,
units are metres. Exported with +Y up, that lands barrel-forward (-Z) and
upright in three.js, so REAL_GUNS needs rot [0, 0, 0].
"""
import argparse
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from tgf import bake, export, scene  # noqa: E402


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--id", required=True)
    p.add_argument("--script", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--previews", required=True)
    p.add_argument("--report", required=True)
    p.add_argument("--source", default=None)
    p.add_argument("--no-previews", action="store_true")
    return p.parse_args(argv)


def split_glass(objs, preset="glass_lens", name="lens"):
    """Optic glass ships as its own unbaked mesh named `lens`: the game swaps in
    see-through glass and a reticle (baked, it would be an opaque disc). Modelled
    reticles (preset "reticle") ship the same way as `reticle`, drawn glowing."""
    import bpy

    parts = []
    for o in scene.meshes(objs):
        idx = [i for i, sl in enumerate(o.material_slots) if sl.material and sl.material.get("tgf_preset") == preset]
        if not idx:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="DESELECT")
        for i in idx:
            o.active_material_index = i
            bpy.ops.object.material_slot_select()
        bpy.ops.mesh.separate(type="SELECTED")
        bpy.ops.object.mode_set(mode="OBJECT")
        parts += [s for s in bpy.context.selected_objects if s is not o]
    if not parts:
        return None
    lens = scene.join(parts, name)
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (0.05, 0.07, 0.08, 1)
    bsdf.inputs["Roughness"].default_value = 0.05
    lens.data.materials.clear()
    lens.data.materials.append(mat)
    return lens


def main():
    a = args()
    scene.reset()
    spec = importlib.util.spec_from_file_location(f"asset_{a.id}", a.script)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    ctx = {"id": a.id, "source": a.source, "scene": scene, "root": os.path.dirname(os.path.dirname(HERE))}
    res = mod.build(ctx)
    objs = res["objects"]

    export.apply_modifiers(objs)
    lens = split_glass(objs)
    reticle = split_glass(objs, "reticle", "reticle")
    out_dir = os.path.dirname(a.out)
    if res.get("bake", True):
        tex_dir = os.path.join(a.previews, "_bake", a.id)
        for o in scene.meshes(objs):
            bake.bake_object(o, tex_dir, size=res.get("bake_size", 1024))
    ship = list(objs) + [x for x in (lens, reticle) if x]
    for i, ratio in enumerate(res.get("lods", [])):
        for o in scene.meshes(objs):
            ship.append(export.add_lod(o, ratio, f"lod{i + 1}"))
    export.export_gltf(a.out, ship)

    rep = export.report(objs)
    rep.update({"id": a.id, "out": os.path.relpath(a.out, ctx["root"]), "budget": res.get("budget")})
    if not a.no_previews:
        rep["previews"] = export.render_previews(objs, a.previews, a.id)
    os.makedirs(os.path.dirname(a.report), exist_ok=True)
    with open(a.report, "w") as f:
        json.dump(rep, f, indent=2)
    print("TGF_REPORT", json.dumps(rep))
    budget = res.get("budget")
    if budget and rep["triangles"] > budget:
        print(f"TGF_ERROR over budget: {rep['triangles']} > {budget} triangles")
        sys.exit(2)


try:
    main()
except SystemExit:
    raise
except Exception as e:  # make failures visible to the node runner
    import traceback

    traceback.print_exc()
    print("TGF_ERROR", e)
    sys.exit(1)
