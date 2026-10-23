import type { OtpAccount, OtpAlgorithm, OtpType } from '../otp/types';
import { OTP_TYPE_SPECS, normalizeByType } from '../otp/types';
import { base32Encode, base32Decode, isValidBase32, normalizeBase32 } from '../otp/base32';
import { decryptWithPassword, encryptWithPassword, type EncryptedRecord, type KdfParams } from '../vault/crypto';
import { parseOtpAuthUri } from '../otp/uri';

/**
 * 备份导入/导出。
 *
 * 导出格式（SimpleF2A 原生，同时尽量贴近 Aegis）：
 * {
 *   "schema": "simplef2a.backup",
 *   "version": 1,
 *   "encrypted": false,
 *   "exportedAt": "...",
 *   "entries": [{ type, uuid, issuer, name, secret, algorithm, digits, period, counter, pin }]
 * }
 * 加密模式：entries 被整体 AES-256-GCM 加密为 { kdf, record }，
 * 与本地存储使用同一套 PBKDF2 + AES-GCM 逻辑。
 *
 * 导入兼容：
 *  - SimpleF2A 原生（明文 / 加密）
 *  - Aegis：{ version, header, db: { entries: [{ type, issuer, name, info: { secret, algo, digits, period, counter } }] } }（可加密）
 *  - 2FAS：{ services: [{ otp: { token, account, issuer, digits, period, algorithm, counter, type } }] }
 *  - Bitwarden：{ items: [{ type: 1, name, login: { totp } }] } / { items: [{ login: { totp } }] }
 *  - AndOTP / FreeOTP+：数组形式 [{ type, secret, issuer, label, digits, period, algorithm }]
 */

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

export interface BackupEntry {
  type: OtpType;
  uuid: string;
  issuer: string;
  name: string;
  secret: string;
  algorithm: OtpAlgorithm;
  digits: number;
  period: number;
  counter: number;
  pin?: string;
}

export interface PlainBackup {
  schema: 'simplef2a.backup';
  version: 1;
  encrypted: false;
  exportedAt: string;
  accountCount: number;
  entries: BackupEntry[];
  /** 兼容性提示 */
  generator: string;
}

export interface EncryptedBackup {
  schema: 'simplef2a.backup';
  version: 1;
  encrypted: true;
  exportedAt: string;
  kdf: KdfParams;
  record: EncryptedRecord;
  context: string;
  hint: string;
}

export type BackupEnvelope = PlainBackup | EncryptedBackup;

/* --------------------------------------------------------------- 导出 */

export function toBackupEntry(account: OtpAccount): BackupEntry {
  return {
    type: account.type,
    uuid: account.id,
    issuer: account.issuer,
    name: account.account,
    secret: normalizeBase32(account.secret),
    algorithm: account.algorithm,
    digits: account.digits,
    period: account.period,
    counter: account.counter,
    ...(account.pin ? { pin: account.pin } : {}),
  };
}

export function buildPlainBackup(accounts: OtpAccount[]): PlainBackup {
  return {
    schema: 'simplef2a.backup',
    version: 1,
    encrypted: false,
    exportedAt: new Date().toISOString(),
    accountCount: accounts.length,
    entries: accounts.map(toBackupEntry),
    generator: 'SimpleF2A · zero-knowledge local vault',
  };
}

export async function buildEncryptedBackup(
  accounts: OtpAccount[],
  password: string,
): Promise<EncryptedBackup> {
  if (password.length < 8) throw new BackupError('备份密码至少需要 8 个字符');
  const plain = buildPlainBackup(accounts);
  const { kdf, record, context } = await encryptWithPassword(password, plain);
  return {
    schema: 'simplef2a.backup',
    version: 1,
    encrypted: true,
    exportedAt: plain.exportedAt,
    kdf,
    record,
    context,
    hint: '使用 SimpleF2A「导入 » JSON 备份」并输入此备份的密码即可恢复',
  };
}

export function backupToJson(envelope: BackupEnvelope): string {
  return JSON.stringify(envelope, null, 2);
}

/* --------------------------------------------------------------- 导入 */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return fallback;
}

function normalizeAlgorithm(value: unknown, fallback: OtpAlgorithm = 'SHA1'): OtpAlgorithm {
  const raw = str(value).toUpperCase().replace(/^HMAC-?/, '').replace(/-/g, '');
  if (raw === 'SHA1') return 'SHA1';
  if (raw === 'SHA256') return 'SHA256';
  if (raw === 'SHA512') return 'SHA512';
  if (raw === 'MD5') return 'MD5';
  return fallback;
}

function normalizeType(value: unknown): OtpType {
  const raw = str(value).toLowerCase();
  if (raw === 'steam') return 'steam';
  if (raw === 'yandex') return 'yandex';
  if (raw === 'motp' || raw === 'm-otp') return 'motp';
  if (raw === 'hotp') return 'hotp';
  return 'totp';
}

/** Aegis 的 secret 既可能是 Base32 也可能是二进制数组。 */
function secretToString(value: unknown): string {
  if (typeof value === 'string') {
    const normalized = normalizeBase32(value);
    return isValidBase32(normalized) ? normalized : '';
  }
  if (Array.isArray(value)) {
    const bytes = new Uint8Array(value.map((v) => num(v, 0) & 0xff));
    return base32Encode(bytes);
  }
  const obj = asRecord(value);
  if (obj && Array.isArray(obj.data)) {
    const bytes = new Uint8Array(obj.data.map((v) => num(v, 0) & 0xff));
    return base32Encode(bytes);
  }
  return '';
}

function makeEntry(input: {
  type?: unknown;
  secret: string;
  issuer: string;
  name: string;
  algorithm?: unknown;
  digits?: unknown;
  period?: unknown;
  counter?: unknown;
  pin?: unknown;
  uuid?: unknown;
}): BackupEntry | null {
  if (!input.secret || !isValidBase32(input.secret)) return null;
  const type = normalizeType(input.type);
  const spec = OTP_TYPE_SPECS[type];
  const draft = normalizeByType({
    type,
    issuer: input.issuer.trim(),
    account: (input.name || input.issuer).trim(),
    secret: input.secret,
    algorithm: normalizeAlgorithm(input.algorithm, spec.defaultAlgorithm),
    digits: num(input.digits, spec.defaultDigits),
    period: num(input.period, spec.defaultPeriod),
    counter: Math.max(0, Math.floor(num(input.counter, 0))),
    pin: str(input.pin) || undefined,
    id: str(input.uuid) || undefined,
  });
  return {
    type: draft.type,
    uuid: draft.id ?? crypto.randomUUID(),
    issuer: draft.issuer,
    name: draft.account,
    secret: draft.secret,
    algorithm: draft.algorithm,
    digits: draft.digits,
    period: draft.period,
    counter: draft.counter,
    ...(draft.pin ? { pin: draft.pin } : {}),
  };
}

function entriesToAccounts(entries: BackupEntry[], startOrder = 0): OtpAccount[] {
  const now = Date.now();
  return entries.map((entry, index) => ({
    id: entry.uuid || crypto.randomUUID(),
    type: entry.type,
    issuer: entry.issuer,
    account: entry.name,
    secret: entry.secret,
    algorithm: entry.algorithm,
    digits: entry.digits,
    period: entry.period,
    counter: entry.counter,
    pin: entry.pin,
    order: startOrder + index,
    createdAt: now + index,
    updatedAt: now + index,
  }));
}

export interface ImportResult {
  accounts: OtpAccount[];
  /** 识别出的来源，用于 UI 文案 */
  source: 'simplef2a' | 'simplef2a-encrypted' | 'aegis' | '2fas' | 'bitwarden' | 'andotp';
  skipped: number;
  /** 若为加密备份，需要密码 */
  needsPassword?: boolean;
}

export function isEncryptedBackup(raw: unknown): raw is EncryptedBackup {
  const obj = asRecord(raw);
  return !!obj && obj.encrypted === true && !!asRecord(obj.record) && !!asRecord(obj.kdf);
}

/** 解析任意受支持的 JSON 备份。加密备份会抛出 needsPassword 错误。 */
export function parseBackupJson(text: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError('不是合法的 JSON 文件');
  }

  /* ---- SimpleF2A 原生 ---- */
  const obj = asRecord(raw);
  if (obj && obj.schema === 'simplef2a.backup') {
    if (obj.encrypted === true) {
      return { accounts: [], source: 'simplef2a-encrypted', skipped: 0, needsPassword: true };
    }
    const entries = Array.isArray(obj.entries) ? obj.entries : [];
    const parsed: BackupEntry[] = [];
    let skipped = 0;
    for (const item of entries) {
      const e = asRecord(item);
      if (!e) {
        skipped++;
        continue;
      }
      const entry = makeEntry({
        type: e.type,
        secret: secretToString(e.secret),
        issuer: str(e.issuer),
        name: str(e.name),
        algorithm: e.algorithm,
        digits: e.digits,
        period: e.period,
        counter: e.counter,
        pin: e.pin,
        uuid: e.uuid,
      });
      if (entry) parsed.push(entry);
      else skipped++;
    }
    return { accounts: entriesToAccounts(parsed), source: 'simplef2a', skipped };
  }

  /* ---- Aegis ---- */
  const aegisDb = obj ? asRecord(obj.db) : null;
  if (obj && (aegisDb || Array.isArray(obj.entries)) && (obj.version !== undefined || aegisDb)) {
    const entryList = aegisDb && Array.isArray(aegisDb.entries) ? aegisDb.entries : (obj.entries as unknown[]);
    const parsed: BackupEntry[] = [];
    let skipped = 0;
    for (const item of entryList ?? []) {
      const e = asRecord(item);
      const info = e ? asRecord(e.info) : null;
      if (!e || !info) {
        skipped++;
        continue;
      }
      const entry = makeEntry({
        type: e.type,
        secret: secretToString(info.secret),
        issuer: str(e.issuer),
        name: str(e.name),
        algorithm: info.algo ?? info.algorithm,
        digits: info.digits,
        period: info.period,
        counter: info.counter,
        pin: info.pin ?? info.pinCode,
        uuid: e.uuid,
      });
      if (entry) parsed.push(entry);
      else skipped++;
    }
    return { accounts: entriesToAccounts(parsed), source: 'aegis', skipped };
  }

  /* ---- 2FAS ---- */
  if (obj && Array.isArray(obj.services)) {
    const parsed: BackupEntry[] = [];
    let skipped = 0;
    for (const item of obj.services) {
      const e = asRecord(item);
      const otp = e ? asRecord(e.otp) : null;
      if (!otp) {
        skipped++;
        continue;
      }
      const entry = makeEntry({
        type: otp.type,
        secret: secretToString(otp.token),
        // 2FAS 的 issuer 常在 otp.issuer / otp.label，服务名作为兜底
        issuer: str(otp.issuer) || str(e?.name) || str(otp.label),
        name: str(e?.account) || str(otp.account) || str(otp.label),
        algorithm: otp.algorithm,
        digits: otp.digits,
        period: otp.period,
        counter: otp.counter,
        uuid: str(e?.id) || undefined,
      });
      if (entry) parsed.push(entry);
      else skipped++;
    }
    return { accounts: entriesToAccounts(parsed), source: '2fas', skipped };
  }

  /* ---- Bitwarden ---- */
  if (obj && Array.isArray(obj.items)) {
    const { parseOtpAuthUriSafe } = lazyUri();
    const parsed: BackupEntry[] = [];
    let skipped = 0;
    for (const item of obj.items) {
      const e = asRecord(item);
      const login = e ? asRecord(e.login) : null;
      const totp = login ? str(login.totp) : '';
      if (!totp) {
        skipped++;
        continue;
      }
      const fromUri = parseOtpAuthUriSafe(totp);
      if (fromUri) {
        parsed.push({ ...fromUri, uuid: fromUri.uuid || crypto.randomUUID() });
        continue;
      }
      const entry = makeEntry({
        secret: secretToString(totp),
        issuer: str(e?.name),
        name: str(login?.username),
      });
      if (entry) parsed.push(entry);
      else skipped++;
    }
    return { accounts: entriesToAccounts(parsed), source: 'bitwarden', skipped };
  }

  /* ---- AndOTP / 纯数组 ---- */
  if (Array.isArray(raw)) {
    const parsed: BackupEntry[] = [];
    let skipped = 0;
    for (const item of raw) {
      const e = asRecord(item);
      if (!e) {
        skipped++;
        continue;
      }
      const label = str(e.label) || str(e.name);
      const sep = label.indexOf(':');
      const entry = makeEntry({
        type: e.type,
        secret: secretToString(e.secret),
        issuer: str(e.issuer) || (sep > 0 ? label.slice(0, sep) : ''),
        name: sep > 0 ? label.slice(sep + 1) : label,
        algorithm: e.algorithm,
        digits: e.digits,
        period: e.period,
        counter: e.counter,
      });
      if (entry) parsed.push(entry);
      else skipped++;
    }
    return { accounts: entriesToAccounts(parsed), source: 'andotp', skipped };
  }

  throw new BackupError('无法识别的备份格式（支持 SimpleF2A / Aegis / 2FAS / Bitwarden / AndOTP）');
}

function lazyUri() {
  const parse = (uri: string): (BackupEntry & { uuid: string }) | null => {
    try {
      const p = parseOtpAuthUri(uri);
      return {
        type: p.type,
        uuid: '',
        issuer: p.issuer,
        name: p.account,
        secret: p.secret,
        algorithm: p.algorithm,
        digits: p.digits,
        period: p.period,
        counter: p.counter,
        ...(p.pin ? { pin: p.pin } : {}),
      };
    } catch {
      return null;
    }
  };
  return { parseOtpAuthUriSafe: parse };
}

/** 解密并解析加密备份。 */
export async function decryptBackup(
  text: string,
  password: string,
): Promise<ImportResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError('不是合法的 JSON 文件');
  }
  if (!isEncryptedBackup(raw)) throw new BackupError('这不是加密备份');
  let payload: unknown;
  try {
    payload = await decryptWithPassword(password, {
      kdf: raw.kdf,
      record: raw.record,
      context: raw.context,
    });
  } catch {
    throw new BackupError('备份密码不正确，或文件已损坏');
  }
  const inner = asRecord(payload);
  if (!inner || !Array.isArray(inner.entries)) throw new BackupError('解密后的备份结构无效');
  const result = parseBackupJson(JSON.stringify(payload));
  return { ...result, source: 'simplef2a', needsPassword: false };
}

/** 生成文件名：simplef2a-backup-YYYYMMDD-HHmm(.enc).json */
export function backupFileName(encrypted: boolean): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `simplef2a-backup-${stamp}${encrypted ? '.enc' : '-PLAINTEXT'}.json`;
}

/** 供测试与导入预览使用 */
export const __internal = { makeEntry, entriesToAccounts, secretToString, base32Decode };
