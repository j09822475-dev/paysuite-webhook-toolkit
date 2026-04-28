/**
 * Pure-JS hex / base64 / base64url / utf8 codecs working on `Uint8Array`.
 *
 * No `Buffer` (not available on edge), no `atob`/`btoa` (unsafe for binary
 * input — they assume Latin-1 strings and corrupt non-ASCII bytes).
 */

const HEX_TABLE: readonly string[] = (() => {
  const t: string[] = new Array<string>(256);
  for (let i = 0; i < 256; i++) t[i] = i.toString(16).padStart(2, '0');
  return t;
})();

const HEX_CHAR_VALUE: Readonly<Record<string, number>> = (() => {
  const t: Record<string, number> = {};
  for (let i = 0; i < 10; i++) t[String.fromCharCode(48 + i)] = i;
  for (let i = 0; i < 6; i++) {
    t[String.fromCharCode(97 + i)] = 10 + i;
    t[String.fromCharCode(65 + i)] = 10 + i;
  }
  return t;
})();

/** Hex codec. Lowercase output; case-insensitive input. */
export const hex = {
  /**
   * Encode a `Uint8Array` to a lowercase hex string.
   *
   * @param bytes - Input bytes.
   * @returns Lowercase hex string of length `bytes.length * 2`.
   *
   * @example
   * ```ts
   * hex.encode(new Uint8Array([0xde, 0xad])); // 'dead'
   * ```
   */
  encode(bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += HEX_TABLE[bytes[i]!];
    return out;
  },

  /**
   * Decode a hex string to a `Uint8Array`.
   *
   * @param input - Hex string. Even length required; case-insensitive.
   * @returns Decoded bytes.
   * @throws {Error} If `input` is malformed (odd length or non-hex char).
   *
   * @example
   * ```ts
   * hex.decode('DEAD'); // Uint8Array [ 0xde, 0xad ]
   * ```
   */
  decode(input: string): Uint8Array {
    if (input.length % 2 !== 0) throw new Error('hex: odd length');
    const out = new Uint8Array(input.length >>> 1);
    for (let i = 0; i < out.length; i++) {
      const hi = HEX_CHAR_VALUE[input[i * 2]!];
      const lo = HEX_CHAR_VALUE[input[i * 2 + 1]!];
      if (hi === undefined || lo === undefined) throw new Error('hex: invalid character');
      out[i] = (hi << 4) | lo;
    }
    return out;
  },
};

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const B64_LOOKUP: Readonly<Record<string, number>> = (() => {
  const t: Record<string, number> = {};
  for (let i = 0; i < B64_ALPHABET.length; i++) t[B64_ALPHABET[i]!] = i;
  for (let i = 0; i < B64URL_ALPHABET.length; i++) t[B64URL_ALPHABET[i]!] = i;
  return t;
})();

function encodeBase64Internal(bytes: Uint8Array, alphabet: string, pad: boolean): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1]!;
    const b2 = bytes[i + 2]!;
    out += alphabet[b0 >>> 2];
    out += alphabet[((b0 & 0x03) << 4) | (b1 >>> 4)];
    out += alphabet[((b1 & 0x0f) << 2) | (b2 >>> 6)];
    out += alphabet[b2 & 0x3f];
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const b0 = bytes[i]!;
    out += alphabet[b0 >>> 2];
    out += alphabet[(b0 & 0x03) << 4];
    if (pad) out += '==';
  } else if (remaining === 2) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1]!;
    out += alphabet[b0 >>> 2];
    out += alphabet[((b0 & 0x03) << 4) | (b1 >>> 4)];
    out += alphabet[(b1 & 0x0f) << 2];
    if (pad) out += '=';
  }
  return out;
}

function decodeBase64Internal(input: string): Uint8Array {
  // Strip padding; tolerate either alphabet on input.
  let s = input;
  while (s.length > 0 && s.charCodeAt(s.length - 1) === 61) s = s.slice(0, -1);
  const len = s.length;
  const groups = Math.floor(len / 4);
  const tail = len - groups * 4;
  if (tail === 1) throw new Error('base64: invalid length');

  let outLen = groups * 3;
  if (tail === 2) outLen += 1;
  else if (tail === 3) outLen += 2;

  const out = new Uint8Array(outLen);
  let oi = 0;
  let i = 0;
  for (let g = 0; g < groups; g++, i += 4) {
    const v0 = B64_LOOKUP[s[i]!];
    const v1 = B64_LOOKUP[s[i + 1]!];
    const v2 = B64_LOOKUP[s[i + 2]!];
    const v3 = B64_LOOKUP[s[i + 3]!];
    if (v0 === undefined || v1 === undefined || v2 === undefined || v3 === undefined) {
      throw new Error('base64: invalid character');
    }
    out[oi++] = (v0 << 2) | (v1 >>> 4);
    out[oi++] = ((v1 & 0x0f) << 4) | (v2 >>> 2);
    out[oi++] = ((v2 & 0x03) << 6) | v3;
  }
  if (tail === 2) {
    const v0 = B64_LOOKUP[s[i]!];
    const v1 = B64_LOOKUP[s[i + 1]!];
    if (v0 === undefined || v1 === undefined) throw new Error('base64: invalid character');
    out[oi++] = (v0 << 2) | (v1 >>> 4);
  } else if (tail === 3) {
    const v0 = B64_LOOKUP[s[i]!];
    const v1 = B64_LOOKUP[s[i + 1]!];
    const v2 = B64_LOOKUP[s[i + 2]!];
    if (v0 === undefined || v1 === undefined || v2 === undefined) {
      throw new Error('base64: invalid character');
    }
    out[oi++] = (v0 << 2) | (v1 >>> 4);
    out[oi++] = ((v1 & 0x0f) << 4) | (v2 >>> 2);
  }
  return out;
}

/** Standard base64 codec (`+/=` alphabet, padded). */
export const base64 = {
  /**
   * Encode bytes to standard base64 (with `=` padding).
   *
   * @param bytes - Input bytes.
   * @returns Base64-encoded string.
   *
   * @example
   * ```ts
   * base64.encode(new Uint8Array([1, 2, 3])); // 'AQID'
   * ```
   */
  encode(bytes: Uint8Array): string {
    return encodeBase64Internal(bytes, B64_ALPHABET, true);
  },

  /**
   * Decode a base64 string. Tolerates both standard (`+/`) and URL-safe
   * (`-_`) alphabets and missing padding.
   *
   * @param input - Base64 string.
   * @returns Decoded bytes.
   * @throws {Error} If `input` contains characters outside the base64 alphabets.
   *
   * @example
   * ```ts
   * base64.decode('AQID'); // Uint8Array [1, 2, 3]
   * ```
   */
  decode(input: string): Uint8Array {
    return decodeBase64Internal(input);
  },
};

/** URL-safe base64 codec (`-_` alphabet, no padding). */
export const base64url = {
  /**
   * Encode bytes to URL-safe base64 without padding.
   *
   * @param bytes - Input bytes.
   * @returns URL-safe base64 string.
   */
  encode(bytes: Uint8Array): string {
    return encodeBase64Internal(bytes, B64URL_ALPHABET, false);
  },

  /**
   * Decode a URL-safe base64 string. Also tolerates the standard alphabet.
   *
   * @param input - URL-safe base64 string.
   * @returns Decoded bytes.
   * @throws {Error} If `input` contains characters outside the base64 alphabets.
   */
  decode(input: string): Uint8Array {
    return decodeBase64Internal(input);
  },
};

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: false });

/** UTF-8 codec backed by the platform `TextEncoder`/`TextDecoder`. */
export const utf8 = {
  /**
   * Encode a string as UTF-8 bytes.
   *
   * @param input - String to encode.
   * @returns UTF-8 byte sequence.
   */
  encode(input: string): Uint8Array {
    return TEXT_ENCODER.encode(input);
  },

  /**
   * Decode UTF-8 bytes to a string. Invalid sequences are replaced (not thrown).
   *
   * @param input - Byte sequence.
   * @returns Decoded string.
   */
  decode(input: Uint8Array): string {
    return TEXT_DECODER.decode(input);
  },
};

/**
 * Concatenate any number of `Uint8Array` instances into a single buffer.
 *
 * @param parts - Byte arrays to concatenate in order.
 * @returns A new `Uint8Array` containing every input byte.
 *
 * @example
 * ```ts
 * concat(utf8.encode('hello '), utf8.encode('world'));
 * ```
 */
export function concat(...parts: ReadonlyArray<Uint8Array>): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
