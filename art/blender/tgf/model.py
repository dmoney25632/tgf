"""Hard-surface modelling primitives for build scripts (metres, front = +Y, up = +Z).

Every part gets a real bevel (rounded edges catch light like machined metal)
and weighted normals, which is most of what separates a "real" gun from a
box model.
"""
import math

import bpy
import bmesh
from mathutils import Matrix, Vector


def _obj(name, me, mat=None):
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    if mat:
        o.data.materials.append(mat)
    return o


def _bevel(o, width, segments=3):
    if width <= 0:
        return o
    m = o.modifiers.new("Bevel", "BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    m.angle_limit = math.radians(35)
    m.harden_normals = True
    o.data.shade_smooth()
    w = o.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL")
    w.keep_sharp = True
    return o


def box(name, size, at, mat=None, bevel=0.0015, seg=3):
    """Axis-aligned box: size (x, y, z), centred at `at`."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(at), verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    return _bevel(_obj(name, me, mat), bevel, seg)


def cyl(name, r, length, at, axis="Y", mat=None, bevel=0.001, verts=32, r2=None):
    """Cylinder (or cone when r2 is given) along `axis`, centred at `at`."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=r, radius2=r if r2 is None else r2, depth=length)
    rot = {"X": Matrix.Rotation(math.pi / 2, 4, "Y"), "Y": Matrix.Rotation(-math.pi / 2, 4, "X"), "Z": Matrix.Identity(4)}[axis]
    bmesh.ops.transform(bm, matrix=rot, verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(at), verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    return _bevel(_obj(name, me, mat), bevel, 2)


def tube(name, r_out, r_in, length, at, axis="Y", mat=None, verts=32):
    """Hollow tube (barrel bore, muzzle) via a solidified open cylinder."""
    o = cyl(name, r_out, length, at, axis, mat, bevel=0.0006, verts=verts)
    bore = cyl(name + "_bore", r_in, length * 1.02, at, axis, None, bevel=0, verts=verts)
    b = o.modifiers.new("Bore", "BOOLEAN")
    b.operation = "DIFFERENCE"
    b.object = bore
    o.modifiers.move(len(o.modifiers) - 1, 0)
    bore.hide_render = True
    bore.hide_set(True)
    return o, bore


def profile(name, pts, width, at=(0, 0, 0), mat=None, bevel=0.0012, seg=3):
    """Extrude a side-view outline (list of (y, z), counter-clockwise) to `width` along X."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    vs = [bm.verts.new((-width / 2, y, z)) for y, z in pts]
    f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    moved = [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=Vector((width, 0, 0)), verts=moved)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.translate(bm, vec=Vector(at), verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    return _bevel(_obj(name, me, mat), bevel, seg)


def cut(target, cutter, hide=True):
    """Boolean difference (slots, grooves, ports). The cutter is hidden and not exported."""
    m = target.modifiers.new("Cut_" + cutter.name, "BOOLEAN")
    m.operation = "DIFFERENCE"
    m.object = cutter
    m.solver = "EXACT"
    # Booleans before bevel so the cut edges get rounded too.
    target.modifiers.move(len(target.modifiers) - 1, 0)
    if hide:
        cutter.hide_render = True
        cutter.hide_set(True)
    return cutter


def array(o, count, offset, axis=1):
    m = o.modifiers.new("Array", "ARRAY")
    m.count = count
    m.use_relative_offset = False
    m.use_constant_offset = True
    d = [0.0, 0.0, 0.0]
    d[axis] = offset
    m.constant_offset_displace = d
    o.modifiers.move(len(o.modifiers) - 1, 0)
    return o


def rotate(o, deg, axis, pivot):
    """Rotate object data around a world pivot."""
    me = o.data
    t = Matrix.Translation(Vector(pivot)) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-Vector(pivot))
    me.transform(t)
    me.update()
    return o
