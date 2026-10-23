import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, generateSecret, isValidBase32, normalizeBase32 } from './base32';

describe('base32', () => {
  it('encodes/decodes RFC 4648 vectors', () => {
    const vectors: Array<[string, string]> = [
      ['', ''],
      ['f', 'MY'],
      ['fo', 'MZXQ'],
      ['foo', 'MZXW6'],
      ['foob', 'MZXW6YQ'],
      ['fooba', 'MZXW6YTB'],
      ['foobar', 'MZXW6YTBOI'],
    ];
    for (const [plain, encoded] of vectors) {
      expect(base32Encode(new TextEncoder().encode(plain))).toBe(encoded);
      expect(new TextDecoder().decode(base32Decode(encoded))).toBe(plain);
    }
  });

  it('decodes RFC 4226 secret "12345678901234567890"', () => {
    const bytes = base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(new TextDecoder().decode(bytes)).toBe('12345678901234567890');
  });

  it('is lenient about case, spaces and padding', () => {
    expect(normalizeBase32('gezd gnbv-gy3t qojq')).toBe('GEZDGNBVGY3TQOJQ');
    expect(base32Decode('MZXW6===')).toEqual(base32Decode('mzxw6'));
  });

  it('validates base32 strings', () => {
    expect(isValidBase32('JBSWY3DPEHPK3PXP')).toBe(true);
    expect(isValidBase32('JBSWY3DPEHPK3PX')).toBe(true);
    expect(isValidBase32('')).toBe(false);
    expect(isValidBase32('ABC1')).toBe(false); // 1 不在字母表
    expect(isValidBase32('A')).toBe(false); // 长度非法
  });

  it('generates unique base32 secrets', () => {
    const a = generateSecret();
    const b = generateSecret();
    expect(a).not.toBe(b);
    expect(isValidBase32(a)).toBe(true);
  });
});
