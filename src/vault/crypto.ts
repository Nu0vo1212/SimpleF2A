/**
 * 加密核心 —— Web Crypto API（零第三方加密依赖）
 *
 * 设计要点（对应 SECURITY.md 威胁模型）：
 *  - 主密码永不落盘：只以明文存在于内存，解锁后立刻从 state 中清除
 *  - PBKDF2-SHA256，600,000 次迭代（OWASP 2023 推荐下限）
 *  - AES-256-GCM，每条记录独立随机 12 字节 IV；vault 头部另用随机 16 字节 salt
 *  - CryptoKey 使用 extractable: false，无法被导出，降低 XSS 窃取价值
 *  - AAD 绑定记录 id + 版本，防止密文在不同条目之间搬移
 */

export const PBKDF2_ITERATIONS = 600_000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
export const KEY_BITS = 256;

const KDF_HASH = 'SHA-256';
const CIPHER = 'AES-GCM';
const AAD_PREFIX = 'simplef2a:v1:';

export interface KdfParams {
  /** PBKDF2 迭代次数（写入 vault 头，便于未来升级） */
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

/* --------------------------------------------------------------- 工具函数 */

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

/** 任何实现（含测试替身）都需要 subtle，缺失时给出明确错误 */
function requireSubtle(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new CryptoError('当前环境不支持 Web Crypto（需要 HTTPS 或 localhost 安全上下文）');
  }
  return globalThis.crypto.subtle;
}

/* ------------------------------------------------------------ 密钥派生 */

export function createKdfParams(): KdfParams {
  return {
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(randomBytes(SALT_BYTES)),
  };
}

/**
 * 从主密码派生不可导出的 AES-GCM CryptoKey。
 * 派生出的原始 key 位只在导入时短暂存在，随后由引擎管理。
 */
export async function deriveKey(password: string, params: KdfParams): Promise<CryptoKey> {
  const subtle = requireSubtle();
  const encoder = new TextEncoder();
  const baseKey = await subtle.importKey(
    'raw',
    encoder.encode(password) as unknown as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: base64ToBytes(params.salt) as unknown as BufferSource,
      iterations: params.iterations,
      hash: KDF_HASH,
    },
    baseKey,
    { name: CIPHER, length: KEY_BITS },
    false, // extractable: false —— 密钥无法被导出
    ['encrypt', 'decrypt'],
  );
}

/* ---------------------------------------------------------------- 加解密 */

function aadFor(context: string): Uint8Array {
  return new TextEncoder().encode(AAD_PREFIX + context);
}

export async function encryptJson(
  key: CryptoKey,
  value: unknown,
  context: string,
): Promise<EncryptedRecord> {
  const subtle = requireSubtle();
  const iv = randomBytes(IV_BYTES);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await subtle.encrypt(
    {
      name: CIPHER,
      iv: iv as unknown as BufferSource,
      additionalData: aadFor(context) as unknown as BufferSource,
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
        name: CIPHER,
        iv: base64ToBytes(record.iv) as unknown as BufferSource,
        additionalData: aadFor(context) as unknown as BufferSource,
        tagLength: 128,
      },
      key,
      base64ToBytes(record.ciphertext) as unknown as BufferSource,
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch {
    // GCM 校验失败意味着：密码错误、数据被篡改、或记录被搬移
    throw new CryptoError('解密失败：主密码不正确或数据已损坏');
  }
}

/** 用密码直接加密任意对象（备份导出），返回自包含信封。 */
export async function encryptWithPassword(
  password: string,
  value: unknown,
): Promise<{ kdf: KdfParams; record: EncryptedRecord; context: string }> {
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

/** 常数时间字符串比较，避免时序侧信道（用于明文导出校验等场景）。 */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}
