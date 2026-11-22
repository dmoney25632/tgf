// Soldier identities: deterministic per agent id, neighbours look different,
// kits keep their silhouette, parts only mix within a skeleton, and the
// static avatar table matches the shipped soldiers.json. Plus the gear
// builder: rigid skinning on real joints, cached per kit combination.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three";
import { AVATAR_IDS, AVATARS, FACE_ORDER, identityKey, npcIdentity, partSources, playerIdentity, TONES, type Kit } from "../src/game/ai/soldier/identity";
import { soldierGear } from "../src/game/ai/soldier/gear";

const meta = JSON.parse(fs.readFileSync(new URL("../public/assets/characters/soldiers/soldiers.json", import.meta.url), "utf8")) as {
  avatars: Record<string, { sex: string; cap: boolean; parts: string[] }>;
};
const KITS: Kit[] = ["standard", "rusher", "heavy", "sniper", "warden"];

test("avatar table mirrors soldiers.json", () => {
  for (const id of AVATAR_IDS) {
    const m = meta.avatars[id];
    assert.ok(m, id);
    assert.equal(AVATARS[id].sex, m.sex, id);
    assert.equal(AVATARS[id].cap, m.cap, id);
    assert.deepEqual([...AVATARS[id].parts].sort(), [...m.parts].sort(), id);
  }
});

test("NPC identities are deterministic and neighbours differ", () => {
  for (const kit of KITS) {
    const keys = new Set<string>();
    for (let s = 0; s < 40; s++) {
      const a = npcIdentity(s, kit), b = npcIdentity(s, kit);
      assert.deepEqual(a, b);
      if (s > 0) assert.notEqual(identityKey(a), identityKey(npcIdentity(s - 1, kit)), `${kit} ${s}`);
      keys.add(identityKey(a));
    }
    assert.ok(keys.size >= 30, `${kit}: only ${keys.size} distinct soldiers in 40`);
  }
  // Standard squads: never the same face twice in a row, several faces in a squad of 20.
  const faces = Array.from({ length: 20 }, (_, i) => npcIdentity(i, "standard").head);
  for (let i = 1; i < faces.length; i++) assert.notEqual(faces[i], faces[i - 1]);
  assert.ok(new Set(faces).size >= 6);
  assert.equal(FACE_ORDER.length % 3, 0);
});

test("parts only mix within one skeleton; kits keep their silhouette", () => {
  for (const kit of KITS) {
    for (let s = 0; s < 60; s++) {
      const id = npcIdentity(s, kit);
      const sex = AVATARS[id.body].sex;
      for (const [part, src] of Object.entries(partSources(id))) {
        if (!src) continue;
        assert.equal(AVATARS[src].sex, sex, `${kit} ${s} ${part}`);
        assert.ok(AVATARS[src].parts.includes(part as never), `${kit} ${s}: ${src} has no ${part}`);
      }
      assert.ok(TONES.includes(id.tone as never));
      assert.ok(id.height > 0.96 && id.height < 1.04 && id.width > 0.9 && id.width < 1.15);
      // A cap is part of the head mesh: never under a helmet / boonie.
      if (AVATARS[id.head].cap) assert.equal(id.headgear, "cap");
      if (id.headgear !== "helmet") assert.equal(id.helmet, null);
      if (kit === "sniper") assert.ok(id.ghillie && id.headgear === "boonie");
      if (kit === "rusher") assert.ok(id.balaclava && id.goggles && id.headgear === "helmet");
      if (kit === "heavy") assert.ok(id.armour === "heavy" && id.width > 1.05);
      if (kit === "warden") assert.ok(id.armour === "warden" && id.headgear === "cap" && id.vest);
      if (id.chestRig) assert.equal(id.vest, null);
    }
  }
});

test("player identities follow the chosen gear and skin", () => {
  for (let gear = 0; gear < 6; gear++) {
    for (const skin of TONES) {
      const id = playerIdentity(gear, skin);
      assert.equal(id.tone, skin);
      assert.equal(id.headgear === "cap", gear === 1);
      if (gear === 3) assert.equal(id.headgear, "bare");
      if (gear === 4) assert.ok(id.balaclava);
      assert.equal(AVATARS[id.head].sex, "m");
      assert.deepEqual(id, playerIdentity(gear, skin));
    }
  }
  // Darker chosen skin picks a darker source face.
  assert.notEqual(playerIdentity(0, TONES[0]).head, playerIdentity(0, TONES[6]).head);
});

test("gear is rigidly skinned onto real joints and cached per combination", () => {
  const joints = ["Bip01", "Bip01_Pelvis", "Bip01_Spine", "Bip01_Spine1", "Bip01_Spine2", "Bip01_Neck", "Bip01_Head", "Bip01_L_UpperArm", "Bip01_R_UpperArm", "Bip01_L_Thigh", "Bip01_R_Thigh", "Bip01_L_Calf", "Bip01_R_Calf"];
  const at = (n: string) => new THREE.Vector3(0, n.includes("Head") ? 1.524 : 1, 0);
  const pal = { uniform: 0x5b6148, vest: 0x4b4a38, helmet: 0x55553f, accent: 0xc0392b };
  for (const kit of KITS) {
    const id = npcIdentity(5, kit);
    const g = soldierGear(id, pal, false, joints, at);
    assert.strictEqual(g, soldierGear(id, pal, false, joints, at));
    for (const geo of [g.kit[0], g.kit[1], g.ghillie]) {
      if (!geo) continue;
      const si = geo.getAttribute("skinIndex"), sw = geo.getAttribute("skinWeight");
      assert.equal(si.count, geo.getAttribute("position").count);
      for (let i = 0; i < si.count; i += 37) {
        assert.ok(si.getX(i) > 0 && si.getX(i) < joints.length);
        assert.equal(sw.getX(i), 1);
      }
    }
    if (kit === "sniper") assert.ok(g.ghillie);
    // The mid LOD never costs more than the near one.
    if (g.kit[0] && g.kit[1]) assert.ok(g.kit[1].index!.count <= g.kit[0].index!.count);
  }
});
