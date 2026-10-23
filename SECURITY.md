# SECURITY.md

SimpleF2A 是一个**纯前端、零服务器**的双因素验证器。这份文档说明它的威胁模型、已实现的安全措施，以及**它无法防御的攻击**。

> 一句话总结：你的密钥只在这台设备的浏览器内存中存在，落盘时全部是 AES-256-GCM 密文；但主密码强度、浏览器本身与设备的安全性，决定了这套机制的上限。

---

## 1. 威胁模型

### 1.1 设计目标（我们承诺防御的）

| 威胁 | 防御手段 |
| --- | --- |
| **静态存储泄露**（未加密的 secret 被拷走） | 所有 OTP 记录整体 AES-256-GCM 加密后写入 IndexedDB；数据库里没有任何明文 secret |
| **主密码泄露给服务器** | 没有任何服务器。应用不发起携带密钥的请求，主密码只存在于内存变量中，从不上传、不落盘 |
| **驻留式凭证**（重启浏览器后仍可解密） | 主密码**永不存储**；派生出的 `CryptoKey` 仅存内存，页面刷新或点「锁定」即失效 |
| **离线暴力破解主密码** | PBKDF2-SHA256，**600,000 次迭代**（OWASP 推荐下限），每次 vault 使用独立随机 16 字节 salt |
| **密文被篡改 / 在不同记录间搬移** | GCM 认证标签 + 每条记录的 **AAD 绑定记录 id**，搬移密文会导致解密失败 |
| **密钥被导出 dump** | `CryptoKey.extractable = false`，`crypto.subtle.exportKey()` 直接抛错 |
| **XSS 注入内联脚本** | 严格 CSP：`script-src 'self'`，**无 `unsafe-inline` / `unsafe-eval`**；`object-src 'none'`、`base-uri 'none'` |
| **旁路时序攻击**（本地比较） | 敏感字符串比较用常数时间实现（`timingSafeEqual`） |
| **明文备份事故** | 明文导出必须通过危险确认框并**手动输入「导出明文」**才能执行；默认推荐密码加密备份 |
| **导入恶意备份** | 所有导入路径做结构校验 + Base32 校验，无法识别的字段直接跳过；`protobuf` 解析器带边界检查 |

### 1.2 明确不防御的（已知局限）

| 风险 | 说明 |
| --- | --- |
| **恶意浏览器扩展** | 能读 DOM、注入脚本、hook `crypto.subtle` 的扩展可以拿到解密后的验证码，甚至在解锁时窃取主密码。**这是本方案最大的结构性局限**——任何浏览器内运行的验证器都无法规避。建议在专用浏览器配置文件中使用本应用，并只安装可信扩展。 |
| **恶意 bookmarked script / 供应链攻击** | 若静态托管被攻破、构建产物被替换，攻击者可以窃取主密码。请从可信来源部署，或自行 `npm run build` 后部署自己的产物。 |
| **弱主密码** | vault 的安全性完全取决于主密码强度。PBKDF2 600k 迭代把单次尝试成本抬高了约 4 个数量级，但弱口令仍会被字典攻击击穿。**请使用 ≥ 12 位的长随机短语**。 |
| **已解锁时的物理访问** | vault 解锁期间，能操作该设备的攻击者可直接读取验证码。应用在页面隐藏（`visibilitychange`）时会自动锁定（默认开启，可在设置中关闭），并按 `Ctrl/⌘ + L` 可手动锁定。 |
| **浏览器内存取证 / 崩溃转储** | 解密后的 plaintext 在内存中存在，操作系统可能将其写入 swap 或崩溃转储。HTTPS 之外的场景无法防御。 |
| **网络层被动监听** | 应用本身不传输密钥；但**背景图片与服务图标来自外部 API**（见下节），因此页面并非零网络请求。favicon 请求还会向第三方暴露你使用了哪些服务。 |
| **favicon 投毒** | 若第三方图标服务被攻破，可能返回恶意构造的图片。图标以 `<img>` 渲染，会在**独立上下文中加载**，无法执行脚本；但仍可能用于像素级追踪。可在设置中关闭联网图标。 |
| **服务端验证码重放** | 这是 OTP 协议本身的性质，与客户端无关。 |
| **恶意 QR 码内容** | 二维码内容只会在本地解析为 OTP 账户配置，不会被执行。但如果用户自行粘贴一份伪造的 `otpauth://`（攻击者已知 secret），攻击者可生成相同的验证码。请始终从服务方的官方渠道获取密钥。 |

---

## 2. 已实现的安全措施（代码级说明）

### 2.1 密钥派生

```ts
// src/vault/crypto.ts
PBKDF2-SHA256 · 600,000 iterations · 16-byte random salt · 256-bit AES key
CryptoKey.extractable = false
```

- 每个 vault 拥有独立 salt，salt 明文随 vault 元数据存储（salt 本身不是秘密）。
- 迭代次数写入 vault 头，未来可平滑升级。
- 派生后立即丢弃中间 `baseKey`（`importKey` 时 `extractable: false`）。

### 2.2 加密与完整性

```ts
AES-256-GCM · 96-bit 随机 IV/次 · 128-bit auth tag
AAD = "simplef2a:v1:" + context
```

- 每条记录的 context 为 `account:<id>`，vault 校验块为 `vault-verifier`，备份为 `backup`。
- 因此密文**无法**在记录之间搬移，也无法把备份密文伪装成账户记录。
- 每次加密都生成新的随机 IV（12 字节），GCM 下同一密钥重复使用 IV 是致命的，此处已严格避免。

### 2.3 存储

- IndexedDB（`idb`）中只保存：`{ kdf: { iterations, salt }, verifier: { iv, ciphertext } }` 与每条记录 `{ id, order, iv, ciphertext }`。
- `localStorage` **只**保存与安全无关的界面偏好（主题、自动锁定开关、背景图开关）。
- `sessionStorage` **只**保存当前背景图 URL 与性能分级记忆。
- 主密码、secret、派生密钥**不写入**任何存储介质。
- 单条记录解密失败时不会拖垮整个 vault（跳过并告警），避免一条损坏导致全量不可用。

### 2.4 内存卫生

- 主密码只以参数形式传入派生函数，派生完成后**立即** `setPassword('')` 从组件状态清除。
- 「锁定」会同时：丢弃 `CryptoKey` 引用、清空内存中的账户数组、通知 UI 回到解锁页。
- `visibilitychange → hidden` 时自动锁定（默认开启）。
- 验证码不做跨会话缓存；HOTP 计数器变更会立即重新加密写回。

### 2.5 CSP

生产构建通过 `<meta http-equiv="Content-Security-Policy">` 注入（见 `vite.config.ts`）：

```
default-src 'self';
script-src 'self';
style-src 'self';
img-src 'self' data: blob: https://api.mtyqx.cn https://api.img.mtyqx.cn https://api.dujin.org https://www.dmoe.cc;
font-src 'self' data:;
connect-src 'self' <同上图片域名>;
manifest-src 'self';
worker-src 'self' blob:;
object-src 'none';
base-uri 'none';
form-action 'none';
upgrade-insecure-requests
```

**注意**：`frame-ancestors` 无法通过 `<meta>` 生效。若需完整的 anti-framing 防护，请使用 `public/_headers`（Cloudflare Pages / Netlify）或 `vercel.json` 中的响应头（两个文件都已随仓库提供）。

### 2.6 网络行为（重要）

应用**不发送** secret、OTP 或主密码到任何服务器。但为了视觉效果与图标体验，它会从以下**第三方**发起请求：

**背景图片**（默认开启）：

- `https://api.mtyqx.cn/api/random.php`
- `https://api.mtyqx.cn/tapi/random.php`
- `https://api.dujin.org/bing/1366.php`
- `https://www.dmoe.cc/random.php?return=img`

**服务图标 favicon**（默认开启，可在设置中关闭）：

- `https://icons.duckduckgo.com/ip3/<domain>.ico`
- `https://www.google.com/s2/favicons?domain=<domain>`

这些请求**不携带任何用户数据**（无 query 参数携带账户信息、无 Cookie、图片以 `<img referrerpolicy="no-referrer">` 加载），但第三方仍能看到你的 IP、请求时间，以及**你拥有哪些服务的账户**（favicon 请求会暴露服务域名，可能被推断为账户所属的服务）。

若你不接受这一点：
- 设置 → 外观 → 关闭「联网获取服务图标」：只使用内置品牌图标（GitHub/Steam/Claude 等）与首字母头像，**零图标请求**
- 设置 → 外观 → 关闭「使用随机图片背景」：只保留渐变与光斑

内置品牌图标全部为**内联 SVG**，不产生任何网络请求。

---

## 3. 密码学实现说明

| 组件 | 实现 |
| --- | --- |
| AES-256-GCM | Web Crypto `crypto.subtle`（原生） |
| PBKDF2-SHA256 | Web Crypto `crypto.subtle.deriveKey`（原生） |
| SHA-1/256/512 HMAC | `otpauth`（基于 Web Crypto）+ Web Crypto 直接调用 |
| **MD5**（仅 MOTP） | 自实现（`src/otp/engine.ts`），因为 Web Crypto **不提供 MD5**。这是唯一自实现的哈希，仅用于生成展示码，**不参与任何密钥派生或完整性校验**。MD5 本身已知碰撞不安全，但 MOTP 规范强制使用它，且此处仅作 OTP 计算的单向压缩函数，不承担抗碰撞安全职责。 |

**没有引入任何第三方加密库**（无 crypto-js、无 libsodium、无 forge）。

---

## 4. 安全自检清单

- [x] 主密码不写入 IndexedDB / localStorage / sessionStorage / Cookie
- [x] PBKDF2-SHA256 ≥ 600,000 迭代，每次随机 16 字节 salt
- [x] AES-256-GCM，每条记录随机 12 字节 IV，AAD 绑定记录 id
- [x] `CryptoKey.extractable === false`（有单测断言 `exportKey` 抛错）
- [x] 锁定清空内存明文；`visibilitychange` 自动锁定
- [x] CSP 无 `unsafe-inline` / `unsafe-eval`
- [x] 无网络回传密钥（代码中无任何含 secret 的 fetch/XHR）
- [x] 危险操作（删除 / 明文导出 / 重置）均有二次确认，且文案具体
- [x] 明文导出需手动输入确认词
- [x] 单元测试覆盖 GCM 篡改检测、AAD 绑定、错误密码拒绝

---

## 5. 负责任披露

若发现安全缺陷，请**不要**公开提交 issue，而是通过仓库的私密渠道（或 Security Advisories）联系维护者。请包含复现步骤与环境信息。我们会尽快评估并修复。

---

## 6. 使用建议

1. 使用 **16 位以上**的随机主密码（推荐 4–6 个随机单词组成的短语）。
2. 始终**同时导出一份加密备份**并离线保存；忘记主密码 = 永久失去账户访问权，没有找回机制。
3. 在专用浏览器配置文件中使用，避免安装来路不明的扩展。
4. 从 HTTPS 部署使用（`crypto.subtle` 在非安全上下文不可用）。
5. 公共电脑上使用后请关闭标签页（不要仅「锁定」后离开）。
