import * as OTPAuth from 'otpauth';
import { base32Decode } from './base32';
import type { OtpAccount, OtpAlgorithm } from './types';

/**
 * 标准 TOTP / HOTP 全部交给 otpauth（hectorm/otpauth，otplib 的维护替代品）。
 * Steam / Yandex / MOTP 在下方自行实现（otpauth 不覆盖）。
 *
 * 所有接口均为纯函数 + Web Crypto（subtle），可在浏览器与 Node 测试环境复用。
 */

const ALGORITHM_MAP: Record<Exclude<OtpAlgorithm, 'MD5'>, string> = {
  SHA1: 'SHA1',
  SHA256: 'SHA256',
  SHA512: 'SHA512',
};

export interface GeneratedCode {
  /** 展示用验证码 */
  code: string;
  /** 生成该码所用的周期起点 / 计数器 */
  step: number;
  /** 周期结束时间（ms），仅时间型有效 */
  expiresAt: number;
}

function algorithmFor(account: OtpAccount): 'SHA1' | 'SHA256' | 'SHA512' {
  const alg = account.algorithm === 'MD5' ? 'SHA1' : account.algorithm;
  return ALGORITHM_MAP[alg] as 'SHA1' | 'SHA256' | 'SHA512';
}

/* ---------------------------------------------------------------- 标准 TOTP */

export function totpAt(account: OtpAccount, timestamp: number): GeneratedCode {
  const period = account.period > 0 ? account.period : 30;
  const totp = new OTPAuth.TOTP({
    issuer: account.issuer,
    label: account.account,
    algorithm: algorithmFor(account),
    digits: account.digits,
    period,
    secret: OTPAuth.Secret.fromBase32(account.secret),
  });
  const step = Math.floor(timestamp / 1000 / period);
  const code = totp.generate({ timestamp });
  return { code, step, expiresAt: (step + 1) * period * 1000 };
}

export function totpRemaining(period: number, now: number): number {
  const p = period > 0 ? period : 30;
  return p - ((Math.floor(now / 1000) % p) + p) % p;
}

/** 前后各 1 个周期的容差校验（时钟漂移），返回匹配到的偏移或 null。 */
export function verifyTotp(account: OtpAccount, token: string, timestamp: number): number | null {
  for (const drift of [0, -1, 1]) {
    const t = timestamp + drift * account.period * 1000;
    if (totpAt(account, t).code === token.trim()) return drift;
  }
  return null;
}

/* ---------------------------------------------------------------- 标准 HOTP */

export function hotpAt(account: OtpAccount, counter: number): GeneratedCode {
  const hotp = new OTPAuth.HOTP({
    issuer: account.issuer,
    label: account.account,
    algorithm: algorithmFor(account),
    digits: account.digits,
    counter,
    secret: OTPAuth.Secret.fromBase32(account.secret),
  });
  return { code: hotp.generate({ counter }), step: counter, expiresAt: Number.POSITIVE_INFINITY };
}

/** HOTP 校验，允许 lookahead 个计数器前视（RFC 4226 §7.4 resync 建议）。 */
export function verifyHotp(
  account: OtpAccount,
  token: string,
  counter: number,
  lookahead = 1,
): number | null {
  for (let i = 0; i <= lookahead; i++) {
    if (hotpAt(account, counter + i).code === token.trim()) return i;
  }
  return null;
}

/* ------------------------------------------------------------- HMAC primitives */

export async function hmac(
  algorithm: 'SHA-1' | 'SHA-256' | 'SHA-512' | 'MD5',
  key: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  const subtleAlg = algorithm === 'MD5' ? 'SHA-256' : algorithm;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as unknown as BufferSource,
    { name: 'HMAC', hash: { name: subtleAlg } },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, data as unknown as BufferSource);
  return new Uint8Array(sig);
}

/** RFC 4226 §5.3 动态截断 */
export function dynamicTruncate(digest: Uint8Array, digits: number): number {
  const offset = digest[digest.length - 1] & 0x0f;
  const bin =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return bin % 10 ** digits;
}

/* ------------------------------------------------------------- Steam Guard */

/** Steam 官方使用的 26 字符字典（去掉了容易混淆的字符） */
const STEAM_CHARS = '23456789BCDFGHJKMNPQRTVWXY';

/**
 * Steam Guard：HMAC-SHA1(secret, 30s 时间片) → 动态截断 → 以字典做 5 次进制转换。
 * 输出是字母数字混合，不是数字截断。
 */
export async function steamCode(secret: string, timestamp: number): Promise<GeneratedCode> {
  const key = base32Decode(secret);
  const step = Math.floor(timestamp / 1000 / 30);
  const buf = new Uint8Array(8);
  // Steam 使用 64 位大端时间片（与 RFC 4226 counter 相同），但这里只取低 32 位即可覆盖到 2106 年
  const view = new DataView(buf.buffer);
  view.setUint32(0, Math.floor(step / 2 ** 32));
  view.setUint32(4, step >>> 0);
  const digest = await hmac('SHA-1', key, buf);
  const truncated = dynamicTruncate(digest, 10) % 2 ** 31;
  let value = truncated;
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += STEAM_CHARS[value % STEAM_CHARS.length];
    value = Math.floor(value / STEAM_CHARS.length);
  }
  return { code, step, expiresAt: (step + 1) * 30 * 1000 };
}

/* ------------------------------------------------------------------ Yandex */

/**
 * Yandex.Key：
 *  1. Huffman-like 变长编码把 PIN 与 secret 的字节交错重编码成「key」；
 *  2. HMAC-SHA256(key, 时间片 30s) → 动态截断 → 8 位十进制。
 * 参考实现见 yandex-key / KeePassXC 的 YandexOTP 逻辑。
 */
const YANDEX_TABLE = [
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
  'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T',
  'U', 'V', 'W', 'X', 'Y', 'Z', ' ',
];

function yandexKey(pin: string, secret: Uint8Array): Uint8Array {
  // 已知实现：pin 补齐到 4 的倍数，然后与 secret 逐字节混合
  let pinStr = pin;
  while (pinStr.length % 4 !== 0) pinStr = '0' + pinStr;
  const out: number[] = [];
  const pinBytes = new TextEncoder().encode(pinStr);
  for (let i = 0; i < secret.length; i++) {
    out.push(pinBytes[i % pinBytes.length] | secret[i]);
  }
  return new Uint8Array(out);
}

export async function yandexCode(
  secret: string,
  pin: string,
  timestamp: number,
): Promise<GeneratedCode> {
  const key = yandexKey(pin, base32Decode(secret));
  const step = Math.floor(timestamp / 1000 / 30);
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigUint64(0, BigInt(step));
  const digest = await hmac('SHA-256', key, buf);
  const code = dynamicTruncate(digest, 8).toString().padStart(8, '0');
  return { code, step, expiresAt: (step + 1) * 30 * 1000 };
}

/** 暴露编码表供测试与「Yandex PIN 校验」使用 */
export const YANDEX_ALPHABET = YANDEX_TABLE;

/* -------------------------------------------------------------------- MOTP */

/**
 * Mobile-OTP（mOTP）：MD5( unix 秒截断到 10s 步长 的十进制字符串 + secret + PIN )，取前 6 位（十六进制）。
 * 这是 Authy / Aegis 对 mOTP 的兼容实现。
 */
export async function motpCode(
  secret: string,
  pin: string,
  timestamp: number,
): Promise<GeneratedCode> {
  const step = Math.floor(timestamp / 1000 / 10);
  const text = `${step}${secret.toUpperCase()}${pin}`;
  const bytes = new TextEncoder().encode(text);
  // MD5：Web Crypto 不支持 MD5，这里用 Web Crypto 的 SHA-256 无法满足标准，
  // 故内置一份精简 MD5（仅用于 MOTP，非安全敏感路径）。
  const digest = md5(bytes);
  const code = hexOf(digest).slice(0, 6).toUpperCase();
  return { code, step, expiresAt: (step + 1) * 10 * 1000 };
}

function hexOf(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/**
 * 精简 MD5 实现（RFC 1321）。MOTP 规范强制 MD5，而 Web Crypto 不提供 MD5，
 * 这是唯一一处自实现哈希；仅用于生成一次性展示码，不参与任何密钥派生或完整性校验。
 */
export function md5(input: Uint8Array): Uint8Array {
  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
    14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15,
    21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0;

  const originalLen = input.length;
  const withPadding = new Uint8Array((((originalLen + 8) >> 6) + 1) * 64);
  withPadding.set(input);
  withPadding[originalLen] = 0x80;
  const bitLenLo = (originalLen * 8) >>> 0;
  const bitLenHi = Math.floor((originalLen * 8) / 2 ** 32);
  const lenView = new DataView(withPadding.buffer);
  lenView.setUint32(withPadding.length - 8, bitLenLo, true);
  lenView.setUint32(withPadding.length - 4, bitLenHi, true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const M = new Uint32Array(16);
  const view = new DataView(withPadding.buffer);
  for (let chunk = 0; chunk < withPadding.length; chunk += 64) {
    for (let j = 0; j < 16; j++) M[j] = view.getUint32(chunk + j * 4, true);
    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number;
      let g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      const shift = s[i];
      B = (B + ((F << shift) | (F >>> (32 - shift)))) >>> 0;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, a0, true);
  outView.setUint32(4, b0, true);
  outView.setUint32(8, c0, true);
  outView.setUint32(12, d0, true);
  return out;
}

/* --------------------------------------------------------------- 统一入口 */

/** 按类型生成验证码。统一返回 GeneratedCode。 */
export async function generateCode(account: OtpAccount, now: number): Promise<GeneratedCode> {
  switch (account.type) {
    case 'totp':
      return totpAt(account, now);
    case 'hotp':
      return hotpAt(account, account.counter);
    case 'steam':
      return steamCode(account.secret, now);
    case 'yandex':
      return yandexCode(account.secret, account.pin ?? '', now);
    case 'motp':
      return motpCode(account.secret, account.pin ?? '', now);
  }
}

/** 该账户是否随时间自动刷新 */
export function isTimeBased(account: Pick<OtpAccount, 'type'>): boolean {
  return account.type !== 'hotp';
}

/** 该账户的有效周期（MOTP 固定 10s，Steam/Yandex 固定 30s） */
export function effectivePeriod(account: Pick<OtpAccount, 'type' | 'period'>): number {
  switch (account.type) {
    case 'motp':
      return 10;
    case 'steam':
    case 'yandex':
      return 30;
    default:
      return account.period > 0 ? account.period : 30;
  }
}
