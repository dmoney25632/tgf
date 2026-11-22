"""Preview renders of a Rocketbox soldier wearing kit (Cycles, headless).

  Blender -b --factory-startup -P art/blender/kit/render_kit.py -- --bodies <dir> --soldiers <dir> \
      --kit <obj> --avatar c --head c --vest a --out <png prefix> [--views front,back,head,chest]

--kit is an OBJ written by dump_gear.ts: the exact geometry gear.ts hands the
game (procedural or authored), with vertex colours and one material group
per (surface, roughness, metalness), so before / after compare like for like.
"""
import argparse
import math
import os
import sys

import bpy
from mathutils import Vector


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--bodies", required=True)
    p.add_argument("--soldiers", required=True)
    p.add_argument("--kit", default="")
    p.add_argument("--avatar", default="c")
    p.add_argument("--head", default="")
    p.add_argument("--vest", default="")
    p.add_argument("--helmet", default="")
    p.add_argument("--out", required=True)
    p.add_argument("--views", default="front,back,head,chest")
    p.add_argument("--samples", type=int, default=48)
    p.add_argument("--size", type=int, default=900)
    return p.parse_args(argv)


def body_material(avatar, soldiers):
    m = bpy.data.materials.new(f"body_{avatar}")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(os.path.join(soldiers, f"soldier_{avatar}_color.jpg"))
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    orm = nt.nodes.new("ShaderNodeTexImage")
    orm.image = bpy.data.images.load(os.path.join(soldiers, f"soldier_{avatar}_orm.jpg"))
    orm.image.colorspace_settings.name = "Non-Color"
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(orm.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    return m


def import_obj(path, name):
    before = set(bpy.data.objects)
    bpy.ops.wm.obj_import(filepath=path, forward_axis="NEGATIVE_Z", up_axis="Y")
    return [o for o in bpy.data.objects if o not in before]


def kit_material(name):
    """Groups are s<surf>_r<rough>_m<metal> (or lens*): vertex colour base, fabric bump on soft surfaces."""
    import re

    name = re.sub(r"\.\d{3}$", "", name)  # Blender's duplicate suffix only: the name itself has decimals
    g = re.match(r"(s(\d+)|lens(dark|clear))_r([\d.]+)_m([\d.]+)", name)
    surf = int(g.group(2)) if g and g.group(2) else 0
    lens = g.group(3) if g else None
    rough = float(g.group(4)) if g else 0.8
    metal = float(g.group(5)) if g else 0.0
    m = bpy.data.materials.new("kit_" + name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if lens:
        # Thin tinted glass: mostly see-through, specular only (the game's lensMaterial).
        bsdf.inputs["Base Color"].default_value = (0.01, 0.012, 0.014, 1) if lens == "dark" else (0.06, 0.065, 0.07, 1)
        bsdf.inputs["Metallic"].default_value = 0.0
        bsdf.inputs["Roughness"].default_value = 0.05
        bsdf.inputs["Alpha"].default_value = 0.8 if lens == "dark" else 0.25
        return m
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "Color"
    attr.attribute_type = "GEOMETRY"
    nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    if 1 <= surf <= 7 and surf not in (5, 6):
        # Fabric: fine weave bump + soft sheen (the game's uber shader does this per pixel).
        tc = nt.nodes.new("ShaderNodeTexCoord")
        wave = nt.nodes.new("ShaderNodeTexNoise")
        wave.inputs["Scale"].default_value = 600
        nt.links.new(tc.outputs["Object"], wave.inputs["Vector"])
        bump = nt.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.12
        nt.links.new(wave.outputs["Fac"], bump.inputs["Height"])
        nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
        bsdf.inputs["Sheen Weight"].default_value = 0.4
    return m


def main():
    a = args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    head = a.head or a.avatar
    objs = []
    bm = body_material(a.avatar, a.soldiers)
    for part_av, part in ((a.avatar, "body"), (head, "head"), (a.helmet, "helmet"), (a.vest, "equipment")):
        if not part_av:
            continue
        got = import_obj(os.path.join(a.bodies, f"soldier_{part_av}.obj"), part)
        mat = bm if part_av == a.avatar else body_material(part_av, a.soldiers)
        for o in got:
            if o.name.split(".")[0] != part:
                bpy.data.objects.remove(o)
                continue
            o.data.materials.clear()
            o.data.materials.append(mat)
            o.data.shade_smooth()
            objs.append(o)
    if a.kit:
        for o in import_obj(a.kit, "kit"):
            for i, slot in enumerate(o.material_slots):
                if slot.material:
                    slot.material = kit_material(slot.material.name)
            o.data.shade_smooth()
            objs.append(o)

    s.render.engine = "CYCLES"
    s.cycles.samples = a.samples
    s.cycles.device = "CPU"
    s.cycles.use_denoising = True
    s.render.resolution_x = a.size
    s.render.resolution_y = int(a.size * 1.2)
    s.view_settings.view_transform = "AgX"
    world = bpy.data.worlds.new("w")
    s.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.42, 0.45, 0.5, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.55
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.2
    sun.data.angle = math.radians(6)
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    s.collection.objects.link(sun)
    fill = bpy.data.objects.new("fill", bpy.data.lights.new("fill", "AREA"))
    fill.data.energy = 220
    fill.data.size = 2
    fill.location = (-2.2, -1.5, 1.6)
    fill.rotation_euler = (Vector((0, 0, 1.2)) - fill.location).to_track_quat("-Z", "Y").to_euler()
    s.collection.objects.link(fill)
    ground = bpy.data.meshes.new("g")
    ground.from_pydata([(-3, -3, 0), (3, -3, 0), (3, 3, 0), (-3, 3, 0)], [], [(0, 1, 2, 3)])
    go = bpy.data.objects.new("ground", ground)
    gm = bpy.data.materials.new("gm")
    gm.diffuse_color = (0.25, 0.24, 0.22, 1)
    gm.use_nodes = True
    gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.2, 0.19, 0.17, 1)
    go.data.materials.append(gm)
    s.collection.objects.link(go)

    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    s.collection.objects.link(cam)
    s.camera = cam
    # Blender space: soldier faces -Y, left = +X.
    views = {
        "front": ((1.5, -3.4, 1.35), (0, 0, 0.98), 42),
        "back": ((-1.6, 3.3, 1.45), (0, 0, 1.0), 42),
        "head": ((0.32, -0.72, 1.66), (0, 0, 1.62), 70),
        "chest": ((0.5, -1.2, 1.32), (0, 0, 1.2), 55),
        "backc": ((-0.55, 1.2, 1.4), (0, 0, 1.22), 50),
        "side": ((1.5, -0.25, 1.15), (0, 0, 1.0), 45),
        "legs": ((0.75, -1.3, 0.8), (0, 0, 0.62), 45),
        "rig": ((0.25, -0.75, 1.25), (0, 0, 1.15), 60),
        "knee": ((0.45, -0.7, 0.6), (0.05, 0, 0.48), 60),
        "hip": ((0.75, -0.55, 0.95), (0.05, 0, 0.88), 50),
    }
    for v in a.views.split(","):
        loc, tgt, lens = views[v]
        cam.location = loc
        cam.data.lens = lens
        cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        s.render.filepath = f"{a.out}_{v}.png"
        bpy.ops.render.render(write_still=True)


main()
