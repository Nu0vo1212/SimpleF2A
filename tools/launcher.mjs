/**
 * SimpleF2A 桌面启动器（托盘常驻版）。
 *
 * 行为：
 *  1. 启动一个仅监听 127.0.0.1 的静态文件服务器（无外网暴露）
 *  2. 启动系统托盘图标（由内嵌的 tray-host.ps1 承载）
 *  3. 自动用默认浏览器打开页面
 *  4. 托盘菜单：打开 / 复制地址 / 刷新 / 退出
 *  5. 主进程退出时自动关闭托盘图标
 *
 * 静态资源在打包时内嵌进 exe（见 tools/build-exe.mjs）。
 */
import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { execFile, exec, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { createHash } from 'node:crypto';

const HOST = '127.0.0.1';
const PORT_START = 48620;
const PORT_TRIES = 20;
const IS_WIN = process.platform === 'win32';

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
};

/* ------------------------------------------------------------------ 资源定位 */

function assetRoots() {
  if (process.pkg) {
    return ['dist', join(dirname(process.execPath), 'dist')];
  }
  const here = dirname(fileURLToPath(import.meta.url));
  return [join(here, '..', 'dist'), join(process.cwd(), 'dist'), join(here, 'dist')];
}

const ASSET_ROOTS = assetRoots();

function toSafeRelative(urlPath) {
  let clean;
  try {
    clean = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    clean = urlPath.split('?')[0];
  }
  return clean
    .split(/[/\\]+/)
    .filter((p) => p && p !== '.' && p !== '..')
    .join('/');
}

function tryRead(relative) {
  for (const root of ASSET_ROOTS) {
    const file = join(root, relative);
    try {
      return { body: readFileSync(file), ext: extname(file) || '.html' };
    } catch {
      /* 换下一个根目录 */
    }
  }
  return null;
}

function readAsset(urlPath) {
  const rel = toSafeRelative(urlPath || '/');
  if (!rel) return tryRead('index.html');
  return tryRead(rel) ?? tryRead(`${rel}/index.html`) ?? tryRead('index.html');
}

function selfCheck() {
  const index = tryRead('index.html');
  if (!index) {
    fail('找不到内置资源 index.html', [
      `进程类型：${process.pkg ? 'pkg 打包 exe' : '开发模式'}`,
      `查找路径：${ASSET_ROOTS.join(' , ')}`,
      '请重新构建：npm run exe',
    ]);
  }
  return index.body.length;
}

function fail(title, details = []) {
  if (IS_WIN) {
    const text = [`SimpleF2A 启动失败`, '', title, ...details, '', '按任意键退出…'].join('\r\n');
    // 有控制台时直接输出；无控制台时弹一个消息框
    if (process.stdout.isTTY) {
      console.error(`\n  ✗ ${title}\n${details.map((d) => '    ' + d).join('\n')}\n`);
    } else {
      const b64 = Buffer.from(text, 'utf16le').toString('base64');
      exec(
        `powershell -NoProfile -WindowStyle Hidden -Command "[void][Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms');[System.Windows.Forms.MessageBox]::Show([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${b64}')),'SimpleF2A')"`,
      );
    }
  } else {
    console.error(`✗ ${title}`, details.join(' '));
  }
  setTimeout(() => process.exit(1), 300);
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

/* ------------------------------------------------------------------ 托盘宿主 */

/** 解出内嵌的 PowerShell 托盘脚本到临时目录 */
function extractTrayScript() {
  const candidates = [
    join(dirname(fileURLToPath(import.meta.url)), 'tray-host.ps1'),
    join(process.cwd(), 'tools', 'tray-host.ps1'),
  ];
  if (process.pkg) {
    candidates.unshift('tools/tray-host.ps1');
  }
  for (const candidate of candidates) {
    try {
      const content = readFileSync(candidate, 'utf8');
      return content;
    } catch {
      /* 继续 */
    }
  }
  return null;
}

function startTray(url) {
  if (!IS_WIN) return { stop: () => {}, available: false };

  const script = extractTrayScript();
  if (!script) return { stop: () => {}, available: false };

  const baseDir = join(os.tmpdir(), 'simplef2a-tray');
  try {
    mkdirSync(baseDir, { recursive: true });
    // 清理上次异常退出遗留的文件（本次实例的文件名带唯一 id，不会误删自己）
    for (const stale of readdirSync(baseDir)) {
      if (!/^tray-[0-9a-f]{8}\.(ps1|cmd|ico)$/.test(stale)) continue;
      try {
        rmSync(join(baseDir, stale), { force: true });
      } catch {
        /* 可能被其它实例占用，忽略 */
      }
    }
  } catch {
    return { stop: () => {}, available: false };
  }

  // 每个实例使用独立文件名，避免多开冲突
  const id = createHash('md5').update(`${process.pid}-${Date.now()}`).digest('hex').slice(0, 8);
  const scriptPath = join(baseDir, `tray-${id}.ps1`);
  const cmdFile = join(baseDir, `tray-${id}.cmd`);
  const iconPath = join(baseDir, `tray-${id}.ico`);

  try {
    // 关键：Windows PowerShell 5.1 在无 BOM 时按 ANSI 解码文件，
    // 会让脚本里的中文变成乱码并导致语法错误。必须写入 UTF-8 BOM。
    const withBom = script.charCodeAt(0) === 0xfeff ? script : '\ufeff' + script;
    writeFileSync(scriptPath, withBom, { encoding: 'utf8' });

    // 把内嵌的 app.ico 释放到临时目录，供托盘使用
    const iconCandidates = process.pkg
      ? ['tools/app.ico', join(dirname(process.execPath), 'tools', 'app.ico')]
      : [
          join(dirname(fileURLToPath(import.meta.url)), 'app.ico'),
          join(process.cwd(), 'tools', 'app.ico'),
        ];
    for (const candidate of iconCandidates) {
      try {
        const bytes = readFileSync(candidate);
        writeFileSync(iconPath, bytes);
        if (process.env.SIMPLEF2A_VERBOSE) {
          console.log(`[tray] icon <- ${candidate} (${bytes.length} bytes)`);
        }
        break;
      } catch {
        /* 换下一个 */
      }
    }
  } catch {
    return { stop: () => {}, available: false };
  }

  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-WindowStyle',
    'Hidden',
    '-File',
    scriptPath,
    '-Url',
    url,
    '-CommandFile',
    cmdFile,
    '-IconFile',
    iconPath,
  ];

  let child;
  try {
    child = spawn('powershell.exe', args, {
      detached: false,
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch {
    return { stop: () => {}, available: false };
  }

  let stopping = false;
  const cleanup = () => {
    if (stopping) return;
    stopping = true;
    try {
      writeFileSync(cmdFile, 'quit', 'utf8');
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      for (const f of [scriptPath, cmdFile, iconPath]) {
        try {
          rmSync(f, { force: true });
        } catch {
          /* ignore */
        }
      }
    }, 600);
  };

  child.on('error', () => {
    /* 托盘不可用时静默降级 */
  });

  return { stop: cleanup, available: true };
}

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
    if (err) console.log(`无法自动打开浏览器，请手动访问：${url}`);
  });
}

function tryListen(port, attempt = 0) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < PORT_TRIES) {
      tryListen(port + 1, attempt + 1);
      return;
    }
    fail(`端口监听失败：${err.message}`);
  });

  server.listen(port, HOST, () => {
    const url = `http://${HOST}:${port}/`;
    const indexBytes = selfCheck();

    const tray = startTray(url);
    // 开发/调试用：SIMPLEF2A_NO_OPEN 可跳过自动打开浏览器
    if (!process.env.SIMPLEF2A_NO_OPEN) {
      setTimeout(() => openBrowser(url), 400);
    }
    if (process.env.SIMPLEF2A_VERBOSE) {
      console.log(`SimpleF2A 运行中：${url}（index ${indexBytes} 字节，托盘：${tray.available ? '已启动' : '不可用'}）`);
    }

    let closing = false;
    const shutdown = (code = 0) => {
      if (closing) return;
      closing = true;
      tray.stop();
      server.close(() => process.exit(code));
      setTimeout(() => process.exit(code), 1200);
    };

    process.on('SIGINT', () => shutdown(0));
    process.on('SIGTERM', () => shutdown(0));
    process.on('exit', () => {
      try {
        tray.stop();
      } catch {
        /* ignore */
      }
    });
    // 所有客户端断开（例如用户手动关掉唯一标签页）不退出，保持托盘常驻
  });
}

selfCheck();
tryListen(PORT_START);

// 无控制台时保持事件循环存活
if (!process.stdout.isTTY) {
  process.stdin.resume?.();
}
