import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { EncryptedRecord, KdfParams } from './crypto';

/**
 * IndexedDB 层（idb 封装）。
 *
 * 只存密文：vault 元数据（salt/迭代次数）与每条记录的 { iv, ciphertext }。
 * 明文 secret / OTP / 主密码 一律不落盘，sessionStorage 也不保存这些内容
 *（仅保存与安全无关的界面偏好，如背景图 URL）。
 */

export interface VaultMeta {
  /** 固定主键，单 vault */
  id: 'primary';
  version: 1;
  kdf: KdfParams;
  /** vault 整体校验块：解密成功的标志是能解开它 */
  verifier: EncryptedRecord;
  createdAt: number;
  updatedAt: number;
  /** 账户数量提示，用于解锁前展示 */
  accountCount: number;
}

export interface StoredAccountRecord extends EncryptedRecord {
  /** 与明文记录 id 相同，用于 AAD 绑定 */
  id: string;
  order: number;
  updatedAt: number;
}

interface VaultDB extends DBSchema {
  meta: {
    key: string;
    value: VaultMeta;
  };
  accounts: {
    key: string;
    value: StoredAccountRecord;
    indexes: { 'by-order': number };
  };
}

const DB_NAME = 'simplef2a-vault';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<VaultDB>> | null = null;

function getDb(): Promise<IDBPDatabase<VaultDB>> {
  if (!dbPromise) {
    dbPromise = openDB<VaultDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('accounts')) {
          const store = db.createObjectStore('accounts', { keyPath: 'id' });
          store.createIndex('by-order', 'order');
        }
      },
      terminated() {
        dbPromise = null;
      },
    });
  }
  return dbPromise;
}

export async function readMeta(): Promise<VaultMeta | undefined> {
  return (await getDb()).get('meta', 'primary');
}

export async function writeMeta(meta: VaultMeta): Promise<void> {
  await (await getDb()).put('meta', meta);
}

export async function readAllAccounts(): Promise<StoredAccountRecord[]> {
  const all = await (await getDb()).getAll('accounts');
  return all.sort((a, b) => a.order - b.order);
}

export async function putAccountRecord(record: StoredAccountRecord): Promise<void> {
  await (await getDb()).put('accounts', record);
}

export async function deleteAccountRecord(id: string): Promise<void> {
  await (await getDb()).delete('accounts', id);
}

export async function replaceAllAccounts(records: StoredAccountRecord[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('accounts', 'readwrite');
  await tx.store.clear();
  for (const record of records) await tx.store.put(record);
  await tx.done;
}

export async function countAccounts(): Promise<number> {
  return (await getDb()).count('accounts');
}

/** 彻底销毁 vault（重置）：删除整个数据库，不可恢复。 */
export async function destroyVault(): Promise<void> {
  const db = await getDb();
  db.close();
  dbPromise = null;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('删除数据库失败'));
    req.onblocked = () => resolve();
  });
}

export const VAULT_DB_NAME = DB_NAME;
