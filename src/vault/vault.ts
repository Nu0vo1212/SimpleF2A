import type { OtpAccount } from '../otp/types';
import {
  clearAll,
  countAll,
  deleteAccount as dbDelete,
  destroyDb,
  readAll,
  replaceAll,
  putAccount,
} from './db';

/**
 * 账户仓库（无主密码版本）。
 *
 * 打开应用即进入主界面，无需解锁。数据持久化在浏览器 IndexedDB，
 * 由访问地址（origin）隔离；导出/导入仍使用 JSON（可加密）。
 */

export interface StoreStatus {
  accountCount: number;
}

export async function getStatus(): Promise<StoreStatus> {
  try {
    return { accountCount: await countAll() };
  } catch {
    return { accountCount: 0 };
  }
}

export async function loadAccounts(): Promise<OtpAccount[]> {
  return readAll();
}

export async function saveAccount(account: OtpAccount): Promise<void> {
  await putAccount(account);
}

export async function saveAll(accounts: OtpAccount[]): Promise<void> {
  await replaceAll(accounts.map((a, i) => ({ ...a, order: i })));
}

export async function removeAccount(id: string): Promise<void> {
  await dbDelete(id);
}

/** 删除全部账户数据（危险操作，UI 需二次确认）。 */
export async function removeEverything(): Promise<void> {
  await clearAll();
  await destroyDb();
}
