import { useRef, useState } from 'react';
import { useVault } from '../lib/context';
import { Logo } from './Logo';
import { MorphIcon, icons } from './Icons';
import { cx } from '../lib/utils';

interface Props {
  onAdd: () => void;
  onSettings: () => void;
  query: string;
  onQueryChange: (value: string) => void;
}

/**
 * 顶部导航：Tier A/B 玻璃，blur 12px，底部亮边。
 * 图标使用 morphicons：主题按钮在太阳/月亮之间做真实 path morph。
 */
export function TopBar({ onAdd, onSettings, query, onQueryChange }: Props) {
  const { refreshBackground, state, tier, settings, toggleTheme } = useVault();
  const [bgSpin, setBgSpin] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleRefreshBg = () => {
    if (bgSpin) return;
    setBgSpin(true);
    refreshBackground();
    window.setTimeout(() => setBgSpin(false), 900);
  };

  const isLight = settings.theme === 'light';

  return (
    <header
      className={cx(
        'topbar',
        'glass',
        'glass--nav',
        tier === 'a' ? 'glass--refract' : 'glass--css-edge',
      )}
    >
      <div className="topbar__inner">
        <div className="topbar__brand">
          <Logo size={28} />
          <div className="topbar__brand-text">
            <span className="topbar__title">SimpleF2A</span>
            <span className="topbar__subtitle">
              {state.accountCount > 0 ? `${state.accountCount} 个账户 · 本地存储` : '本地验证器'}
            </span>
          </div>
        </div>

        <div className="topbar__search">
          <MorphIcon
            icon={icons.search}
            size={16}
            className="topbar__search-icon"
            reducedMotion="user"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="search"
            className="topbar__search-input"
            placeholder="搜索服务或账户"
            value={query}
            aria-label="搜索账户"
            onChange={(e) => onQueryChange(e.target.value)}
          />
        </div>

        <nav className="topbar__actions" aria-label="主操作">
          <button
            type="button"
            className="icon-button icon-button--glass theme-toggle"
            onClick={toggleTheme}
            aria-label={isLight ? '切换到深色模式' : '切换到浅色模式'}
            title={isLight ? '切换到深色模式 (Ctrl/⌘+Shift+L)' : '切换到浅色模式 (Ctrl/⌘+Shift+L)'}
            aria-pressed={isLight}
          >
            {/* 同一个 MorphIcon：icon prop 变化即触发形变动画 */}
            <MorphIcon
              icon={isLight ? icons.moon : icons.sun}
              size={17}
              spring="bouncy"
              reducedMotion="user"
              aria-hidden="true"
            />
          </button>

          <button
            type="button"
            className="icon-button icon-button--glass"
            onClick={handleRefreshBg}
            aria-label="换个背景"
            title="换个背景"
          >
            <MorphIcon
              icon={icons.background}
              size={17}
              className={cx(bgSpin && 'fade-spin')}
              reducedMotion="user"
              aria-hidden="true"
            />
          </button>

          <button
            type="button"
            className="icon-button icon-button--glass"
            onClick={onSettings}
            aria-label="设置"
            title="设置"
          >
            <MorphIcon
              icon={icons.settings}
              size={17}
              reducedMotion="user"
              aria-hidden="true"
            />
          </button>

          <button type="button" className="primary-button primary-button--compact" onClick={onAdd}>
            <MorphIcon icon={icons.add} size={16} reducedMotion="user" aria-hidden="true" />
            <span className="topbar__add-label">添加账户</span>
          </button>
        </nav>
      </div>
    </header>
  );
}

/** 玻璃装饰：Tier A 下允许折射的胶囊 / 球体，仅作视觉锚点，无交互 */
export function DecorativeOrbs() {
  const { tier } = useVault();
  if (tier === 'c') return null;
  return (
    <div className="decor" aria-hidden="true">
      <div className={cx('decor__orb', 'decor__orb--lg', tier === 'a' && 'glass glass--refract')} />
      <div className={cx('decor__orb', 'decor__orb--sm', tier === 'a' && 'glass glass--refract')} />
      <div className="decor__capsule glass glass--pill" />
    </div>
  );
}
