/**
 * 截图 + 冒烟测试脚本（开发工具，不参与应用运行）。
 *
 * 用法：
 *   1. npm run build
 *   2. npm run preview        （另一个终端，http://localhost:4173）
 *   3. node tools/screenshots.mjs
 *
 * 输出到 screenshots/ 目录。需要本机有 Edge 或 Chrome。
 */
import puppeteer from 'puppeteer-core';
import { mkdir, existsSync } from 'node:fs';
import { mkdir as mkdirAsync } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.env.PREVIEW_URL ?? 'http://[::1]:4173';
const OUT = 'screenshots';

const CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const executablePath = CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error('未找到 Chrome/Edge，请设置 BROWSER_PATH 环境变量');
  process.exit(1);
}

await mkdirAsync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb', '--font-render-hinting=none'],
  defaultViewport: { width: 1440, height: 960, deviceScaleFactor: 2 },
});

const page = await browser.newPage();
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('[console.error]', msg.text());
});
page.on('pageerror', (err) => console.log('[pageerror]', err.message));

// 固定随机图片背景，保证截图可复现（仍走真实的 img 加载路径）
const FIXED_BG =
  'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?auto=format&fit=crop&w=1600&q=70';

async function shot(name, opts = {}) {
  await sleep(600);
  await page.screenshot({ path: `${OUT}/${name}.png`, ...opts });
  console.log('✓', name);
}

/** 让背景使用固定图片（避免每次截图背景都不一样） */
async function pinBackground(url) {
  await page.evaluate((u) => {
    sessionStorage.setItem('simplef2a:bg-url', u);
  }, url);
}

console.log('→ 打开', BASE);
await page.goto(BASE, { waitUntil: 'networkidle2' });
await sleep(1200);

/* 1. 首次设置主密码 */
await shot('01-create-vault');

const PASSWORD = 'correct horse battery staple';
await page.type('#master-password', PASSWORD);
await page.type('#master-password-confirm', PASSWORD);
await sleep(200);
await shot('02-create-filled');

await page.click('button[type="submit"]');
await sleep(2500); // PBKDF2 600k 迭代

/* 2. 空状态 */
await shot('03-empty-state');

/* 3. 添加账户 —— 三个入口 */
await page.click('.empty-state .primary-button');
await sleep(500);
await shot('04-add-scan-tab');

const tabs = await page.$$('.segmented__item');
await tabs[1].click();
await sleep(400);
await shot('05-add-uri-tab');

// 通过 URI 添加若干账户
const URIS = [
  'otpauth://totp/GitHub:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&algorithm=SHA1&digits=6&period=30',
  'otpauth://totp/Cloudflare:alice@example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Cloudflare&algorithm=SHA256&digits=6&period=30',
  'otpauth://hotp/VPN%20Gateway:it-ops?secret=JBSWY3DPEHPK3PXP&issuer=VPN%20Gateway&counter=7',
  'otpauth://steam/Steam:nightowl?secret=JBSWY3DPEHPK3PXP',
  'otpauth://totp/Bank%20of%20Glass:alice?secret=MFRGGZDFMZTWQ2LK&issuer=Bank%20of%20Glass&digits=8&period=60',
];

for (const [i, uri] of URIS.entries()) {
  if (i > 0) {
    // 重新打开添加弹窗并切到「粘贴 URI」
    await page.click('.topbar__actions .primary-button');
    await sleep(500);
  }
  await page.waitForSelector('#uri-input, .segmented__item', { timeout: 5000 });
  const hasInput = await page.$('#uri-input');
  if (!hasInput) {
    const tabEls = await page.$$('.segmented__item');
    await tabEls[1].click();
    await sleep(300);
  }
  // 通过 React 的 value setter 写入，确保受控组件状态同步
  await page.$eval('#uri-input', (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value',
    ).set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, uri);
  await sleep(250);

  const actual = await page.$eval('#uri-input', (el) => el.value);
  if (actual !== uri) {
    console.log(`  ! 第 ${i + 1} 个输入不一致\n    want=${uri}\n    got =${actual}`);
  }

  await page.click('.panel__actions .primary-button');
  await sleep(400);
  const confirmBtn = await page.$('.dialog__preview-actions .primary-button');
  if (!confirmBtn) {
    const err = await page.$eval('.form-error', (el) => el.textContent).catch(() => '(无错误信息)');
    throw new Error(`第 ${i + 1} 个 URI 未能进入预览态：${err}`);
  }
  await confirmBtn.click();
  await sleep(800);
}

/* 4. 账户列表（带随机/固定图片背景 + 折射） */
await pinBackground(FIXED_BG);
await page.reload({ waitUntil: 'networkidle2' });
await sleep(1500);
await page.type('#master-password', PASSWORD);
await page.click('button[type="submit"]');
await sleep(2500);
await shot('06-account-list');

/* 5. 添加账户弹窗（桌面） */
await page.click('.topbar__actions .primary-button');
await sleep(500);
await page.$$eval('.segmented__item', (els) => els[2]?.click());
await sleep(400);
await shot('07-add-manual');

await page.keyboard.press('Escape');
await sleep(400);

/* 6. 浅色模式对比 */
await page.evaluate(() => {
  document.documentElement.dataset.theme = 'light';
});
await sleep(700);
await shot('08-light-mode');

await page.evaluate(() => {
  document.documentElement.dataset.theme = 'dark';
});
await sleep(500);

/* 7. 设置 / 备份面板 */
await page.click('.topbar__actions .icon-button[aria-label="设置"]');
await sleep(600);
await shot('09-settings-backup');
await page.keyboard.press('Escape');
await sleep(400);

/* 8. 移动端 375px */
const mobile = await browser.newPage();
await mobile.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await mobile.goto(BASE, { waitUntil: 'networkidle2' });
await sleep(1200);
await mobile.evaluate((u) => sessionStorage.setItem('simplef2a:bg-url', u), FIXED_BG);
await mobile.reload({ waitUntil: 'networkidle2' });
await sleep(1200);
await mobile.screenshot({ path: `${OUT}/10-mobile-unlock.png` });
console.log('✓ 10-mobile-unlock');
await mobile.type('#master-password', PASSWORD);
await mobile.click('button[type="submit"]');
await sleep(2500);
await mobile.screenshot({ path: `${OUT}/11-mobile-list.png` });
console.log('✓ 11-mobile-list');

// 横向滚动检查
const overflow = await mobile.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
}));
console.log('移动端横向溢出检查:', overflow, overflow.scrollWidth <= overflow.clientWidth + 1 ? 'PASS' : 'FAIL');

await mobile.click('.topbar__actions .primary-button');
await sleep(700);
await mobile.screenshot({ path: `${OUT}/12-mobile-drawer.png` });
console.log('✓ 12-mobile-drawer');

/* 9. Tier 降级验证 */
const tierProbe = await browser.newPage();
await tierProbe.emulateMediaFeatures([
  { name: 'prefers-reduced-transparency', value: 'reduce' },
]);
await tierProbe.setViewport({ width: 1440, height: 960, deviceScaleFactor: 2 });
await tierProbe.goto(BASE, { waitUntil: 'networkidle2' });
await sleep(1200);
const tier = await tierProbe.evaluate(() => ({
  tier: document.documentElement.dataset.glassTier,
  classes: document.documentElement.className,
}));
console.log('Tier C 降级探测:', tier, tier.tier === 'c' ? 'PASS' : 'FAIL');
await tierProbe.evaluate((u) => sessionStorage.setItem('simplef2a:bg-url', u), FIXED_BG);
await tierProbe.reload({ waitUntil: 'networkidle2' });
await sleep(1000);
await tierProbe.type('#master-password', PASSWORD);
await tierProbe.click('button[type="submit"]');
await sleep(2500);
await tierProbe.screenshot({ path: `${OUT}/13-tier-c.png` });
console.log('✓ 13-tier-c');

await browser.close();
console.log('\n全部截图已生成到', OUT);
