import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  VaultContext,
  type AppSettings,
  type ToastItem,
  type ToastKind,
  type VaultContextValue,
} from './context';
import type { OtpAccount } from '../otp/types';
import * as store from '../vault/vault';
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
  theme: 'dark',
  backgroundImage: true,
  fetchRemoteIcons: true,
};

function readSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      theme: parsed.theme === 'light' ? 'light' : 'dark',
      backgroundImage: parsed.backgroundImage ?? DEFAULT_SETTINGS.backgroundImage,
      fetchRemoteIcons: parsed.fetchRemoteIcons ?? DEFAULT_SETTINGS.fetchRemoteIcons,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeSettings(settings: AppSettings): void {
  try {
    // 只保存界面偏好，不含任何账户数据
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
    accountCount: 0,
    loading: true,
    error: null,
    mode: 'browser',
    storagePath: null,
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

      // 双条件判定：只有「首帧慢」+「帧率也确实低」才降级，
      // 避免后台标签页节流 / 冷启动噪声造成误降级。
      window.setTimeout(async () => {
        if (cancelled) return;
        const fps = await sampleScrollFps(scrollSampleTarget.current);
        if (cancelled) return;

        const slowFrames = fps > 0 && fps < TIER_THRESHOLDS.minScrollFps;
        const slowFirstFrame = firstFrame > TIER_THRESHOLDS.firstFrameBudgetMs;

        if (slowFrames || (slowFirstFrame && fps > 0 && fps < 58)) {
          rememberDegradedTier();
          applyTierToDocument('b');
          setTier('b');
        }
      }, 1600);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---------------------------------------------------------- 主题应用 */
  useEffect(() => {
    writeSettings(settings);
    const root = document.documentElement;
    // 先加过渡类，再切主题，避免生硬跳变（reduced-motion 时由 CSS 覆盖）
    root.classList.add('theme-animating');
    root.dataset.theme = settings.theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', settings.theme === 'light' ? '#EEF2F6' : '#07090C');
    const timer = window.setTimeout(() => root.classList.remove('theme-animating'), 320);
    return () => window.clearTimeout(timer);
  }, [settings]);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const toggleTheme = useCallback(() => {
    setSettings((prev) => ({ ...prev, theme: prev.theme === 'dark' ? 'light' : 'dark' }));
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

  /* --------------------------------------------------------- load data */
  const reloadAccounts = useCallback(async () => {
    try {
      // 先确认运行环境：桌面版需要等 pywebview 桥注入完成，
      // 否则会误判为浏览器模式，从 IndexedDB 读出空数据。
      await store.ensureMode();
      const list = await store.loadAccounts();
      const status = await store.getStatus();
      setAccounts(list);
      setState((prev) => ({
        ...prev,
        accountCount: list.length,
        loading: false,
        error: null,
        mode: status.mode,
        storagePath: status.storage?.path ?? null,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        accountCount: 0,
        loading: false,
        error: err instanceof Error ? err.message : '读取本地数据失败',
      }));
    }
  }, []);

  useEffect(() => {
    void reloadAccounts();
  }, [reloadAccounts]);

  /* ------------------------------------------------------------ actions */
  const addAccounts = useCallback(
    async (drafts: OtpAccount[]) => {
      const startOrder = accounts.length;
      const next = [
        ...accounts,
        ...drafts.map((draft, i) => ({ ...draft, order: startOrder + i })),
      ];
      await store.saveAll(next);
      setAccounts(next);
      setState((prev) => ({ ...prev, accountCount: next.length }));
    },
    [accounts],
  );

  const updateAccount = useCallback(
    async (account: OtpAccount) => {
      const next = accounts.map((a) => (a.id === account.id ? account : a));
      await store.saveAll(next);
      setAccounts(next);
    },
    [accounts],
  );

  const deleteAccount = useCallback(
    async (id: string) => {
      const next = accounts.filter((a) => a.id !== id).map((a, i) => ({ ...a, order: i }));
      await store.saveAll(next);
      setAccounts(next);
      setState((prev) => ({ ...prev, accountCount: next.length }));
    },
    [accounts],
  );

  const replaceAccounts = useCallback(async (next: OtpAccount[]) => {
    const ordered = next.map((a, i) => ({ ...a, order: i }));
    await store.saveAll(ordered);
    setAccounts(ordered);
    setState((prev) => ({ ...prev, accountCount: ordered.length }));
  }, []);

  const resetVault = useCallback(async () => {
    await store.removeEverything();
    setAccounts([]);
    setState((prev) => ({ ...prev, accountCount: 0, loading: false, error: null }));
  }, []);

  /* ------------------------------------------------- 全局快捷键（可选） */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Ctrl/⌘ + Shift + L 切换主题
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        toggleTheme();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleTheme]);

  const value = useMemo<VaultContextValue>(
    () => ({
      state,
      accounts,
      settings,
      tier,
      toasts,
      now,
      resetVault,
      addAccounts,
      updateAccount,
      deleteAccount,
      replaceAccounts,
      updateSettings,
      toggleTheme,
      toast,
      dismissToast,
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
      resetVault,
      addAccounts,
      updateAccount,
      deleteAccount,
      replaceAccounts,
      updateSettings,
      toggleTheme,
      toast,
      dismissToast,
      refreshBackground,
      backgroundUrl,
      backgroundReady,
      reloadAccounts,
    ],
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}
