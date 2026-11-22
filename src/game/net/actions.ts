/**
 * Teammates' one-off actions (reload, grenade throw) for their third-person
 * avatars.
 *
 * On the wire it is one optional trailing byte on the player state (see
 * encodePlayerState): low 2 bits = the action in progress, high 6 bits = a
 * counter bumped every time an action starts. The byte is left out while
 * idle, so an idle state stays 23 bytes and old clients (which stop reading
 * after the fixed fields) simply ignore it. Because it is a state rather
 * than an edge, a lost packet or a late joiner still sees the reload that is
 * in progress; the counter tells a fresh reload from the same one.
 */

/** Wire codes (append only). */
export const ACTIONS = ["none", "reload", "throw"] as const;
export type ActionKind = (typeof ACTIONS)[number];
export const ACT_NONE = 0, ACT_RELOAD = 1, ACT_THROW = 2;
const SEQ_MOD = 64;
/** A queued start older than this (render clock, ms) is dropped instead of played. */
const STALE_MS = 1500;

/** Packs action + start counter into the trailing state byte. */
export const packAction = (act: number, seq: number) => (act & 3) | ((seq % SEQ_MOD) << 2);
export const unpackAction = (b: number) => ({ act: b & 3, seq: (b >> 2) & (SEQ_MOD - 1) });

/**
 * Sender side. `track` every frame with what the local player is doing;
 * `wire` once per outgoing state. An action that starts and ends between two
 * sends (a quick tap-throw at a low state rate) is still reported once.
 */
export class ActionSender {
  private cur = ACT_NONE;
  private seq = 0;
  /** Started since the last send (survives the action ending before then). */
  private latched = ACT_NONE;

  track(act: number) {
    if (act !== this.cur && act !== ACT_NONE) {
      this.seq = (this.seq + 1) % SEQ_MOD;
      this.latched = act;
    }
    this.cur = act;
  }

  wire(): { act: number; actSeq: number } {
    const act = this.cur !== ACT_NONE ? this.cur : this.latched;
    this.latched = ACT_NONE;
    return { act, actSeq: this.seq };
  }
}

/** The bits of Humanoid the follower drives. */
export interface ActionModel {
  reload(): void;
  throwGrenade(): void;
  /** Ends the action: blends out, or stops at once when `now`. */
  cancelAction(now?: boolean): void;
  readonly acting: boolean;
}

/**
 * Receiver side, one per remote avatar. `observe` every state message (in
 * the sender's clock); `apply` each frame at the avatar's render time, so the
 * action plays in step with the interpolated body rather than early.
 */
export class ActionFollower {
  private lastAct = ACT_NONE;
  private lastSeq = -1;
  private lastWeapon = -1;
  /** What the avatar is playing (as far as we started it). */
  private playing = ACT_NONE;
  private readonly queue: { at: number; cmd: "reload" | "throw" | "cancel" }[] = [];

  observe(time: number, act: number, seq: number, weapon: number) {
    const swapped = this.lastWeapon >= 0 && weapon !== this.lastWeapon;
    this.lastWeapon = weapon;
    if (act !== ACT_NONE && (act !== this.lastAct || seq !== this.lastSeq)) {
      // A new action (also the first one a late joiner hears about, mid-reload).
      this.push(time, act === ACT_THROW ? "throw" : "reload");
    } else if (this.lastAct === ACT_RELOAD && (act !== ACT_RELOAD || swapped)) {
      // Reload finished early or was cancelled (weapon swap, sprint-melee…): blend out now.
      this.push(time, "cancel");
    }
    this.lastAct = act;
    if (act !== ACT_NONE) this.lastSeq = seq;
  }

  private push(at: number, cmd: "reload" | "throw" | "cancel") {
    if (this.queue.length >= 8) this.queue.shift();
    this.queue.push({ at, cmd });
  }

  /** Runs queued commands that are due at `renderTime` against the model. */
  apply(renderTime: number, model: ActionModel) {
    while (this.queue.length && this.queue[0].at <= renderTime) {
      const { at, cmd } = this.queue.shift()!;
      if (cmd === "cancel") {
        // Only cut a reload we started; a throw plays out on its own timing.
        if (this.playing === ACT_RELOAD && model.acting) model.cancelAction();
        this.playing = ACT_NONE;
      } else if (renderTime - at > STALE_MS) {
        // Queued while the avatar was hidden: long over, don't replay it.
        continue;
      } else {
        // A new action replaces whatever is still playing (a reload on the gun
        // they just swapped away from, a throw that outlasted the real one).
        if (model.acting) model.cancelAction(true);
        if (cmd === "reload") model.reload();
        else model.throwGrenade();
        this.playing = !model.acting ? ACT_NONE : cmd === "reload" ? ACT_RELOAD : ACT_THROW;
      }
    }
    if (!model.acting) this.playing = ACT_NONE;
  }

  /** Peer dropped / avatar respawned: forget the stream so the next state starts fresh. */
  reset() {
    this.lastAct = ACT_NONE;
    this.lastSeq = -1;
    this.lastWeapon = -1;
    this.playing = ACT_NONE;
    this.queue.length = 0;
  }
}
