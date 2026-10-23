/**
 * 联网获取真实网站 favicon（内置品牌图标未命中时的兜底）。
 *
 * 隐私取舍：
 *  - 请求会发送到第三方图标服务，第三方可由此推断「你有哪些账户」
 *  - 因此该能力默认由设置项控制，且可在设置里完全关闭
 *  - 不做完整的 favicon 缓存落盘（privacy 优先），只在会话内用 Map 记忆命中结果
 *
 * CSP：需要允许 https://icons.duckduckgo.com 与 https://www.google.com/s2
 */

const SESSION_KEY = 'simplef2a:favicon-cache';

type Cache = Record<string, string | null>;

function readCache(): Cache {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '{}') as Cache;
  } catch {
    return {};
  }
}

function writeCache(cache: Cache): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(cache));
  } catch {
    /* 配额或隐私模式，忽略 */
  }
}

/**
 * 把 issuer / account 推测成可能的域名候选。
 * 例："GitHub" → github.com；"alice@example.com" → example.com；
 *     "Corp VPN" → corpvpn.com / corp-vpn.com
 */
export function guessDomains(issuer: string, account: string): string[] {
  const out: string[] = [];
  const push = (host: string) => {
    const h = host.trim().toLowerCase();
    if (h && h.includes('.') && !out.includes(h)) out.push(h);
  };

  // 1) 账户名里如果是邮箱，域名是最强信号
  const email = /@([a-z0-9.-]+\.[a-z]{2,})/i.exec(account);
  if (email) push(email[1]);

  // 2) issuer 本身已经是域名
  const issuerTrim = issuer.trim().toLowerCase();
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(issuerTrim)) push(issuerTrim);

  // 3) issuer 是普通品牌名：清洗后拼 .com / .io / .app
  const slug = issuerTrim
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '');
  if (slug && slug.length >= 2 && slug.length <= 24) {
    push(`${slug}.com`);
    push(`${slug}.io`);
    // 带连字符的变体（"vpn gateway" → vpn-gateway.com）
    const dashed = issuerTrim
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-');
    if (dashed !== slug) push(`${dashed}.com`);
  }

  return out.slice(0, 3);
}

/** 构造候选 favicon URL 列表（多源容灾） */
export function faviconUrls(domain: string): string[] {
  return [
    `https://icons.duckduckgo.com/ip3/${domain}.ico`,
    `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
  ];
}

const inflight = new Map<string, Promise<string | null>>();
let memoryCache: Cache = readCache();

function probe(url: string, timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
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
      // 图标服务对不存在的域名常返回占位图（16x16 或 1x1），这里不做严格判定，
      // 由 <img> 的自然尺寸兜底：过小视为无效
      if (img.naturalWidth < 16 || img.naturalHeight < 16) {
        reject(new Error('too small'));
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

/**
 * 解析某个服务的真实 favicon URL（带会话级缓存）。
 * 全部失败返回 null，调用方回退到首字母头像。
 */
export function resolveFavicon(issuer: string, account: string): Promise<string | null> {
  const key = `${issuer}|${account}`;
  if (key in memoryCache) return Promise.resolve(memoryCache[key]);
  const existing = inflight.get(key);
  if (existing) return existing;

  const task = (async () => {
    const domains = guessDomains(issuer, account);
    for (const domain of domains) {
      for (const url of faviconUrls(domain)) {
        try {
          const ok = await probe(url);
          memoryCache = { ...memoryCache, [key]: ok };
          writeCache(memoryCache);
          return ok;
        } catch {
          /* 换下一个源 */
        }
      }
    }
    memoryCache = { ...memoryCache, [key]: null };
    writeCache(memoryCache);
    return null;
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, task);
  return task;
}

export function clearFaviconCache(): void {
  memoryCache = {};
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}
