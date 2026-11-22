"""Bake procedural materials into one game texture set per object.

Output per baked object: <name>_baseColor.png, <name>_metallicRoughness.png
(glTF packing: G = roughness, B = metallic), <name>_normal.png (OpenGL).
The object gets a fresh simple Principled material wired to those images, so
the glTF exporter writes exactly the game's PBR set.
"""
import os

import bpy


def _uv_unwrap(obj, margin=0.004):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=margin, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode="OBJECT")


def _image(name, size, colorspace, color=(0, 0, 0, 1)):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = colorspace
    img.generated_color = color
    return img


def _set_target(obj, img):
    """Make `img` the active bake target in every material of obj."""
    for slot in obj.material_slots:
        nt = slot.material.node_tree
        n = nt.nodes.get("__bake_target") or nt.nodes.new("ShaderNodeTexImage")
        n.name = "__bake_target"
        n.image = img
        nt.nodes.active = n


def _bake(kind, obj, img, **kw):
    _set_target(obj, img)
    bpy.ops.object.bake(type=kind, margin=8, use_clear=True, **kw)


def _swap_inputs(obj, socket, value_from=None):
    """Temporarily route a Principled input into Emission so it can be baked as a colour."""
    saved = []
    for slot in obj.material_slots:
        nt = slot.material.node_tree
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


def bake_object(obj, out_dir, size=1024, samples=16):
    """Bake obj's materials to a PBR texture set in out_dir and rewire it to those images."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.device = "CPU"
    # Empty slots (parts made without a material) would break baking: give them a neutral finish.
    from . import materials as M
    for i, slot in enumerate(obj.material_slots):
        if slot.material is None:
            obj.material_slots[i].material = M.pbr(f"{obj.name}_fallback", "parkerized")
    if not obj.data.materials:
        obj.data.materials.append(M.pbr(f"{obj.name}_fallback", "parkerized"))
    if not obj.data.uv_layers:
        _uv_unwrap(obj)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    # Base colour straight from the shader input via emission: Cycles' DIFFUSE colour pass is
    # albedo * (1 - metallic), which baked every metal part near-black.
    base = _image(f"{obj.name}_baseColor", size, "sRGB")
    s = _swap_inputs(obj, "Base Color")
    _bake("EMIT", obj, base)
    _restore(s)

    rough = _image(f"{obj.name}_r", size, "Non-Color")
    s = _swap_inputs(obj, "Roughness")
    _bake("EMIT", obj, rough)
    _restore(s)
    metal = _image(f"{obj.name}_m", size, "Non-Color")
    s = _swap_inputs(obj, "Metallic")
    _bake("EMIT", obj, metal)
    _restore(s)

    normal = _image(f"{obj.name}_normal", size, "Non-Color", (0.5, 0.5, 1, 1))
    _bake("NORMAL", obj, normal, normal_space="TANGENT")

    # Pack metallicRoughness: R unused (1), G roughness, B metallic.
    mr = _image(f"{obj.name}_metallicRoughness", size, "Non-Color")
    rp, mp = list(rough.pixels), list(metal.pixels)
    px = [0.0] * len(rp)
    for i in range(0, len(rp), 4):
        px[i], px[i + 1], px[i + 2], px[i + 3] = 1.0, rp[i], mp[i], 1.0
    mr.pixels = px

    os.makedirs(out_dir, exist_ok=True)
    for img in (base, normal, mr):
        img.filepath_raw = os.path.join(out_dir, img.name + ".png")
        img.file_format = "PNG"
        img.save()

    # Replace materials with one simple glTF-friendly material using the baked set.
    m = bpy.data.materials.new(f"{obj.name}_baked")
    m.use_nodes = True
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
    obj.data.materials.clear()
    obj.data.materials.append(m)
    return m
