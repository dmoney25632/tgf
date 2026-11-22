"""Headless build of the modular architecture kit.

    Blender -b --factory-startup -noaudio -P art/blender/archkit/build.py -- \
        --out public/assets/archkit/archkit.gltf --previews art/previews/archkit [--atlas 2048] [--only a,b] [--no-previews]

Steps: bake the 16-cell surface atlas -> build every piece at LOD0 (bevelled,
weighted normals, full detail) and LOD1 (no bevels, small parts dropped) ->
project UVs into the atlas cells -> bake per-corner AO against a context
(wall with the opening, ground) into COLOR_0 (alpha = tint mask) -> export
one glTF (one node per piece: `<piece>` and `<piece>__lod1`) + archkit.json
(per-piece triangles and bounds, glTF axes) -> preview renders.
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import ak_atlas  # noqa: E402
import ak_lib as L  # noqa: E402
import ak_pieces as P  # noqa: E402


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    p.add_argument("--previews", required=True)
    p.add_argument("--atlas", type=int, default=2048)
    p.add_argument("--only", default="")
    p.add_argument("--no-previews", action="store_true")
    return p.parse_args(argv)


_ctx = {}


def context(kind):
    """Bake occluders for a context (cached; hidden from renders, never exported)."""
    if kind is None:
        return []
    key = repr(kind)
    if key not in _ctx:
        if kind[0] == "hole":
            _, w, h, _y = kind
            door = h > 2.0
            objs = [L.wall_with_hole(f"ctx_hole_{w}_{h}", w, h, z0=0.0 if door else -1.0)]
            if door:
                objs.append(L.ground_plane(f"ctx_ground_{w}"))
        elif kind[0] == "wall":
            objs = [L.wall_with_hole("ctx_wall", 0, 0, z0=-2.0, z1=3.0)]
        elif kind[0] == "ground":
            objs = [L.ground_plane("ctx_ground")]
        else:
            objs = [L.wall_with_hole("ctx_wallg", 0, 0, z0=0.0, z1=3.0), L.ground_plane("ctx_groundw")]
        _ctx[key] = objs
    return _ctx[key]


def gl_bounds(o):
    """Bounds in glTF axes (x, z_up -> y, -y -> z)."""
    vs = [v.co for v in o.data.vertices]
    if not vs:
        return [0, 0, 0], [0, 0, 0]
    xs = [v.x for v in vs]
    ys = [v.z for v in vs]
    zs = [-v.y for v in vs]
    r = lambda a: round(a, 4)
    return [r(min(xs)), r(min(ys)), r(min(zs))], [r(max(xs)), r(max(ys)), r(max(zs))]


def mats_used(o):
    used = sorted({p.material_index for p in o.data.polygons})
    names = ["kit_atlas", "kit_glass", "kit_lamp"]
    return [names[i] for i in used]


def main():
    a = args()
    t0 = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.unit_settings.system = "METRIC"
    tex_dir = os.path.join(a.previews, "_bake")
    imgs = ak_atlas.bake_atlas(tex_dir, size=a.atlas, samples=4)
    mats = L.materials()
    ak_atlas.wire_atlas_material(mats[0], imgs)
    print(f"atlas baked in {time.time() - t0:.1f}s")

    only = set(filter(None, a.only.split(",")))
    built = []
    report = {}
    for name, (fn, ctx) in P.PIECES.items():
        if only and name not in only:
            continue
        entry = {}
        for lod in (0, 1):
            k = L.Kit(lod)
            fn(k)
            o = L.finish(k, name if lod == 0 else f"{name}__lod1")
            L.map_uvs(o)
            L.bake_ao(o, context(ctx))
            o.hide_render = True
            built.append(o)
            lo, hi = gl_bounds(o)
            entry[f"lod{lod}"] = {"tris": L.tri_count(o), "min": lo, "max": hi, "materials": mats_used(o)}
        report[name] = entry
        print(f"  {name}: {entry['lod0']['tris']} / {entry['lod1']['tris']} tris")

    # Export: pieces only (context occluders stay behind).
    for c in _ctx.values():
        for o in c:
            bpy.data.objects.remove(o)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in built:
        o.select_set(True)
    # Images next to the glTF (the runner converts them to JPEG + KTX2).
    import shutil

    for i in imgs.values():
        dst = os.path.join(os.path.dirname(a.out), i.name + ".png")
        shutil.copyfile(os.path.join(tex_dir, i.name + ".png"), dst)
        i.filepath = dst
    bpy.ops.export_scene.gltf(
        filepath=a.out,
        export_format="GLTF_SEPARATE",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=True,
        export_animations=False,
        export_extras=False,
    )
    meta = {
        "$comment": "Built by art/blender/archkit/build.py. Bounds in glTF axes (Y up, -Z out of the wall).",
        "atlas": {"cells": L.CELLS, "grid": L.GRID, "cellMetres": L.CELL_M, "tintMask": L.TINT_MASK},
        "heights": {"low": P.LOW, "mantle": P.MANTLE},
        "pieces": report,
    }
    with open(os.path.splitext(a.out)[0] + ".json", "w") as f:
        json.dump(meta, f, indent=1)
    tot0 = sum(e["lod0"]["tris"] for e in report.values())
    tot1 = sum(e["lod1"]["tris"] for e in report.values())
    print(f"ARCHKIT_REPORT pieces={len(report)} lod0={tot0} lod1={tot1} time={time.time() - t0:.1f}s")

    if not a.no_previews:
        import ak_render

        for o in built:
            o.hide_render = o.name.endswith("__lod1")
        ak_render.kit_sheet([o for o in built if not o.name.endswith("__lod1")], imgs, a.previews)


try:
    main()
except SystemExit:
    raise
except Exception as e:
    import traceback

    traceback.print_exc()
    print("ARCHKIT_ERROR", e)
    sys.exit(1)
