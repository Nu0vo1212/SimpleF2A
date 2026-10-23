import { isValidBase32, normalizeBase32 } from './base32';
import { OTP_TYPE_SPECS, normalizeByType, type OtpAccountDraft, type OtpAlgorithm, type OtpType } from './types';

/**
 * otpauth:// 解析器（Key URI Format: https://github.com/google/google-authenticator/wiki/Key-Uri-Format）
 *
 * 支持：
 *   otpauth://totp/Issuer:account?secret=...&issuer=Issuer&algorithm=SHA1&digits=6&period=30
 *   otpauth://hotp/...?counter=0
 *   otpauth://steam/...（第三方验证器扩展）
 *   otpauth://motp/Issuer:account?secret=...&pin=1234
 * 以及 otpauth-migration:// 的识别（批量解析见 migration.ts）。
 */

export interface ParsedOtpUri {
  type: OtpType;
  issuer: string;
  account: string;
  secret: string;
  algorithm: OtpAlgorithm;
  digits: number;
  period: number;
  counter: number;
  pin?: string;
}

export class OtpUriError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OtpUriError';
  }
}

const URI_RE = /^otpauth:\/\/([a-z0-9]+)\/(.+)$/i;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

function parseAlgorithm(raw: string | null, fallback: OtpAlgorithm): OtpAlgorithm {
  if (!raw) return fallback;
  const upper = raw.toUpperCase();
  // TOTP/HOTP 仅支持 RFC 6238/4226 定义的三种 HMAC 算法；MD5 只属于 MOTP
  if (upper === 'SHA1' || upper === 'SHA256' || upper === 'SHA512') {
    return upper;
  }
  throw new OtpUriError(`不支持的算法：${raw}`);
}

/** 该 URI 是否真的带有 otpauth:// 的 type/ 路径段 */
export function hasOtpTypePath(text: string): boolean {
  return /^otpauth:\/\/[a-z0-9]+\/.+/i.test(text.trim());
}

function parseInt10(raw: string | null, fallback: number, field: string): number {
  if (raw === null || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) throw new OtpUriError(`${field} 必须是正整数`);
  return n;
}

export function isOtpAuthUri(text: string): boolean {
  // 注意排除 otpauth-migration:// —— 它由 isMigrationUri 单独处理
  const trimmed = text.trim();
  return hasOtpTypePath(trimmed) && !/^otpauth-migration:\/\//i.test(trimmed);
}

export function isMigrationUri(text: string): boolean {
  return /^otpauth-migration:\/\//i.test(text.trim());
}

/** 从 URI 的路径段解析 issuer 与 account。 */
function parseLabel(rawPath: string): { issuer: string; account: string } {
  const withoutQuery = rawPath.split('?')[0];
  const decoded = safeDecode(withoutQuery).replace(/^\//, '');
  const sepIndex = decoded.indexOf(':');
  if (sepIndex === -1) {
    return { issuer: '', account: decoded.trim() };
  }
  return {
    issuer: decoded.slice(0, sepIndex).trim(),
    account: decoded.slice(sepIndex + 1).trim(),
  };
}

export function parseOtpAuthUri(input: string): ParsedOtpUri {
  const text = input.trim();
  const match = URI_RE.exec(text);
  if (!match) throw new OtpUriError('不是合法的 otpauth:// URI');

  const rawType = match[1].toLowerCase();
  const queryIndex = match[2].indexOf('?');
  const rawPath = queryIndex === -1 ? match[2] : match[2].slice(0, queryIndex);
  const queryString = queryIndex === -1 ? '' : match[2].slice(queryIndex + 1);
  const params = new URLSearchParams(queryString);

  const label = parseLabel(rawPath);
  const queryIssuer = (params.get('issuer') ?? '').trim();
  const issuer = queryIssuer || label.issuer;
  const account = label.account || issuer;

  const secretRaw = params.get('secret');
  if (!secretRaw) throw new OtpUriError('URI 缺少 secret 参数');
  const secret = normalizeBase32(secretRaw);
  if (!isValidBase32(secret)) throw new OtpUriError('secret 不是合法的 Base32 字符串');

  const type: OtpType =
    rawType === 'steam' ? 'steam' : rawType === 'motp' ? 'motp' : rawType === 'yandex' ? 'yandex' : rawType === 'hotp' ? 'hotp' : rawType === 'totp' ? 'totp' : (() => {
      throw new OtpUriError(`不支持的 OTP 类型：${rawType}`);
    })();

  const spec = OTP_TYPE_SPECS[type];
  // 固定算法的类型（steam/yandex/motp）若显式声明了不兼容算法，直接拒绝而不是静默覆盖
  const rawAlgorithm = params.get('algorithm');
  if (spec.algorithmFixed && rawAlgorithm && rawAlgorithm.toUpperCase() !== spec.algorithmFixed) {
    throw new OtpUriError(`${spec.label} 只支持 ${spec.algorithmFixed} 算法`);
  }
  const digits = spec.digitsFixed ?? parseInt10(params.get('digits'), spec.defaultDigits, 'digits');
  const period = spec.type === 'hotp' ? 30 : parseInt10(params.get('period'), spec.defaultPeriod, 'period');
  if (period <= 0) throw new OtpUriError('period 必须大于 0');
  if (digits < 1 || digits > 10) throw new OtpUriError('digits 需在 1–10 之间');

  const algorithm: OtpAlgorithm = spec.algorithmFixed
    ? spec.algorithmFixed
    : parseAlgorithm(params.get('algorithm'), spec.defaultAlgorithm);
  const counter = parseInt10(params.get('counter'), 0, 'counter');
  const pin = params.get('pin') ?? undefined;

  const draft: OtpAccountDraft = normalizeByType({
    type,
    issuer,
    account,
    secret,
    algorithm,
    digits,
    period,
    counter,
    pin,
  });

  return draft as ParsedOtpUri;
}

/** 生成 otpauth:// URI（单账户导出用）。 */
export function buildOtpAuthUri(
  account: Pick<
    OtpAccountDraft,
    'type' | 'issuer' | 'account' | 'secret' | 'algorithm' | 'digits' | 'period' | 'counter' | 'pin'
  >,
  options: { includePin?: boolean } = {},
): string {
  const spec = OTP_TYPE_SPECS[account.type];
  const labelName = account.issuer
    ? `${account.issuer}:${account.account}`
    : account.account || account.issuer || 'account';
  const params = new URLSearchParams();
  params.set('secret', normalizeBase32(account.secret));
  if (account.issuer) params.set('issuer', account.issuer);
  if (!spec.algorithmFixed) params.set('algorithm', account.algorithm);
  if (spec.digitsFixed === null) params.set('digits', String(account.digits));
  if (account.type === 'hotp') {
    params.set('counter', String(account.counter));
  } else if (account.period !== spec.defaultPeriod) {
    params.set('period', String(account.period));
  }
  if (options.includePin && account.pin) params.set('pin', account.pin);

  return `otpauth://${account.type}/${encodeURIComponent(labelName)}?${params.toString()}`;
}
