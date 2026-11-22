"""Preview renders of the kit (Cycles): a catalogue sheet of every piece on wall
stubs, and close-ups of the window, door and cover sets. Uses the shipped
atlas + the baked AO / tint mask exactly as the game shader does:
    colour = atlas * AO * mix(1, instance tint, mask)
"""
import math
import os

import bpy
from mathutils import Vector

import ak_lib as L

ROWS = [
    ("windows", ["win_casement", "win_casement_broken", "win_sill", "win_lintel", "win_lintel_key", "win_surround", "win_bars", "win_boarded", "win_bricked"]),
    ("shutters", ["shutters_open", "louvres_open", "shutters_closed", "louvres_closed", "shutter_hanging"]),
    ("doors", ["door_frame", "door_surround", "door_leaf_panel", "door_leaf_plank", "door_leaf_metal", "door_step", "door_lamp", "steps_3"]),
    ("shop", ["shopfront", "roller_box", "roller_slats", "roller_bottom"]),
    ("trims", ["cornice", "string_course", "plinth_course", "quoin_long", "quoin_short", "corbel", "gutter", "fascia", "downpipe", "downpipe_head", "downpipe_shoe"]),
    ("roof", ["ridge_clay", "roof_slate", "roof_clay", "chimney_stack", "chimney_stack_stone", "chimney_cap", "balcony_slab", "balcony_rail", "balcony_post"]),
    ("cover", ["coping_low", "coping_mantle", "lowwall", "wall_mantle", "sandbag_row", "crate_cover", "rubble_low", "fence_timber", "step_block"]),
]

TINTS = {
    "shutters_open": (0.2, 0.32, 0.22), "louvres_open": (0.16, 0.25, 0.4), "shutters_closed": (0.45, 0.12, 0.08),
    "louvres_closed": (0.3, 0.4, 0.33), "shutter_hanging": (0.2, 0.32, 0.22), "win_casement": (0.85, 0.83, 0.78),
    "win_casement_broken": (0.6, 0.5, 0.36), "door_leaf_panel": (0.12, 0.22, 0.3), "door_leaf_metal": (0.25, 0.32, 0.28),
    "door_frame": (0.9, 0.88, 0.82), "shopfront": (0.12, 0.24, 0.18), "roller_box": (0.6, 0.6, 0.58), "roller_slats": (0.62, 0.62, 0.6),
    "balcony_slab": (0.75, 0.72, 0.66), "fascia": (0.85, 0.83, 0.78),
}


def _preview_material(imgs):
    m = bpy.data.materials["kit_atlas"]
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = bsdf.inputs["Base Color"].links[0].from_node
    attr = nt.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
    info = nt.nodes.new("ShaderNodeObjectInfo")
    tint = nt.nodes.new("ShaderNodeMix")
    tint.data_type = "RGBA"
    nt.links.new(attr.outputs["Alpha"], tint.inputs["Factor"])
    tint.inputs[6].default_value = (1, 1, 1, 1)
    nt.links.new(info.outputs["Color"], tint.inputs[7])
    m1 = nt.nodes.new("ShaderNodeMix")
    m1.data_type = "RGBA"
    m1.blend_type = "MULTIPLY"
    m1.inputs["Factor"].default_value = 1
    nt.links.new(tex.outputs["Color"], m1.inputs[6])
    nt.links.new(attr.outputs["Color"], m1.inputs[7])
    m2 = nt.nodes.new("ShaderNodeMix")
    m2.data_type = "RGBA"
    m2.blend_type = "MULTIPLY"
    m2.inputs["Factor"].default_value = 1
    nt.links.new(m1.outputs[2], m2.inputs[6])
    nt.links.new(tint.outputs[2], m2.inputs[7])
    nt.links.new(m2.outputs[2], bsdf.inputs["Base Color"])
    g = bpy.data.materials["kit_glass"]
    gb = g.node_tree.nodes["Principled BSDF"]
    gb.inputs["Alpha"].default_value = 0.45


def _plaster(name, col):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*col, 1)
    b.inputs["Roughness"].default_value = 0.95
    n = m.node_tree.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = 40
    bump = m.node_tree.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.15
    m.node_tree.links.new(n.outputs["Fac"], bump.inputs["Height"])
    m.node_tree.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


def _stub(name, w, h, z0, z1, at, hole=True):
    o = L.wall_with_hole(name, w if hole else 0, h if hole else 0, z0=z0, z1=z1, T=0.3, L=max(w + 1.2, 1.6))
    o.hide_render = False
    o.data.materials.append(_plaster("prev_plaster", (0.62, 0.56, 0.46)))
    o.location = at
    return o


def _setup(size=(2200, 1500), samples=48):
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.samples = samples
    s.cycles.use_denoising = True
    s.cycles.device = "CPU"
    s.render.resolution_x, s.render.resolution_y = size
    s.render.film_transparent = False
    s.view_settings.view_transform = "AgX"
    w = s.world or bpy.data.worlds.new("w")
    s.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.55, 0.65, 0.8, 1)
    bg.inputs["Strength"].default_value = 0.9
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.2
    sun.data.angle = math.radians(2)
    sun.rotation_euler = (math.radians(50), math.radians(-12), math.radians(30))
    s.collection.objects.link(sun)
    return s


def _camera(s, loc, target, lens=50, ortho=None):
    cam = bpy.data.objects.get("pcam") or bpy.data.objects.new("pcam", bpy.data.cameras.new("pcam"))
    if cam.name not in s.collection.objects:
        s.collection.objects.link(cam)
    cam.data.type = "ORTHO" if ortho else "PERSP"
    if ortho:
        cam.data.ortho_scale = ortho
    cam.data.lens = lens
    cam.data.clip_end = 500
    cam.location = Vector(loc)
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
    s.camera = cam
    return cam


def _render(s, path):
    s.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("ARCHKIT_PREVIEW", path)


def kit_sheet(objs, imgs, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    _preview_material(imgs)
    s = _setup()
    by = {o.name: o for o in objs}
    ground = L.ground_plane("prev_ground", 200)
    ground.hide_render = False
    ground.data.materials.append(_plaster("prev_ground_m", (0.25, 0.24, 0.2)))
    rows_y = {}
    for r, (row, names) in enumerate(ROWS):
        y = -r * 5.0
        x = 0.0
        for n in names:
            o = by.get(n)
            if not o:
                continue
            lo = Vector((min(v.co.x for v in o.data.vertices), min(v.co.y for v in o.data.vertices), min(v.co.z for v in o.data.vertices)))
            hi = Vector((max(v.co.x for v in o.data.vertices), max(v.co.y for v in o.data.vertices), max(v.co.z for v in o.data.vertices)))
            # Room for the wall stub too (stubs are hole width + 1.2 m, at least 1.6 m).
            sw = {"door_frame": 1.1, "door_surround": 1.1, "door_lamp": 1.1, "shopfront": 2.4, "roller_box": 2.4}.get(n, 1.0 if n.startswith(("win_", "shutter", "louvres")) else 0.0)
            stubbed = sw > 0 or n in ("cornice", "string_course", "plinth_course", "quoin_long", "quoin_short", "corbel", "downpipe", "downpipe_head", "balcony_slab", "door_step", "steps_3", "downpipe_shoe")
            half = max(sw + 1.2, 1.6) / 2 if stubbed else 0.0
            lo.x = min(lo.x, -half)
            hi.x = max(hi.x, half)
            x += -lo.x + 0.15
            dz = 0.0
            if n.startswith(("win_", "shutter", "louvres")):
                dz = 1.0
                _stub(f"stub_{n}", 1.0, 1.4, -1.0, 2.6, (x, y, dz))
            elif n in ("door_frame", "door_surround", "door_lamp"):
                _stub(f"stub_{n}", 1.1, 2.2, 0.0, 3.2, (x, y, 0.0))
                if n == "door_lamp":
                    dz = 2.4
            elif n in ("shopfront", "roller_box"):
                _stub(f"stub_{n}", 2.4, 2.5, 0.0, 3.6, (x, y, 0.0))
            elif n in ("cornice", "string_course", "plinth_course", "quoin_long", "quoin_short", "corbel", "downpipe", "downpipe_head", "balcony_slab"):
                dz = {"plinth_course": 0.0, "downpipe": 0.6, "downpipe_head": 2.4, "balcony_slab": 1.5}.get(n, 1.6)
                _stub(f"stub_{n}", 0, 0, 0.0, 3.2, (x, y, 0.0), hole=False)
            elif n == "door_step" or n == "steps_3" or n == "downpipe_shoe":
                _stub(f"stub_{n}", 0, 0, 0.0, 2.6, (x, y, 0.0), hole=False)
            elif n in ("gutter", "fascia", "ridge_clay"):
                dz = 2.0
            inst = o.copy()
            s.collection.objects.link(inst)
            inst.location = (x, y, dz)
            inst.color = (*TINTS.get(n, (0.92, 0.9, 0.86)), 1)
            if n.startswith("door_leaf"):
                inst.location = (x - 0.5, y, 0)
            if n.startswith("roof_"):
                inst.rotation_euler = (math.radians(-55), 0, 0)
                inst.location = (x, y, 0.05)
            x += hi.x + 0.15
        rows_y[row] = (y, x)
    for o in objs:
        o.hide_render = True
    width = max(v[1] for v in rows_y.values())
    cy = -2.5 * len(ROWS) + 2.5
    _camera(s, (width / 2 + 6, cy + 26, 22), (width / 2, cy + 1, 0.5), ortho=max(width, 5.0 * len(ROWS)) * 1.02)
    _render(s, os.path.join(out_dir, "archkit_sheet.png"))
    s.render.resolution_x, s.render.resolution_y = 1600, 1000
    for row, (y, w) in rows_y.items():
        _camera(s, (w / 2 + 1.2, y + max(4.5, w * 0.75), 2.4), (w / 2, y, 1.1), lens=40)
        _render(s, os.path.join(out_dir, f"archkit_{row}.png"))
