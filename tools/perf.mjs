/**
 * 性能实测脚本：在无节流与 6x CPU 节流下测量列表滚动帧率。
 *
 * 用法：node tools/perf.mjs  （需先 npm run build && npm run preview）
 * 输出 JSON 供 README 引用。
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.env.PREVIEW_URL ?? 'http://[::1]:4173';
const CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const executablePath = CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error('未找到浏览器');
  process.exit(1);
}

const PASSWORD = 'correct horse battery staple';
const ACCOUNT_COUNT = 24;

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1440, height: 960, deviceScaleFactor: 1 },
});

const page = await browser.newPage();
await page.goto(BASE, { waitUntil: 'networkidle2' });
await sleep(800);
await page.type('#master-password', PASSWORD);
await page.type('#master-password-confirm', PASSWORD);
await page.click('button[type="submit"]');
await sleep(2500);

/* 通过 otpauth-migration:// 批量注入账号（顺便验证 Google Authenticator 批量导入路径） */
function varint(n) {
  const out = [];
  let v = n;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return out;
}
const tag = (f, w) => varint((f << 3) | w);
const lenField = (f, payload) => [...tag(f, 2), ...varint(payload.length), ...payload];
const varField = (f, v) => [...tag(f, 0), ...varint(v)];
const enc = (s) => [...new TextEncoder().encode(s)];

const SECRET_BYTES = [...new TextEncoder().encode('12345678901234567890')];
const params = [];
for (let i = 0; i < ACCOUNT_COUNT; i++) {
  params.push(
    [
      ...lenField(1, SECRET_BYTES),
      ...lenField(2, enc(`user${i}@example.com`)),
      ...lenField(3, enc(`Service${i}`)),
      ...varField(4, 1), // SHA1
      ...varField(5, 1), // 6 digits
      ...varField(6, 2), // TOTP
    ].flat(),
  );
}
const body = params.flatMap((p) => lenField(1, p));
const full = [...body, ...varField(2, 1), ...varField(3, 1), ...varField(4, 0), ...varField(5, 99)];
const migrationData = btoa(String.fromCharCode(...full))
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');

await page.click('.topbar__actions .primary-button');
await sleep(400);
const tabs = await page.$$('.segmented__item');
await tabs[1].click();
await sleep(250);
await page.$eval(
  '#uri-input',
  (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  },
  `otpauth-migration://offline?data=${migrationData}`,
);
await page.click('.panel__actions .primary-button');
await sleep(400);
const batchBtn = await page.$('.batch .primary-button');
if (!batchBtn) throw new Error('批量导入按钮未出现');
await batchBtn.click();
await sleep(1200);

const count = await page.$$eval('.account-card', (els) => els.length);
console.log(`已注入 ${count} 个账户`);

/** 测量滚动帧率 */
async function measure(label) {
  const result = await page.evaluate(async () => {
    const scroller = document.scrollingElement;
    const frames = [];
    let last = performance.now();
    // 连续滚动 2 秒
    for (let i = 0; i < 120; i++) {
      window.scrollBy(0, 24);
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now();
      frames.push(now - last);
      last = now;
      if (scroller.scrollTop + window.innerHeight >= scroller.scrollHeight - 4) {
        window.scrollTo(0, 0);
      }
    }
    const valid = frames.filter((f) => f > 0 && f < 200);
    const sum = valid.reduce((a, b) => a + b, 0);
    const sorted = [...valid].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    return {
      frames: valid.length,
      avgFps: +(1000 / (sum / valid.length)).toFixed(1),
      p95FrameMs: +p95.toFixed(2),
      longFrames: frames.filter((f) => f > 33.4).length,
    };
  });
  console.log(`${label}:`, JSON.stringify(result));
  return result;
}

const baseline = await measure('无节流');

// 6x CPU 节流
const client = await page.createCDPSession();
await client.send('Emulation.setCPUThrottlingRate', { rate: 6 });
await sleep(500);
const throttled = await measure('6x CPU');
await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });

// 首屏指标
const nav = await page.evaluate(() => {
  const entry = performance.getEntriesByType('navigation')[0];
  const paints = performance.getEntriesByType('paint');
  return {
    domContentLoaded: Math.round(entry.domContentLoadedEventEnd),
    load: Math.round(entry.loadEventEnd),
    firstPaint: Math.round(paints.find((p) => p.name === 'first-paint')?.startTime ?? 0),
    firstContentfulPaint: Math.round(
      paints.find((p) => p.name === 'first-contentful-paint')?.startTime ?? 0,
    ),
  };
});
console.log('首屏指标:', JSON.stringify(nav));
console.log(
  '\nRESULT_JSON ' +
    JSON.stringify({ accountCount: count, baseline, throttled, nav }, null, 0),
);

await browser.close();
