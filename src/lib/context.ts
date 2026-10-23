import { createContext, useContext } from 'react';
import type { OtpAccount } from '../otp/types';
import type { GlassTier } from './tier';

export type ToastKind = 'info' | 'success' | 'warning' | 'danger';

export interface ToastItem {
  id: string;
  kind: ToastKind;
  message: string;
}

export interface AppSettings {
  /** 页面隐藏时自动锁定 */
  autoLockOnHide: boolean;
  /** 主题 */
  theme: 'dark' | 'light';
  /** 背景图开关（关闭后只用渐变） */
  backgroundImage: boolean;
}

export interface VaultViewState {
  /** 是否已存在 vault */
  exists: boolean;
  /** 是否已解锁 */
  unlocked: boolean;
  accountCount: number;
  loading: boolean;
  error: string | null;
}

export interface VaultContextValue {
  state: VaultViewState;
  accounts: OtpAccount[];
  settings: AppSettings;
  tier: GlassTier;
  toasts: ToastItem[];
  /** 当前时间戳（每 250ms 更新，用于倒计时平滑） */
  now: number;
  createVault: (password: string) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  lock: () => void;
  resetVault: () => Promise<void>;
  addAccounts: (drafts: OtpAccount[]) => Promise<void>;
  updateAccount: (account: OtpAccount) => Promise<void>;
  deleteAccount: (id: string) => Promise<void>;
  replaceAccounts: (accounts: OtpAccount[]) => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => void;
  toast: (message: string, kind?: ToastKind) => void;
  dismissToast: (id: string) => void;
  changePassword: (current: string, next: string) => Promise<void>;
  refreshBackground: () => void;
  backgroundUrl: string | null;
  backgroundReady: boolean;
  reloadAccounts: () => Promise<void>;
}

export const VaultContext = createContext<VaultContextValue | null>(null);

export function useVault(): VaultContextValue {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error('useVault must be used within VaultProvider');
  return ctx;
}
