/** 全量截图（免密码版本）：空状态、深色、浅色、添加账户、设置、移动端、Tier C */
import puppeteer from 'puppeteer-core';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = 'http://[::1]:4173/';
const OUT = 'screenshots';
const BROWSER = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const URIS = [
  'otpauth://totp/GitHub:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub',
  'otpauth://steam/Steam:nightowl?secret=JBSWY3DPEHPK3PXP',
  'otpauth://totp/Claude:alice@anthropic.com?secret=GEZDGNBVGY3TQOJQ&issuer=Claude&algorithm=SHA256',
  'otpauth://totp/Cloudflare:ops@cf.com?secret=JBSWY3DPEHPK3PXP&issuer=Cloudflare',
  'otpauth://hotp/VPN%20Gateway:it-ops?secret=JBSWY3DPEHPK3PXP&issuer=VPN%20Gateway&counter=7',
  'otpauth://totp/Google:alice@gmail.com?secret=JBSWY3DPEHPK3PXP&issuer=Google',
];

async function newPage(browser, opts = {}) {
  const page = await browser.newPage();
  await page.emulateMediaFeatures([
    { name: 'prefers-reduced-transparency', value: 'no-preference' },
    { name: 'prefers-reduced-motion', value: 'no-preference' },
  ]);
  if (opts.viewport) await page.setViewport(opts.viewport);
  return page;
}

async function addAccount(page, uri) {
  await page.waitForSelector('.topbar__actions .primary-button', { timeout: 8000 });
  await page.click('.topbar__actions .primary-button');
  await sleep(500);
  await page.waitForSelector('.segmented__item');
  if (!(await page.$('#uri-input'))) {
    const tabs = await page.$$('.segmented__item');
    await tabs[1].click();
    await sleep(280);
  }
  await page.waitForSelector('#uri-input');
  await page.$eval(
    '#uri-input',
    (el, v) => {
      const s = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      s.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    uri,
  );
  await page.click('.panel__actions .primary-button');
  await sleep(400);
  await page.click('.dialog__preview-actions .primary-button');
  await sleep(850);
}

const browser = await puppeteer.launch({
  executablePath: BROWSER,
  headless: true,
  args: ['--no-sandbox', '--force-color-profile=srgb'],
  defaultViewport: { width: 1440, height: 960, deviceScaleFactor: 2 },
});

/* 1. 空状态（免密码直接进入） */
const page = await newPage(browser);
await page.goto(BASE, { waitUntil: 'networkidle2' });
await sleep(1800);
await page.screenshot({ path: `${OUT}/20-empty-no-password.png` });
console.log('✓ 20 空状态');

/* 2. 添加账户弹窗的两个入口 */
await page.click('.empty-state .primary-button');
await sleep(700);
await page.screenshot({ path: `${OUT}/24-add-scan.png` });
console.log('✓ 24 扫码入口');
await page.keyboard.press('Escape');
await sleep(400);

/* 3. 添加账户 */
for (const uri of URIS) await addAccount(page, uri);

/* 4. 深色列表 */
await sleep(1200);
await page.screenshot({ path: `${OUT}/21-dark.png` });
console.log('✓ 21 深色列表');

/* 5. 手动输入面板 */
await page.click('.topbar__actions .primary-button');
await sleep(500);
const tabs = await page.$$('.segmented__item');
await tabs[2].click();
await sleep(400);
await page.screenshot({ path: `${OUT}/25-add-manual.png` });
console.log('✓ 25 手动输入');
await page.keyboard.press('Escape');
await sleep(400);

/* 6. 浅色列表 */
await page.click('.theme-toggle');
await sleep(1100);
await page.screenshot({ path: `${OUT}/22-light.png` });
console.log('✓ 22 浅色列表');

/* 7. 设置面板（浅色） */
await page.click('.topbar__actions .icon-button[aria-label="设置"]');
await sleep(800);
await page.screenshot({ path: `${OUT}/23-settings.png` });
console.log('✓ 23 设置浅色');
await page.keyboard.press('Escape');
await sleep(400);

/* 8. 设置面板（深色，展示备份页） */
await page.click('.theme-toggle');
await sleep(900);
await page.click('.topbar__actions .icon-button[aria-label="设置"]');
await sleep(700);
await page.$$eval('.settings__tab', (els) => els[1]?.click());
await sleep(500);
await page.screenshot({ path: `${OUT}/26-settings-backup.png` });
console.log('✓ 26 设置备份');
await page.keyboard.press('Escape');
await sleep(400);

/* 9. 移动端 375 */
const mobile = await newPage(browser, {
  viewport: { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
});
await mobile.goto(BASE, { waitUntil: 'networkidle2' });
await sleep(2000);
await mobile.screenshot({ path: `${OUT}/27-mobile-list.png` });
const overflow = await mobile.evaluate(() => ({
  sw: document.documentElement.scrollWidth,
  cw: document.documentElement.clientWidth,
}));
console.log('✓ 27 移动端', overflow, overflow.sw <= overflow.cw + 1 ? 'PASS' : 'FAIL');
await mobile.click('.topbar__actions .primary-button');
await sleep(800);
await mobile.screenshot({ path: `${OUT}/28-mobile-drawer.png` });
console.log('✓ 28 移动端抽屉');

/* 10. Tier C 降级 */
const tierC = await browser.newPage();
await tierC.emulateMediaFeatures([{ name: 'prefers-reduced-transparency', value: 'reduce' }]);
await tierC.setViewport({ width: 1440, height: 960, deviceScaleFactor: 2 });
await tierC.goto(BASE, { waitUntil: 'networkidle2' });
await sleep(2200);
const tier = await tierC.evaluate(() => document.documentElement.dataset.glassTier);
console.log('Tier C 探测:', tier, tier === 'c' ? 'PASS' : 'FAIL');
await tierC.screenshot({ path: `${OUT}/29-tier-c.png` });
console.log('✓ 29 Tier C');

await browser.close();
console.log('done');
