# SECURITY.md

SimpleF2A 是一个**纯前端、零服务器**的双因素验证器。

> ⚠️ **重要设计说明**：本应用**不使用主密码，账户数据未加密存储**。这不是疏忽，而是明确的产品取舍——打开即用的便利性优先。
>
> 因此，你的安全边界是**浏览器 profile 本身**，而不是密码学。请在阅读下方威胁模型后再决定是否使用。

---

## 1. 当前安全模型

### 1.1 实际保护（能做到的）

| 保护 | 手段 |
| --- | --- |
| **数据不出本机** | 无后端、无账号系统；secret 与 OTP 的计算与存储全部在浏览器内完成 |
| **无网络回传** | 不存在任何携带 secret / OTP 的请求 |
| **隔离于站点** | 浏览器 IndexedDB 按 origin 隔离，其它网站无法读取你的账户数据 |
| **防 XSS 注入** | 严格 CSP：`script-src 'self'`，无 `unsafe-inline` / `unsafe-eval`；`object-src 'none'`、`base-uri 'none'` |
| **备份可选加密** | 导出的备份可选用 AES-256-GCM + PBKDF2-SHA256（600,000 迭代）加密 |
| **危险操作确认** | 删除账户、导出明文、清空数据均需二次确认，明文导出需手动输入确认词 |
| **导入校验** | 所有导入路径做结构校验 + Base32 校验，无法识别的字段直接跳过 |

### 1.2 明确不保护（必须了解的局限）

| 风险 | 说明 |
| --- | --- |
| **任何能访问该页面的人** | 因为无主密码，**打开应用即可看到全部验证码**。同一台电脑、同一浏览器用户下没有第二道防线。 |
| **共用电脑 / 多人设备** | 极不建议。若必须使用，请用独立的操作系统账户或独立的浏览器 profile。 |
| **操作系统级恶意软件** | 键盘记录器、内存读取工具、浏览器 profile 拷贝都可以直接拿到密钥与验证码。 |
| **恶意浏览器扩展** | 能读 DOM、注入脚本、hook `crypto.subtle` 的扩展可以拿到全部验证码。建议在干净的浏览器 profile 中使用。 |
| **磁盘未加密** | IndexedDB 以明文存放于浏览器 profile 目录。设备丢失且未启用全盘加密时，数据可被离线读取。**建议开启 BitLocker / FileVault。** |
| **供应链攻击** | 若静态托管被攻破或构建产物被替换，攻击者可窃取全部数据。请从可信来源部署，或自行 `npm run build`。 |
| **网络环境可见性** | 背景图片与服务图标来自第三方（见第 3 节），第三方可推断你使用了哪些服务。 |
| **公共电脑上的残留** | 用完不清除站点数据时，数据会留在这台机器上。 |

### 1.3 与「加密 vault」版本的关系

本项目早期版本使用主密码 + PBKDF2 + AES-256-GCM 加密本地 vault。该方案已按需求移除，原因是「打开即用」的体验优先级更高。

如果需要加密存储，有两个选项：

1. **导出密码加密的备份**：设置 → 备份与迁移 → 密码加密的 JSON
2. 自行 Fork 并恢复 `src/vault/` 中的加密层（git 历史可查）

---

## 2. 数据存储细节

### 2.1 IndexedDB

数据库：`simplef2a-accounts`（version 1）

| Object store | 内容 |
| --- | --- |
| `accounts` | `{ id, order, updatedAt, data: <OtpAccount 明文 JSON> }` |
| `meta` | 预留的通用键值 |

存储内容包括：issuer、账户名、secret（Base32）、算法、位数、周期、计数器、PIN（Yandex/MOTP）。

**上述内容均为明文。**

### 2.2 localStorage / sessionStorage

| 存储 | 键 | 内容 | 是否敏感 |
| --- | --- | --- | --- |
| localStorage | `simplef2a:settings` | 主题、背景开关、联网图标开关 | 否 |
| sessionStorage | `simplef2a:bg-url` | 当前背景图 URL | 否 |
| sessionStorage | `simplef2a:favicon-cache` | 已解析的 favicon URL | 否 |
| sessionStorage | `simplef2a:tier` | 玻璃质量降级记忆 | 否 |

**账户数据不会写入 localStorage / sessionStorage / Cookie。**

### 2.3 清除数据

- 应用内：设置 → 备份与迁移 → 清空全部账户
- 浏览器内：站点设置 → 清除数据
- 彻底：删除该 origin 的全部存储

---

## 3. 网络行为

应用**不发送** secret、OTP 到任何服务器。但会从以下第三方发起请求：

**背景图片**（默认开启，设置可关）：

- `https://api.mtyqx.cn/api/random.php`
- `https://api.mtyqx.cn/tapi/random.php`
- `https://api.dujin.org/bing/1366.php`
- `https://www.dmoe.cc/random.php?return=img`

**服务图标 favicon**（默认开启，设置可关）：

- `https://icons.duckduckgo.com/ip3/<domain>.ico`
- `https://www.google.com/s2/favicons?domain=<domain>`

这些请求**不携带账户信息**（无 query 参数、无 Cookie、`referrerpolicy="no-referrer"`），但第三方能看到你的 IP、请求时间，以及**favicon 请求暴露的服务域名**（可能被推断为账户所属服务）。

关闭全部第三方请求：设置 → 外观 → 关闭「使用随机图片背景」与「联网获取服务图标」。内置品牌图标为**内联 SVG**，不产生任何网络请求。

---

## 4. 备份文件

| 模式 | 安全性 | 用途 |
| --- | --- | --- |
| **密码加密 JSON** | 推荐。AES-256-GCM，PBKDF2-SHA256 600k 迭代，随机 16 字节 salt + 12 字节 IV | 长期存档、跨设备迁移 |
| **明文 JSON** | ⚠️ 等同于裸密钥。任何拿到文件的人都能生成你的验证码 | 仅用于导入其它验证器后立即删除 |

备份格式与 Aegis 字段命名对齐（`type` / `uuid` / `issuer` / `name` / `secret` / `algorithm` / `digits` / `period` / `counter`），便于迁移。

---

## 5. 密码学实现（仅用于备份加密）

| 组件 | 实现 |
| --- | --- |
| AES-256-GCM | Web Crypto `crypto.subtle`（原生） |
| PBKDF2-SHA256 | Web Crypto `crypto.subtle.deriveKey`（原生） |
| SHA-1/256/512 HMAC | `otpauth`（基于 Web Crypto） |
| **MD5**（仅 MOTP） | 自实现（`src/otp/engine.ts`），因为 Web Crypto **不提供 MD5**。仅用于生成展示码，不参与任何密钥派生或完整性校验。MOTP 规范强制 MD5。 |

**没有引入任何第三方加密库**。

---

## 6. 安全自检清单

- [x] 无主密码、无登录流程（设计如此，见第 1 节）
- [x] 账户数据不写入 localStorage / sessionStorage / Cookie
- [x] 无网络回传 secret / OTP
- [x] CSP 无 `unsafe-inline` / `unsafe-eval`
- [x] 备份加解密：AES-256-GCM + PBKDF2 600k + 随机 IV/salt + AAD 绑定
- [x] 备份密钥 `extractable: false`（单测断言 `exportKey` 抛错）
- [x] 危险操作（删除 / 明文导出 / 清空）均有二次确认，文案具体
- [x] 明文导出需手动输入确认词
- [x] 单元测试覆盖 GCM 篡改检测、AAD 绑定、错误密码拒绝

---

## 7. 使用建议

1. **只在私人设备上使用**，并开启操作系统账户密码与全盘加密。
2. 使用独立的浏览器 profile，不装来路不明的扩展。
3. **定期导出加密备份**并离线保存——清除浏览器数据会丢失全部账户。
4. 在公用电脑上用完后，务必清除该站点的浏览数据。
5. 通过 HTTPS 部署使用（`crypto.subtle` 在非安全上下文不可用）。

---

## 8. 负责任披露

若发现安全缺陷，请**不要**公开提交 issue，而是通过仓库的私密渠道（或 Security Advisories）联系维护者。请包含复现步骤与环境信息。
