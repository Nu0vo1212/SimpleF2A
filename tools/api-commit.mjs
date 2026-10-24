/**
 * 通过 GitHub REST API 提交文件（git push 被网络中断时的备用方案）。
 *
 * 用法：node tools/api-commit.mjs "<commit message>" <file1> [file2] ...
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const message = process.argv[2];
const files = process.argv.slice(3);

if (!message || files.length === 0) {
  console.error('用法: node tools/api-commit.mjs "<message>" <file...>');
  process.exit(1);
}

const token =
  process.env.GITHUB_TOKEN ||
  (() => {
    if (!existsSync('.upload.env')) return null;
    const m = /GITHUB_TOKEN\s*=\s*(.+)/.exec(readFileSync('.upload.env', 'utf8'));
    return m ? m[1].trim() : null;
  })();

if (!token) {
  console.error('缺少 GITHUB_TOKEN');
  process.exit(1);
}

const OWNER = 'Nu0vo1212';
const REPO = 'SimpleF2A';
const BRANCH = 'main';
const API = 'https://api.github.com';

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'simplef2a-api-commit',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    throw new Error(`${res.status} ${json?.message ?? text.slice(0, 200)}`);
  }
  return json;
}

// 1. 取当前分支 HEAD
const ref = await api(`/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
const headSha = ref.object.sha;
console.log('远端 HEAD:', headSha.slice(0, 7));

// 2. 取该 commit 的树
const headCommit = await api(`/repos/${OWNER}/${REPO}/git/commits/${headSha}`);
const baseTreeSha = headCommit.tree.sha;

// 3. 逐文件创建 blob
const treeItems = [];
for (const file of files) {
  if (!existsSync(file)) {
    console.error('✗ 文件不存在:', file);
    process.exit(1);
  }
  // 读取为新提交后的内容（若工作区有未提交改动，以工作区为准）
  const content = readFileSync(file);
  const isBinary = /\.(png|jpg|jpeg|ico|woff2?)$/i.test(file);
  const blob = await api(`/repos/${OWNER}/${REPO}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify(
      isBinary
        ? { content: content.toString('base64'), encoding: 'base64' }
        : { content: content.toString('utf8'), encoding: 'utf-8' },
    ),
  });
  treeItems.push({ path: file.replace(/\\/g, '/'), mode: '100644', type: 'blob', sha: blob.sha });
  console.log('  blob:', file, blob.sha.slice(0, 7));
}

// 4. 创建新树
const newTree = await api(`/repos/${OWNER}/${REPO}/git/trees`, {
  method: 'POST',
  body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
});

// 5. 创建 commit
const newCommit = await api(`/repos/${OWNER}/${REPO}/git/commits`, {
  method: 'POST',
  body: JSON.stringify({
    message,
    tree: newTree.sha,
    parents: [headSha],
  }),
});
console.log('新 commit:', newCommit.sha.slice(0, 7));

// 6. 更新分支引用
await api(`/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
  method: 'PATCH',
  body: JSON.stringify({ sha: newCommit.sha, force: false }),
});

// 7. 让本地 git 与远端对齐（避免后续 push 冲突）
try {
  execFileSync('git', ['reset', '--soft', newCommit.sha], { stdio: 'ignore' });
  console.log('本地已对齐到远端 commit');
} catch {
  /* 忽略 */
}

console.log('\n✓ 已通过 API 提交并推送:', `https://github.com/${OWNER}/${REPO}`);
