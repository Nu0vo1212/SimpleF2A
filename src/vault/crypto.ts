/**
 * 备份加解密工具（仅用于「导出加密备份」功能）。
 *
 * 注意：本地账户存储已不再加密（应用无需主密码）。
 * 这个模块只服务于用户主动导出的加密 JSON 备份 —— 让备份文件本身可以加密码保护。
 *
 * 实现：Web Crypto API，AES-256-GCM + PBKDF2-SHA256（600,000 次迭代）。
 */

export const PBKDF2_ITERATIONS = 600_000;

export interface KdfParams {
  iterations: number;
  /** base64 */
  salt: string;
}

export interface EncryptedRecord {
  /** base64 IV（12 字节） */
  iv: string;
  /** base64 密文（含 GCM tag） */
  ciphertext: string;
}

export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoError';
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return buf;
}

function requireSubtle(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new CryptoError('当前环境不支持 Web Crypto（需要 HTTPS 或 localhost）');
  }
  return globalThis.crypto.subtle;
}

export function createKdfParams(iterations = PBKDF2_ITERATIONS): KdfParams {
  return { iterations, salt: bytesToBase64(randomBytes(16)) };
}

export async function deriveKey(password: string, params: KdfParams): Promise<CryptoKey> {
  const subtle = requireSubtle();
  const baseKey = await subtle.importKey(
    'raw',
    new TextEncoder().encode(password) as unknown as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: base64ToBytes(params.salt) as unknown as BufferSource,
      iterations: params.iterations,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

const AAD_PREFIX = 'simplef2a-backup:v1:';

export async function encryptJson(
  key: CryptoKey,
  value: unknown,
  context: string,
): Promise<EncryptedRecord> {
  const subtle = requireSubtle();
  const iv = randomBytes(12);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as unknown as BufferSource,
      additionalData: new TextEncoder().encode(AAD_PREFIX + context) as unknown as BufferSource,
      tagLength: 128,
    },
    key,
    plaintext as unknown as BufferSource,
  );
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
}

export async function decryptJson<T>(
  key: CryptoKey,
  record: EncryptedRecord,
  context: string,
): Promise<T> {
  const subtle = requireSubtle();
  try {
    const plaintext = await subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: base64ToBytes(record.iv) as unknown as BufferSource,
        additionalData: new TextEncoder().encode(AAD_PREFIX + context) as unknown as BufferSource,
        tagLength: 128,
      },
      key,
      base64ToBytes(record.ciphertext) as unknown as BufferSource,
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch {
    throw new CryptoError('解密失败：密码不正确或文件已损坏');
  }
}

export async function encryptWithPassword(password: string, value: unknown) {
  const kdf = createKdfParams();
  const key = await deriveKey(password, kdf);
  const context = 'backup';
  const record = await encryptJson(key, value, context);
  return { kdf, record, context };
}

export async function decryptWithPassword<T>(
  password: string,
  envelope: { kdf: KdfParams; record: EncryptedRecord; context?: string },
): Promise<T> {
  const key = await deriveKey(password, envelope.kdf);
  return decryptJson<T>(key, envelope.record, envelope.context ?? 'backup');
}
