import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * 严格 CSP：生产环境由 meta 标签注入（静态托管无需服务端）。
 * - 禁止 unsafe-inline / unsafe-eval 脚本
 * - img-src 仅允许 self / data: / blob: 以及随机图片背景 API 的域名
 * - connect-src 仅允许同源 + 背景图片 API（fetch 探测）
 * - 无 frame-src / worker 外部源
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // 样式全部来自打包产物，禁止内联样式表
  "style-src 'self'",
  // 背景图片 API 会 302 跳转到自己的图片 CDN；服务图标来自第三方 favicon 服务
  'img-src \'self\' data: blob: https://api.mtyqx.cn https://api.img.mtyqx.cn https://api.dujin.org https://www.dmoe.cc https://icons.duckduckgo.com https://www.google.com',
  "font-src 'self' data:",
  "connect-src 'self' https://api.mtyqx.cn https://api.img.mtyqx.cn https://api.dujin.org https://www.dmoe.cc https://icons.duckduckgo.com https://www.google.com",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  // 注意：frame-ancestors 在 <meta> 中无效，静态部署时请用 _headers / vercel.json 等价配置
  "upgrade-insecure-requests",
].join('; ');

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [
    react(),
    {
      name: 'simplef2a-csp',
      transformIndexHtml(html) {
        if (mode !== 'production') return html;
        return html.replace(
          '<head>',
          `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
        );
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // 背景图片来自外部 API，绝不缓存其响应，避免把用户看到的图片写入磁盘
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: 'es2022',
    cssTarget: 'chrome111',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
  },
}));
