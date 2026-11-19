/**
 * Tiny little-endian byte writer/reader plus base64 helpers. Snapshots and
 * player states are packed into bytes, then base64'd so they ride inside a
 * JSON broadcast payload (Supabase Realtime and BroadcastChannel both carry
 * JSON reliably; base64 costs +33% but keeps one code path).
 */
export class ByteWriter {
  private buf: Uint8Array;
  private view: DataView;
  private n = 0;

  constructor(capacity = 256) {
    this.buf = new Uint8Array(capacity);
    this.view = new DataView(this.buf.buffer);
  }

  get length() {
    return this.n;
  }

  private ensure(extra: number) {
    if (this.n + extra <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.n + extra) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.n));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(v: number) {
    this.ensure(1);
    this.view.setUint8(this.n, clampInt(v, 0, 0xff));
    this.n += 1;
  }
  i8(v: number) {
    this.ensure(1);
    this.view.setInt8(this.n, clampInt(v, -128, 127));
    this.n += 1;
  }
  u16(v: number) {
    this.ensure(2);
    this.view.setUint16(this.n, clampInt(v, 0, 0xffff), true);
    this.n += 2;
  }
  i16(v: number) {
    this.ensure(2);
    this.view.setInt16(this.n, clampInt(v, -32768, 32767), true);
    this.n += 2;
  }
  u32(v: number) {
    this.ensure(4);
    this.view.setUint32(this.n, Math.max(0, Math.min(0xffffffff, Math.round(v))) >>> 0, true);
    this.n += 4;
  }

  /** Writes a u8 placeholder and returns its offset (patched later). */
  reserveU8() {
    this.ensure(1);
    return this.n++;
  }
  reserveU16() {
    this.ensure(2);
    const at = this.n;
    this.n += 2;
    return at;
  }
  patchU8(at: number, v: number) {
    this.view.setUint8(at, clampInt(v, 0, 0xff));
  }
  patchU16(at: number, v: number) {
    this.view.setUint16(at, clampInt(v, 0, 0xffff), true);
  }

  bytes() {
    return this.buf.slice(0, this.n);
  }
}

export class ByteReader {
  private readonly view: DataView;
  private n = 0;

  constructor(private readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  get remaining() {
    return this.buf.length - this.n;
  }

  private need(k: number) {
    if (this.n + k > this.buf.length) throw new RangeError("truncated message");
  }
  u8() {
    this.need(1);
    return this.view.getUint8(this.n++);
  }
  i8() {
    this.need(1);
    return this.view.getInt8(this.n++);
  }
  u16() {
    this.need(2);
    const v = this.view.getUint16(this.n, true);
    this.n += 2;
    return v;
  }
  i16() {
    this.need(2);
    const v = this.view.getInt16(this.n, true);
    this.n += 2;
    return v;
  }
  u32() {
    this.need(4);
    const v = this.view.getUint32(this.n, true);
    this.n += 4;
    return v;
  }
}

function clampInt(v: number, lo: number, hi: number) {
  const r = Math.round(v);
  return r < lo ? lo : r > hi ? hi : r;
}

export function toBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function fromBase64(b64: string) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
