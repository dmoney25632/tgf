"""Preview renders of the first-person arms (Cycles), before / after checks.

    Blender -b --factory-startup -P art/blender/fparms/render.py -- \
        --arms <arms.glb> --tex <dir with fparms_{color,normal,orm}.(png|jpg)> \
        --poses <dir from game_pose.ts> --out <dir> [--stress] [--only m4a1,akm]

Game views: the pose files hold the camera and every bone's deformation
matrix from the real game code (WeaponViewmodel + FpArms solver), so the
arms are deformed exactly like three.js does it (linear blend skinning, in
numpy) and seen through the game's viewmodel camera, next to the gun.
Stress views (--stress): the armature posed by hand (deep elbow bend, full
fist, wrist twist and flexion) from close up, to catch candy-wrapping,
collapsing knuckles and stretched textures.

The material mirrors createArmsMaterial (FpArms.ts): albedo x region tint x 4
(ORM red: 0 sleeve, 1 glove, 0.5 untinted skin / watch), roughness ORM green,
metalness ORM blue, tangent-space normal map.
"""
import argparse
import glob
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Euler, Matrix, Quaternion, Vector

GLOVE = (0x2B / 255, 0x2A / 255, 0x26 / 255)
SLEEVE = (0x4D / 255, 0x52 / 255, 0x40 / 255)
C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # glTF Y-up -> Blender Z-up


def srgb(c):
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--arms", required=True)
    p.add_argument("--tex", required=True)
    p.add_argument("--poses", default=None)
    p.add_argument("--out", required=True)
    p.add_argument("--stress", action="store_true")
    p.add_argument("--only", default="")
    p.add_argument("--samples", type=int, default=48)
    p.add_argument("--res", default="1280x720")
    p.add_argument("--tag", default="")
    return p.parse_args(argv)


def tex(dirname, kind):
    for ext in ("png", "jpg"):
        f = os.path.join(dirname, f"fparms_{kind}.{ext}")
        if os.path.exists(f):
            return f
    raise FileNotFoundError(kind)


def arms_material(texdir):
    m = bpy.data.materials.new("fp-arms-preview")
    m.use_nodes = True
    nt = m.node_tree
    N = nt.nodes
    L = nt.links
    bsdf = N["Principled BSDF"]
    col = N.new("ShaderNodeTexImage")
    col.image = bpy.data.images.load(tex(texdir, "color"))
    orm = N.new("ShaderNodeTexImage")
    orm.image = bpy.data.images.load(tex(texdir, "orm"))
    orm.image.colorspace_settings.name = "Non-Color"
    nrm = N.new("ShaderNodeTexImage")
    nrm.image = bpy.data.images.load(tex(texdir, "normal"))
    nrm.image.colorspace_settings.name = "Non-Color"
    sep = N.new("ShaderNodeSeparateColor")
    L.new(orm.outputs["Color"], sep.inputs["Color"])
    # weights: glove = sat(2r - 1), sleeve = sat(1 - 2r), untinted = rest
    def math_node(op, a, b=None, clamp=False):
        n = N.new("ShaderNodeMath")
        n.operation = op
        n.use_clamp = clamp
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                L.new(v, n.inputs[i])
        return n.outputs[0]
    r = sep.outputs["Red"]
    g = math_node("MULTIPLY_ADD", r, 2.0, clamp=True)
    g.node.inputs[2].default_value = -1.0
    s = math_node("MULTIPLY_ADD", r, -2.0, clamp=True)
    s.node.inputs[2].default_value = 1.0
    def rgb(c):
        n = N.new("ShaderNodeRGB")
        n.outputs[0].default_value = (*[x * 4 for x in srgb(c)], 1)
        return n.outputs[0]
    def mix(blend="MIX"):
        n = N.new("ShaderNodeMix")
        n.data_type = "RGBA"
        n.blend_type = blend
        ins = [i for i in n.inputs if i.type == "RGBA"]
        out = [o for o in n.outputs if o.type == "RGBA"][0]
        return n, ins[0], ins[1], out
    mix1, a1, b1, o1 = mix()
    a1.default_value = (1, 1, 1, 1)
    L.new(rgb(GLOVE), b1)
    L.new(g, mix1.inputs[0])
    mix2, a2, b2, o2 = mix()
    L.new(o1, a2)
    L.new(rgb(SLEEVE), b2)
    L.new(s, mix2.inputs[0])
    mul, a3, b3, o3 = mix("MULTIPLY")
    mul.inputs[0].default_value = 1
    L.new(col.outputs["Color"], a3)
    L.new(o2, b3)
    L.new(o3, bsdf.inputs["Base Color"])
    L.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    L.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    nm = N.new("ShaderNodeNormalMap")
    L.new(nrm.outputs["Color"], nm.inputs["Color"])
    L.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def setup_scene(res, samples):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    w, h = (int(x) for x in res.split("x"))
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Medium High Contrast"
    world = bpy.data.worlds.new("w")
    sc.world = world
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes["Background"]
    sky = nt.nodes.new("ShaderNodeTexSky")
    try:
        sky.sky_type = "NISHITA"
    except TypeError:
        pass
    sky.sun_elevation = math.radians(35)
    sky.sun_rotation = math.radians(140)
    nt.links.new(sky.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 0.12
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 1.6
    sun.data.angle = math.radians(2)
    sun.rotation_euler = Euler((math.radians(50), math.radians(-25), math.radians(140)))
    sc.collection.objects.link(sun)
    return sc


def import_arms(path, mat):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    mesh = next(o for o in new if o.type == "MESH" and o.vertex_groups)
    arm = next(o for o in new if o.type == "ARMATURE")
    for o in new:
        if o.type == "MESH" and o is not mesh:
            bpy.data.objects.remove(o)
    mesh.data.materials.clear()
    mesh.data.materials.append(mat)
    for p in mesh.data.polygons:
        p.use_smooth = True
    return mesh, arm


def lbs_matrix_weights(mesh):
    names = [g.name for g in mesh.vertex_groups]
    n = len(mesh.data.vertices)
    W = np.zeros((n, len(names)), np.float32)
    for v in mesh.data.vertices:
        for g in v.groups:
            W[v.index, g.group] = g.weight
    s = W.sum(1, keepdims=True)
    W /= np.maximum(s, 1e-8)
    return names, W


def pose_game(mesh, rest, names, W, pose):
    """Linear blend skinning with the game's deformation matrices (glTF space)."""
    Ds = []
    for nme in names:
        d = pose["bones"].get(nme)
        if d is None:
            Ds.append(np.eye(4))
            continue
        D = Matrix([d[0:4], d[4:8], d[8:12], d[12:16]]).transposed()  # column-major
        Ds.append(np.array(C @ D @ C.inverted()))
    Ds = np.array(Ds)  # (B,4,4)
    P = np.c_[rest, np.ones(len(rest))]
    M = np.einsum("vb,bij->vij", W, Ds)
    out = np.einsum("vij,vj->vi", M, P)[:, :3]
    mesh.data.vertices.foreach_set("co", out.astype(np.float32).ravel())
    mesh.data.update()


def game_camera(pose):
    c = pose["camera"]
    M = Matrix([c["matrix"][0:4], c["matrix"][4:8], c["matrix"][8:12], c["matrix"][12:16]]).transposed()
    cam = bpy.data.objects.get("cam") or bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    if cam.name not in bpy.context.scene.collection.objects:
        bpy.context.scene.collection.objects.link(cam)
    cam.matrix_world = C @ M
    cam.data.sensor_fit = "VERTICAL"
    cam.data.angle_y = math.radians(c["fov"])
    cam.data.clip_start = 0.01
    bpy.context.scene.camera = cam
    return cam


def import_gun(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    gm = bpy.data.materials.get("gunmetal") or bpy.data.materials.new("gunmetal")
    gm.use_nodes = True
    b = gm.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.035, 0.035, 0.037, 1)
    b.inputs["Roughness"].default_value = 0.45
    b.inputs["Metallic"].default_value = 0.6
    for o in new:
        if o.type == "MESH":
            o.data.materials.clear()
            o.data.materials.append(gm)
    return new


def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("wrote", path)


# ---- Stress poses ------------------------------------------------------------------

def stress_pose(arm, kind):
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = Quaternion()
        pb.scale = (1, 1, 1)
        pb.location = (0, 0, 0)
    bpy.context.view_layer.update()

    def rot_world(name, axis_w, ang):
        """Rotate bone `name` by `ang` about a world axis (applied in its parent's frame)."""
        pb = arm.pose.bones[name]
        bpy.context.view_layer.update()
        M = pb.matrix.copy()
        R = Quaternion(Vector(axis_w).normalized(), ang).to_matrix().to_4x4()
        T = Matrix.Translation(M.translation)
        pb.matrix = T @ R @ T.inverted() @ M
        bpy.context.view_layer.update()

    def bone_axis(name):
        b = arm.pose.bones[name]
        return (b.tail - b.head).normalized()

    for S, k in (("R", 1), ("L", -1)):
        p = f"Bip01_{S}_"
        if kind == "bend":
            # Upper arm forward, elbow bent ~120 deg, hand in a fist.
            rot_world(p + "UpperArm", (1, 0, 0), math.radians(70))
            fore = arm.pose.bones[p + "Forearm"]
            up = bone_axis(p + "UpperArm")
            hinge = up.cross(Vector((0, -1, 0))).normalized()
            rot_world(p + "Forearm", hinge, math.radians(-115) * 1)
            del fore
        if kind in ("bend", "fist"):
            for f in range(1, 5):
                for seg in ("", "1", "2"):
                    nm = f"{p}Finger{f}{seg}"
                    pb = arm.pose.bones[nm]
                    # curl about the knuckle line (index->pinky across the hand)
                    k1 = arm.pose.bones[p + "Finger1"].head
                    k4 = arm.pose.bones[p + "Finger4"].head
                    hand = arm.pose.bones[p + "Hand"]
                    across = (k4 - k1).normalized()
                    palm = (pb.tail - pb.head).normalized().cross(across)
                    del palm
                    rot_world(nm, across * k, math.radians(80 if seg == "" else 90))
                    del hand
            rot_world(p + "Finger0", bone_axis(p + "Hand"), math.radians(25) * k)
            rot_world(p + "Finger01", bone_axis(p + "Hand"), math.radians(35) * k)
        if kind == "twist":
            ax = bone_axis(p + "Forearm")
            ang = math.radians(100)
            rot_world(p + "Hand", ax, ang * k)
            for i in (1, 2, 3):
                pb = arm.pose.bones[f"{p}ForeTwist{i}"]
                rot_world(f"{p}ForeTwist{i}", ax, ang * k * i / 3)
                del pb
        if kind == "flex":
            k1 = arm.pose.bones[p + "Finger1"].head
            k4 = arm.pose.bones[p + "Finger4"].head
            rot_world(p + "Hand", (k4 - k1).normalized() * k, math.radians(60))


def stress_camera(target, offset, lens=50):
    cam = bpy.data.objects.get("cam") or bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    if cam.name not in bpy.context.scene.collection.objects:
        bpy.context.scene.collection.objects.link(cam)
    cam.data.sensor_fit = "AUTO"
    cam.data.lens = lens
    cam.data.clip_start = 0.01
    cam.location = Vector(target) + Vector(offset)
    d = Vector(target) - cam.location
    cam.rotation_mode = "XYZ"
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam


def main():
    a = args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(a.out, exist_ok=True)
    setup_scene(a.res, a.samples)
    mat = arms_material(a.tex)
    mesh, arm = import_arms(a.arms, mat)
    only = [x for x in a.only.split(",") if x]
    tag = a.tag
    if a.poses:
        names, W = lbs_matrix_weights(mesh)
        mods = [m for m in mesh.modifiers if m.type == "ARMATURE"]
        for m in mods:
            m.show_render = False
            m.show_viewport = False
        rest = np.zeros(len(mesh.data.vertices) * 3, np.float32)
        mesh.data.vertices.foreach_get("co", rest)
        rest = rest.reshape(-1, 3).astype(np.float64)
        for jf in sorted(glob.glob(os.path.join(a.poses, "*.json"))):
            name = os.path.splitext(os.path.basename(jf))[0]
            if only and name not in only:
                continue
            pose = json.load(open(jf))
            pose_game(mesh, rest, names, W, pose)
            game_camera(pose)
            gun = import_gun(jf.replace(".json", ".glb"))
            render(os.path.join(a.out, f"{name}{tag}.png"))
            # close-up through the same eye: aim between the visible hands, narrow lens
            cam = bpy.context.scene.camera
            hands = []
            for side in ("R", "L"):
                d = pose["bones"].get(f"Bip01_{side}_Hand")
                b = arm.data.bones.get(f"Bip01_{side}_Hand")
                if d is None or b is None:
                    continue
                D = C @ Matrix([d[0:4], d[4:8], d[8:12], d[12:16]]).transposed() @ C.inverted()
                if abs(D.determinant()) < 1e-9:
                    continue
                p = D @ (arm.matrix_world @ b.head_local)
                if (cam.matrix_world.inverted() @ p).z < -0.05:
                    hands.append(p)
            if hands:
                tgt = sum(hands, Vector()) / len(hands)
                M0 = cam.matrix_world.copy()
                fov = cam.data.angle_y
                cam.rotation_mode = "QUATERNION"
                cam.rotation_quaternion = (tgt - cam.location).to_track_quat("-Z", "Y")
                cam.data.angle_y = math.radians(24 if len(hands) == 1 else 34)
                render(os.path.join(a.out, f"{name}_close{tag}.png"))
                cam.matrix_world = M0
                cam.data.angle_y = fov
            for o in gun:
                bpy.data.objects.remove(o)
        mesh.data.vertices.foreach_set("co", rest.astype(np.float32).ravel())
        mesh.data.update()
        for m in mods:
            m.show_render = True
            m.show_viewport = True
    if a.stress:
        # Rest: right hand at about (-0.6, ...) Blender space.
        views = {
            "rest_hand_back": ("rest", "Bip01_R_Hand", (-0.25, -0.12, 0.12)),
            "rest_hand_palm": ("rest", "Bip01_R_Hand", (0.05, -0.3, -0.05)),
            "rest_wrist": ("rest", "Bip01_R_Hand", (-0.12, -0.25, 0.18)),
            "fist": ("fist", "Bip01_R_Hand", (-0.22, -0.2, 0.05)),
            "bend": ("bend", "Bip01_R_Forearm", (-0.2, -0.55, 0.15)),
            "twist": ("twist", "Bip01_R_Hand", (-0.15, -0.35, 0.15)),
            "flex": ("flex", "Bip01_R_Hand", (-0.3, -0.2, 0.05)),
        }
        for name, (kind, bone, off) in views.items():
            if only and name not in only:
                continue
            stress_pose(arm, kind)
            bpy.context.view_layer.update()
            pb = arm.pose.bones[bone]
            target = arm.matrix_world @ ((pb.head + pb.tail) / 2 if bone.endswith("Forearm") else pb.head)
            if bone.endswith("Hand"):
                # aim at the middle of the palm
                f2 = arm.pose.bones["Bip01_R_Finger2"]
                target = arm.matrix_world @ ((pb.head + f2.head) / 2)
            stress_camera(target, off)
            render(os.path.join(a.out, f"stress_{name}{tag}.png"))


main()
