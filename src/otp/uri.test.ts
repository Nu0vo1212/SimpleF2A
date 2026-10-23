import { describe, expect, it } from 'vitest';
import { buildOtpAuthUri, isMigrationUri, isOtpAuthUri, parseOtpAuthUri } from './uri';
import { base32Encode } from './base32';

describe('parseOtpAuthUri', () => {
  it('parses a standard TOTP URI with issuer in path and query', () => {
    const uri =
      'otpauth://totp/Example:alice@google.com?secret=JBSWY3DPEHPK3PXP&issuer=Example';
    const parsed = parseOtpAuthUri(uri);
    expect(parsed).toMatchObject({
      type: 'totp',
      issuer: 'Example',
      account: 'alice@google.com',
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });
  });

  it('extracts algorithm / digits / period query params', () => {
    const parsed = parseOtpAuthUri(
      'otpauth://totp/Big%20Corp:bob@big.com?secret=JBSWY3DPEHPK3PXP&issuer=Big%20Corp&algorithm=SHA256&digits=8&period=60',
    );
    expect(parsed.issuer).toBe('Big Corp');
    expect(parsed.account).toBe('bob@big.com');
    expect(parsed.algorithm).toBe('SHA256');
    expect(parsed.digits).toBe(8);
    expect(parsed.period).toBe(60);
  });

  it('falls back to path issuer when query issuer is missing', () => {
    const parsed = parseOtpAuthUri('otpauth://totp/OnlyPath:user@x.com?secret=JBSWY3DPEHPK3PXP');
    expect(parsed.issuer).toBe('OnlyPath');
  });

  it('handles account-only labels and url-encoded colons', () => {
    const parsed = parseOtpAuthUri('otpauth://totp/user%40example.com?secret=JBSWY3DPEHPK3PXP');
    expect(parsed.account).toBe('user@example.com');
    expect(parsed.issuer).toBe('');
  });

  it('parses HOTP with counter', () => {
    const parsed = parseOtpAuthUri(
      'otpauth://hotp/ACME:carol?secret=JBSWY3DPEHPK3PXP&counter=42&issuer=ACME',
    );
    expect(parsed.type).toBe('hotp');
    expect(parsed.counter).toBe(42);
  });

  it('parses Steam URIs and forces 5 digits / SHA1', () => {
    const parsed = parseOtpAuthUri(
      'otpauth://steam/Steam:gamer?secret=JBSWY3DPEHPK3PXP&digits=6',
    );
    expect(parsed.type).toBe('steam');
    expect(parsed.digits).toBe(5);
    expect(parsed.algorithm).toBe('SHA1');
  });

  it('parses MOTP with pin', () => {
    const parsed = parseOtpAuthUri(
      'otpauth://motp/mOTP:user?secret=JBSWY3DPEHPK3PXP&pin=1234',
    );
    expect(parsed.type).toBe('motp');
    expect(parsed.pin).toBe('1234');
    expect(parsed.digits).toBe(6);
    expect(parsed.period).toBe(10);
  });

  it('normalizes lowercase / spaced secrets', () => {
    const parsed = parseOtpAuthUri('otpauth://totp/X:y?secret=jbsw y3dp ehpk 3pxp');
    expect(parsed.secret).toBe('JBSWY3DPEHPK3PXP');
  });

  it('rejects malformed input', () => {
    expect(() => parseOtpAuthUri('https://example.com')).toThrow();
    expect(() => parseOtpAuthUri('otpauth://totp/X:y')).toThrow(/secret/);
    expect(() => parseOtpAuthUri('otpauth://totp/X:y?secret=!!!')).toThrow(/Base32/);
    expect(() => parseOtpAuthUri('otpauth://unknown/X:y?secret=JBSWY3DPEHPK3PXP')).toThrow();
    expect(() =>
      parseOtpAuthUri('otpauth://totp/X:y?secret=JBSWY3DPEHPK3PXP&algorithm=MD5'),
    ).toThrow(/算法/);
    // steam 固定 SHA1，显式声明其它算法应被拒绝
    expect(() =>
      parseOtpAuthUri('otpauth://steam/X:y?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256'),
    ).toThrow(/SHA1/);
  });

  it('isOtpAuthUri detects the scheme', () => {
    expect(isOtpAuthUri('otpauth://totp/a?secret=JBSWY3DPEHPK3PXP')).toBe(true);
    expect(isOtpAuthUri('  otpauth://hotp/a?secret=x')).toBe(true);
    expect(isOtpAuthUri('otpauth-migration://offline?data=x')).toBe(false);
    expect(isOtpAuthUri('otpauth://x')).toBe(false);
    expect(isMigrationUri('otpauth-migration://offline?data=x')).toBe(true);
    expect(isMigrationUri('otpauth://totp/x')).toBe(false);
  });
});

describe('buildOtpAuthUri', () => {
  it('round-trips a TOTP account', () => {
    const uri = buildOtpAuthUri({
      type: 'totp',
      issuer: 'Example',
      account: 'alice@google.com',
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      counter: 0,
    });
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    const parsed = parseOtpAuthUri(uri);
    expect(parsed.issuer).toBe('Example');
    expect(parsed.account).toBe('alice@google.com');
    expect(parsed.secret).toBe('JBSWY3DPEHPK3PXP');
  });

  it('round-trips custom period/digits/algorithm', () => {
    const uri = buildOtpAuthUri({
      type: 'totp',
      issuer: 'Corp',
      account: 'u',
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA512',
      digits: 8,
      period: 45,
      counter: 0,
    });
    const parsed = parseOtpAuthUri(uri);
    expect(parsed).toMatchObject({ algorithm: 'SHA512', digits: 8, period: 45 });
  });

  it('round-trips HOTP counter', () => {
    const uri = buildOtpAuthUri({
      type: 'hotp',
      issuer: 'Legacy',
      account: 'dev',
      secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      counter: 7,
    });
    expect(parseOtpAuthUri(uri).counter).toBe(7);
  });

  it('encodes raw secret bytes to base32 (public test bytes)', () => {
    expect(base32Encode(new TextEncoder().encode('12345678901234567890'))).toBe(
      'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
    );
  });
});
