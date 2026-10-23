/**
 * 随机图片背景（外部 API，多源容灾）。
 *
 * 约束：
 *  - 只在浏览器本地请求，不携带任何用户数据（无 query 参数、无 cookie —— 用 no-cors 预检不可行，
 *    因此用 <img> 加载，天然受 CSP img-src 白名单约束）
 *  - 当前 URL 缓存到 sessionStorage，组件重渲染不重复请求；刷新页面才重新挑选
 *  - 全部源失败 → 保持 CSS 渐变兜底，UI 不抖动
 *  - 换背景 = 重新挑选（若返回同一 URL，追加时间戳破坏缓存并重试其他源）
 */

export const BACKGROUND_SOURCES = [
  'https://api.mtyqx.cn/api/random.php',
  'https://api.mtyqx.cn/tapi/random.php',
  'https://api.dujin.org/bing/1366.php',
  'https://www.dmoe.cc/random.php?return=img',
] as const;

const STORAGE_KEY = 'simplef2a:bg-url';
const LOAD_TIMEOUT_MS = 12_000;

export interface BackgroundState {
  url: string | null;
  /** 正在加载的 url，用于淡入过渡 */
  loading: boolean;
  /** 是否已成功加载过 */
  loaded: boolean;
}

export function readCachedBackground(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function cacheBackground(url: string | null): void {
  try {
    if (url) sessionStorage.setItem(STORAGE_KEY, url);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* 隐私模式下 sessionStorage 可能不可用，忽略 */
  }
}

/** 用 image 元素预加载，带超时；失败 reject。 */
export function preloadImage(url: string, timeoutMs = LOAD_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') {
      reject(new Error('no Image'));
      return;
    }
    const img = new Image();
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      img.src = '';
      reject(new Error('timeout'));
    }, timeoutMs);
    img.onload = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // 避免 API 返回 1x1 追踪像素或空图
      if (img.naturalWidth < 32 || img.naturalHeight < 32) {
        reject(new Error('invalid image'));
        return;
      }
      resolve(url);
    };
    img.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('load error'));
    };
    img.src = url;
  });
}

/** 顺序尝试所有源，返回第一个成功的 URL；全失败返回 null。 */
export async function pickBackground(excludeUrl?: string | null): Promise<string | null> {
  for (const source of BACKGROUND_SOURCES) {
    const candidate = source + (source.includes('?') ? '&' : '?') + 'r=' + Date.now().toString(36);
    try {
      const url = await preloadImage(candidate);
      if (excludeUrl && url === excludeUrl) continue;
      cacheBackground(url);
      return url;
    } catch {
      // 继续下一个源
    }
  }
  cacheBackground(null);
  return null;
}

/** 无随机源成功时，最终兜底：纯 CSS 渐变（返回 null 由 UI 处理）。 */
export const FALLBACK_MODE = 'fallback';
