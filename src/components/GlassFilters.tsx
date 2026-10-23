import { useEffect, useRef, useState } from 'react';

/**
 * 液态玻璃的边缘折射滤镜（Tier A 专用）。
 *
 * 工作原理：
 *  feTurbulence 生成低频噪声 → 轻微模糊成平滑位移场 →
 *  feDisplacementMap 用该场对 backdrop 采样做像素级偏折。
 *  CSS 侧再用 radial-gradient mask 把位移限制在边缘，
 *  中心区域完全不动，保证验证码与文字不被重采样。
 *
 * 注意：SVG 展示属性（baseFrequency / numOctaves / scale）不接受 var()，
 * 因此这里把设计 Token 读出来以数值写入属性 —— Token 仍是唯一真源。
 */
const FILTER_DEFS = [
  { id: 'liquid-glass-edge', scaleVar: '--glass-refraction-scale' },
  { id: 'liquid-glass-edge-nav', scaleVar: '--glass-refraction-scale-nav' },
] as const;

interface FilterParams {
  baseFrequency: number;
  numOctaves: number;
  scales: Record<string, number>;
}

function readParams(): FilterParams {
  const styles = getComputedStyle(document.documentElement);
  const base = Number.parseFloat(styles.getPropertyValue('--glass-refraction-base-frequency')) || 0.012;
  const octaves = Number.parseInt(styles.getPropertyValue('--glass-refraction-octaves'), 10) || 2;
  const scales: Record<string, number> = {};
  for (const def of FILTER_DEFS) {
    scales[def.id] = Number.parseFloat(styles.getPropertyValue(def.scaleVar)) || 12;
  }
  return { baseFrequency: base, numOctaves: octaves, scales };
}

export function GlassFilters() {
  const [params, setParams] = useState<FilterParams>({ baseFrequency: 0.012, numOctaves: 2, scales: {} });
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    // 首帧后再读计算样式，确保 CSS 已应用
    const raf = requestAnimationFrame(() => setParams(readParams()));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="0"
      height="0"
      style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
    >
      <defs>
        {FILTER_DEFS.map((def) => {
          const scale = params.scales[def.id] ?? 12;
          return (
            <filter
              key={def.id}
              id={def.id}
              x="-25%"
              y="-25%"
              width="150%"
              height="150%"
              colorInterpolationFilters="sRGB"
            >
              <feTurbulence
                type="fractalNoise"
                baseFrequency={params.baseFrequency}
                numOctaves={params.numOctaves}
                seed={7}
                result="noise"
              />
              {/* 平滑位移场：stdDeviation 越大，折射越连续、越像液体 */}
              <feGaussianBlur in="noise" stdDeviation={1.6} result="softNoise" />
              <feDisplacementMap
                in="SourceGraphic"
                in2="softNoise"
                scale={scale}
                xChannelSelector="R"
                yChannelSelector="G"
                result="displaced"
              />
              {/* 轻微色散：RGB 通道分离 ~0.4px，模拟玻璃边缘的色彩偏移 */}
              <feColorMatrix
                in="displaced"
                type="matrix"
                values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
                result="chanR"
              />
              <feOffset in="chanR" dx={0.6} dy={0} result="chanR2" />
              <feColorMatrix
                in="displaced"
                type="matrix"
                values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
                result="chanG"
              />
              <feColorMatrix
                in="displaced"
                type="matrix"
                values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
                result="chanB"
              />
              <feOffset in="chanB" dx={-0.6} dy={0} result="chanB2" />
              <feBlend in="chanR2" in2="chanG" mode="screen" result="rg" />
              <feBlend in="rg" in2="chanB2" mode="screen" />
            </filter>
          );
        })}
      </defs>
    </svg>
  );
}
