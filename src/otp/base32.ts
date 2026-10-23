/**
 * Base32 (RFC 4648) 编解码 —— OTP secret 的通用传输格式。
 * 输入宽松处理：忽略空格、连字符、大小写，自动补齐 padding。
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const LOOKUP = (() => {
  const map = new Int8Array(256).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) {
    map[ALPHABET.charCodeAt(i)] = i;
    map[ALPHABET.toLowerCase().charCodeAt(i)] = i;
  }
  return map;
})();

export function normalizeBase32(input: string): string {
  return input.replace(/[\s\-_=]/g, '').toUpperCase();
}

export function isValidBase32(input: string): boolean {
  const s = normalizeBase32(input);
  if (s.length === 0) return false;
  for (const ch of s) {
    if (ch === '=') continue;
    if (LOOKUP[ch.charCodeAt(0)] === -1) return false;
  }
  // 去除 padding 后的有效字符长度：RFC4648 中 Base32 有效长度模 8 不能为 1/3/6
  const core = s.replace(/=+$/, '');
  const rem = core.length % 8;
  return rem !== 1 && rem !== 3 && rem !== 6;
}

export function base32Decode(input: string): Uint8Array {
  const s = normalizeBase32(input).replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s) {
    const idx = LOOKUP[ch.charCodeAt(0)];
    if (idx === -1) throw new Error(`非法的 Base32 字符: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(value >>> bits) & 31];
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** 生成新的随机 secret（20 字节 = 160bit，与 RFC 4226 推荐一致），返回 Base32。 */
export function generateSecret(bytes = 20): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base32Encode(buf);
}
