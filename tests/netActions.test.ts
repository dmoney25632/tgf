// Teammates' reloads and grenade throws reach their third-person avatars:
// sender tracking → optional trailing state byte → follower on the receiving
// avatar, replayed at the avatar's render time. Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fromBase64, toBase64 } from "../src/game/net/codec";
import { decodePlayerState, encodePlayerState, type PlayerStateMsg, type SnapshotPayload, type StatePayload } from "../src/game/net/protocol";
import { ACT_NONE, ACT_RELOAD, ACT_THROW, ActionFollower, ActionSender, type ActionModel } from "../src/game/net/actions";

/** Stand-in for Humanoid's action API (same busy rules: one action at a time). */
class FakeModel implements ActionModel {
  log: string[] = [];
  act: "none" | "reload" | "throw" = "none";
  get acting() {
    return this.act !== "none";
  }
  reload() {
    if (this.acting) return;
    this.act = "reload";
    this.log.push("reload");
  }
  throwGrenade() {
    if (this.acting) return;
    this.act = "throw";
    this.log.push("throw");
  }
  cancelAction(now = false) {
    if (!this.acting) return;
    this.log.push(now ? "cut" : "cancel");
    this.act = "none";
  }
}

const base = (over: Partial<PlayerStateMsg> = {}): PlayerStateMsg => ({
  slot: 1, seq: 0, time: 0, x: 1, y: 0, z: 2, yaw: 0.5, pitch: 0, crouch: false, sprint: false, slide: false,
  grounded: true, ads: false, downed: false, selfReviving: false, ready: false, weapon: 3, shots: 0, reviveTarget: 255, ...over,
});

/** Player A: a frame loop that tracks the local action and sends state every `every` frames. */
function playerA() {
  const sender = new ActionSender();
  let seq = 0;
  return {
    frame: (act: number) => sender.track(act),
    /** A client's broadcast state, as B receives it (JSON + base64 like the transport). */
    send(time: number, weapon = 3): StatePayload {
      const payload: StatePayload = { b: toBase64(encodePlayerState(base({ seq: ++seq, time, weapon, ...sender.wire() }))) };
      return JSON.parse(JSON.stringify(payload)) as StatePayload;
    },
  };
}

/** Player B's side of CoopSurvivalNet.onState → RemoteAvatar for slot 1. */
function avatarB() {
  const follower = new ActionFollower();
  const model = new FakeModel();
  return {
    model,
    receive(p: StatePayload | SnapshotPayload) {
      const b = "h" in p && p.h ? p.h : p.b;
      const m = decodePlayerState(fromBase64(b))!;
      follower.observe(m.time, m.act ?? ACT_NONE, m.actSeq ?? 0, m.weapon);
    },
    render: (t: number) => follower.apply(t, model),
    follower,
  };
}

test("a reload by player A plays as a reload on B's avatar, at B's render time", () => {
  const a = playerA();
  const b = avatarB();
  a.frame(ACT_NONE);
  b.receive(a.send(1000));
  a.frame(ACT_RELOAD);
  const msg = a.send(1050);
  assert.equal(fromBase64(msg.b).length, 24, "one extra byte while reloading");
  b.receive(msg);
  b.render(1000);
  assert.deepEqual(b.model.log, [], "not before the interpolated body gets there");
  b.render(1060);
  assert.deepEqual(b.model.log, ["reload"]);
  // The same reload in the next messages doesn't restart it.
  b.receive(a.send(1100));
  b.receive(a.send(1150));
  b.render(1200);
  assert.deepEqual(b.model.log, ["reload"]);
  // Reload done on A: the avatar's (longer) animation blends out to match.
  a.frame(ACT_NONE);
  const idle = a.send(1200);
  assert.equal(fromBase64(idle.b).length, 23, "idle state is the old 23-byte record");
  b.receive(idle);
  b.render(1250);
  assert.deepEqual(b.model.log, ["reload", "cancel"]);
});

test("the host's own reload rides its snapshot pose the same way", () => {
  const host = playerA();
  const b = avatarB();
  host.frame(ACT_RELOAD);
  const snap: SnapshotPayload = { b: "", h: host.send(5000).b };
  b.receive(snap);
  b.render(5000);
  assert.deepEqual(b.model.log, ["reload"]);
});

test("a reload cancelled by a swap cuts the avatar's reload; a fresh reload restarts it", () => {
  const a = playerA();
  const b = avatarB();
  a.frame(ACT_RELOAD);
  b.receive(a.send(100, 3));
  b.render(100);
  // Swap to the sidearm: local reload cancelled, weapon index changes.
  a.frame(ACT_NONE);
  b.receive(a.send(150, 7));
  b.render(150);
  assert.deepEqual(b.model.log, ["reload", "cancel"]);
  // Reload the sidearm right away (a new action, new counter).
  a.frame(ACT_RELOAD);
  b.receive(a.send(200, 7));
  b.render(200);
  assert.deepEqual(b.model.log, ["reload", "cancel", "reload"]);
  // Swap mid-reload within one send interval (reload → swap → reload on the new gun).
  a.frame(ACT_NONE);
  a.frame(ACT_RELOAD);
  b.receive(a.send(250, 3));
  b.render(250);
  assert.deepEqual(b.model.log, ["reload", "cancel", "reload", "cut", "reload"]);
});

test("grenade throws reach the avatar, even a tap shorter than one send interval", () => {
  const a = playerA();
  const b = avatarB();
  a.frame(ACT_THROW);
  a.frame(ACT_NONE); // over before the next send
  const msg = a.send(10);
  assert.equal(decodePlayerState(fromBase64(msg.b))!.act, ACT_THROW);
  b.receive(msg);
  b.render(10);
  assert.deepEqual(b.model.log, ["throw"]);
  // The throw isn't cut short by the next idle state: it plays out.
  b.receive(a.send(60));
  b.render(60);
  assert.deepEqual(b.model.log, ["throw"]);
});

test("a late joiner sees a reload already in progress; stale queued starts are dropped", () => {
  const a = playerA();
  a.frame(ACT_RELOAD);
  a.send(0); // before B joined
  const late = avatarB();
  late.receive(a.send(50));
  late.render(50);
  assert.deepEqual(late.model.log, ["reload"]);
  // A start queued while the avatar was hidden is not replayed seconds later.
  const hidden = avatarB();
  hidden.receive(a.send(100));
  hidden.render(5000);
  assert.deepEqual(hidden.model.log, []);
});

test("old senders (23-byte state) mean no action; old receivers read the same fixed fields", () => {
  const legacy = encodePlayerState(base({ time: 9 }));
  assert.equal(legacy.length, 23);
  const m = decodePlayerState(legacy)!;
  assert.equal(m.act, ACT_NONE);
  const withAct = encodePlayerState(base({ time: 9, act: ACT_RELOAD, actSeq: 63 }));
  const back = decodePlayerState(withAct)!;
  assert.equal(back.act, ACT_RELOAD);
  assert.equal(back.actSeq, 63);
  // An old decoder stops after the fixed record: those bytes are unchanged.
  assert.deepEqual([...withAct.slice(0, 23)], [...legacy]);
});
