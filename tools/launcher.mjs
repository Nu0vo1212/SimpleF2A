/**
 * SimpleF2A 桌面启动器。
 *
 * 行为：
 *  1. 启动一个仅监听 127.0.0.1 的静态文件服务器（无外网暴露）
 *  2. 在控制台打印访问地址与安全提示
 *  3. 自动用默认浏览器打开页面
 *  4. 关闭命令行窗口即停止服务
 *
 * 静态资源在打包时内嵌进 exe（见 tools/build-exe.mjs），
 * 因此 exe 是单文件、可移动的。
 */
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const HOST = '127.0.0.1';
const PORT_START = 48620;
const PORT_TRIES = 20;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/* ------------------------------------------------------------------ 资源定位 */

/**
 * pkg 打包后：内嵌资源位于快照文件系统（process.pkg 为真），
 * 以 exe 同级 `__assets__` 虚拟路径暴露（build-exe.mjs 中配置 assets）。
 * 开发运行：使用仓库内的 dist/。
 */
function resolveAssetRoot() {
  if (process.pkg) {
    return 'dist';
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '..', 'dist'),
    join(process.cwd(), 'dist'),
    join(here, 'dist'),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, 'index.html'))) return c;
  }
  return candidates[0];
}

const ASSET_ROOT = resolveAssetRoot();

function readAsset(urlPath) {
  // 归一化并阻断路径穿越
  const clean = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const rel = normalize(clean).replace(/^([/\\])+/, '').replace(/^(\.\.[/\\])+/, '');
  const candidates = [
    join(ASSET_ROOT, rel),
    join(ASSET_ROOT, rel, 'index.html'),
    join(ASSET_ROOT, 'index.html'), // SPA 回退
  ];
  for (const file of candidates) {
    try {
      if (!file.startsWith(normalize(ASSET_ROOT))) continue;
      return { body: readFileSync(file), ext: extname(file) || '.html' };
    } catch {
      /* 继续尝试 */
    }
  }
  return null;
}

/* -------------------------------------------------------------------- 服务器 */

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob: https://api.mtyqx.cn https://api.img.mtyqx.cn https://api.dujin.org https://www.dmoe.cc https://icons.duckduckgo.com https://www.google.com",
  "font-src 'self' data:",
  "connect-src 'self' https://api.mtyqx.cn https://api.img.mtyqx.cn https://api.dujin.org https://www.dmoe.cc https://icons.duckduckgo.com https://www.google.com",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const server = http.createServer((req, res) => {
  const asset = readAsset(req.url ?? '/');
  const headers = {
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
    'Cache-Control': 'no-store',
  };

  if (!asset) {
    res.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
    return;
  }
  res.writeHead(200, {
    ...headers,
    'Content-Type': MIME[asset.ext] ?? 'application/octet-stream',
    'Content-Length': asset.body.length,
  });
  res.end(asset.body);
});

/* ----------------------------------------------------------- 启动与打开浏览器 */

function openBrowser(url) {
  const platform = process.platform;
  const cmd =
    platform === 'win32'
      ? `start "" "${url}"`
      : platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) {
      console.log(`\n  ⚠ 无法自动打开浏览器，请手动访问：${url}\n`);
    }
  });
}

function banner(url, port) {
  const line = '─'.repeat(52);
  console.log('');
  console.log(`  ${line}`);
  console.log('   SimpleF2A · 本地加密双因素验证器');
  console.log(`  ${line}`);
  console.log('');
  console.log(`   访问地址   ${url}`);
  console.log(`   监听端口   ${HOST}:${port}（仅本机可访问）`);
  console.log(`   资源来源   ${process.pkg ? 'exe 内嵌' : ASSET_ROOT}`);
  console.log('');
  console.log('   🔒 你的密钥只保存在这个浏览器里，不会上传到任何服务器。');
  console.log('      主密码永不保存，关掉页面即锁定。');
  console.log('');
  console.log('   ▸ 关闭这个窗口即停止服务。');
  console.log(`  ${line}`);
  console.log('');
}

function tryListen(port, attempt = 0) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < PORT_TRIES) {
      tryListen(port + 1, attempt + 1);
      return;
    }
    console.error(`\n  ✗ 启动失败：${err.message}\n`);
    console.error('  按任意键退出…');
    process.stdin.resume();
    process.stdin.once('data', () => process.exit(1));
  });

  server.listen(port, HOST, () => {
    const url = `http://${HOST}:${port}/`;
    banner(url, port);
    if (!process.env.SIMPLEF2A_NO_OPEN) {
      setTimeout(() => openBrowser(url), 350);
    }
  });
}

tryListen(PORT_START);

// 保持进程存活；Ctrl+C 优雅退出
process.on('SIGINT', () => {
  console.log('\n  正在关闭…');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 800);
});
