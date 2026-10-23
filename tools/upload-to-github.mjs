#!/usr/bin/env node
/**
 * 一键推送到 GitHub（SimpleF2A 仓库）。
 *
 * Token 不写死在代码里 —— 按优先级读取：
 *   1. 环境变量 GITHUB_TOKEN
 *   2. 命令行参数 --token=xxx
 *   3. 本地文件 .upload.env（已被 .gitignore 忽略，不会提交）
 *
 * 用法：
 *   node tools/upload-to-github.mjs                        # 增量提交并推送
 *   node tools/upload-to-github.mjs --message "更新 UI"
 *   node tools/upload-to-github.mjs --init                 # 仅初始化仓库/远端
 *   node tools/upload-to-github.mjs --token=ghp_xxx        # 临时传入
 *   node tools/upload-to-github.mjs --repo-name other-name # 指定仓库名
 *
 * 首次运行会：创建本地 git 仓库（若无）→ 提交 → 用 token 调用 GitHub API
 * 创建同名远端仓库（若不存在）→ 推送 main 分支。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

/* ------------------------------------------------------------------ 参数 */

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  const next = args[idx + 1];
  // 支持 `--flag value` 与裸 `--flag`
  return next && !next.startsWith('--') ? next : true;
};

const FLAGS = {
  message: getArg('message', null),
  repoName: getArg('repo-name', null),
  owner: getArg('owner', null),
  visibility: getArg('visibility', 'private'),
  branch: getArg('branch', 'main'),
  initOnly: Boolean(getArg('init', false)),
  force: Boolean(getArg('force', false)),
};

/* ------------------------------------------------------------------ Token */

function readDotEnvToken() {
  const file = '.upload.env';
  if (!existsSync(file)) return null;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:GITHUB_TOKEN|GH_TOKEN)\s*=\s*(.+)\s*$/.exec(line);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

const token =
  process.env.GITHUB_TOKEN ||
  process.env.GH_TOKEN ||
  (typeof getArg('token', null) === 'string' && getArg('token', null) !== '' ? getArg('token', null) : null) ||
  readDotEnvToken();

if (!token) {
  console.error(
    [
      '✗ 未找到 GitHub Token。请任选一种方式提供：',
      '  1) 环境变量：  $env:GITHUB_TOKEN="ghp_xxx"',
      '  2) 本地文件：  在项目根目录创建 .upload.env，写入 GITHUB_TOKEN=ghp_xxx',
      '  3) 命令行：    node tools/upload-to-github.mjs --token=ghp_xxx',
      '',
      '  建议使用 Fine-grained PAT，仅勾选目标仓库的 Contents: Read and write 权限。',
    ].join('\n'),
  );
  process.exit(1);
}

/* ------------------------------------------------------------------- git */

function git(...gitArgs) {
  return execFileSync('git', gitArgs, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function gitQuiet(...gitArgs) {
  try {
    return git(...gitArgs);
  } catch {
    return null;
  }
}

try {
  git('--version');
} catch {
  console.error('✗ 未检测到 git，请先安装 Git：https://git-scm.com/downloads');
  process.exit(1);
}

if (!existsSync('.git')) {
  console.log('→ 初始化本地 git 仓库');
  git('init', '-b', FLAGS.branch);
}
git('config', 'user.name', gitQuiet('config', 'user.name') || 'SimpleF2A Bot');
git('config', 'user.email', gitQuiet('config', 'user.email') || 'bot@simplef2a.local');

/* --------------------------------------------------------------- GitHub API */

const API = 'https://api.github.com';

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'simplef2a-uploader',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg = json?.message ?? text.slice(0, 200);
    const err = new Error(`${res.status} ${msg}`);
    err.status = res.status;
    err.json = json;
    throw err;
  }
  return json;
}

const user = await api('/user');
const owner = FLAGS.owner || user.login;
const repoName = FLAGS.repoName || 'SimpleF2A';
console.log(`→ 目标仓库：${owner}/${repoName}（${FLAGS.visibility}）`);

/* 创建远端仓库（已存在则复用） */
let createdRepo = false;
try {
  const existing = await api(`/repos/${owner}/${repoName}`);
  console.log(`→ 远端仓库已存在：${existing.html_url}`);
} catch (err) {
  if (err.status === 404) {
    try {
      const repo = await api('/user/repos', {
        method: 'POST',
        body: JSON.stringify({
          name: repoName,
          description:
            'SimpleF2A · 液态玻璃零服务器 2FA 验证器（TOTP/HOTP/Steam/Yandex/MOTP，AES-256-GCM 本地加密）',
          private: FLAGS.visibility !== 'public',
          has_issues: true,
          has_wiki: false,
          auto_init: false,
        }),
      });
      createdRepo = true;
      console.log(`→ 已创建远端仓库：${repo.html_url}`);
    } catch (createErr) {
      if (createErr.status === 403) {
        console.error(
          '✗ Token 缺少创建仓库的权限。请在 GitHub 上手动创建仓库后重试，',
          '或在 Fine-grained PAT 中开启 Administration: Read and write。',
        );
      }
      throw createErr;
    }
  } else {
    throw err;
  }
}

/* --------------------------------------------------------------- commit */

const remoteUrl = `https://github.com/${owner}/${repoName}.git`;

if (!gitQuiet('remote', 'get-url', 'origin')) {
  git('remote', 'add', 'origin', remoteUrl);
} else {
  git('remote', 'set-url', 'origin', remoteUrl);
}

git('add', '-A');

// 安全检查：确认没有任何凭据文件被加入暂存区
const staged = gitQuiet('diff', '--cached', '--name-only') ?? '';
const forbidden = staged
  .split(/\r?\n/)
  .filter(Boolean)
  .filter(
    (f) =>
      /(^|\/)\.upload\.env$/.test(f) ||
      /(^|\/)\.env(\.|$)/.test(f) ||
      /(^|\/)node_modules\//.test(f) ||
      /(^|\/)dist\//.test(f),
  );
if (forbidden.length > 0) {
  console.error('✗ 暂存区包含不应提交的文件：', forbidden.join(', '));
  console.error('  请检查 .gitignore 后重试。');
  process.exit(1);
}

const message =
  FLAGS.message ||
  `chore: 更新 SimpleF2A (${new Date().toISOString().slice(0, 16).replace('T', ' ')})`;

const hasChanges = Boolean(gitQuiet('diff', '--cached', '--name-only'));
if (hasChanges) {
  git('commit', '-m', message);
  console.log(`→ 已提交：${message}`);
} else {
  console.log('→ 没有新的变更需要提交');
}

if (FLAGS.initOnly) {
  console.log('✓ 仓库与远端已就绪（--init 模式，未推送）');
  process.exit(0);
}

/* ----------------------------------------------------------------- push */

// 使用 token 作为一次性凭据推送，避免写入磁盘的 remote URL
const authUrl = `https://x-access-token:${token}@github.com/${owner}/${repoName}.git`;

if (createdRepo) {
  console.log('→ 推送首次提交');
  git('push', '-u', authUrl, `HEAD:refs/heads/${FLAGS.branch}`);
} else {
  // 远端已有内容时先同步，避免 non-fast-forward
  gitQuiet('fetch', authUrl, FLAGS.branch);
  const remoteHead = gitQuiet('rev-parse', `FETCH_HEAD`);
  if (remoteHead) {
    const merge = gitQuiet('merge', '--no-edit', '--allow-unrelated-histories', 'FETCH_HEAD');
    if (merge === null) {
      if (!FLAGS.force) {
        console.error(
          [
            '✗ 与远端存在冲突，自动合并失败。',
            '  请手动解决冲突后重试，或加 --force 强推（会覆盖远端提交，慎用）。',
          ].join('\n'),
        );
        process.exit(1);
      }
      console.log('→ --force 模式：跳过合并，直接强推');
    }
  }
  const pushArgs = FLAGS.force
    ? ['push', '--force', authUrl, `HEAD:refs/heads/${FLAGS.branch}`]
    : ['push', authUrl, `HEAD:refs/heads/${FLAGS.branch}`];
  git(...pushArgs);
}

console.log('');
console.log(`✓ 已推送到 https://github.com/${owner}/${repoName}`);
if (FLAGS.visibility !== 'public') {
  console.log('  仓库为私有。要公开：仓库 Settings → Danger Zone → Change visibility');
}
