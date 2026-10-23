import { useEffect, useRef, useState } from 'react';
import { Plus, Lock, Search, Image as ImageIcon, Settings2, Check } from 'lucide-react';
import { useVault } from '../lib/context';
import { Logo } from './Logo';
import { cx } from '../lib/utils';

interface Props {
  onAdd: () => void;
  onSettings: () => void;
  query: string;
  onQueryChange: (value: string) => void;
}

/** 顶部导航：Tier A/B 玻璃，blur 12px，底部亮边 */
export function TopBar({ onAdd, onSettings, query, onQueryChange }: Props) {
  const { lock, refreshBackground, state, tier } = useVault();
  const [searchOpen, setSearchOpen] = useState(false);
  const [bgSpin, setBgSpin] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  const handleRefreshBg = () => {
    if (bgSpin) return;
    setBgSpin(true);
    refreshBackground();
    window.setTimeout(() => setBgSpin(false), 900);
  };

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
              {state.accountCount > 0 ? `${state.accountCount} 个账户 · 本地加密` : '本地加密验证器'}
            </span>
          </div>
        </div>

        <div className={cx('topbar__search', searchOpen && 'topbar__search--open')}>
          <Search size={16} aria-hidden="true" className="topbar__search-icon" />
          <input
            ref={inputRef}
            type="search"
            className="topbar__search-input"
            placeholder="搜索服务或账户"
            value={query}
            aria-label="搜索账户"
            onChange={(e) => onQueryChange(e.target.value)}
            onBlur={() => {
              if (!query) setSearchOpen(false);
            }}
          />
        </div>

        <nav className="topbar__actions" aria-label="主操作">
          <button
            type="button"
            className="icon-button icon-button--glass"
            onClick={handleRefreshBg}
            aria-label="换个背景"
            title="换个背景"
          >
            <ImageIcon size={17} className={cx(bgSpin && 'fade-spin')} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button icon-button--glass"
            onClick={onSettings}
            aria-label="设置"
            title="设置"
          >
            <Settings2 size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button icon-button--glass"
            onClick={lock}
            aria-label="锁定保险库"
            title="锁定 (Ctrl/⌘ + L)"
          >
            <Lock size={17} aria-hidden="true" />
          </button>
          <button type="button" className="primary-button primary-button--compact" onClick={onAdd}>
            <Plus size={16} aria-hidden="true" />
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

export function InlineCheck() {
  return <Check size={14} aria-hidden="true" />;
}
