/**
 * 构建 Windows 单文件 exe 并输出到桌面。
 *
 * 前置：先 npm run build 生成 dist/
 * 用法：node tools/build-exe.mjs [--out "C:\\path\\SimpleF2A.exe"]
 *
 * 说明：
 *  - 使用 @yao-pkg/pkg 把 tools/launcher.mjs 打成 node24-win-x64 单文件
 *  - dist/ 与 tools/tray-host.ps1 作为内嵌资源一起写入 exe
 *  - 需要 pkg-fetch 的预构建二进制；若本机缓存缺失，脚本会自动从镜像下载
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  copyFileSync,
  mkdirSync,
  statSync,
  createWriteStream,
  chmodSync,
  writeFileSync,
  cpSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const ENTRY = join(ROOT, 'tools', 'launcher.mjs');
const WORK = join(ROOT, '.exe-build');
const RAW_EXE = join(WORK, 'SimpleF2A-raw.exe');

const NODE_VERSION = 'v24.22.1';
const PKG_FETCH_TAG = 'v3.6';
const CACHE_DIR = join(os.homedir(), '.pkg-cache', PKG_FETCH_TAG);
const CACHE_FILE = join(CACHE_DIR, `fetched-${NODE_VERSION}-win-x64`);
const MIRROR = `https://github.com/yao-pkg/pkg-fetch/releases/download/${PKG_FETCH_TAG}/node-${NODE_VERSION}-win-x64`;

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const DESKTOP = join(os.homedir(), 'Desktop');
const TARGET =
  outIdx !== -1 && args[outIdx + 1] ? resolve(args[outIdx + 1]) : join(DESKTOP, 'SimpleF2A.exe');

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('✗ 未找到 dist/index.html，请先运行：npm run build');
  process.exit(1);
}

mkdirSync(WORK, { recursive: true });

/* --------------------------------------------- 确保 pkg-fetch 基础二进制就绪 */

async function ensureBaseBinary() {
  if (existsSync(CACHE_FILE) && statSync(CACHE_FILE).size > 50 * 1024 * 1024) {
    console.log('→ 基础二进制已缓存');
    return;
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  console.log('→ 下载 pkg-fetch 基础二进制（约 89MB）…');
  const res = await fetch(MIRROR);
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`);
  const fileStream = createWriteStream(CACHE_FILE);
  await new Promise((resolvePromise, reject) => {
    res.body.pipeTo(
      new WritableStream({
        write(chunk) {
          fileStream.write(chunk);
        },
        close() {
          fileStream.end(resolvePromise);
        },
        abort(err) {
          fileStream.destroy();
          reject(err);
        },
      }),
    );
  });
  try {
    chmodSync(CACHE_FILE, 0o755);
  } catch {
    /* Windows 忽略 */
  }
  console.log('  ✓ 已缓存');
}

await ensureBaseBinary();

/* ------------------------------------------------------------- 打包 */

console.log('→ 打包 exe（内嵌 dist/ 资源）…');

// 直接调用 pkg 的 JS 入口，避免 Windows 下 spawn .cmd 的 EINVAL 问题
const PKG_BIN = join(ROOT, 'node_modules', '@yao-pkg', 'pkg', 'lib-es5', 'bin.js');
if (!existsSync(PKG_BIN)) {
  console.error('✗ 未找到 @yao-pkg/pkg，请先运行：npm install');
  process.exit(1);
}

/**
 * pkg 通过 package.json 的 pkg.assets 决定内嵌哪些非 JS 资源。
 * 这里生成一个临时 package.json（指向 launcher），把 dist/ 与托盘脚本都打进去。
 */
const STAGING = join(WORK, 'pkg-entry');
mkdirSync(STAGING, { recursive: true });
const stagingPkg = {
  name: 'simplef2a-bundle',
  version: '1.0.0',
  main: 'launcher.mjs',
  pkg: {
    // assets 会内嵌到快照文件系统；--icon 用于设置 exe 的 Windows 资源图标
    assets: ['dist/**/*', 'tools/tray-host.ps1', 'tools/app.ico'],
    outputPath: WORK,
  },
};

writeFileSync(join(STAGING, 'package.json'), JSON.stringify(stagingPkg, null, 2), 'utf8');
copyFileSync(ENTRY, join(STAGING, 'launcher.mjs'));
// dist/ 与托盘脚本按 assets 声明的位置放置
cpSync(DIST, join(STAGING, 'dist'), { recursive: true });
mkdirSync(join(STAGING, 'tools'), { recursive: true });
copyFileSync(
  join(ROOT, 'tools', 'tray-host.ps1'),
  join(STAGING, 'tools', 'tray-host.ps1'),
);
copyFileSync(join(ROOT, 'tools', 'app.ico'), join(STAGING, 'tools', 'app.ico'));

execFileSync(
  process.execPath,
  [
    PKG_BIN,
    join(STAGING, 'launcher.mjs'),
    '--targets',
    'node24-win-x64',
    '--output',
    RAW_EXE,
    '--public-packages',
    '*',
    '--compress',
    'GZip',
    '--no-dict',
    '*',
  ],
  { cwd: STAGING, stdio: 'inherit' },
);

/**
 * 注意：不要用 Win32 UpdateResource 事后修改 pkg 产出的 exe —— 
 * pkg 把载荷追加在 PE 结构之后，改写资源段会让它报 "Pkg: Error reading from file"。
 *
 * 正确做法是在「基础二进制」阶段就带图标（pkg-fetch 的 built-* 文件），
 * 但那需要重新构建 Node 基础镜像。这里采用更安全的折中：
 *   - exe 使用 pkg 默认图标
 *   - 托盘图标在运行时从内嵌的 app.ico 读取（已实现且可靠）
 */

if (!existsSync(RAW_EXE)) {
  console.error('✗ pkg 未生成 exe');
  process.exit(1);
}

mkdirSync(dirname(TARGET), { recursive: true });
copyFileSync(RAW_EXE, TARGET);
const sizeMb = (statSync(TARGET).size / 1024 / 1024).toFixed(1);

console.log('');
console.log(`✓ 已生成：${TARGET}  (${sizeMb} MB)`);
console.log('  双击运行后常驻系统托盘，并自动用默认浏览器打开应用。');
console.log('  托盘图标：单击/双击打开页面，右键可复制地址、刷新、退出。');
