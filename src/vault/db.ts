import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { OtpAccount } from '../otp/types';

/**
 * 账户存储层（IndexedDB）。
 *
 * 设计变更说明：
 *  - 本应用已移除主密码，因此不再有 vault 加密层；
 *  - 记录以明文 JSON 存放在浏览器 IndexedDB 中（按访问地址隔离）；
 *  - 安全边界 = 本机浏览器 profile。详见 SECURITY.md。
 */

export interface StoredAccount {
  id: string;
  order: number;
  updatedAt: number;
  data: OtpAccount;
}

interface AppDB extends DBSchema {
  accounts: {
    key: string;
    value: StoredAccount;
    indexes: { 'by-order': number };
  };
  meta: {
    key: string;
    value: { id: string; value: unknown };
  };
}

const DB_NAME = 'simplef2a-accounts';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<AppDB>> | null = null;

function getDb(): Promise<IDBPDatabase<AppDB>> {
  if (!dbPromise) {
    dbPromise = openDB<AppDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('accounts')) {
          const store = db.createObjectStore('accounts', { keyPath: 'id' });
          store.createIndex('by-order', 'order');
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'id' });
        }
      },
      terminated() {
        dbPromise = null;
      },
    });
  }
  return dbPromise;
}

export async function readAll(): Promise<OtpAccount[]> {
  const all = await (await getDb()).getAll('accounts');
  return all.sort((a, b) => a.order - b.order).map((r) => r.data);
}

export async function putAccount(account: OtpAccount): Promise<void> {
  await (await getDb()).put('accounts', {
    id: account.id,
    order: account.order,
    updatedAt: account.updatedAt,
    data: account,
  });
}

export async function deleteAccount(id: string): Promise<void> {
  await (await getDb()).delete('accounts', id);
}

export async function replaceAll(accounts: OtpAccount[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('accounts', 'readwrite');
  await tx.store.clear();
  for (const account of accounts) {
    await tx.store.put({
      id: account.id,
      order: account.order,
      updatedAt: account.updatedAt,
      data: account,
    });
  }
  await tx.done;
}

export async function countAll(): Promise<number> {
  return (await getDb()).count('accounts');
}

/** 清空全部账户（重置功能）。保留数据库本身。 */
export async function clearAll(): Promise<void> {
  const db = await getDb();
  await db.clear('accounts');
}

export async function getMeta<T>(id: string): Promise<T | undefined> {
  const row = await (await getDb()).get('meta', id);
  return row?.value as T | undefined;
}

export async function setMeta(id: string, value: unknown): Promise<void> {
  await (await getDb()).put('meta', { id, value });
}

export async function destroyDb(): Promise<void> {
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
