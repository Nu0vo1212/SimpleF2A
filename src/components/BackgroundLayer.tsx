import { useEffect, useRef, useState } from 'react';
import { useVault } from '../lib/context';
import { preloadImage } from '../lib/background';

/**
 * 背景层（fixed，独立于主文档流）。
 *
 * 层次：基底渐变 → 随机图片（1s 淡入）→ 暗色遮罩 → 光斑 → 细线纹理 → 渐隐
 * 动画只作用于光斑的 transform；图片本身完全静态，避免大图重绘。
 */
export function BackgroundLayer() {
  const { backgroundUrl, backgroundReady, settings } = useVault();
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [canAnimate, setCanAnimate] = useState(false);
  const rafRef = useRef<number | null>(null);

  // 二次预加载，保证淡入前资源已在缓存中（避免半张图淡入）
  useEffect(() => {
    if (!backgroundUrl || !backgroundReady) {
      setLoadedUrl(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        await preloadImage(backgroundUrl, 8000);
        if (!cancelled) setLoadedUrl(backgroundUrl);
      } catch {
        if (!cancelled) setLoadedUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backgroundUrl, backgroundReady]);

  // 光斑动画延迟启动：等首帧稳定后再开启，避免首屏掉帧
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    rafRef.current = window.requestAnimationFrame(() => setCanAnimate(true));
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const showImage = settings.backgroundImage && !!loadedUrl;

  return (
    <div className="bg-root" data-animate={canAnimate} data-mode={showImage ? 'image' : 'fallback'}>
      {showImage && (
        <img
          className="bg-image bg-image--loaded"
          src={loadedUrl ?? undefined}
          alt=""
          aria-hidden="true"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
        />
      )}
      <div className="bg-overlay" />
      <div className="bg-spots">
        <div className="bg-spot bg-spot--indigo" />
        <div className="bg-spot bg-spot--teal" />
        <div className="bg-spot bg-spot--amber" />
      </div>
      <div className="bg-lines" />
      <div className="bg-vignette" />
    </div>
  );
}
