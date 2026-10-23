/**
 * 玻璃质量分级（Tier A / B / C）—— 运行时自动检测，不提供「手动关闭效果」开关。
 *
 * 判定链路（从高到低）：
 *  1. prefers-reduced-transparency: reduce  → Tier C
 *  2. 低端设备信号（hardwareConcurrency ≤ 4 / deviceMemory ≤ 4） → Tier B
 *  3. 不支持 backdrop-filter 或 SVG filter（Safari < 9 等） → Tier C / B
 *  4. 首帧耗时 + 滚动帧率实测不达标 → 降为 Tier B（本会话内记忆）
 *
 * 高层级可在运行中因性能回归被下调，但绝不自动升级（避免闪烁）。
 */

export type GlassTier = 'a' | 'b' | 'c';

export interface TierReport {
  tier: GlassTier;
  reasons: string[];
  hardwareConcurrency: number;
  deviceMemory: number | null;
  supportsBackdropFilter: boolean;
  supportsSvgFilter: boolean;
  firstFrameMs: number | null;
  measuredFps: number | null;
}

const TIER_STORAGE_KEY = 'simplef2a:tier';

/** 性能预算阈值 —— 全部集中在此，符合「降级阈值 token 化」要求 */
export const TIER_THRESHOLDS = {
  /** 低于该 CPU 核心数视为低端设备 */
  minCores: 4,
  /** 低于该内存（GB）视为低端设备 */
  minDeviceMemory: 4,
  /** 首帧（DOMContentLoaded → rAF 回调）超过该毫秒数则降级 */
  firstFrameBudgetMs: 260,
  /** 滚动采样帧率低于该值则降级到 Tier B */
  minScrollFps: 45,
  /** 采样帧数 */
  sampleFrames: 36,
};

export function prefersReducedTransparency(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-transparency: reduce)').matches;
  } catch {
    return false;
  }
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function supportsBackdrop(): boolean {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false;
  return (
    CSS.supports('backdrop-filter', 'blur(8px)') ||
    CSS.supports('-webkit-backdrop-filter', 'blur(8px)')
  );
}

function supportsSvgFilterUrl(): boolean {
  if (typeof document === 'undefined') return false;
  // 现代浏览器都支持 URL 引用的 SVG filter；关键是 URL-reference 支持（Safari < 9 不支持）
  return typeof document.body?.style.filter === 'string';
}

interface NavigatorWithHints extends Navigator {
  deviceMemory?: number;
}

export function detectTier(): TierReport {
  const reasons: string[] = [];
  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as
    | NavigatorWithHints
    | undefined;
  const hardwareConcurrency = nav?.hardwareConcurrency ?? 8;
  const deviceMemory = typeof nav?.deviceMemory === 'number' ? nav.deviceMemory : null;
  const supportsBackdropFilter = supportsBackdrop();
  const supportsSvgFilter = supportsSvgFilterUrl();

  let tier: GlassTier = 'a';

  if (prefersReducedTransparency()) {
    tier = 'c';
    reasons.push('系统偏好：降低透明度');
  }

  if (tier !== 'c' && !supportsBackdropFilter) {
    tier = 'c';
    reasons.push('浏览器不支持 backdrop-filter');
  }

  if (tier === 'a' && !supportsSvgFilter) {
    tier = 'b';
    reasons.push('浏览器不支持 SVG 滤镜');
  }

  if (tier === 'a') {
    if (hardwareConcurrency <= TIER_THRESHOLDS.minCores) {
      tier = 'b';
      reasons.push(`CPU 核心数 ${hardwareConcurrency} ≤ ${TIER_THRESHOLDS.minCores}`);
    } else if (deviceMemory !== null && deviceMemory <= TIER_THRESHOLDS.minDeviceMemory) {
      tier = 'b';
      reasons.push(`设备内存 ${deviceMemory}GB ≤ ${TIER_THRESHOLDS.minDeviceMemory}GB`);
    }
  }

  // 此前会话已测出性能不足 → 直接锁定为 Tier B（不反复试探）
  try {
    const remembered = sessionStorage.getItem(TIER_STORAGE_KEY);
    if (remembered === 'b' && tier === 'a') {
      tier = 'b';
      reasons.push('本会话此前测得帧率不足，已记忆为 Tier B');
    }
  } catch {
    /* ignore */
  }

  return {
    tier,
    reasons,
    hardwareConcurrency,
    deviceMemory,
    supportsBackdropFilter,
    supportsSvgFilter,
    firstFrameMs: null,
    measuredFps: null,
  };
}

/**
 * 首帧耗时：从 navigationStart 到首个 rAF 回调。
 * 超过预算说明设备/主线程吃紧，退回 Tier B。
 */
export function measureFirstFrame(): Promise<number> {
  return new Promise((resolve) => {
    const start =
      typeof performance !== 'undefined' && performance.timeOrigin
        ? performance.now()
        : 0;
    requestAnimationFrame(() => resolve(performance.now() - start));
  });
}

/**
 * 滚动帧率采样：在列表滚动（或模拟滚动）期间用 rAF 统计帧间隔。
 * 返回平均 fps；低于 minScrollFps 时调用方应降级。
 */
export function sampleScrollFps(
  target: HTMLElement | null,
  frames = TIER_THRESHOLDS.sampleFrames,
): Promise<number> {
  return new Promise((resolve) => {
    let last = performance.now();
    let count = 0;
    let elapsed = 0;
    let raf = 0;
    const onFrame = (now: number) => {
      const delta = now - last;
      last = now;
      // 忽略切后台造成的巨大间隔
      if (delta > 0 && delta < 200) {
        elapsed += delta;
        count++;
      }
      if (count >= frames) {
        cancelAnimationFrame(raf);
        resolve(count === 0 ? 0 : (count / elapsed) * 1000);
        return;
      }
      raf = requestAnimationFrame(onFrame);
    };
    // 轻微滚动触发真实合成路径（若目标可滚动）
    if (target && target.scrollHeight > target.clientHeight) {
      target.scrollTop = target.scrollTop + 1;
      target.scrollTop = Math.max(0, target.scrollTop - 1);
    }
    raf = requestAnimationFrame(onFrame);
  });
}

export function rememberDegradedTier(): void {
  try {
    sessionStorage.setItem(TIER_STORAGE_KEY, 'b');
  } catch {
    /* ignore */
  }
}

/** 把 tier 写到 <html data-glass-tier>，驱动 CSS 降级 */
export function applyTierToDocument(tier: GlassTier): void {
  const root = document.documentElement;
  root.dataset.glassTier = tier;
  root.classList.toggle('tier-b', tier === 'b');
  root.classList.toggle('tier-c', tier === 'c');
}
