import type { OtpAccount } from '../otp/types';

/**
 * 存储适配层：在浏览器与桌面（pywebview）之间自动切换。
 *
 * - 浏览器：IndexedDB（原有实现）
 * - 桌面：窗口暴露 window.pywebview.api，数据存到 %APPDATA%\SimpleF2A\accounts.json
 *
 * 桌面模式下数据不随「清除浏览器数据」消失，换浏览器/换端口也不会丢。
 */

interface PywebviewApi {
  load_accounts(): Promise<{ ok: boolean; accounts?: OtpAccount[]; error?: string }>;
  save_accounts(accounts: OtpAccount[]): Promise<{ ok: boolean; error?: string }>;
  clear_accounts(): Promise<{ ok: boolean; error?: string }>;
  storage_info(): Promise<{
    ok: boolean;
    path?: string;
    count?: number;
    bytes?: number;
    error?: string;
  }>;
  minimize_to_tray(): Promise<{ ok: boolean }>;
  show_window(): Promise<{ ok: boolean }>;
  quit_app(): Promise<{ ok: boolean }>;
  open_external(url: string): Promise<{ ok: boolean; error?: string }>;
  app_info(): Promise<{
    ok: boolean;
    name?: string;
    version?: string;
    platform?: string;
    mode?: string;
    storagePath?: string;
  }>;
}

declare global {
  interface Window {
    pywebview?: {
      api: PywebviewApi;
    };
  }
}

/** 等待 pywebview 注入 api（注入发生在页面加载之后） */
function waitForBridge(timeoutMs = 1200): Promise<PywebviewApi | null> {
  return new Promise((resolve) => {
    if (window.pywebview?.api) {
      resolve(window.pywebview.api);
      return;
    }
    let settled = false;
    const finish = (api: PywebviewApi | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('pywebviewready', onReady);
      resolve(api);
    };
    const onReady = () => finish(window.pywebview?.api ?? null);
    window.addEventListener('pywebviewready', onReady);
    window.setTimeout(() => finish(window.pywebview?.api ?? null), timeoutMs);
  });
}

let bridgePromise: Promise<PywebviewApi | null> | null = null;

/**
 * 获取桌面桥（浏览器环境返回 null）。
 *
 * 注意：不能永久缓存 null —— pywebview 的 api 是在页面加载后注入的，
 * 首次调用可能还没就绪。若把 null 缓存下来，后续所有调用都会认为
 * 「不是桌面版」，导致数据读不出来（界面显示空状态）。
 */
export function desktopBridge(): Promise<PywebviewApi | null> {
  if (window.pywebview?.api) return Promise.resolve(window.pywebview.api);
  if (!bridgePromise) {
    bridgePromise = waitForBridge().then((api) => {
      // 只缓存「成功」的结果；失败的留待下次重试
      if (!api) bridgePromise = null;
      return api;
    });
  }
  return bridgePromise;
}

/** 当前是否运行在桌面外壳中 */
export async function isDesktop(): Promise<boolean> {
  return (await desktopBridge()) !== null;
}

export interface StorageInfo {
  path: string;
  count: number;
  bytes: number;
}

export async function loadAccountsFromDisk(): Promise<OtpAccount[] | null> {
  const api = await desktopBridge();
  if (!api) return null;
  const res = await api.load_accounts();
  if (!res.ok) throw new Error(res.error ?? '读取本地账户失败');
  return (res.accounts ?? []) as OtpAccount[];
}

export async function saveAccountsToDisk(accounts: OtpAccount[]): Promise<boolean> {
  const api = await desktopBridge();
  if (!api) return false;
  const res = await api.save_accounts(accounts);
  if (!res.ok) throw new Error(res.error ?? '保存到本地失败');
  return true;
}

export async function clearAccountsOnDisk(): Promise<boolean> {
  const api = await desktopBridge();
  if (!api) return false;
  const res = await api.clear_accounts();
  if (!res.ok) throw new Error(res.error ?? '清空失败');
  return true;
}

export async function getStorageInfo(): Promise<StorageInfo | null> {
  const api = await desktopBridge();
  if (!api) return null;
  const res = await api.storage_info();
  if (!res.ok) return null;
  return {
    path: res.path ?? '',
    count: res.count ?? 0,
    bytes: res.bytes ?? 0,
  };
}

/** 桌面壳能力：最小化到托盘 / 退出 / 打开外链 */
export async function desktopAction(
  action: 'minimize' | 'quit' | 'show',
): Promise<boolean> {
  const api = await desktopBridge();
  if (!api) return false;
  try {
    if (action === 'minimize') await api.minimize_to_tray();
    else if (action === 'quit') await api.quit_app();
    else await api.show_window();
    return true;
  } catch {
    return false;
  }
}
