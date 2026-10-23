/**
 * 构建 Windows 单文件 exe 并输出到桌面。
 *
 * 前置：先 npm run build 生成 dist/
 * 用法：node tools/build-exe.mjs [--out "C:\\path\\SimpleF2A.exe"]
 *
 * 说明：
 *  - 使用 @yao-pkg/pkg 把 tools/launcher.mjs 打成 node24-win-x64 单文件
 *  - dist/ 作为内嵌资源一起写入 exe（launcher 通过 process.pkg 判断并从虚拟路径读取）
 *  - 需要 pkg-fetch 的预构建二进制；若本机缓存缺失，脚本会自动从镜像下载
 */
import { execFileSync } from 'node:child_process';
import { existsSync, copyFileSync, mkdirSync, statSync, createWriteStream, chmodSync } from 'node:fs';
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
execFileSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  [
    '@yao-pkg/pkg',
    ENTRY,
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
  { cwd: ROOT, stdio: 'inherit' },
);

if (!existsSync(RAW_EXE)) {
  console.error('✗ pkg 未生成 exe');
  process.exit(1);
}

mkdirSync(dirname(TARGET), { recursive: true });
copyFileSync(RAW_EXE, TARGET);
const sizeMb = (statSync(TARGET).size / 1024 / 1024).toFixed(1);

console.log('');
console.log(`✓ 已生成：${TARGET}  (${sizeMb} MB)`);
console.log('  双击运行后会打开命令行窗口，并自动用默认浏览器打开应用。');
console.log('  关闭命令行窗口即停止服务。');
