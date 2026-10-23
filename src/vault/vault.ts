import {
  CryptoError,
  decryptJson,
  deriveKey,
  encryptJson,
  createKdfParams,
  type EncryptedRecord,
  type KdfParams,
} from './crypto';
import {
  countAccounts,
  deleteAccountRecord,
  destroyVault,
  putAccountRecord,
  readAllAccounts,
  readMeta,
  replaceAllAccounts,
  writeMeta,
  type StoredAccountRecord,
  type VaultMeta,
} from './db';
import type { OtpAccount } from '../otp/types';

/**
 * Vault 生命周期管理（UI 无关的纯逻辑，可被 React store 调用）。
 *
 * 关键不变量：
 *  1. CryptoKey 只保存在本模块的内存变量中，且不参与序列化
 *  2. 锁定 = 丢弃 key 引用 + 通知调用方清空明文
 *  3. 任何明文记录只在内存中出现，落盘前一定经过 encryptJson
 */

export const VERIFIER_CONTEXT = 'vault-verifier';
export const ACCOUNT_CONTEXT_PREFIX = 'account:';
export const MIN_MASTER_PASSWORD_LENGTH = 8;

export interface VaultStatus {
  exists: boolean;
  accountCount: number;
  createdAt: number | null;
}

interface UnlockedState {
  key: CryptoKey;
  meta: VaultMeta;
}

let unlocked: UnlockedState | null = null;

export function isUnlocked(): boolean {
  return unlocked !== null;
}

export function getKdfIterations(): number | null {
  return unlocked?.meta.kdf.iterations ?? null;
}

export async function getVaultStatus(): Promise<VaultStatus> {
  const meta = await readMeta();
  if (!meta) return { exists: false, accountCount: 0, createdAt: null };
  return { exists: true, accountCount: meta.accountCount, createdAt: meta.createdAt };
}

/** 在写入前校验主密码强度（仅长度与基本多样性，避免过度限制）。 */
export function validateMasterPassword(password: string): string | null {
  if (password.length < MIN_MASTER_PASSWORD_LENGTH) {
    return `主密码至少需要 ${MIN_MASTER_PASSWORD_LENGTH} 个字符`;
  }
  if (password.length > 256) return '主密码过长（上限 256 字符）';
  return null;
}

/** 创建全新 vault（已存在时抛错，避免误覆盖）。 */
export async function createVault(password: string): Promise<void> {
  const err = validateMasterPassword(password);
  if (err) throw new CryptoError(err);
  const existing = await readMeta();
  if (existing) throw new CryptoError('vault 已存在，请使用解锁或重置');

  const kdf: KdfParams = createKdfParams();
  const key = await deriveKey(password, kdf);
  const verifier = await encryptJson(key, { ok: true }, VERIFIER_CONTEXT);
  const now = Date.now();
  const meta: VaultMeta = {
    id: 'primary',
    version: 1,
    kdf,
    verifier,
    createdAt: now,
    updatedAt: now,
    accountCount: 0,
  };
  await writeMeta(meta);
  unlocked = { key, meta };
}

/** 解锁：派生 key → 解 verifier 块 → 成功才把 key 留在内存。 */
export async function unlockVault(password: string): Promise<void> {
  const meta = await readMeta();
  if (!meta) throw new CryptoError('尚未创建 vault');
  const key = await deriveKey(password, meta.kdf);
  try {
    await decryptJson(key, meta.verifier, VERIFIER_CONTEXT);
  } catch {
    throw new CryptoError('主密码不正确');
  }
  unlocked = { key, meta };
}

/** 锁定：丢弃 key 与元数据引用。调用方负责清空明文账户列表。 */
export function lockVault(): void {
  unlocked = null;
}

/** 修改主密码：用旧 key 解出全部记录，再用新 key 重新加密写回。 */
export async function changeMasterPassword(
  currentPassword: string,
  nextPassword: string,
): Promise<void> {
  const err = validateMasterPassword(nextPassword);
  if (err) throw new CryptoError(err);
  const meta = await readMeta();
  if (!meta) throw new CryptoError('尚未创建 vault');

  const oldKey = await deriveKey(currentPassword, meta.kdf);
  try {
    await decryptJson(oldKey, meta.verifier, VERIFIER_CONTEXT);
  } catch {
    throw new CryptoError('当前主密码不正确');
  }

  const plaintext = await readAllAccountsWith(oldKey);
  const kdf = createKdfParams();
  const newKey = await deriveKey(nextPassword, kdf);
  const verifier = await encryptJson(newKey, { ok: true }, VERIFIER_CONTEXT);
  const records = await Promise.all(
    plaintext.map(async (account) => encryptAccountWith(newKey, account)),
  );
  const nextMeta: VaultMeta = {
    ...meta,
    kdf,
    verifier,
    updatedAt: Date.now(),
  };
  await replaceAllAccounts(records);
  await writeMeta(nextMeta);
  unlocked = { key: newKey, meta: nextMeta };
}

/** 重置：销毁整个数据库（危险操作，UI 必须二次确认）。 */
export async function resetVault(): Promise<void> {
  unlocked = null;
  await destroyVault();
}

/* ------------------------------------------------------- 账户读写（需解锁） */

function requireUnlocked(): UnlockedState {
  if (!unlocked) throw new CryptoError('vault 已锁定');
  return unlocked;
}

function accountContext(id: string): string {
  return ACCOUNT_CONTEXT_PREFIX + id;
}

async function encryptAccountWith(key: CryptoKey, account: OtpAccount): Promise<StoredAccountRecord> {
  const record = await encryptJson(key, account, accountContext(account.id));
  return {
    id: account.id,
    order: account.order,
    updatedAt: account.updatedAt,
    iv: record.iv,
    ciphertext: record.ciphertext,
  };
}

async function readAllAccountsWith(key: CryptoKey): Promise<OtpAccount[]> {
  const records = await readAllAccounts();
  const accounts: OtpAccount[] = [];
  for (const record of records) {
    try {
      accounts.push(await decryptJson<OtpAccount>(key, record, accountContext(record.id)));
    } catch {
      // 单条损坏不应拖垮整个 vault：跳过并继续
      console.warn('[vault] 跳过无法解密的记录', record.id);
    }
  }
  return accounts;
}

async function syncMetaCount(): Promise<void> {
  const state = requireUnlocked();
  const count = await countAccounts();
  if (count !== state.meta.accountCount) {
    state.meta = { ...state.meta, accountCount: count, updatedAt: Date.now() };
    await writeMeta(state.meta);
  }
}

export async function loadAccounts(): Promise<OtpAccount[]> {
  const state = requireUnlocked();
  return readAllAccountsWith(state.key);
}

export async function persistAccount(account: OtpAccount): Promise<void> {
  const state = requireUnlocked();
  const record = await encryptAccountWith(state.key, account);
  await putAccountRecord(record);
  await syncMetaCount();
}

/** 原子地替换全部账户（导入 / 排序后保存）。 */
export async function persistAllAccounts(accounts: OtpAccount[]): Promise<void> {
  const state = requireUnlocked();
  const records = await Promise.all(
    accounts.map((account) => encryptAccountWith(state.key, account)),
  );
  await replaceAllAccounts(records);
  await syncMetaCount();
}

export async function removeAccount(id: string): Promise<void> {
  requireUnlocked();
  await deleteAccountRecord(id);
  await syncMetaCount();
}

export type { EncryptedRecord, VaultMeta };
