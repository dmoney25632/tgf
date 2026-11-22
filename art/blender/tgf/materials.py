"""PBR material library for hard-surface assets (guns, gear, props).

Materials are procedural (noise-driven wear, grime, edge scratches) so build
scripts need no texture downloads; `bake.py` flattens them into the glTF
texture set (baseColor, metallicRoughness, normal) the game expects.
"""
import bpy

# name: (base RGB linear, metallic, roughness, wear strength)
PRESETS = {
    "parkerized": ((0.035, 0.036, 0.038), 0.85, 0.48, 0.6),
    "blued_steel": ((0.03, 0.035, 0.045), 0.95, 0.32, 0.5),
    "anodized_black": ((0.022, 0.022, 0.024), 0.75, 0.42, 0.7),
    "polymer_black": ((0.025, 0.025, 0.026), 0.0, 0.62, 0.25),
    "polymer_tan": ((0.28, 0.21, 0.13), 0.0, 0.6, 0.25),
    "polymer_od": ((0.09, 0.1, 0.06), 0.0, 0.62, 0.25),
    "wood_walnut": ((0.14, 0.06, 0.025), 0.0, 0.5, 0.2),
    "rubber": ((0.02, 0.02, 0.02), 0.0, 0.85, 0.1),
    "brass": ((0.55, 0.38, 0.12), 1.0, 0.3, 0.3),
    "steel_bare": ((0.45, 0.45, 0.46), 1.0, 0.28, 0.2),
    "glass_lens": ((0.02, 0.03, 0.04), 0.0, 0.05, 0.0),
}


def _node(nt, kind, loc, **props):
    n = nt.nodes.new(kind)
    n.location = loc
    for k, v in props.items():
        setattr(n, k, v)
    return n


def pbr(name, preset=None, base=None, metallic=None, roughness=None, wear=None, scale=60.0):
    """A worn hard-surface material: edge wear exposes bright metal, cavities collect grime,
    micro noise breaks up roughness, and a fine bump adds surface texture."""
    p = PRESETS.get(preset, ((0.05, 0.05, 0.05), 0.5, 0.5, 0.3))
    base = base or p[0]
    metallic = p[1] if metallic is None else metallic
    roughness = p[2] if roughness is None else roughness
    wear = p[3] if wear is None else wear

    m = bpy.data.materials.new(name)
    m["tgf_preset"] = preset or ""
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = _node(nt, "ShaderNodeOutputMaterial", (900, 0))
    bsdf = _node(nt, "ShaderNodeBsdfPrincipled", (600, 0))
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    coord = _node(nt, "ShaderNodeTexCoord", (-900, 0))
    noise = _node(nt, "ShaderNodeTexNoise", (-650, 150))
    noise.inputs["Scale"].default_value = scale
    noise.inputs["Detail"].default_value = 8.0
    nt.links.new(coord.outputs["Object"], noise.inputs["Vector"])

    # Edge wear: convex edges (geometry pointiness needs Cycles) masked by noise.
    geo = _node(nt, "ShaderNodeNewGeometry", (-650, -150))
    edge = _node(nt, "ShaderNodeMapRange", (-420, -150))
    edge.inputs["From Min"].default_value = 0.52
    edge.inputs["From Max"].default_value = 0.6
    nt.links.new(geo.outputs["Pointiness"], edge.inputs["Value"])
    mask = _node(nt, "ShaderNodeMath", (-200, -150), operation="MULTIPLY")
    nt.links.new(edge.outputs["Result"], mask.inputs[0])
    nt.links.new(noise.outputs["Fac"], mask.inputs[1])
    wear_k = _node(nt, "ShaderNodeMath", (0, -150), operation="MULTIPLY")
    wear_k.inputs[1].default_value = wear
    nt.links.new(mask.outputs["Value"], wear_k.inputs[0])

    # Base colour: finish with slight mottling, worn edges toward bare steel.
    mott = _node(nt, "ShaderNodeMix", (-200, 200), data_type="RGBA")
    mott.inputs["Factor"].default_value = 0.12
    mott.inputs["A"].default_value = (*base, 1)
    mott.inputs["B"].default_value = (base[0] * 1.6, base[1] * 1.6, base[2] * 1.6, 1)
    nt.links.new(noise.outputs["Fac"], mott.inputs["Factor"])
    col = _node(nt, "ShaderNodeMix", (200, 200), data_type="RGBA")
    # Metal finishes wear through to bare steel; plastics, wood and rubber only scuff lighter.
    worn = (0.42, 0.42, 0.43) if metallic > 0.3 else tuple(min(1.0, c * 2.2 + 0.03) for c in base)
    col.inputs["B"].default_value = (*worn, 1)
    nt.links.new(mott.outputs["Result"], col.inputs["A"])
    nt.links.new(wear_k.outputs["Value"], col.inputs["Factor"])
    nt.links.new(col.outputs["Result"], bsdf.inputs["Base Color"])

    met = _node(nt, "ShaderNodeMix", (200, 0))
    met.inputs["A"].default_value = metallic
    met.inputs["B"].default_value = 1.0 if metallic > 0.3 else metallic
    nt.links.new(wear_k.outputs["Value"], met.inputs["Factor"])
    nt.links.new(met.outputs["Result"], bsdf.inputs["Metallic"])

    rough = _node(nt, "ShaderNodeMapRange", (200, -300))
    rough.inputs["To Min"].default_value = max(0.02, roughness - 0.08)
    rough.inputs["To Max"].default_value = min(1.0, roughness + 0.08)
    nt.links.new(noise.outputs["Fac"], rough.inputs["Value"])
    nt.links.new(rough.outputs["Result"], bsdf.inputs["Roughness"])

    bump = _node(nt, "ShaderNodeBump", (350, -450))
    bump.inputs["Strength"].default_value = 0.08
    bump.inputs["Distance"].default_value = 0.0004
    nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
