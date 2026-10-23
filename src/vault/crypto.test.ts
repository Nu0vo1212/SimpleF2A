import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  bytesToBase64,
  createKdfParams,
  decryptJson,
  decryptWithPassword,
  deriveKey,
  encryptJson,
  encryptWithPassword,
  PBKDF2_ITERATIONS,
  timingSafeEqual,
  CryptoError,
} from './crypto';
import {
  backupFileName,
  buildEncryptedBackup,
  buildPlainBackup,
  decryptBackup,
  parseBackupJson,
  BackupError,
} from './backup';
import type { OtpAccount } from '../otp/types';

/**
 * 加密测试使用低迭代次数的派生参数以保持测试速度，
 * 但会单独断言生产默认值为 OWASP 推荐的 600,000。
 */

const FAST_KDF = () => ({ iterations: 1_000, salt: bytesToBase64(crypto.getRandomValues(new Uint8Array(16))) });

function account(over: Partial<OtpAccount> = {}): OtpAccount {
  return {
    id: 'acc-1',
    type: 'totp',
    issuer: 'Example',
    account: 'alice@example.com',
    secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    counter: 0,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

describe('crypto primitives', () => {
  it('uses the OWASP-recommended default iteration count', () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
    expect(createKdfParams().iterations).toBe(PBKDF2_ITERATIONS);
    expect(base64ToBytes(createKdfParams().salt)).toHaveLength(16);
  });

  it('round-trips base64 for binary data', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(64));
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it('round-trips JSON through AES-256-GCM', async () => {
    const kdf = FAST_KDF();
    const key = await deriveKey('correct horse battery staple', kdf);
    const payload = { hello: '世界', n: 42, nested: { a: [1, 2, 3] } };
    const record = await encryptJson(key, payload, 'test');
    expect(base64ToBytes(record.iv)).toHaveLength(12);
    const back = await decryptJson<typeof payload>(key, record, 'test');
    expect(back).toEqual(payload);
  });

  it('produces a different IV (and ciphertext) for every encryption', async () => {
    const key = await deriveKey('pw', FAST_KDF());
    const a = await encryptJson(key, { v: 1 }, 'ctx');
    const b = await encryptJson(key, { v: 1 }, 'ctx');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('fails with a wrong password', async () => {
    const kdf = FAST_KDF();
    const key = await deriveKey('right', kdf);
    const record = await encryptJson(key, { v: 1 }, 'ctx');
    const wrong = await deriveKey('wrong', kdf);
    await expect(decryptJson(wrong, record, 'ctx')).rejects.toBeInstanceOf(CryptoError);
  });

  it('rejects tampered ciphertext (GCM auth tag)', async () => {
    const key = await deriveKey('pw', FAST_KDF());
    const record = await encryptJson(key, { v: 1 }, 'ctx');
    const bytes = base64ToBytes(record.ciphertext);
    bytes[0] ^= 0xff;
    await expect(
      decryptJson(key, { iv: record.iv, ciphertext: bytesToBase64(bytes) }, 'ctx'),
    ).rejects.toBeInstanceOf(CryptoError);
  });

  it('binds records to their context via AAD (no cross-record swapping)', async () => {
    const key = await deriveKey('pw', FAST_KDF());
    const record = await encryptJson(key, { id: 'a' }, 'account:a');
    await expect(decryptJson(key, record, 'account:b')).rejects.toBeInstanceOf(CryptoError);
    await expect(decryptJson(key, record, 'account:a')).resolves.toEqual({ id: 'a' });
  });

  it('derives CryptoKeys that are not extractable', async () => {
    const key = await deriveKey('pw', FAST_KDF());
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });

  it('password envelope round-trips', async () => {
    const { kdf, record, context } = await encryptWithPassword('backup-pass', { a: 1 });
    const { deriveKey: dk } = await import('./crypto');
    const key = await dk('backup-pass', kdf);
    await expect(decryptJson(key, record, context)).resolves.toEqual({ a: 1 });
    await expect(
      decryptWithPassword('nope', { kdf, record, context }),
    ).rejects.toBeInstanceOf(CryptoError);
  });

  it('compares strings in constant time', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
  });
});

describe('backup export / import', () => {
  it('produces an Aegis-compatible field layout', () => {
    const plain = buildPlainBackup([account()]);
    expect(plain.encrypted).toBe(false);
    expect(plain.entries[0]).toMatchObject({
      type: 'totp',
      issuer: 'Example',
      name: 'alice@example.com',
      secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });
  });

  it('round-trips a plain backup', () => {
    const plain = buildPlainBackup([account(), account({ id: 'acc-2', type: 'hotp', counter: 5 })]);
    const result = parseBackupJson(JSON.stringify(plain));
    expect(result.source).toBe('simplef2a');
    expect(result.accounts).toHaveLength(2);
    expect(result.accounts[1]).toMatchObject({ type: 'hotp', counter: 5 });
  });

  it('round-trips an encrypted backup', async () => {
    const accounts = [account(), account({ id: 'acc-3', type: 'steam' })];
    const backup = await buildEncryptedBackup(accounts, 'strong-backup-password');
    const text = JSON.stringify(backup);

    const needs = parseBackupJson(text);
    expect(needs.needsPassword).toBe(true);

    const restored = await decryptBackup(text, 'strong-backup-password');
    expect(restored.accounts).toHaveLength(2);
    expect(restored.accounts[1].type).toBe('steam');
    await expect(decryptBackup(text, 'wrong-password')).rejects.toBeInstanceOf(BackupError);
  });

  it('rejects weak backup passwords', async () => {
    await expect(buildEncryptedBackup([account()], 'short')).rejects.toBeInstanceOf(BackupError);
  });

  it('imports an Aegis export', () => {
    const aegis = {
      version: 1,
      header: { slots: null, params: null },
      db: {
        version: 3,
        entries: [
          {
            type: 'totp',
            uuid: 'u-1',
            issuer: 'AegisCorp',
            name: 'bob@corp.com',
            info: { secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', algo: 'SHA256', digits: 8, period: 60 },
          },
          {
            type: 'steam',
            uuid: 'u-2',
            issuer: 'Steam',
            name: 'gamer',
            info: { secret: 'GEZDGNBVGY3TQOJQ', digits: 5 },
          },
        ],
      },
    };
    const result = parseBackupJson(JSON.stringify(aegis));
    expect(result.source).toBe('aegis');
    expect(result.accounts).toHaveLength(2);
    expect(result.accounts[0]).toMatchObject({ algorithm: 'SHA256', digits: 8, period: 60 });
    expect(result.accounts[1].type).toBe('steam');
  });

  it('imports a 2FAS export', () => {
    const twoFas = {
      schemaVersion: 4,
      services: [
        {
          name: 'TwoFAS',
          secret: '',
          otp: {
            label: 'user',
            account: 'carol',
            issuer: 'TwoFAS',
            digits: 6,
            period: 30,
            counter: 0,
            algorithm: 'SHA1',
            token: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
            type: 'TOTP',
          },
        },
      ],
    };
    const result = parseBackupJson(JSON.stringify(twoFas));
    expect(result.source).toBe('2fas');
    expect(result.accounts[0]).toMatchObject({ issuer: 'TwoFAS', account: 'carol' });
  });

  it('imports a Bitwarden export with otpauth URIs', () => {
    const bw = {
      encrypted: false,
      items: [
        {
          type: 1,
          name: 'BW Site',
          login: {
            username: 'dave',
            totp: 'otpauth://totp/BW%20Site:dave?secret=GEZDGNBVGY3TQOJQ&issuer=BW%20Site',
          },
        },
        { type: 1, name: 'no totp', login: { username: 'x' } },
      ],
    };
    const result = parseBackupJson(JSON.stringify(bw));
    expect(result.source).toBe('bitwarden');
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0]).toMatchObject({ issuer: 'BW Site', account: 'dave' });
    expect(result.skipped).toBe(1);
  });

  it('imports an AndOTP style array', () => {
    const arr = [{ type: 'TOTP', secret: 'GEZDGNBVGY3TQOJQ', issuer: 'And', label: 'And:erin', digits: 6, period: 30 }];
    const result = parseBackupJson(JSON.stringify(arr));
    expect(result.source).toBe('andotp');
    expect(result.accounts[0]).toMatchObject({ issuer: 'And', account: 'erin' });
  });

  it('throws on unrecognised or invalid JSON', () => {
    expect(() => parseBackupJson('not json')).toThrow(BackupError);
    expect(() => parseBackupJson('{"foo":1}')).toThrow(BackupError);
  });

  it('builds a descriptive filename', () => {
    expect(backupFileName(false)).toMatch(/^simplef2a-backup-\d{8}-\d{4}-PLAINTEXT\.json$/);
    expect(backupFileName(true)).toMatch(/^simplef2a-backup-\d{8}-\d{4}\.enc\.json$/);
  });
});
