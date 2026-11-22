"""The kit's shared trim atlas: 16 procedural surface cells baked to one PBR set.

Each cell is 1.25 m x 1.25 m of real surface (512 px at 2048). The bake
plane is laid out exactly like the UV sheet (5 m x 5 m, UV = position / 5),
one material per cell, and procedural noise in object space (metres), so
the grain, joints and pitting are at real scale. Output (PNG, OpenGL normal):
    kit_atlas_baseColor.png, kit_atlas_metallicRoughness.png (G rough, B metal),
    kit_atlas_normal.png
Cavities are folded into the base colour (darker pits, joints and grain).
"""
import os

import bmesh
import bpy

from ak_lib import CELLS, GRID, CELL_M


class Nodes:
    """Tiny node-graph DSL: numbers or sockets in, sockets out."""

    def __init__(self, mat):
        mat.use_nodes = True
        self.nt = mat.node_tree
        self.nt.nodes.clear()
        self.x = -1600
        self.co = self.add("ShaderNodeTexCoord").outputs["Object"]

    def add(self, kind, **props):
        n = self.nt.nodes.new(kind)
        n.location = (self.x, len(self.nt.nodes) * -40)
        self.x += 12
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def link(self, sock, val):
        if isinstance(val, (int, float)):
            sock.default_value = val
        elif isinstance(val, tuple):
            sock.default_value = val if len(val) == len(sock.default_value) else (*val, 1.0)
        else:
            self.nt.links.new(val, sock)

    def vscale(self, s, vec=None):
        n = self.add("ShaderNodeVectorMath", operation="MULTIPLY")
        self.link(n.inputs[0], vec or self.co)
        n.inputs[1].default_value = s
        return n.outputs[0]

    def voff(self, off, vec=None):
        n = self.add("ShaderNodeVectorMath", operation="ADD")
        self.link(n.inputs[0], vec or self.co)
        n.inputs[1].default_value = off
        return n.outputs[0]

    def noise(self, scale, detail=4.0, rough=0.5, distort=0.0, vec=None, out="Fac"):
        n = self.add("ShaderNodeTexNoise")
        self.link(n.inputs["Vector"], vec or self.co)
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        n.inputs["Distortion"].default_value = distort
        return n.outputs[out]

    def voronoi(self, scale, feature="F1", out="Distance", vec=None, rand=1.0):
        n = self.add("ShaderNodeTexVoronoi", feature=feature)
        self.link(n.inputs["Vector"], vec or self.co)
        n.inputs["Scale"].default_value = scale
        n.inputs["Randomness"].default_value = rand
        return n.outputs[out]

    def wave(self, scale, direction="Y", distort=4.0, detail=3.0, vec=None, profile="SIN"):
        n = self.add("ShaderNodeTexWave", wave_type="BANDS", bands_direction=direction, wave_profile=profile)
        self.link(n.inputs["Vector"], vec or self.co)
        n.inputs["Scale"].default_value = scale
        n.inputs["Distortion"].default_value = distort
        n.inputs["Detail"].default_value = detail
        return n.outputs["Fac"]

    def brick(self, c1, c2, mortar, width, row, mortar_size, vec=None):
        n = self.add("ShaderNodeTexBrick")
        self.link(n.inputs["Vector"], vec or self.co)
        n.inputs["Color1"].default_value = (*c1, 1)
        n.inputs["Color2"].default_value = (*c2, 1)
        n.inputs["Mortar"].default_value = (*mortar, 1)
        n.inputs["Scale"].default_value = 1.0
        n.inputs["Mortar Size"].default_value = mortar_size
        n.inputs["Mortar Smooth"].default_value = 0.2
        n.inputs["Bias"].default_value = 0.0
        n.inputs["Brick Width"].default_value = width
        n.inputs["Row Height"].default_value = row
        return n.outputs["Color"], n.outputs["Fac"]

    def math(self, op, a, b=0.0, clamp=False):
        n = self.add("ShaderNodeMath", operation=op, use_clamp=clamp)
        self.link(n.inputs[0], a)
        self.link(n.inputs[1], b)
        return n.outputs[0]

    def mr(self, x, a, b, c=0.0, d=1.0, smooth=True):
        n = self.add("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP" if smooth else "LINEAR", clamp=True)
        self.link(n.inputs["Value"], x)
        n.inputs["From Min"].default_value = a
        n.inputs["From Max"].default_value = b
        n.inputs["To Min"].default_value = c
        n.inputs["To Max"].default_value = d
        return n.outputs["Result"]

    def lerp(self, t, a, b):
        n = self.add("ShaderNodeMix", data_type="FLOAT", clamp_factor=True)
        self.link(n.inputs["Factor"], t)
        self.link(n.inputs["A"], a)
        self.link(n.inputs["B"], b)
        return n.outputs["Result"]

    def mix(self, t, a, b):
        n = self.add("ShaderNodeMix", data_type="RGBA", clamp_factor=True)
        self.link(n.inputs["Factor"], t)
        self.link(n.inputs[6], a)
        self.link(n.inputs[7], b)
        return n.outputs[2]

    def cmul(self, col, k):
        """Colour times a scalar (socket or number)."""
        n = self.add("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY", clamp_factor=True)
        n.inputs["Factor"].default_value = 1.0
        self.link(n.inputs[6], col)
        if isinstance(k, (int, float)):
            n.inputs[7].default_value = (k, k, k, 1)
        else:
            c = self.add("ShaderNodeCombineColor")
            for i in range(3):
                self.link(c.inputs[i], k)
            self.nt.links.new(c.outputs[0], n.inputs[7])
        return n.outputs[2]

    def ramp(self, x, stops):
        n = self.add("ShaderNodeValToRGB")
        self.link(n.inputs["Fac"], x)
        els = n.color_ramp.elements
        while len(els) > len(stops):
            els.remove(els[-1])
        while len(els) < len(stops):
            els.new(0.5)
        for e, (p, c) in zip(els, stops):
            e.position = p
            e.color = (*c, 1)
        return n.outputs["Color"]

    def sep(self, col, ch=0):
        n = self.add("ShaderNodeSeparateColor")
        self.link(n.inputs[0], col)
        return n.outputs[ch]

    def output(self, color, rough, metal, height, strength=0.5, distance=0.004):
        bsdf = self.add("ShaderNodeBsdfPrincipled")
        out = self.add("ShaderNodeOutputMaterial")
        self.nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
        self.link(bsdf.inputs["Base Color"], color)
        self.link(bsdf.inputs["Roughness"], rough)
        self.link(bsdf.inputs["Metallic"], metal)
        bump = self.add("ShaderNodeBump")
        bump.inputs["Strength"].default_value = strength
        bump.inputs["Distance"].default_value = distance
        self.link(bump.inputs["Height"], height)
        self.nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])


# ---- Cell recipes (colours are linear) ------------------------------------------------------

def stone(N):
    n1 = N.noise(2.6, 8, 0.55)
    n2 = N.noise(26, 6, 0.6)
    pit = N.mr(N.voronoi(95), 0.0, 0.16, 1.0, 0.0)
    sparse = N.mr(N.noise(9, 2), 0.45, 0.62)
    pits = N.math("MULTIPLY", pit, sparse)
    tool = N.wave(22, "DIAGONAL", 1.2, 2)
    h = N.math("ADD", N.math("MULTIPLY", n2, 0.55), N.math("MULTIPLY", n1, 0.25))
    h = N.math("ADD", h, N.math("MULTIPLY", tool, 0.06))
    h = N.math("SUBTRACT", h, N.math("MULTIPLY", pits, 0.35))
    col = N.ramp(n1, [(0.3, (0.5, 0.47, 0.41)), (0.7, (0.68, 0.65, 0.57))])
    col = N.cmul(col, N.mr(n2, 0.2, 0.8, 0.86, 1.06))
    stain = N.mr(N.noise(1.1, 3), 0.58, 0.72, 0.0, 0.35)
    col = N.mix(stain, col, (0.5, 0.4, 0.29))
    col = N.mix(N.math("MULTIPLY", pits, 0.7), col, (0.2, 0.19, 0.17))
    N.output(col, N.mr(n2, 0, 1, 0.78, 0.92), 0.0, h, 0.7, 0.012)


def rubble_wall(N):
    v = N.vscale((1.0, 1.75, 1.0))
    warp = N.voff((0, 0, 0), v)
    e = N.voronoi(3.3, "DISTANCE_TO_EDGE", vec=warp)
    rnd = N.sep(N.voronoi(3.3, "F1", "Color", vec=warp), 0)
    mortar = N.mr(e, 0.018, 0.055, 1.0, 0.0)
    dome = N.mr(e, 0.02, 0.26, 0.0, 1.0)
    fine = N.noise(14, 6, 0.6)
    h = N.lerp(mortar, N.math("MULTIPLY", dome, N.mr(fine, 0, 1, 0.75, 1.0)), N.math("MULTIPLY", N.noise(40, 3), 0.1))
    scol = N.ramp(rnd, [(0.0, (0.2, 0.19, 0.18)), (0.35, (0.3, 0.25, 0.19)), (0.7, (0.4, 0.38, 0.34)), (1.0, (0.26, 0.24, 0.22))])
    scol = N.cmul(scol, N.mr(fine, 0.2, 0.8, 0.8, 1.12))
    col = N.mix(mortar, scol, (0.3, 0.28, 0.24))
    moss = N.mr(N.noise(1.6, 4), 0.62, 0.75, 0.0, 0.4)
    col = N.mix(N.math("MULTIPLY", moss, mortar), col, (0.2, 0.24, 0.12))
    N.output(col, N.lerp(mortar, 0.86, 0.95), 0.0, h, 1.0, 0.03)


def render(N):
    n1 = N.noise(1.4, 6, 0.5)
    sand = N.noise(180, 2, 0.5)
    trowel = N.noise(5, 3, 0.5, vec=N.vscale((1.0, 2.6, 1.0)))
    crack = N.mr(N.voronoi(1.8, "DISTANCE_TO_EDGE", vec=N.voff((0.3, 0.1, 0), N.vscale((1, 1, 1)))), 0.0, 0.006, 1.0, 0.0)
    crack = N.math("MULTIPLY", crack, N.mr(N.noise(2.2, 2), 0.55, 0.7))
    h = N.math("ADD", N.math("MULTIPLY", trowel, 0.4), N.math("MULTIPLY", sand, 0.25))
    h = N.math("SUBTRACT", h, N.math("MULTIPLY", crack, 0.4))
    col = N.cmul((0.8, 0.78, 0.73), N.mr(n1, 0.2, 0.8, 0.9, 1.04))
    col = N.mix(N.math("MULTIPLY", crack, 0.8), col, (0.35, 0.33, 0.3))
    N.output(col, 0.93, 0.0, h, 0.5, 0.008)


def concrete(N):
    n1 = N.noise(2.0, 6, 0.55)
    pores = N.math("MULTIPLY", N.mr(N.voronoi(70), 0.0, 0.09, 1.0, 0.0), N.mr(N.noise(11, 2), 0.4, 0.6))
    agg = N.sep(N.voronoi(28, "F1", "Color"), 1)
    h = N.math("SUBTRACT", N.math("ADD", N.math("MULTIPLY", N.noise(60, 4), 0.35), N.math("MULTIPLY", agg, 0.08)), N.math("MULTIPLY", pores, 0.4))
    col = N.cmul((0.56, 0.54, 0.5), N.mr(n1, 0.2, 0.8, 0.88, 1.06))
    col = N.cmul(col, N.mr(agg, 0, 1, 0.95, 1.04))
    col = N.mix(N.math("MULTIPLY", pores, 0.8), col, (0.22, 0.21, 0.2))
    N.output(col, 0.9, 0.0, h, 0.6, 0.01)


def _grain(N, scale, distort, along="Y"):
    return N.wave(scale, along, distort, 4, vec=N.vscale((0.18, 1.0, 1.0)))


def timber_paint(N):
    g = _grain(N, 14, 9)
    chip = N.mr(N.noise(6.5, 6, 0.6), 0.63, 0.66)
    craz = N.mr(N.voronoi(16, "DISTANCE_TO_EDGE"), 0.0, 0.012, 1.0, 0.0)
    craz = N.math("MULTIPLY", craz, N.mr(N.noise(3, 2), 0.5, 0.65))
    h = N.math("SUBTRACT", N.math("ADD", 0.6, N.math("MULTIPLY", g, 0.08)), N.math("ADD", N.math("MULTIPLY", chip, 0.4), N.math("MULTIPLY", craz, 0.12)))
    paint = N.cmul((0.8, 0.79, 0.75), N.mr(N.noise(3, 3), 0, 1, 0.9, 1.03))
    wood = N.ramp(g, [(0.2, (0.22, 0.17, 0.12)), (0.8, (0.34, 0.28, 0.2))])
    col = N.mix(chip, paint, wood)
    col = N.mix(N.math("MULTIPLY", craz, 0.6), col, (0.3, 0.28, 0.25))
    N.output(col, N.lerp(chip, 0.52, 0.86), 0.0, h, 0.6, 0.007)


def timber_raw(N):
    g = _grain(N, 9, 11)
    fine = N.noise(60, 3, 0.6, vec=N.vscale((0.15, 1.0, 1.0)))
    crack = N.mr(N.wave(5, "Y", 14, 2, vec=N.vscale((0.12, 1.0, 1.0)), profile="SAW"), 0.0, 0.05, 1.0, 0.0)
    h = N.math("SUBTRACT", N.math("ADD", N.math("MULTIPLY", g, 0.5), N.math("MULTIPLY", fine, 0.25)), N.math("MULTIPLY", crack, 0.5))
    col = N.ramp(g, [(0.0, (0.2, 0.17, 0.13)), (0.5, (0.33, 0.29, 0.23)), (1.0, (0.42, 0.38, 0.31))])
    col = N.cmul(col, N.mr(N.noise(1.5, 3), 0, 1, 0.82, 1.08))
    col = N.mix(N.math("MULTIPLY", crack, 0.8), col, (0.08, 0.07, 0.06))
    N.output(col, 0.86, 0.0, h, 0.9, 0.012)


def iron(N):
    rust = N.mr(N.noise(4, 8, 0.62), 0.58, 0.68)
    pit = N.noise(120, 2)
    h = N.math("ADD", N.math("SUBTRACT", 0.5, N.math("MULTIPLY", rust, 0.12)), N.math("MULTIPLY", pit, N.math("MULTIPLY", rust, 0.2)))
    col = N.mix(rust, (0.034, 0.034, 0.036), N.ramp(pit, [(0.3, (0.12, 0.05, 0.025)), (0.8, (0.22, 0.1, 0.04))]))
    N.output(col, N.lerp(rust, 0.42, 0.85), N.lerp(rust, 0.55, 0.12), h, 0.6, 0.006)


def zinc(N):
    sp = N.sep(N.voronoi(9, "F1", "Color"), 0)
    oxide = N.mr(N.noise(2.0, 4, 0.5, vec=N.vscale((0.25, 4.0, 1.0))), 0.55, 0.75, 0.0, 0.7)
    col = N.cmul((0.4, 0.41, 0.42), N.mr(sp, 0, 1, 0.9, 1.08))
    col = N.mix(oxide, col, (0.58, 0.59, 0.57))
    N.output(col, N.lerp(oxide, N.mr(sp, 0, 1, 0.34, 0.48), 0.72), N.lerp(oxide, 0.85, 0.35), N.math("MULTIPLY", N.noise(80, 2), 0.2), 0.3, 0.004)


def sheet_paint(N):
    rust = N.mr(N.noise(5, 8, 0.6), 0.62, 0.7)
    run = N.mr(N.noise(3.0, 5, 0.6, vec=N.vscale((4.0, 0.3, 1.0))), 0.6, 0.72, 0.0, 0.6)
    scratch = N.mr(N.wave(40, "DIAGONAL", 20, 1, profile="SAW"), 0.0, 0.02, 1.0, 0.0)
    scratch = N.math("MULTIPLY", scratch, N.mr(N.noise(7, 2), 0.6, 0.7))
    h = N.math("SUBTRACT", N.math("ADD", 0.5, N.math("MULTIPLY", N.noise(3, 2), 0.1)), N.math("ADD", N.math("MULTIPLY", rust, 0.2), N.math("MULTIPLY", scratch, 0.1)))
    col = N.cmul((0.74, 0.73, 0.7), N.mr(N.noise(2, 3), 0, 1, 0.9, 1.03))
    col = N.mix(N.math("MAXIMUM", rust, N.math("MULTIPLY", run, 0.5)), col, (0.2, 0.09, 0.04))
    col = N.mix(scratch, col, (0.45, 0.45, 0.46))
    N.output(col, N.lerp(rust, 0.44, 0.85), N.lerp(rust, 0.25, 0.1), h, 0.5, 0.006)


def brick(N):
    c, fac = N.brick((0.33, 0.12, 0.065), (0.45, 0.2, 0.11), (0.5, 0.47, 0.42), 0.225, 0.075, 0.011)
    fine = N.noise(30, 5, 0.6)
    var = N.sep(N.voronoi(14, "F1", "Color", vec=N.vscale((0.4, 1.2, 1.0))), 0)
    h = N.math("ADD", N.math("SUBTRACT", 1.0, N.math("MULTIPLY", fac, 0.85)), N.math("MULTIPLY", fine, 0.12))
    col = N.cmul(c, N.mr(fine, 0.2, 0.8, 0.82, 1.1))
    col = N.cmul(col, N.mr(var, 0, 1, 0.85, 1.12))
    soot = N.mr(N.noise(1.2, 3), 0.6, 0.75, 0.0, 0.4)
    col = N.mix(soot, col, (0.08, 0.06, 0.05))
    N.output(col, N.lerp(fac, 0.85, 0.95), 0.0, h, 0.9, 0.012)


def slate(N):
    layers = N.noise(3.0, 8, 0.65, vec=N.vscale((0.4, 5.0, 1.0)))
    fine = N.noise(40, 4, 0.6)
    h = N.math("ADD", N.math("MULTIPLY", layers, 0.6), N.math("MULTIPLY", fine, 0.2))
    col = N.ramp(N.noise(1.8, 4), [(0.3, (0.035, 0.04, 0.05)), (0.7, (0.065, 0.07, 0.08))])
    col = N.cmul(col, N.mr(layers, 0, 1, 0.85, 1.15))
    lichen = N.math("MULTIPLY", N.mr(N.voronoi(7), 0.0, 0.12, 1.0, 0.0), N.mr(N.noise(2.5, 3), 0.55, 0.7))
    col = N.mix(lichen, col, (0.42, 0.42, 0.33))
    N.output(col, N.lerp(lichen, 0.5, 0.85), 0.0, h, 0.8, 0.01)


def clay(N):
    n1 = N.noise(3.0, 6, 0.55)
    fine = N.noise(50, 3, 0.6)
    col = N.ramp(n1, [(0.2, (0.3, 0.1, 0.05)), (0.6, (0.44, 0.17, 0.08)), (0.9, (0.5, 0.24, 0.12))])
    col = N.cmul(col, N.mr(fine, 0, 1, 0.9, 1.05))
    lichen = N.math("MULTIPLY", N.mr(N.voronoi(6), 0.0, 0.15, 1.0, 0.0), N.mr(N.noise(2, 3), 0.55, 0.68))
    col = N.mix(lichen, col, (0.46, 0.44, 0.32))
    N.output(col, N.lerp(lichen, 0.7, 0.86), 0.0, N.math("MULTIPLY", fine, 0.4), 0.5, 0.006)


def hessian(N):
    a = N.wave(55, "X", 0.4, 1)
    b = N.wave(55, "Y", 0.4, 1)
    weave = N.math("MAXIMUM", a, b)
    fuzz = N.noise(200, 2)
    h = N.math("ADD", N.math("MULTIPLY", weave, 0.7), N.math("MULTIPLY", fuzz, 0.2))
    col = N.cmul((0.42, 0.35, 0.23), N.mr(weave, 0, 1, 0.82, 1.06))
    dirt = N.mr(N.noise(1.6, 4), 0.5, 0.7, 0.0, 0.5)
    col = N.mix(dirt, col, (0.26, 0.21, 0.15))
    N.output(col, 0.95, 0.0, h, 0.6, 0.004)


def debris(N):
    cid = N.sep(N.voronoi(12, "F1", "Color"), 0)
    e = N.voronoi(12, "DISTANCE_TO_EDGE")
    dome = N.mr(e, 0.0, 0.18)
    brickish = N.mr(cid, 0.68, 0.7)
    col = N.mix(brickish, (0.44, 0.43, 0.4), (0.38, 0.15, 0.08))
    col = N.cmul(col, N.mr(N.noise(25, 4), 0, 1, 0.8, 1.1))
    dust = N.mr(e, 0.0, 0.05, 1.0, 0.0)
    col = N.mix(dust, col, (0.5, 0.46, 0.4))
    N.output(col, 0.92, 0.0, N.math("ADD", N.math("MULTIPLY", dome, 0.8), N.math("MULTIPLY", N.noise(60, 3), 0.15)), 1.0, 0.02)


def dark(N):
    n = N.noise(8, 4)
    N.output(N.cmul((0.022, 0.021, 0.02), N.mr(n, 0, 1, 0.8, 1.2)), N.mr(n, 0, 1, 0.6, 0.75), 0.0, N.math("MULTIPLY", n, 0.2), 0.3, 0.004)


def oak(N):
    g = _grain(N, 16, 7)
    pores = N.noise(120, 2, 0.5, vec=N.vscale((0.1, 1.0, 1.0)))
    wear = N.mr(N.noise(2.5, 4), 0.55, 0.7, 0.0, 0.5)
    h = N.math("ADD", N.math("MULTIPLY", g, 0.3), N.math("MULTIPLY", pores, 0.25))
    col = N.ramp(g, [(0.1, (0.13, 0.065, 0.032)), (0.6, (0.21, 0.11, 0.055)), (1.0, (0.27, 0.15, 0.075))])
    col = N.mix(wear, col, (0.3, 0.24, 0.17))
    N.output(col, N.lerp(wear, 0.4, 0.75), 0.0, h, 0.6, 0.006)


RECIPES = {f.__name__: f for f in (stone, rubble_wall, render, concrete, timber_paint, timber_raw, iron, zinc, sheet_paint, brick, slate, clay, hessian, debris, dark, oak)}


# ---- Bake -----------------------------------------------------------------------------------

def _plane():
    """GRID x CELL_M square sheet, one quad per cell (UV = position / span, row 0 at the top)."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    span = GRID * CELL_M
    for i in range(len(CELLS)):
        col, row = i % GRID, i // GRID
        x0, y0 = col * CELL_M, (GRID - 1 - row) * CELL_M
        vs = [bm.verts.new((x, y, 0)) for x, y in ((x0, y0), (x0 + CELL_M, y0), (x0 + CELL_M, y0 + CELL_M), (x0, y0 + CELL_M))]
        f = bm.faces.new(vs)
        f.material_index = i
        for l in f.loops:
            l[uvl].uv = (l.vert.co.x / span, l.vert.co.y / span)
    me = bpy.data.meshes.new("atlas_plane")
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new("atlas_plane", me)
    bpy.context.scene.collection.objects.link(o)
    for name in CELLS:
        m = bpy.data.materials.new(f"cell_{name}")
        RECIPES[name](Nodes(m))
        me.materials.append(m)
    return o


def _target(o, img):
    for m in o.data.materials:
        nt = m.node_tree
        n = nt.nodes.get("__bake") or nt.nodes.new("ShaderNodeTexImage")
        n.name = "__bake"
        n.image = img
        nt.nodes.active = n


def _route(o, socket):
    """Send a Principled input to the surface as emission (to bake it as a colour)."""
    saved = []
    for m in o.data.materials:
        nt = m.node_tree
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
        src = bsdf.inputs[socket]
        em = nt.nodes.new("ShaderNodeEmission")
        if src.is_linked:
            nt.links.new(src.links[0].from_socket, em.inputs["Color"])
        else:
            v = src.default_value
            em.inputs["Color"].default_value = (v, v, v, 1)
        old = out.inputs["Surface"].links[0].from_socket
        nt.links.new(em.outputs[0], out.inputs["Surface"])
        saved.append((nt, out, old, em))
    return saved


def _unroute(saved):
    for nt, out, old, em in saved:
        nt.links.new(old, out.inputs["Surface"])
        nt.nodes.remove(em)


def bake_atlas(out_dir, size=2048, samples=4):
    """Bakes the 16 cells; returns {kind: image} (images saved as PNG into out_dir)."""
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.samples = samples
    s.cycles.device = "CPU"
    s.render.bake.target = "IMAGE_TEXTURES"
    s.render.bake.margin = 0
    o = _plane()
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o

    def img(name, cs, col=(0, 0, 0, 1)):
        i = bpy.data.images.new(name, size, size, alpha=False)
        i.colorspace_settings.name = cs
        i.generated_color = col
        return i

    base = img("kit_atlas_baseColor", "sRGB")
    _target(o, base)
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, use_clear=True)
    rough = img("kit_r", "Non-Color")
    _target(o, rough)
    sv = _route(o, "Roughness")
    bpy.ops.object.bake(type="EMIT", use_clear=True)
    _unroute(sv)
    metal = img("kit_m", "Non-Color")
    _target(o, metal)
    sv = _route(o, "Metallic")
    bpy.ops.object.bake(type="EMIT", use_clear=True)
    _unroute(sv)
    normal = img("kit_atlas_normal", "Non-Color", (0.5, 0.5, 1, 1))
    _target(o, normal)
    bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT", use_clear=True)

    mr = img("kit_atlas_metallicRoughness", "Non-Color")
    import numpy as np

    n = size * size * 4
    rp = np.empty(n, dtype=np.float32)
    mp = np.empty(n, dtype=np.float32)
    rough.pixels.foreach_get(rp)
    metal.pixels.foreach_get(mp)
    px = np.ones(n, dtype=np.float32)
    px[1::4] = rp[0::4]
    px[2::4] = mp[0::4]
    mr.pixels.foreach_set(px)
    os.makedirs(out_dir, exist_ok=True)
    for i in (base, normal, mr):
        i.filepath_raw = os.path.join(out_dir, i.name + ".png")
        i.file_format = "PNG"
        i.save()
    bpy.data.objects.remove(o)
    return {"base": base, "normal": normal, "mr": mr}


def wire_atlas_material(mat, imgs):
    """kit_atlas -> the baked images (the pattern the glTF exporter writes as standard PBR)."""
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    tb = nt.nodes.new("ShaderNodeTexImage")
    tb.image = imgs["base"]
    nt.links.new(tb.outputs["Color"], bsdf.inputs["Base Color"])
    tm = nt.nodes.new("ShaderNodeTexImage")
    tm.image = imgs["mr"]
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(tm.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    tn = nt.nodes.new("ShaderNodeTexImage")
    tn.image = imgs["normal"]
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    return mat
