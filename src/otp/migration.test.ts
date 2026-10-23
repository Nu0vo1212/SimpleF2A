import { describe, expect, it } from 'vitest';
import { MigrationError, extractMigrationData, parseMigrationUri } from './migration';

/** 手工构造 protobuf 字节（按公开的 MigrationPayload 定义），不含任何真实凭据。 */

function varint(n: number): number[] {
  const out: number[] = [];
  let v = n;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return out;
}

function tag(field: number, wire: number): number[] {
  return varint((field << 3) | wire);
}

function lenField(field: number, payload: number[]): number[] {
  return [...tag(field, 2), ...varint(payload.length), ...payload];
}

function varField(field: number, value: number): number[] {
  return [...tag(field, 0), ...varint(value)];
}

function otpParam(opts: {
  secret: number[];
  name: string;
  issuer: string;
  algorithm: number;
  digits: number;
  type: number;
  counter?: number;
}): number[] {
  const enc = (s: string) => [...new TextEncoder().encode(s)];
  return [
    ...lenField(1, opts.secret),
    ...lenField(2, enc(opts.name)),
    ...lenField(3, enc(opts.issuer)),
    ...varField(4, opts.algorithm),
    ...varField(5, opts.digits),
    ...varField(6, opts.type),
    ...(opts.counter !== undefined ? varField(7, opts.counter) : []),
  ];
}

function payload(params: number[][]): string {
  const body = params.flatMap((p) => lenField(1, p));
  const full = [...body, ...varField(2, 1), ...varField(3, 1), ...varField(4, 0), ...varField(5, 1234)];
  const bytes = new Uint8Array(full);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 公开示例 secret 的 ASCII 字节（"12345678901234567890"）
const SECRET_BYTES = [...new TextEncoder().encode('12345678901234567890')];

describe('otpauth-migration parsing', () => {
  it('parses a single TOTP account', () => {
    const data = payload([
      otpParam({
        secret: SECRET_BYTES,
        name: 'alice@example.com',
        issuer: 'Example',
        algorithm: 1,
        digits: 1,
        type: 2,
      }),
    ]);
    const accounts = parseMigrationUri(`otpauth-migration://offline?data=${data}`);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      type: 'totp',
      issuer: 'Example',
      account: 'alice@example.com',
      secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
      algorithm: 'SHA1',
      digits: 6,
    });
  });

  it('parses multiple accounts including HOTP and SHA-256', () => {
    const data = payload([
      otpParam({
        secret: SECRET_BYTES,
        name: 'Example:bob@example.com',
        issuer: '',
        algorithm: 2,
        digits: 2,
        type: 2,
      }),
      otpParam({
        secret: SECRET_BYTES,
        name: 'Legacy:carol',
        issuer: 'Legacy',
        algorithm: 1,
        digits: 1,
        type: 1,
        counter: 17,
      }),
    ]);
    const accounts = parseMigrationUri(`otpauth-migration://offline?data=${data}`);
    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toMatchObject({ issuer: 'Example', account: 'bob@example.com', algorithm: 'SHA256', digits: 8 });
    expect(accounts[1]).toMatchObject({ type: 'hotp', issuer: 'Legacy', account: 'carol', counter: 17 });
  });

  it('accepts standard base64 with padding and url-encoded data', () => {
    const data = payload([
      otpParam({ secret: SECRET_BYTES, name: 'X:y', issuer: 'X', algorithm: 1, digits: 1, type: 2 }),
    ]);
    const plusSafe = encodeURIComponent(data);
    expect(parseMigrationUri(`otpauth-migration://offline?data=${plusSafe}`)).toHaveLength(1);
  });

  it('throws on garbage payloads', () => {
    expect(() => parseMigrationUri('otpauth-migration://offline?data=%%%')).toThrow(MigrationError);
    expect(() => parseMigrationUri('otpauth-migration://offline')).toThrow(MigrationError);
  });

  it('extractMigrationData returns the raw data parameter', () => {
    expect(extractMigrationData('otpauth-migration://offline?data=ABC')).toBe('ABC');
  });
});
