import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { VaultContext, type AppSettings, type ToastItem, type ToastKind, type VaultContextValue } from './context';
import type { OtpAccount } from '../otp/types';
import * as vault from '../vault/vault';
import {
  applyTierToDocument,
  detectTier,
  measureFirstFrame,
  rememberDegradedTier,
  sampleScrollFps,
  TIER_THRESHOLDS,
  type GlassTier,
} from './tier';
import { pickBackground, preloadImage, readCachedBackground } from './background';

const SETTINGS_KEY = 'simplef2a:settings';

const DEFAULT_SETTINGS: AppSettings = {
  autoLockOnHide: true,
  theme: 'dark',
  backgroundImage: true,
};

function readSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      autoLockOnHide: parsed.autoLockOnHide ?? DEFAULT_SETTINGS.autoLockOnHide,
      theme: parsed.theme === 'light' ? 'light' : 'dark',
      backgroundImage: parsed.backgroundImage ?? DEFAULT_SETTINGS.backgroundImage,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeSettings(settings: AppSettings): void {
  try {
    // 只保存与安全无关的界面偏好，绝不含 secret / 密码
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

const prefersLight = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches;

export function VaultProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => {
    const stored = readSettings();
    // 首次访问跟随系统主题
    if (!localStorage.getItem(SETTINGS_KEY)) {
      return { ...stored, theme: prefersLight() ? 'light' : 'dark' };
    }
    return stored;
  });

  const [state, setState] = useState<VaultContextValue['state']>({
    exists: false,
    unlocked: false,
    accountCount: 0,
    loading: true,
    error: null,
  });
  const [accounts, setAccounts] = useState<OtpAccount[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [tier, setTier] = useState<GlassTier>('a');
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [backgroundReady, setBackgroundReady] = useState(false);
  const scrollSampleTarget = useRef<HTMLElement | null>(null);

  /* ------------------------------------------------------------- toasts */
  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev.slice(-2), { id, kind, message }]);
      window.setTimeout(() => dismissToast(id), kind === 'danger' ? 6000 : 3200);
    },
    [dismissToast],
  );

  /* ---------------------------------------------------------- tier init */
  useEffect(() => {
    const report = detectTier();
    applyTierToDocument(report.tier);
    setTier(report.tier);
    if (report.tier !== 'a') return;

    let cancelled = false;
    void (async () => {
      const firstFrame = await measureFirstFrame();
      if (cancelled) return;
      if (firstFrame > TIER_THRESHOLDS.firstFrameBudgetMs) {
        rememberDegradedTier();
        applyTierToDocument('b');
        setTier('b');
        return;
      }
      // 渲染稳定后做一次真实滚动帧率采样
      window.setTimeout(async () => {
        if (cancelled) return;
        const fps = await sampleScrollFps(scrollSampleTarget.current);
        if (cancelled) return;
        if (fps > 0 && fps < TIER_THRESHOLDS.minScrollFps) {
          rememberDegradedTier();
          applyTierToDocument('b');
          setTier('b');
        }
      }, 1400);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---------------------------------------------------------- settings */
  useEffect(() => {
    writeSettings(settings);
    document.documentElement.dataset.theme = settings.theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', settings.theme === 'light' ? '#EEF2F6' : '#07090C');
  }, [settings]);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  /* --------------------------------------------------------- background */
  useEffect(() => {
    if (!settings.backgroundImage) {
      setBackgroundReady(false);
      setBackgroundUrl(null);
      return;
    }
    let cancelled = false;
    const cached = readCachedBackground();
    void (async () => {
      if (cached) {
        try {
          await preloadImage(cached, 6000);
          if (cancelled) return;
          setBackgroundUrl(cached);
          setBackgroundReady(true);
          return;
        } catch {
          /* 缓存失效，重新挑选 */
        }
      }
      const picked = await pickBackground(null);
      if (cancelled) return;
      setBackgroundUrl(picked);
      setBackgroundReady(picked !== null);
    })();
    return () => {
      cancelled = true;
    };
  }, [settings.backgroundImage]);

  const refreshBackground = useCallback(() => {
    if (!settings.backgroundImage) {
      updateSettings({ backgroundImage: true });
      return;
    }
    void (async () => {
      setBackgroundReady(false);
      const picked = await pickBackground(backgroundUrl);
      setBackgroundUrl(picked);
      setBackgroundReady(picked !== null);
      if (!picked) toast('背景图片源当前不可用，已回退到渐变背景', 'warning');
    })();
  }, [backgroundUrl, settings.backgroundImage, toast, updateSettings]);

  /* -------------------------------------------------------------- clock */
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  /* ------------------------------------------------------- vault status */
  const refreshStatus = useCallback(async () => {
    const status = await vault.getVaultStatus();
    setState((prev) => ({
      ...prev,
      exists: status.exists,
      accountCount: status.exists ? status.accountCount : 0,
      loading: false,
    }));
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const reloadAccounts = useCallback(async () => {
    if (!vault.isUnlocked()) {
      setAccounts([]);
      return;
    }
    const list = await vault.loadAccounts();
    setAccounts(list);
  }, []);

  /* ------------------------------------------------------------ actions */
  const createVault = useCallback(
    async (password: string) => {
      await vault.createVault(password);
      setAccounts([]);
      await refreshStatus();
      setState((prev) => ({ ...prev, unlocked: true, exists: true, accountCount: 0 }));
    },
    [refreshStatus],
  );

  const unlock = useCallback(
    async (password: string) => {
      await vault.unlockVault(password);
      const list = await vault.loadAccounts();
      setAccounts(list);
      await refreshStatus();
      setState((prev) => ({ ...prev, unlocked: true, exists: true, accountCount: list.length }));
    },
    [refreshStatus],
  );

  const lock = useCallback(() => {
    vault.lockVault();
    // 立即清空内存中的明文账户
    setAccounts([]);
    setState((prev) => ({ ...prev, unlocked: false }));
  }, []);

  const resetVault = useCallback(async () => {
    await vault.resetVault();
    setAccounts([]);
    setState({ exists: false, unlocked: false, accountCount: 0, loading: false, error: null });
  }, []);

  const addAccounts = useCallback(
    async (drafts: OtpAccount[]) => {
      const startOrder = accounts.length;
      const next = [
        ...accounts,
        ...drafts.map((draft, i) => ({ ...draft, order: startOrder + i })),
      ];
      await vault.persistAllAccounts(next);
      setAccounts(next);
      await refreshStatus();
    },
    [accounts, refreshStatus],
  );

  const updateAccount = useCallback(
    async (account: OtpAccount) => {
      const next = accounts.map((a) => (a.id === account.id ? account : a));
      await vault.persistAllAccounts(next);
      setAccounts(next);
    },
    [accounts],
  );

  const deleteAccount = useCallback(
    async (id: string) => {
      await vault.removeAccount(id);
      const next = accounts.filter((a) => a.id !== id).map((a, i) => ({ ...a, order: i }));
      setAccounts(next);
      await refreshStatus();
    },
    [accounts, refreshStatus],
  );

  const replaceAccounts = useCallback(
    async (next: OtpAccount[]) => {
      const ordered = next.map((a, i) => ({ ...a, order: i }));
      await vault.persistAllAccounts(ordered);
      setAccounts(ordered);
      await refreshStatus();
    },
    [refreshStatus],
  );

  const changePassword = useCallback(async (current: string, next: string) => {
    await vault.changeMasterPassword(current, next);
  }, []);

  /* -------------------------------------------------- auto lock on hide */
  useEffect(() => {
    if (!settings.autoLockOnHide) return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && vault.isUnlocked()) {
        vault.lockVault();
        setAccounts([]);
        setState((prev) => ({ ...prev, unlocked: false }));
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [settings.autoLockOnHide]);

  /* ------------------------------------------------- 全局快捷键（可选） */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && vault.isUnlocked() === false) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        if (vault.isUnlocked()) {
          vault.lockVault();
          setAccounts([]);
          setState((prev) => ({ ...prev, unlocked: false }));
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const value = useMemo<VaultContextValue>(
    () => ({
      state,
      accounts,
      settings,
      tier,
      toasts,
      now,
      createVault,
      unlock,
      lock,
      resetVault,
      addAccounts,
      updateAccount,
      deleteAccount,
      replaceAccounts,
      updateSettings,
      toast,
      dismissToast,
      changePassword,
      refreshBackground,
      backgroundUrl,
      backgroundReady,
      reloadAccounts,
    }),
    [
      state,
      accounts,
      settings,
      tier,
      toasts,
      now,
      createVault,
      unlock,
      lock,
      resetVault,
      addAccounts,
      updateAccount,
      deleteAccount,
      replaceAccounts,
      updateSettings,
      toast,
      dismissToast,
      changePassword,
      refreshBackground,
      backgroundUrl,
      backgroundReady,
      reloadAccounts,
    ],
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}
