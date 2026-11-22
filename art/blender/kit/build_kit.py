"""Headless kit build:  Blender -b --factory-startup -P art/blender/kit/build_kit.py -- --bodies <dir> --out <kit.gltf> --report <json>

Run through art/blender/kit/build.mjs, which extracts the Rocketbox bodies
first and meshopt-packs the export afterwards. Writes one glTF with a node
per piece (<piece> and <piece>_lod1), materials k_<role>, COLOR_0 =
baked occlusion / seams / edge wear (rgb) and dust (a), TEXCOORD_0 = metric
box projection for the soldier uber shader.
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402

import kitlib as K  # noqa: E402
import pieces  # noqa: E402

MALE = "abcdef"
HELMETED = "abcgh"


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--bodies", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--report", required=True)
    p.add_argument("--only", default="")
    return p.parse_args(argv)


class Ctx:
    pass


def occluder(files, keep):
    """Blender-space BVH (AO occluder)."""
    trees = []
    for f in files:
        for verts, faces in K.load_obj(f, keep).values():
            vs = [tuple(K.C @ K.V(*v)) for v in verts]
            trees.append(BVHTree.FromPolygons(vs, faces))
    return trees


def main():
    a = args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    B = lambda ids: [os.path.join(a.bodies, f"soldier_{i}.obj") for i in ids]  # noqa: E731
    ctx = Ctx()
    ctx.heads = K.Body(B(HELMETED), ("head",))
    ctx.helmets = K.Body(B(HELMETED), ("helmet",))
    ctx.torso = K.Body(B(MALE), ("body",), xmax=0.25)
    ctx.torso_vest = K.Body(B(MALE), ("body", "equipment"), xmax=0.25)
    ctx.chest = ctx.torso
    ctx.legs = K.Body(B(MALE), ("body",), ymax=0.95)
    ctx.leg = {1: K.Body(B(MALE), ("body",), side=1, ymax=0.95), -1: K.Body(B(MALE), ("body",), side=-1, ymax=0.95)}
    ctx.waist = ctx.torso_vest
    occ = occluder(B("c"), ("body", "head"))
    only = set(filter(None, a.only.split(",")))

    report = {"pieces": {}}
    shipped = []
    for lod in (0, 1):
        K.Q.lod = lod
        for name, fn in pieces.PIECES:
            if only and name not in only:
                continue
            res = fn(ctx)
            for P in res if isinstance(res, list) else [res]:
                if not P.objs:
                    continue
                final = P.name + ("_lod1" if lod else "")
                o = K.finish(P, occ, pieces.HARD, name=final)
                shipped.append(o)
                report["pieces"].setdefault(P.name, [0, 0])[lod] = K.tris(o)
                K.Piece.current = None
    for o in shipped:
        o.select_set(False)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in shipped:
        o.select_set(True)
        # Strip build-only attributes (the tack marks live in the vertex colours now).
        for nm in ("tack",):
            at = o.data.attributes.get(nm)
            if at is not None:
                o.data.attributes.remove(at)
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
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
        export_animations=False,
        export_extras=False,
    )
    os.makedirs(os.path.dirname(a.report), exist_ok=True)
    with open(a.report, "w") as f:
        json.dump(report, f, indent=1)
    print("KIT_REPORT", json.dumps(report))


try:
    main()
except SystemExit:
    raise
except Exception as e:
    import traceback

    traceback.print_exc()
    print("KIT_ERROR", e)
    sys.exit(1)
