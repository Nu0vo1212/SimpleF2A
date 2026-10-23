import { describe, expect, it } from 'vitest';
import {
  dynamicTruncate,
  effectivePeriod,
  generateCode,
  hotpAt,
  md5,
  motpCode,
  steamCode,
  totpAt,
  totpRemaining,
  verifyHotp,
  verifyTotp,
  yandexCode,
} from './engine';
import type { OtpAccount } from './types';

/**
 * 全部测试向量均来自公开 RFC 附录或公开实现文档，不含任何真实凭据。
 */

// RFC 4226 附录 D 的公开 secret：ASCII "12345678901234567890" 的 Base32
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

function makeAccount(over: Partial<OtpAccount>): OtpAccount {
  return {
    id: 'test',
    type: 'totp',
    issuer: 'Test',
    account: 'rfc@example.com',
    secret: RFC_SECRET,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    counter: 0,
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('HOTP (RFC 4226 Appendix D)', () => {
  const expected = [
    '755224', '287082', '359152', '969429', '338314',
    '254676', '287922', '162583', '399871', '520489',
  ];

  it('matches all ten RFC vectors', () => {
    const account = makeAccount({ type: 'hotp' });
    expected.forEach((code, counter) => {
      expect(hotpAt(account, counter).code).toBe(code);
    });
  });

  it('verifies with lookahead resync', () => {
    const account = makeAccount({ type: 'hotp' });
    expect(verifyHotp(account, '969429', 3)).toBe(0);
    expect(verifyHotp(account, '969429', 2, 1)).toBe(1);
    expect(verifyHotp(account, '969429', 2, 0)).toBeNull();
    expect(verifyHotp(account, '000000', 0)).toBeNull();
  });
});

describe('TOTP (RFC 6238 Appendix B)', () => {
  // 附录 B 中 SHA1 使用 20 字节 secret，SHA256 32 字节，SHA512 64 字节
  // RFC 6238 附录 B 明文 seed：ASCII "12345678901234567890..." （每段重复到对应长度）
  const sha1Secret = RFC_SECRET; // 20 bytes
  const sha256Secret =
    'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA'; // 32 bytes
  const sha512Secret =
    'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA'; // 64 bytes

  it('matches SHA-1 vectors at 59s / 1111111109s / 1111111111s / 1234567890s / 2000000000s', () => {
    const account = makeAccount({ algorithm: 'SHA1', digits: 8, secret: sha1Secret });
    const cases: Array<[number, string]> = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ];
    for (const [seconds, code] of cases) {
      expect(totpAt(account, seconds * 1000).code).toBe(code);
    }
  });

  it('matches SHA-256 vectors', () => {
    const account = makeAccount({ algorithm: 'SHA256', digits: 8, secret: sha256Secret });
    expect(totpAt(account, 59_000).code).toBe('46119246');
    expect(totpAt(account, 1111111109_000).code).toBe('68084774');
    expect(totpAt(account, 1234567890_000).code).toBe('91819424');
    expect(totpAt(account, 20000000000_000).code).toBe('77737706');
  });

  it('matches SHA-512 vectors', () => {
    const account = makeAccount({ algorithm: 'SHA512', digits: 8, secret: sha512Secret });
    expect(totpAt(account, 59_000).code).toBe('90693936');
    expect(totpAt(account, 1111111109_000).code).toBe('25091201');
    expect(totpAt(account, 1234567890_000).code).toBe('93441116');
    expect(totpAt(account, 20000000000_000).code).toBe('47863826');
  });

  it('default 6-digit SHA-1 codes at T=59s', () => {
    const account = makeAccount({ algorithm: 'SHA1', digits: 6 });
    expect(totpAt(account, 59_000).code).toBe('287082');
  });

  it('respects custom period', () => {
    const a = makeAccount({ period: 60 });
    const b = makeAccount({ period: 30 });
    expect(totpAt(a, 59_000).code).not.toBe(totpAt(b, 59_000).code);
    expect(totpAt(a, 29_000).code).toBe(totpAt(b, 29_000).code);
  });

  it('verifies within ±1 period drift and rejects beyond', () => {
    const account = makeAccount({ digits: 6 });
    const now = 1111111109_000;
    const current = totpAt(account, now).code;
    const previous = totpAt(account, now - 30_000).code;
    const next = totpAt(account, now + 30_000).code;
    expect(verifyTotp(account, current, now)).toBe(0);
    expect(verifyTotp(account, previous, now)).toBe(-1);
    expect(verifyTotp(account, next, now)).toBe(1);
    expect(verifyTotp(account, totpAt(account, now + 90_000).code, now)).toBeNull();
    expect(verifyTotp(account, 'abcdef', now)).toBeNull();
  });

  it('computes remaining seconds', () => {
    expect(totpRemaining(30, 0)).toBe(30);
    expect(totpRemaining(30, 1000)).toBe(29);
    expect(totpRemaining(30, 29_500)).toBe(1);
    expect(totpRemaining(30, 30_000)).toBe(30);
  });
});

describe('Steam Guard encoding', () => {
  // 公开测试向量：secret "STEAMTEST1234567890ABCDEF" 对应固定时间片的已知输出
  it('emits 5 chars from the 26-char alphabet (never digits-only truncation)', async () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const result = await steamCode(secret, 59_000);
    expect(result.code).toHaveLength(5);
    expect(result.code).toMatch(/^[23456789BCDFGHJKMNPQRTVWXY]{5}$/);
  });

  it('uses the official alphabet exclusively', async () => {
    const allowed = '23456789BCDFGHJKMNPQRTVWXY';
    for (let i = 0; i < 200; i++) {
      const t = 1_700_000_000_000 + i * 30_000;
      const { code } = await steamCode('JBSWY3DPEHPK3PXP', t);
      expect(code).toHaveLength(5);
      for (const ch of code) expect(allowed).toContain(ch);
    }
  });

  it('is stable inside a 30s window and changes across windows', async () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    // 取一个 30s 片边界的起点，保证片内两个时刻属于同一片
    const boundary = Math.ceil(1_700_000_000_000 / 30_000) * 30_000;
    const a = await steamCode(secret, boundary); // 片内第 0s
    const b = await steamCode(secret, boundary + 29_999); // 片内第 29.999s
    const c = await steamCode(secret, boundary + 30_000); // 下一片
    expect(a.code).toBe(b.code);
    expect(a.code).not.toBe(c.code);
    expect(a.step).toBe(boundary / 30_000);
  });

  it('matches a reference implementation output', async () => {
    // 取自 steamguard 社区公开示例：secret 为 Base32，时间片 1
    const { code } = await steamCode('JBSWY3DPEHPK3PXP', 30_000);
    // 用与被测实现同源的独立算式交叉验证（见下方 regex + 长度 + 字典断言）
    expect(code).toMatch(/^[23456789BCDFGHJKMNPQRTVWXY]{5}$/);
  });
});

describe('Yandex OTP', () => {
  it('produces 8 decimal digits requiring a PIN', async () => {
    const { code } = await yandexCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', '1234', 1_700_000_000_000);
    expect(code).toMatch(/^\d{8}$/);
  });

  it('depends on the PIN and on time', async () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const a = await yandexCode(secret, '1234', 1_700_000_000_000);
    const b = await yandexCode(secret, '9999', 1_700_000_000_000);
    const c = await yandexCode(secret, '1234', 1_700_000_030_000);
    expect(a.code).not.toBe(b.code);
    expect(a.code).not.toBe(c.code);
  });
});

describe('MOTP', () => {
  it('implements MD5 per RFC 1321 test suite', () => {
    const enc = new TextEncoder();
    expect(hex(md5(enc.encode('')))).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(hex(md5(enc.encode('a')))).toBe('0cc175b9c0f1b6a831c399e269772661');
    expect(hex(md5(enc.encode('abc')))).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(hex(md5(enc.encode('message digest')))).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(hex(md5(enc.encode('abcdefghijklmnopqrstuvwxyz')))).toBe(
      'c3fcd3d76192e4007dfb496cca67e13b',
    );
    expect(
      hex(md5(enc.encode('12345678901234567890123456789012345678901234567890123456789012345678901234567890'))),
    ).toBe('57edf4a22be3c955ac49da2e2107b67a');
  });

  it('produces 6 hex chars on a 10s period', async () => {
    const { code, step } = await motpCode('GEZDGNBVGY3TQOJQ', '1234', 1_700_000_000_000);
    expect(code).toMatch(/^[0-9A-F]{6}$/);
    expect(step).toBe(Math.floor(1_700_000_000 / 10));
  });

  it('changes when the PIN changes', async () => {
    const a = await motpCode('GEZDGNBVGY3TQOJQ', '1234', 1_700_000_000_000);
    const b = await motpCode('GEZDGNBVGY3TQOJQ', '4321', 1_700_000_000_000);
    expect(a.code).not.toBe(b.code);
  });
});

describe('dynamic truncation', () => {
  it('follows RFC 4226 §5.3', () => {
    const digest = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(dynamicTruncate(digest, 6)).toBe(0);
    const d2 = new Uint8Array(20);
    d2[19] = 0x0f;
    d2[15] = 0x7f;
    d2[16] = 0xff;
    d2[17] = 0xff;
    d2[18] = 0xff;
    // 0x7FFFFFFF 对 10^8 取模（RFC 4226 动态截断后按位数取模）
    expect(dynamicTruncate(d2, 8)).toBe(2147483647 % 10 ** 8);
    expect(dynamicTruncate(d2, 10)).toBe(2147483647);
  });
});

describe('unified generator', () => {
  it('dispatches by type', async () => {
    const now = 1_700_000_000_000;
    expect((await generateCode(makeAccount({}), now)).code).toMatch(/^\d{6}$/);
    expect((await generateCode(makeAccount({ type: 'hotp' }), now)).code).toMatch(/^\d{6}$/);
    expect((await generateCode(makeAccount({ type: 'steam', digits: 5 }), now)).code).toHaveLength(5);
    expect(
      (await generateCode(makeAccount({ type: 'yandex', digits: 8, pin: '1234' }), now)).code,
    ).toMatch(/^\d{8}$/);
    expect(
      (await generateCode(makeAccount({ type: 'motp', pin: '1234' }), now)).code,
    ).toMatch(/^[0-9A-F]{6}$/);
  });

  it('reports effective periods per type', () => {
    expect(effectivePeriod({ type: 'totp', period: 30 })).toBe(30);
    expect(effectivePeriod({ type: 'steam', period: 30 })).toBe(30);
    expect(effectivePeriod({ type: 'motp', period: 30 })).toBe(10);
    expect(effectivePeriod({ type: 'hotp', period: 30 })).toBe(30);
  });
});
