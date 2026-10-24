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
import {
  clearAccountsOnDisk,
  getStorageInfo,
  loadAccountsFromDisk,
  saveAccountsToDisk,
  type StorageInfo,
} from '../lib/desktop';

/**
 * 账户仓库。
 *
 * 存储后端自动切换：
 *  - 桌面版（Python + pywebview）：%APPDATA%\SimpleF2A\accounts.json
 *  - 浏览器：IndexedDB
 *
 * 这样桌面版的数据不受浏览器缓存清理影响，也不会因端口变化而“丢账户”。
 */

export interface StoreStatus {
  accountCount: number;
  /** 桌面模式下的数据文件信息 */
  storage: StorageInfo | null;
  mode: 'desktop' | 'browser';
}

let desktopMode: boolean | null = null;

async function detectDesktop(): Promise<boolean> {
  if (desktopMode === true) return true;
  const accounts = await loadAccountsFromDisk();
  if (accounts !== null) {
    desktopMode = true;
    return true;
  }
  desktopMode = false;
  return false;
}

/**
 * 等待桌面桥就绪后再判断运行环境。
 *
 * pywebview 的 api 是在页面加载之后注入的（会派发 pywebviewready 事件）。
 * 应用启动时必须先等这个，否则会把桌面版误判成浏览器，
 * 从 IndexedDB 读出空列表 —— 表现就是「数据明明在，界面却是空的」。
 */
export async function ensureMode(): Promise<'desktop' | 'browser'> {
  if (desktopMode === true) return 'desktop';

  // 1) 若桥已就绪，直接用
  const first = await loadAccountsFromDisk();
  if (first !== null) {
    desktopMode = true;
    return 'desktop';
  }

  // 2) 否则最多等 4 秒，监听 pywebviewready
  const ready = await new Promise<boolean>((resolve) => {
    if (window.pywebview?.api) {
      resolve(true);
      return;
    }
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      window.removeEventListener('pywebviewready', onReady);
      resolve(v);
    };
    const onReady = () => finish(true);
    window.addEventListener('pywebviewready', onReady);
    window.setTimeout(() => finish(false), 4000);
  });

  if (ready) {
    const retry = await loadAccountsFromDisk();
    if (retry !== null) {
      desktopMode = true;
      return 'desktop';
    }
  }

  desktopMode = false;
  return 'browser';
}

export async function getMode(): Promise<'desktop' | 'browser'> {
  return (await detectDesktop()) ? 'desktop' : 'browser';
}

export async function getStatus(): Promise<StoreStatus> {
  const isDesktop = await detectDesktop();
  if (isDesktop) {
    const storage = await getStorageInfo();
    return {
      accountCount: storage?.count ?? 0,
      storage,
      mode: 'desktop',
    };
  }
  try {
    return { accountCount: await countAll(), storage: null, mode: 'browser' };
  } catch {
    return { accountCount: 0, storage: null, mode: 'browser' };
  }
}

export async function loadAccounts(): Promise<OtpAccount[]> {
  if (await detectDesktop()) {
    return (await loadAccountsFromDisk()) ?? [];
  }
  return readAll();
}

export async function saveAccount(account: OtpAccount): Promise<void> {
  if (await detectDesktop()) {
    const list = (await loadAccountsFromDisk()) ?? [];
    const idx = list.findIndex((a) => a.id === account.id);
    if (idx >= 0) list[idx] = account;
    else list.push(account);
    await saveAccountsToDisk(list);
    return;
  }
  await putAccount(account);
}

export async function saveAll(accounts: OtpAccount[]): Promise<void> {
  const ordered = accounts.map((a, i) => ({ ...a, order: i }));
  if (await detectDesktop()) {
    await saveAccountsToDisk(ordered);
    return;
  }
  await replaceAll(ordered);
}

export async function removeAccount(id: string): Promise<void> {
  if (await detectDesktop()) {
    const list = (await loadAccountsFromDisk()) ?? [];
    await saveAccountsToDisk(list.filter((a) => a.id !== id));
    return;
  }
  await dbDelete(id);
}

/** 删除全部账户数据（危险操作，UI 需二次确认）。 */
export async function removeEverything(): Promise<void> {
  if (await detectDesktop()) {
    await clearAccountsOnDisk();
    return;
  }
  await clearAll();
  await destroyDb();
}
