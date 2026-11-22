"""IMI Uzi (stock folded), modelled from public reference dimensions.

Overall ~470 mm folded, 260 mm barrel, receiver ~52 mm wide. Front = +Y.
Two shipped meshes: `uzi` (everything) and `mag` (split off so reloads move it).
"""
from tgf import export, materials as M
from tgf.model import box, cut, cyl, profile, rotate, tube, array
from tgf import scene as sc


def build(ctx):
    metal = M.pbr("uzi_parkerized", "parkerized", wear=0.8)
    dark = M.pbr("uzi_blued", "blued_steel")
    poly = M.pbr("uzi_polymer", "polymer_black", scale=140)
    parts = []
    add = parts.append

    # Receiver: pressed-steel box, slightly narrower at the bottom.
    rec = profile("receiver", [(-0.205, -0.04), (0.062, -0.04), (0.066, -0.03), (0.066, 0.033), (-0.205, 0.033)], 0.052, mat=metal, bevel=0.003)
    add(rec)
    # Side stamping ribs (pressed reinforcement lines).
    for x in (-0.0262, 0.0262):
        add(box(f"rib{x}", (0.002, 0.19, 0.006), (x, -0.07, -0.012), metal, bevel=0.0009))
    # Ejection port (right side) cut into the receiver.
    cut(rec, box("port_cut", (0.02, 0.05, 0.018), (0.026, -0.005, 0.016), bevel=0))

    # Top cover with longitudinal grooves.
    top = box("top_cover", (0.054, 0.252, 0.016), (0, -0.074, 0.041), metal, bevel=0.004, seg=4)
    add(top)
    groove = box("groove", (0.0035, 0.2, 0.01), (-0.012, -0.075, 0.049), bevel=0)
    array(groove, 4, 0.008, axis=0)
    cut(top, groove)
    # Cocking knob on the top cover, offset left.
    add(cyl("cock_stem", 0.004, 0.012, (-0.012, -0.03, 0.054), "Z", dark))
    add(cyl("cock_knob", 0.0085, 0.008, (-0.012, -0.03, 0.062), "Z", dark, bevel=0.0015, r2=0.0075))

    # Barrel nut + barrel + muzzle.
    add(cyl("barrel_nut", 0.024, 0.024, (0, 0.078, 0.0), "Y", metal, bevel=0.002, verts=24))
    knurl = box("nut_knurl", (0.004, 0.026, 0.06), (0, 0.078, 0), bevel=0)
    for i in range(12):
        k = box(f"nut_k{i}", (0.003, 0.026, 0.004), (0, 0.078, 0.0255), bevel=0)
        rotate(k, i * 30, "Y", (0, 0.078, 0))
        cut(parts[-1], k)
    knurl.hide_set(True)
    barrel, bore = tube("barrel", 0.0105, 0.0047, 0.10, (0, 0.135, 0.0), "Y", dark)
    add(barrel)
    add(tube("muzzle_crown", 0.0118, 0.0047, 0.008, (0, 0.183, 0.0), "Y", dark)[0])

    # Front sight: post between protective ears, on a base at the front of the top cover.
    add(box("fs_base", (0.03, 0.022, 0.012), (0, 0.045, 0.055), metal, bevel=0.002))
    for x in (-0.011, 0.011):
        add(profile(f"fs_ear{x}", [(0.036, 0.0), (0.054, 0.0), (0.05, 0.03), (0.04, 0.03)], 0.004, (x, 0, 0.061), metal, bevel=0.0009))
    add(box("fs_post", (0.0025, 0.004, 0.022), (0, 0.045, 0.072), dark, bevel=0.0005))
    # Rear sight: flip aperture between ears.
    add(box("rs_base", (0.03, 0.02, 0.01), (0, -0.188, 0.054), metal, bevel=0.002))
    for x in (-0.011, 0.011):
        add(profile(f"rs_ear{x}", [(-0.198, 0.0), (-0.178, 0.0), (-0.182, 0.022), (-0.194, 0.022)], 0.004, (x, 0, 0.059), metal, bevel=0.0009))
    ap = box("rs_leaf", (0.012, 0.003, 0.016), (0, -0.188, 0.068), dark, bevel=0.0008)
    cut(ap, cyl("rs_hole", 0.0018, 0.01, (0, -0.188, 0.07), "Y", bevel=0))
    add(ap)

    # Pistol grip (mag well inside it), slight rake, polymer panels over a steel frame.
    grip = profile("grip_frame", [(-0.11, -0.04), (-0.05, -0.04), (-0.056, -0.152), (-0.116, -0.152)], 0.036, mat=metal, bevel=0.003)
    add(grip)
    for x in (-0.0195, 0.0195):
        pnl = profile(f"grip_panel{x}", [(-0.107, -0.055), (-0.058, -0.055), (-0.063, -0.146), (-0.112, -0.146)], 0.004, (x, 0, 0), poly, bevel=0.0018)
        stip = box(f"grip_stip{x}", (0.008, 0.002, 0.07), (x * 1.2, -0.085, -0.1), bevel=0)
        array(stip, 14, 0.0035, axis=1)
        stip.location.y -= 0.022
        cut(pnl, stip)
        add(pnl)
    # Grip safety along the back strap.
    add(profile("grip_safety", [(-0.118, -0.05), (-0.11, -0.05), (-0.116, -0.13), (-0.124, -0.128)], 0.02, mat=metal, bevel=0.0015))
    # Fire selector (left, above the grip).
    add(cyl("selector", 0.0065, 0.004, (-0.028, -0.06, -0.03), "X", dark, bevel=0.001))
    add(box("selector_lever", (0.003, 0.012, 0.004), (-0.0305, -0.053, -0.026), dark, bevel=0.0008))

    # Trigger guard (front of the grip) and trigger.
    add(profile("tg_front", [(-0.008, -0.04), (0.0, -0.04), (-0.006, -0.082), (-0.014, -0.08)], 0.012, mat=metal, bevel=0.0018))
    add(box("tg_bottom", (0.012, 0.05, 0.005), (0, -0.033, -0.083), metal, bevel=0.0018))
    trig = profile("trigger", [(-0.036, -0.04), (-0.03, -0.04), (-0.034, -0.058), (-0.042, -0.07), (-0.045, -0.067), (-0.039, -0.056)], 0.006, mat=dark, bevel=0.0012)
    add(trig)

    # Folded stock: two flat arms under the receiver and the butt plate under the barrel nut.
    for x in (-0.024, 0.024):
        add(box(f"stock_arm{x}", (0.004, 0.25, 0.008), (x, -0.07, -0.046), metal, bevel=0.0012))
    add(box("stock_hinge", (0.056, 0.016, 0.016), (0, -0.2, -0.042), metal, bevel=0.003))
    butt = profile("stock_butt", [(0.05, -0.052), (0.064, -0.052), (0.064, -0.09), (0.05, -0.09)], 0.054, mat=metal, bevel=0.003)
    add(butt)
    add(box("butt_pad", (0.05, 0.006, 0.036), (0, 0.066, -0.071), poly, bevel=0.002))
    # Sling swivels.
    add(tube("swivel_f", 0.006, 0.0035, 0.004, (0.029, 0.04, -0.02), "X", metal)[0])
    add(tube("swivel_r", 0.006, 0.0035, 0.004, (0.029, -0.19, -0.02), "X", metal)[0])

    # Magazine (separate mesh): 32-rd stick mag below the grip, ribbed body, base plate.
    mag = profile("mag", [(-0.106, -0.152), (-0.06, -0.152), (-0.063, -0.258), (-0.103, -0.258)], 0.026, mat=metal, bevel=0.002)
    ribm = box("mag_rib", (0.03, 0.03, 0.003), (0, -0.083, -0.175), bevel=0)
    array(ribm, 6, -0.012, axis=2)
    cut(mag, ribm)
    base = box("mag_base", (0.03, 0.05, 0.007), (0, -0.083, -0.261), dark, bevel=0.002)

    # Apply modifiers (booleans, bevels) per part, then join into shipped meshes.
    export.apply_modifiers(parts + [mag, base])
    body = sc.join(parts, "uzi")
    magj = sc.join([mag, base], "mag")
    sc.clean([body, magj], weighted_normals=True)
    return {"objects": [body, magj], "bake": True, "bake_size": 1024, "budget": 24000}
