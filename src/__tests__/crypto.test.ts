import { describe, expect, it } from 'vitest';
import {
  hmacSha1,
  hmacSha256,
  normalizeEd25519PublicKey,
  secretToBytes,
  verifyEd25519,
} from '../core/crypto.js';
import { base64, base64url, hex, utf8 } from '../core/encoding.js';
import { WebhookError } from '../errors/index.js';

describe('secretToBytes', () => {
  it('should encode a string secret as UTF-8 bytes', () => {
    expect(secretToBytes('abc')).toEqual(utf8.encode('abc'));
  });

  it('should pass through Uint8Array secrets unchanged', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(secretToBytes(bytes)).toBe(bytes);
  });
});

describe('hmacSha256', () => {
  it('should produce the well-known RFC 4231 test vector when called', async () => {
    // Test vector: key = "key" UTF-8, data = "The quick brown fox jumps over the lazy dog"
    const key = utf8.encode('key');
    const data = utf8.encode('The quick brown fox jumps over the lazy dog');
    const out = await hmacSha256(key, data);
    expect(hex.encode(out)).toBe(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
    );
  });

  it('should produce a 32-byte digest when called', async () => {
    const out = await hmacSha256(new Uint8Array(8), new Uint8Array(0));
    expect(out.length).toBe(32);
  });
});

describe('hmacSha1', () => {
  it('should produce a 20-byte digest when called', async () => {
    const out = await hmacSha1(utf8.encode('k'), utf8.encode('m'));
    expect(out.length).toBe(20);
  });

  it('should produce stable output for known input', async () => {
    const out = await hmacSha1(utf8.encode('key'), utf8.encode('msg'));
    // SHA1 is deterministic — assert reproducibility.
    const out2 = await hmacSha1(utf8.encode('key'), utf8.encode('msg'));
    expect(hex.encode(out)).toBe(hex.encode(out2));
  });
});

describe('normalizeEd25519PublicKey', () => {
  const raw = new Uint8Array(32);
  for (let i = 0; i < 32; i++) raw[i] = i;

  it('should accept a raw 32-byte Uint8Array', () => {
    expect(normalizeEd25519PublicKey(raw)).toBe(raw);
  });

  it('should reject Uint8Array of wrong length', () => {
    expect(() => normalizeEd25519PublicKey(new Uint8Array(16))).toThrow(WebhookError);
  });

  it('should decode hex strings of length 64', () => {
    expect(normalizeEd25519PublicKey(hex.encode(raw))).toEqual(raw);
  });

  it('should reject hex strings that decode to wrong length', () => {
    expect(() => normalizeEd25519PublicKey('00'.repeat(16))).toThrow(/32 bytes/);
  });

  it('should decode standard base64 strings', () => {
    expect(normalizeEd25519PublicKey(base64.encode(raw))).toEqual(raw);
  });

  it('should decode URL-safe base64 strings', () => {
    expect(normalizeEd25519PublicKey(base64url.encode(raw))).toEqual(raw);
  });

  it('should decode PEM-wrapped Ed25519 SubjectPublicKeyInfo', () => {
    // Ed25519 SPKI prefix: 12 bytes (3 + 9 OID/etc) — reconstruct and base64-encode.
    const spkiPrefix = new Uint8Array([
      0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
    ]);
    const der = new Uint8Array(spkiPrefix.length + raw.length);
    der.set(spkiPrefix, 0);
    der.set(raw, spkiPrefix.length);
    const pem = `-----BEGIN PUBLIC KEY-----\n${base64.encode(der)}\n-----END PUBLIC KEY-----`;
    expect(normalizeEd25519PublicKey(pem)).toEqual(raw);
  });

  it('should reject PEM that is too short', () => {
    const pem = '-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----';
    expect(() => normalizeEd25519PublicKey(pem)).toThrow(/too short/);
  });

  it('should reject base64 input that decodes to wrong length', () => {
    expect(() => normalizeEd25519PublicKey(base64.encode(new Uint8Array(16)))).toThrow(WebhookError);
  });

  it('should throw on completely invalid input', () => {
    expect(() => normalizeEd25519PublicKey('!!!!')).toThrow(WebhookError);
  });
});

describe('verifyEd25519', () => {
  it('should verify a known-valid signature when called', async () => {
    // Generate keypair via WebCrypto and sign.
    const keyPair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const data = utf8.encode('hello world');
    const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', keyPair.privateKey, data));
    const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
    expect(await verifyEd25519(rawPub, sig, data)).toBe(true);
  });

  it('should return false for a tampered signature', async () => {
    const keyPair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const data = utf8.encode('hello world');
    const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', keyPair.privateKey, data));
    sig[0] ^= 0xff;
    const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
    expect(await verifyEd25519(rawPub, sig, data)).toBe(false);
  });

  it('should reuse the cached CryptoKey across calls (smoke test)', async () => {
    const keyPair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const data = utf8.encode('payload');
    const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', keyPair.privateKey, data));
    const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
    // Two calls with the same publicKey buffer should both succeed.
    expect(await verifyEd25519(rawPub, sig, data)).toBe(true);
    expect(await verifyEd25519(rawPub, sig, data)).toBe(true);
  });
});
