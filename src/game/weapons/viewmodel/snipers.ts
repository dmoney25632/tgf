import * as THREE from "three";
import { type P2, type V3, circle, place, rrect, slot } from "./geo";
import { buildArm } from "./hands";
import { type Kit, barrel, boxMag, flashHider, pinX, pistolGrip, rail, rifleScope, screwX, selectorMarks, triggerGroup } from "./parts";
import { type GunSpec, boltFace, grabMag, newSpec, part, receiverWithPort, strongOnGrip, supportOnHandguard, v3 } from "./common";

// =============================================================================
// Dragunov SVD — long stamped receiver, side-mounted PSO-1 scope, skeleton
// wooden stock with cheek rest, vented wooden handguard, 10-round steel box,
// AK-style reciprocating charging handle, slotted flash hider.
// =============================================================================
export function buildSvd(k: Kit): GunSpec {
  const { b, m } = k;
  const g = newSpec("svd");
  const yb = -0.056;
  const recTop = yb + 0.018;
  const recBot = yb - 0.04;
  b.into(g.root);

  const rec: P2[] = [[0.1, recTop], [-0.14, recTop], [-0.14, recBot], [-0.06, recBot - 0.004], [0.06, recBot - 0.004], [0.1, recBot + 0.006]];
  const portC: [number, number] = [-0.03, yb + 0.002];
  const inner = receiverWithPort(k, m.blued, rec, -0.0175, 0.0175, rrect(0.06, 0.014, 0.002, portC[0], portC[1], 2));
  b.box(m.polymer, 0.0004, 0.014, 0.06, inner + 0.0002, portC[1], portC[0], { bev: 0 });
  // Dust cover (ribbed, domed) + rear catch.
  const dome: P2[] = [];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI;
    dome.push([Math.cos(a) * 0.0175, recTop + Math.sin(a) * 0.008]);
  }
  b.section(m.blued, dome, 0.1, -0.06, { bev: 0.0006 });
  for (let i = 0; i < 3; i++) b.box(m.blued, 0.03, 0.002, 0.004, 0, recTop + 0.0075, 0.04 - i * 0.03, { bev: 0.0005 });
  // Safety lever + selector marks on the right.
  b.box(m.blued, 0.002, 0.012, 0.11, 0.019, yb - 0.01, 0.02, { rx: 0.05, bev: 0.0006 });
  selectorMarks(k, 0.0186, yb - 0.02, 0.04);
  // PSO-1 side rail on the left of the receiver.
  b.box(m.blued, 0.004, 0.022, 0.1, -0.0195, yb - 0.004, 0.01, { bev: 0.0008 });
  // Trigger group + grip (SVD's thumbhole, drawn as a raked wooden grip).
  triggerGroup(k, m.blued, m.steel, 0.07, 0.008, recBot - 0.004, 0.024, 0.012);
  const grip = pistolGrip(k, m.wood, 0.09, recBot - 0.004, 0.096, 0.42, 0.034, 0.03);
  // Skeleton stock: top comb + cheek rest, lower spine joining the grip bottom.
  const s0 = 0.1;
  const s1 = 0.4;
  const gy = recBot - 0.1;
  b.profile(m.wood, [
    [s0, recTop - 0.002], [s1, recTop - 0.012], [s1, gy - 0.06], [s1 - 0.02, gy - 0.064], [s0 + 0.08, gy + 0.004], [s0 + 0.04, gy + 0.012], [s0 + 0.04, recBot - 0.01], [s0, recBot],
  ], 0.036, 0, { bev: 0.004, bevSeg: 2, holes: [[[s0 + 0.08, recTop - 0.02], [s1 - 0.03, recTop - 0.026], [s1 - 0.03, gy - 0.038], [s0 + 0.11, gy - 0.006], [s0 + 0.08, recBot - 0.02]]] });
  b.profile(m.wood, [[s0 + 0.1, recTop - 0.006], [s1 - 0.04, recTop - 0.012], [s1 - 0.05, recTop + 0.006], [s0 + 0.14, recTop + 0.008]], 0.03, 0, { bev: 0.004, bevSeg: 2 });
  b.profile(m.rubber, [[s1, recTop - 0.01], [s1 + 0.012, recTop - 0.012], [s1 + 0.012, gy - 0.062], [s1, gy - 0.062]], 0.038, 0, { bev: 0.002 });
  // Vented wooden handguard (two halves) around a gas tube + barrel.
  const hg = rrect(0.044, 0.05, 0.016, 0, yb + 0.002, 4);
  b.section(m.wood, hg, -0.14, -0.38, { bev: 0.003, bevSeg: 2 });
  for (let i = 0; i < 6; i++) for (const sx of [-1, 1]) b.add(m.polymer, new THREE.PlaneGeometry(0.018, 0.006), place(sx * 0.0222, yb + 0.004, -0.17 - i * 0.034, { ry: sx * Math.PI / 2 }));
  b.section(m.blued, rrect(0.046, 0.054, 0.012, 0, yb + 0.002, 3), -0.38, -0.39, { bev: 0.001 });
  // Gas block + front sight, long barrel, slotted flash hider.
  barrel(k, m.blued, -0.14, -0.7, yb, 0.0105, 0.0095);
  b.box(m.blued, 0.022, 0.04, 0.03, 0, yb + 0.008, -0.4, { bev: 0.002 });
  const fz = -0.66;
  b.box(m.blued, 0.012, 0.03, 0.02, 0, yb + 0.014, fz, { bev: 0.0012 });
  b.add(m.blued, new THREE.TorusGeometry(0.009, 0.0022, 6, 18, Math.PI), place(0, yb + 0.03, fz));
  flashHider(k, m.blued, -0.7, yb, 0.012, 0.075);
  g.muzzle.position.set(0, yb, -0.78);

  // PSO-1 (4×): slim tube, objective shade, long rubber eyecup, turrets on top
  // and left, a reticle-lamp cap, and the side bracket down to the rail.
  const zo = -0.09;
  const ze = 0.11;
  b.lathe(m.blued, [[0.019, zo - 0.035], [0.019, zo], [0.012, zo + 0.03], [0.012, ze - 0.03], [0.015, ze - 0.02], [0.015, ze], [0.0135, ze]], 0, 0, { seg: 24 });
  b.lathe(m.tubeInterior, [[0.0175, zo - 0.035], [0.0175, zo - 0.02], [0, zo - 0.02]], 0, 0, { seg: 20 });
  b.add(m.lensCoated, new THREE.CircleGeometry(0.0175, 24), place(0, 0, zo - 0.025, { ry: Math.PI }));
  b.lathe(m.rubber, [[0.015, ze], [0.018, ze + 0.008], [0.0195, ze + 0.05], [0.017, ze + 0.052], [0.0145, ze + 0.01]], 0, 0, { seg: 22 });
  b.add(m.lensCoatedAmber, new THREE.CircleGeometry(0.0135, 24), place(0, 0, ze - 0.004));
  b.section(m.blued, rrect(0.032, 0.032, 0.008, 0, 0, 3), -0.01, 0.02, { bev: 0.002 });
  b.lathe(m.knurled, [[0, 0], [0.009, 0], [0.009, -0.016], [0, -0.016]], 0, 0.016, { rx: Math.PI / 2, z: 0.005, seg: 18 });
  b.lathe(m.knurled, [[0, 0], [0.009, 0], [0.009, -0.016], [0, -0.016]], -0.016, 0, { ry: Math.PI / 2, z: 0.005, seg: 18 });
  b.lathe(m.blued, [[0, 0], [0.006, 0], [0.006, -0.012], [0, -0.012]], 0.012, 0.008, { ry: -Math.PI / 2, rz: 0.5, z: 0.04, seg: 12 });
  b.profile(m.blued, [[0.06, -0.012], [-0.04, -0.012], [-0.04, yb + 0.006], [0.06, yb + 0.006]], 0.008, -0.021, { bev: 0.0012 });
  b.box(m.blued, 0.026, 0.01, 0.1, -0.012, -0.012, 0.01, { bev: 0.0015 });
  b.cyl(m.steel, 0.005, -0.006, 0.006, -0.026, yb + 0.002, 10, { ry: Math.PI / 2, z: 0.03 });

  b.into(g.bolt);
  boltFace(k, inner, portC[1], portC[0] + 0.004, 0.01, 0.04);
  g.boltTravel = 0.04;
  // Charging handle rides with the carrier (right side).
  g.charge = part(g);
  b.into(g.charge);
  b.box(m.blued, 0.005, 0.006, 0.04, 0.019, yb + 0.004, -0.02, { bev: 0.001 });
  b.lathe(m.blued, [[0, 0], [0.0045, 0], [0.0052, -0.004], [0.0052, -0.014], [0, -0.016]], 0.021, yb + 0.004, { ry: -Math.PI / 2, z: -0.028, seg: 10 });
  g.chargeTravel = 0.04;
  g.chargeRides = true;

  b.into(g.mag);
  boxMag(k, m.blued, 0.064, 0.1, 0.01, 0.024, { ribs: true, rounds: m.brass, plate: m.blued });
  g.mag.position.set(0, recBot, -0.04);
  g.magPath = { pull: [0, -0.016, -0.012], away: [-0.07, -0.34, 0.02], rot: [0.55, 0, 0.35], rockIn: 0.25 };

  b.into(g.root);
  buildArm(b, m, ...strongOnGrip(grip.top, grip.axis, [0.11, -0.33, 0.37]));
  const leftAt: V3 = [0, yb - 0.004, -0.3];
  b.into(g.leftArm);
  buildArm(b, m, ...supportOnHandguard(leftAt, 0.026, [-0.25, -0.31, 0.2]));
  b.into(g.leftGrab);
  const grabAt: V3 = [0, -0.05, -0.006];
  buildArm(b, m, ...grabMag(grabAt, 0.025, [0, -1, 0.1]));

  g.leftRest.set(...leftAt);
  g.leftReach.copy(v3(grabAt)).add(g.mag.position).sub(g.leftRest);
  g.boltHand.set(0.026, yb + 0.004, -0.03);
  g.eject.position.set(0.018, portC[1], portC[0]);
  g.ejectDir.set(1, 0.4, 0.2).normalize();
  g.shell = "heavy";
  g.hip.set(0.14, -0.08, -0.34);
  g.hipRot.set(0.03, 0.07, -0.1);
  g.ads.set(0, 0, -0.06 - ze - 0.052);
  g.scope = true;
  g.flash = "hider";
  g.flashScale = 0.9;
  g.cycle = 0.12;
  g.butt = new THREE.Vector3(0, recBot - 0.05, 0.41);
  return g;
}

// =============================================================================
// M24 SWS — Remington 700 long action in an olive composite stock, heavy
// barrel, 10× Leupold-style scope, bolt worked by the strong hand after every
// shot, rounds thumbed one at a time through the ejection port.
// =============================================================================
export function buildM24(k: Kit): GunSpec {
  const { b, m } = k;
  const g = newSpec("m24");
  const yb = -0.052;
  const railTop = -0.024;
  b.into(g.root);

  // Composite stock: long forend, raised comb, near-vertical grip, butt + pad.
  const st: P2[] = [
    [-0.46, yb - 0.008], [-0.12, yb - 0.006], [0.07, yb - 0.006], [0.11, -0.05], [0.16, -0.046], [0.37, -0.05], [0.37, -0.18], [0.33, -0.182],
    [0.17, -0.142], [0.13, -0.14], [0.1, -0.168], [0.068, -0.17], [0.05, -0.11], [0.02, -0.098], [-0.08, -0.1], [-0.11, -0.104], [-0.46, yb - 0.046],
  ];
  b.profile(m.polymerOlive, st, 0.04, 0, { bev: 0.005, bevSeg: 2, seg: 2, holes: [rrect(0.05, 0.03, 0.012, 0.025, -0.115, 3)] });
  // Grip panel texture + sling studs + recoil pad.
  for (const sx of [-1, 1]) b.box(m.grip, 0.002, 0.05, 0.04, sx * 0.0202, -0.13, 0.095, { rx: -0.35, bev: 0.0008 });
  b.profile(m.rubber, [[0.37, -0.048], [0.385, -0.05], [0.385, -0.182], [0.37, -0.182]], 0.042, 0, { bev: 0.003, bevSeg: 2 });
  for (const z of [-0.4, 0.3]) b.lathe(m.steel, [[0, 0], [0.003, 0], [0.003, -0.008], [0, -0.008]], 0, z < 0 ? yb - 0.044 : -0.165, { rx: Math.PI / 2, z, seg: 8 });
  // Bottom metal: trigger guard + floorplate.
  triggerGroup(k, m.blued, m.steel, 0.045, -0.005, -0.098, 0.024, 0.012);
  b.box(m.blued, 0.024, 0.004, 0.09, 0, -0.1, -0.05, { bev: 0.001 });
  // Round receiver, scope base, recoil lug, ejection port on the right.
  const rr = 0.0165;
  const ry = yb + 0.004;
  const ring: P2[] = circle(rr, 0, ry, 22);
  b.section(m.blued, ring, 0.06, -0.13, { bev: 0.0012, holes: [] });
  b.box(m.polymer, 0.0006, 0.014, 0.065, rr - 0.0003, ry + 0.003, -0.02, { bev: 0 });
  rail(k, m.blued, 0.055, -0.13, railTop, 0.021);
  b.box(m.blued, 0.012, 0.012, 0.02, 0, ry - rr, -0.12, { bev: 0.001 });
  for (const z of [0.04, -0.11]) screwX(k, 0, railTop - 0.002, z, 0.0016);
  // Heavy barrel + crown.
  barrel(k, m.blued, -0.13, -0.66, yb, 0.0135, 0.0115);
  g.muzzle.position.set(0, yb, -0.665);
  const sc = rifleScope(k, -0.04, railTop);

  // Bolt: shroud + body slide back; handle group lifts about the bore axis.
  b.into(g.bolt);
  boltFace(k, rr - 0.0012, ry + 0.003, -0.02, 0.012, 0.05);
  const lift = new THREE.Group();
  lift.position.set(0, ry, 0);
  g.bolt.add(lift);
  g.boltLift = lift;
  g.boltLiftAngle = 1.05;
  b.into(lift);
  b.cyl(m.bright, 0.0095, -0.02, 0.07, 0, 0, 16);
  b.lathe(m.blued, [[0, 0.07], [0.0135, 0.07], [0.014, 0.08], [0.012, 0.095], [0.006, 0.1], [0, 0.1]], 0, 0, { seg: 16 });
  b.rod(m.bright, [0.006, 0, 0.065], [0.04, -0.016, 0.075], 0.0034, 8);
  b.add(m.blued, new THREE.SphereGeometry(0.0078, 12, 10), place(0.043, -0.018, 0.076));
  g.boltTravel = 0.085;

  // Held cartridge for round-by-round loading.
  b.into(g.mag);
  b.lathe(m.brass, [[0, 0.035], [0.006, 0.035], [0.006, -0.012], [0.004, -0.02], [0.0038, -0.025], [0, -0.025]], 0, 0, { seg: 10 });
  b.lathe(m.copper, [[0, -0.025], [0.0038, -0.025], [0.0033, -0.04], [0.0015, -0.047], [0, -0.048]], 0, 0, { seg: 10 });
  g.mag.position.set(0.004, ry + 0.012, -0.02);
  g.magHidden = true;

  // Strong arm in its own group (it works the bolt).
  g.rightArm = part(g);
  b.into(g.rightArm);
  const gripTop: V3 = [0, -0.104, 0.085];
  const gripAxis: V3 = [0, -0.94, 0.34];
  buildArm(b, m, ...strongOnGrip(gripTop, gripAxis, [0.11, -0.33, 0.37]));
  g.rightToBolt = new THREE.Vector3(0.043, ry - 0.018, 0.076).sub(v3(gripTop)).add(new THREE.Vector3(0.006, -0.004, 0.012));

  b.into(g.leftArm);
  const leftAt: V3 = [0, yb - 0.04, -0.33];
  buildArm(b, m, { at: leftAt, axis: [0, 0, 1], palm: [-0.2, -1, 0], elbow: [-0.25, -0.3, 0.2], left: true, watch: true }, { r: 0.03, thumb: "forward", phi0: -62, tight: 0.75 });
  b.into(g.leftGrab);
  buildArm(b, m, { at: [-0.004, -0.004, 0.02], axis: [0, 0, 1], palm: [-0.3, -1, 0], elbow: [-0.15, -0.3, 0.3], left: true, watch: true }, { r: 0.008, thumb: "up", fingers: ["wrap", [0.3, 1.0, 0.8], [0.6, 1.2, 0.9], [0.8, 1.3, 1.0]], tight: 1.1 });

  g.leftRest.set(...leftAt);
  g.leftReach.set(0.004, ry + 0.012 - leftAt[1], -0.02 - leftAt[2]);
  g.boltHand.copy(g.leftRest);
  g.eject.position.set(rr, ry + 0.004, -0.02);
  g.ejectDir.set(1, 0.6, 0.3).normalize();
  g.shell = "heavy";
  g.hip.set(0.14, -0.08, -0.34);
  g.hipRot.set(0.03, 0.07, -0.1);
  g.ads.set(0, 0, -0.1 - sc.eye);
  g.scope = true;
  g.flash = "hider";
  g.flashScale = 0.75;
  g.cycle = 0.95;
  g.reload = "shell";
  g.butt = new THREE.Vector3(0, -0.12, 0.38);
  return g;
}

// =============================================================================
// Barrett M82A1 — .50 BMG anti-materiel rifle: big stamped upper with barrel
// cooling slots, arrowhead dual-chamber brake, folding carry handle and
// bipod, 10-round box ahead of the grip, side charging handle, scope on a
// long rail, monopod socket in the stock.
// =============================================================================
export function buildM82(k: Kit): GunSpec {
  const { b, m } = k;
  const g = newSpec("m82");
  const yb = -0.07;
  const top = -0.036;
  const bot = -0.104;
  const railTop = top + 0.009;
  b.into(g.root);

  // Upper: receiver + barrel shroud with cooling slots.
  const slots: P2[][] = [];
  for (let i = 0; i < 5; i++) slots.push(slot(0.03, 0.012, -0.2 - i * 0.045, yb - 0.002, 3));
  const upper: P2[] = [[0.11, top], [-0.43, top], [-0.45, top - 0.01], [-0.45, bot + 0.02], [-0.43, bot + 0.01], [0.11, bot + 0.01]];
  b.profile(m.cerakoteDark, upper, 0.052, 0, { bev: 0.003, bevSeg: 2, holes: slots });
  b.cyl(m.blued, 0.0175, -0.17, -0.44, 0, yb, 16);
  const portC: [number, number] = [-0.03, yb];
  b.box(m.polymer, 0.0006, 0.022, 0.07, 0.0262, portC[1], portC[0], { bev: 0 });
  rail(k, m.cerakoteDark, 0.08, -0.24, railTop, 0.024);
  for (let i = 0; i < 6; i++) for (const sx of [-1, 1]) pinX(k, m.steel, 0.0026, 0.003, sx * 0.027, bot + 0.016, 0.07 - i * 0.08);
  // Lower: grip, trigger, mag well, stock with recoil buffer + monopod socket.
  b.profile(m.cerakoteDark, [
    [0.11, bot + 0.01], [0.11, bot - 0.008], [0.06, bot - 0.012], [-0.03, bot - 0.012], [-0.04, bot - 0.004], [-0.13, bot - 0.004], [-0.13, bot + 0.01],
  ], 0.05, 0, { bev: 0.002 });
  triggerGroup(k, m.cerakoteDark, m.steel, 0.1, 0.03, bot - 0.012, 0.026, 0.013);
  const grip = pistolGrip(k, m.grip, 0.1, bot - 0.012, 0.1, 0.28, 0.038, 0.032);
  b.box(m.steel, 0.004, 0.012, 0.026, -0.0262, bot - 0.002, 0.075, { rx: 0.3, bev: 0.0008 });
  selectorMarks(k, -0.0262, bot, 0.07);
  b.profile(m.cerakoteDark, [[0.11, top + 0.004], [0.42, top - 0.002], [0.42, -0.21], [0.38, -0.214], [0.3, -0.16], [0.18, -0.13], [0.11, bot - 0.012]], 0.046, 0, {
    bev: 0.004, bevSeg: 2, holes: [rrect(0.12, 0.04, 0.016, 0.27, -0.11, 3)],
  });
  b.profile(m.rubber, [[0.42, top - 0.002], [0.44, top - 0.004], [0.44, -0.212], [0.42, -0.214]], 0.05, 0, { bev: 0.004, bevSeg: 2 });
  b.box(m.polymer, 0.032, 0.012, 0.13, 0, top + 0.004, 0.27, { bev: 0.004, seg: 2 });
  b.cyl(m.steel, 0.008, -0.012, 0.012, 0, -0.19, 10, { rx: Math.PI / 2, z: 0.36 });
  // Barrel + arrowhead brake (side windows).
  barrel(k, m.blued, -0.44, -0.8, yb, 0.0175, 0.016);
  const bz = -0.8;
  b.profile(m.blued, [[bz, yb + 0.022], [bz - 0.1, yb + 0.022], [bz - 0.13, yb], [bz - 0.1, yb - 0.022], [bz, yb - 0.022], [bz + 0.01, yb]], 0.064, 0, {
    bev: 0.003, bevSeg: 2, holes: [rrect(0.034, 0.03, 0.006, bz - 0.03, yb, 2), rrect(0.03, 0.026, 0.006, bz - 0.078, yb, 2)],
  });
  b.cyl(m.blued, 0.012, bz - 0.01, bz - 0.11, 0, yb, 14);
  g.muzzle.position.set(0, yb, bz - 0.135);
  // Carry handle (folded flat over the shroud) + bipod folded under the barrel.
  b.rod(m.steel, [-0.016, top + 0.004, -0.27], [-0.016, top + 0.004, -0.39], 0.0045, 8);
  b.rod(m.steel, [0.016, top + 0.004, -0.27], [0.016, top + 0.004, -0.39], 0.0045, 8);
  b.rod(m.polymer, [-0.016, top + 0.004, -0.39], [0.016, top + 0.004, -0.39], 0.008, 10);
  b.box(m.steel, 0.05, 0.016, 0.03, 0, bot + 0.004, -0.42, { bev: 0.002 });
  for (const sx of [-1, 1]) {
    b.rod(m.steel, [sx * 0.018, bot, -0.41], [sx * 0.022, bot - 0.002, -0.18], 0.0065, 8);
    b.box(m.rubber, 0.03, 0.01, 0.04, sx * 0.024, bot - 0.004, -0.17, { bev: 0.003, seg: 2 });
  }
  const sc = rifleScope(k, -0.04, railTop);

  b.into(g.bolt);
  b.box(m.bright, 0.0008, 0.016, 0.05, 0.0262, portC[1], portC[0] + 0.004, { bev: 0.0002 });
  g.boltTravel = 0.05;
  g.charge = part(g);
  b.into(g.charge);
  b.box(m.steel, 0.008, 0.012, 0.03, 0.03, yb + 0.012, -0.08, { bev: 0.0015 });
  b.lathe(m.polymer, [[0, 0], [0.008, 0], [0.009, -0.006], [0.009, -0.02], [0, -0.022]], 0.034, yb + 0.012, { ry: -Math.PI / 2, z: -0.085, seg: 12 });
  g.chargeTravel = 0.1;

  b.into(g.mag);
  boxMag(k, m.blued, 0.15, 0.085, 0, 0.044, { rounds: m.brass, plate: m.blued });
  g.mag.position.set(0, bot - 0.004, -0.06);
  g.magPath = { pull: [0, -0.07, 0], away: [-0.08, -0.36, 0.05], rot: [-0.3, 0, 0.35] };

  b.into(g.root);
  buildArm(b, m, ...strongOnGrip(grip.top, grip.axis, [0.12, -0.34, 0.38], 0.019));
  const leftAt: V3 = [0, bot - 0.03, 0.25];
  b.into(g.leftArm);
  buildArm(b, m, { at: leftAt, axis: [0, 0, -1], palm: [0, -1, 0.1], elbow: [-0.2, -0.38, 0.12], left: true, watch: true }, { r: 0.02, thumb: "forward", tight: 0.85 });
  b.into(g.leftGrab);
  const grabAt: V3 = [0, -0.05, 0];
  buildArm(b, m, ...grabMag(grabAt, 0.03, [0, -1, 0.05]));

  g.leftRest.set(...leftAt);
  g.leftReach.copy(v3(grabAt)).add(g.mag.position).sub(g.leftRest);
  g.boltHand.set(0.04, yb + 0.012, -0.1);
  g.eject.position.set(0.027, portC[1], portC[0]);
  g.ejectDir.set(1, 0.45, 0.2).normalize();
  g.shell = "bmg";
  g.hip.set(0.15, -0.085, -0.36);
  g.hipRot.set(0.03, 0.07, -0.1);
  g.ads.set(0, 0, -0.1 - sc.eye);
  g.scope = true;
  g.flash = "brake";
  g.flashScale = 1.9;
  g.cycle = 0.25;
  g.locksBack = true;
  g.butt = new THREE.Vector3(0, -0.14, 0.44);
  return g;
}
