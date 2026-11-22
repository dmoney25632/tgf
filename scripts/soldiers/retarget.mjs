// UAL (UE-mannequin rig, glTF) -> Rocketbox Biped clips, by world-space
// rotation deltas from a direction-aligned reference pose.
import { THREE, loadGLB } from "./lib.mjs";

const SIDE = (s, S) => [
  [`clavicle_${s}`, `Bip01_${S}_Clavicle`, `upperarm_${s}`, `Bip01_${S}_UpperArm`],
  [`upperarm_${s}`, `Bip01_${S}_UpperArm`, `lowerarm_${s}`, `Bip01_${S}_Forearm`],
  [`lowerarm_${s}`, `Bip01_${S}_Forearm`, `hand_${s}`, `Bip01_${S}_Hand`],
  [`hand_${s}`, `Bip01_${S}_Hand`, `middle_01_${s}`, `Bip01_${S}_Finger2`],
  [`thigh_${s}`, `Bip01_${S}_Thigh`, `calf_${s}`, `Bip01_${S}_Calf`],
  [`calf_${s}`, `Bip01_${S}_Calf`, `foot_${s}`, `Bip01_${S}_Foot`],
  [`foot_${s}`, `Bip01_${S}_Foot`, `ball_${s}`, `Bip01_${S}_Toe0`],
  ...[["thumb", 0], ["index", 1], ["middle", 2], ["ring", 3], ["pinky", 4]].flatMap(([f, k]) => [
    [`${f}_01_${s}`, `Bip01_${S}_Finger${k}`, `${f}_02_${s}`, `Bip01_${S}_Finger${k}1`],
    [`${f}_02_${s}`, `Bip01_${S}_Finger${k}1`, `${f}_03_${s}`, `Bip01_${S}_Finger${k}2`],
    [`${f}_03_${s}`, `Bip01_${S}_Finger${k}2`, null, null],
  ]),
];
/** [src bone, tgt bone, src child, tgt child] (children define the bone direction). */
export const MAP = [
  ["pelvis", "Bip01_Pelvis", "spine_01", "Bip01_Spine"],
  ["spine_01", "Bip01_Spine", "spine_02", "Bip01_Spine1"],
  ["spine_02", "Bip01_Spine1", "spine_03", "Bip01_Spine2"],
  ["spine_03", "Bip01_Spine2", "neck_01", "Bip01_Neck"],
  ["neck_01", "Bip01_Neck", "Head", "Bip01_Head"],
  ["Head", "Bip01_Head", null, null],
  ...SIDE("l", "L"),
  ...SIDE("r", "R"),
];

const byName = (root) => { const m = new Map(); root.traverse((o) => { if (o.isBone || o.type === "Bone" || o.name) m.set(o.name, o); }); return m; };
const wq = (o, q = new THREE.Quaternion()) => o.getWorldQuaternion(q);
const wp = (o, v = new THREE.Vector3()) => o.getWorldPosition(v);

export async function loadSource(path) {
  const gltf = await loadGLB(path);
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const bones = byName(scene);
  // Facing: toes point forward.
  const f = wp(bones.get("ball_l")).sub(wp(bones.get("foot_l")));
  const yaw = Math.atan2(f.x, f.z); // 0 when facing +Z
  scene.rotation.y = -yaw;
  scene.updateMatrixWorld(true);
  const rest = new Map();
  scene.traverse((o) => rest.set(o, [o.position.clone(), o.quaternion.clone(), o.scale.clone()]));
  return { scene, bones, clips: gltf.animations, rest, yaw };
}

export function makeRetargeter(src, tgtGroup) {
  const S = src.bones, T = byName(tgtGroup);
  const resetSrc = () => { for (const [o, [p, q, s]] of src.rest) { o.position.copy(p); o.quaternion.copy(q); o.scale.copy(s); } src.scene.updateMatrixWorld(true); };
  resetSrc();
  // Reference pose for the target: a clone posed so each bone points like the source rest.
  const tgtRest = new Map();
  tgtGroup.traverse((o) => tgtRest.set(o, o.quaternion.clone()));
  const C = new Map();
  for (const [sn, tn, sc, tc] of MAP) {
    const sb = S.get(sn), tb = T.get(tn);
    if (!sb || !tb) throw new Error("missing " + sn + " / " + tn);
    tgtGroup.updateMatrixWorld(true);
    if (sc && tc) {
      const ds = wp(S.get(sc)).sub(wp(sb)).normalize();
      const dt = wp(T.get(tc)).sub(wp(tb)).normalize();
      const qa = new THREE.Quaternion().setFromUnitVectors(dt, ds);
      const w = qa.multiply(wq(tb));
      const pw = wq(tb.parent);
      tb.quaternion.copy(pw.invert().multiply(w));
      tgtGroup.updateMatrixWorld(true);
    }
    C.set(tn, wq(sb).invert().multiply(wq(tb)));
  }
  const refQ = new Map();
  tgtGroup.traverse((o) => refQ.set(o, o.quaternion.clone()));
  // Restore the bind pose.
  for (const [o, q] of tgtRest) o.quaternion.copy(q);
  tgtGroup.updateMatrixWorld(true);
  const srcHip = wp(S.get("pelvis")).y;
  const tgtHip = wp(T.get("Bip01")).y;
  const hipK = tgtHip / srcHip;
  const bip = T.get("Bip01");
  const bipRest = bip.position.clone();

  /** Samples a source clip into a target clip. opts.only: set of target bone names to keep. */
  function retarget(clip, { fps = 30, name = clip.name, only = null, rootY = true, frames = null } = {}) {
    resetSrc();
    const mixer = new THREE.AnimationMixer(src.scene);
    const act = mixer.clipAction(clip);
    act.play();
    const n = frames ?? Math.max(2, Math.round(clip.duration * fps) + 1);
    const times = new Float32Array(n);
    const qv = new Map(MAP.map(([, tn]) => [tn, new Float32Array(n * 4)]));
    const pv = new Float32Array(n * 3);
    const q = new THREE.Quaternion();
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : (i / (n - 1)) * clip.duration;
      times[i] = t;
      mixer.setTime(Math.min(t, clip.duration - 1e-4));
      src.scene.updateMatrixWorld(true);
      // Root position.
      const hp = wp(S.get("pelvis"));
      bip.position.set(hp.x * hipK, rootY ? hp.y * hipK : bipRest.y, hp.z * hipK);
      tgtGroup.updateMatrixWorld(true);
      for (const [sn, tn] of MAP) {
        const tb = T.get(tn);
        const w = wq(S.get(sn)).multiply(C.get(tn));
        tb.quaternion.copy(wq(tb.parent, q).invert().multiply(w));
        tb.updateMatrixWorld(true);
        tb.quaternion.toArray(qv.get(tn), i * 4);
      }
      bip.position.toArray(pv, i * 3);
    }
    // Make quaternion tracks continuous.
    for (const arr of qv.values()) for (let i = 1; i < n; i++) {
      const d = arr[i * 4] * arr[i * 4 - 4] + arr[i * 4 + 1] * arr[i * 4 - 3] + arr[i * 4 + 2] * arr[i * 4 - 2] + arr[i * 4 + 3] * arr[i * 4 - 1];
      if (d < 0) for (let k = 0; k < 4; k++) arr[i * 4 + k] *= -1;
    }
    const tracks = [];
    if (!only || only.has("Bip01")) tracks.push(new THREE.VectorKeyframeTrack("Bip01.position", times, pv));
    for (const [tn, arr] of qv) if (!only || only.has(tn)) tracks.push(new THREE.QuaternionKeyframeTrack(`${tn}.quaternion`, times, arr));
    mixer.stopAllAction();
    mixer.uncacheRoot(src.scene);
    resetSrc();
    for (const [o, qq] of tgtRest) o.quaternion.copy(qq);
    bip.position.copy(bipRest);
    tgtGroup.updateMatrixWorld(true);
    return new THREE.AnimationClip(name, clip.duration, tracks);
  }
  return { retarget, refQ, hipK };
}

/** Horizontal root travel speed of a root-motion clip (m/s, source units). */
export function rootSpeed(src, clip) {
  const mixer = new THREE.AnimationMixer(src.scene);
  mixer.clipAction(clip).play();
  const pos = (t) => { mixer.setTime(t); src.scene.updateMatrixWorld(true); return wp(src.bones.get("pelvis")); };
  const a = pos(0), b = pos(clip.duration - 1e-4);
  mixer.stopAllAction();
  return { d: Math.hypot(b.x - a.x, b.z - a.z), dz: b.z - a.z, dx: b.x - a.x, dur: clip.duration };
}
