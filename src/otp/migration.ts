import { base32Encode } from './base32';
import { normalizeByType, type OtpAccountDraft, type OtpAlgorithm } from './types';

/**
 * otpauth-migration:// 解析器 —— Google Authenticator 的「导出账户」格式。
 *
 * 结构：otpauth-migration://offline?data=<base64url(protobuf)>
 *   message MigrationPayload {
 *     repeated OtpParameters otp_parameters = 1;
 *     int32 version = 2;
 *     int32 batch_size = 3;
 *     int32 batch_index = 4;
 *     int32 batch_id = 5;
 *   }
 *   message OtpParameters {
 *     bytes secret = 1;
 *     string name = 2;
 *     string issuer = 3;
 *     enum Algorithm { ALGORITHM_UNSPECIFIED=0; SHA1=1; SHA256=2; SHA512=3; MD5=4; }
 *     enum DigitCount { DIGIT_COUNT_UNSPECIFIED=0; SIX=1; EIGHT=2; }
 *     enum OtpType { OTP_TYPE_UNSPECIFIED=0; HOTP=1; TOTP=2; }
 *     int64 counter = 7;
 *     Algorithm algorithm = 4;
 *     DigitCount digits = 5;
 *     OtpType type = 6;
 *   }
 *
 * 这里使用一个最小 protobuf wire-format 读取器，避免引入外部依赖。
 */

export interface MigrationAccount extends OtpAccountDraft {
  /** 迁移载荷里的原始序号，用于稳定排序 */
  index: number;
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

/* ---------------------------------------------------- 最小 protobuf 读取器 */

interface ProtoReader {
  pos: number;
  bytes: Uint8Array;
}

function readVarint(r: ProtoReader): number {
  let result = 0;
  let shift = 0;
  while (r.pos < r.bytes.length) {
    const b = r.bytes[r.pos++];
    result += (b & 0x7f) * 2 ** shift;
    shift += 7;
    if ((b & 0x80) === 0) return result;
    if (shift > 63) throw new MigrationError('protobuf varint 溢出');
  }
  throw new MigrationError('protobuf 数据被截断');
}

function readTag(r: ProtoReader): { field: number; wire: number } {
  const tag = readVarint(r);
  return { field: tag >>> 3, wire: tag & 0x7 };
}

function readBytes(r: ProtoReader): Uint8Array {
  const len = readVarint(r);
  if (r.pos + len > r.bytes.length) throw new MigrationError('protobuf 长度越界');
  const slice = r.bytes.subarray(r.pos, r.pos + len);
  r.pos += len;
  return slice;
}

function skipField(r: ProtoReader, wire: number) {
  switch (wire) {
    case 0:
      readVarint(r);
      break;
    case 1:
      r.pos += 8;
      break;
    case 2:
      readBytes(r);
      break;
    case 5:
      r.pos += 4;
      break;
    default:
      throw new MigrationError(`不支持的 protobuf wire type: ${wire}`);
  }
}

/* ----------------------------------------------------------- base64url */

function base64UrlToBytes(input: string): Uint8Array {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new MigrationError('data 参数不是合法的 Base64');
  }
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new MigrationError('data 参数不是合法的 Base64');
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/* --------------------------------------------------------------- 解析 */

const ALGO_MAP: Record<number, OtpAlgorithm> = { 1: 'SHA1', 2: 'SHA256', 3: 'SHA512', 4: 'MD5' };
const DIGITS_MAP: Record<number, number> = { 1: 6, 2: 8 };

function parseOtpParameters(bytes: Uint8Array): {
  secret: Uint8Array;
  name: string;
  issuer: string;
  algorithm: OtpAlgorithm;
  digits: number;
  type: 'totp' | 'hotp';
  counter: number;
} {
  const r: ProtoReader = { pos: 0, bytes };
  const out = {
    secret: new Uint8Array(0) as Uint8Array,
    name: '',
    issuer: '',
    algorithm: 'SHA1' as OtpAlgorithm,
    digits: 6,
    type: 'totp' as 'totp' | 'hotp',
    counter: 0,
  };
  const decoder = new TextDecoder();
  while (r.pos < r.bytes.length) {
    const { field, wire } = readTag(r);
    switch (field) {
      case 1:
        out.secret = readBytes(r);
        break;
      case 2:
        out.name = decoder.decode(readBytes(r));
        break;
      case 3:
        out.issuer = decoder.decode(readBytes(r));
        break;
      case 4:
        out.algorithm = ALGO_MAP[readVarint(r)] ?? 'SHA1';
        break;
      case 5:
        out.digits = DIGITS_MAP[readVarint(r)] ?? 6;
        break;
      case 6:
        out.type = readVarint(r) === 1 ? 'hotp' : 'totp';
        break;
      case 7:
        out.counter = readVarint(r);
        break;
      default:
        skipField(r, wire);
    }
  }
  return out;
}

/** 提取 `data=` 参数（Google 导出串偶尔会被 URL 编码或多包 '\n' 拼接）。 */
export function extractMigrationData(uri: string): string {
  const text = uri.trim();
  const match = /[?&]data=([^&]+)/.exec(text);
  const data = match ? match[1] : text.replace(/^otpauth-migration:\/\/[^?]*\?/, '');
  if (!data) throw new MigrationError('未找到 data 参数');
  try {
    return decodeURIComponent(data);
  } catch {
    throw new MigrationError('data 参数不是合法的 URL 编码');
  }
}

export function parseMigrationUri(uri: string): MigrationAccount[] {
  const data = extractMigrationData(uri);
  const bytes = base64UrlToBytes(data);

  const r: ProtoReader = { pos: 0, bytes };
  const accounts: MigrationAccount[] = [];
  let hasFields = false;
  while (r.pos < r.bytes.length) {
    const { field, wire } = readTag(r);
    if (field === 1 && wire === 2) {
      hasFields = true;
      const param = parseOtpParameters(readBytes(r));
      if (param.secret.length === 0) continue;
      // name 常见格式为 "issuer:account" 或仅 "account"
      let { name, issuer } = param;
      const sep = name.indexOf(':');
      if (sep !== -1) {
        const nameIssuer = name.slice(0, sep).trim();
        if (!issuer) issuer = nameIssuer;
        name = name.slice(sep + 1).trim();
      }
      accounts.push({
        ...normalizeByType({
          type: param.type,
          issuer: issuer.trim(),
          account: name.trim() || issuer.trim(),
          secret: base32Encode(param.secret),
          algorithm: param.algorithm,
          digits: param.digits,
          period: 30,
          counter: param.counter,
        }),
        index: accounts.length,
      });
    } else {
      skipField(r, wire);
    }
  }
  if (!hasFields && accounts.length === 0) {
    throw new MigrationError('载荷中没有可导入的账户');
  }
  return accounts;
}
