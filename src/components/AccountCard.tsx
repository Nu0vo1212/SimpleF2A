import { useEffect, useRef, useState } from 'react';
import type { OtpAccount } from '../otp/types';
import { useVault } from '../lib/context';
import { copyText, cx, formatCode, OTP_TYPE_LABELS } from '../lib/utils';
import { hotpAt } from '../otp/engine';
import { isTimeBased } from '../otp/engine';
import { ServiceAvatar } from './ServiceAvatar';
import { MorphIcon, icons } from './Icons';

interface Props {
  account: OtpAccount;
  code: string;
  remaining: number;
  period: number;
  index: number;
  onEdit: () => void;
  onExport: () => void;
  onDelete: () => void;
}

const RADIUS = 15;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function AccountCard({
  account,
  code,
  remaining,
  period,
  index,
  onEdit,
  onExport,
  onDelete,
}: Props) {
  const { updateAccount, toast } = useVault();
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const copyTimer = useRef<number | null>(null);

  const showCopied = () => {
    setCopied(true);
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 1400);
  };

  useEffect(() => {
    return () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onClickAway = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClickAway);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickAway);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const handleCopy = async () => {
    if (!code) return;
    const ok = await copyText(code);
    if (ok) {
      showCopied();
      toast(`${account.issuer || account.account} 的验证码已复制`, 'success');
    } else {
      toast('复制失败，请手动选择验证码', 'warning');
    }
  };

  const handleHotpNext = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const next = { ...account, counter: account.counter + 1, updatedAt: Date.now() };
      await updateAccount(next);
      const generated = hotpAt(next, next.counter);
      void copyText(generated.code);
      toast(`已生成并复制第 ${next.counter} 个验证码`, 'success');
    } finally {
      setBusy(false);
    }
  };

  const warn = isTimeBased(account) && remaining <= 5;
  const progress = isTimeBased(account) ? Math.max(0, Math.min(1, remaining / period)) : 1;
  const dashOffset = CIRCUMFERENCE * (1 - progress);
  const typeLabel = OTP_TYPE_LABELS[account.type] ?? account.type;

  return (
    <article
      ref={cardRef}
      className={cx(
        'account-card',
        'glass',
        'glass--interactive',
        'glass--refract',
        copied && 'account-card--copied',
      )}
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
      aria-label={`${account.issuer || '未命名服务'} ${account.account}`}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          void handleCopy();
        }
      }}
    >
      <header className="account-card__head">
        <ServiceAvatar account={account} />
        <div className="account-card__identity">
          <h3 className="account-card__issuer" title={account.issuer}>
            {account.issuer || '未命名服务'}
          </h3>
          <p className="account-card__account" title={account.account}>
            {account.account || '—'}
          </p>
        </div>
        <div className="account-card__menu" ref={menuRef}>
          <button
            type="button"
            className="icon-button"
            aria-label="更多操作"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen((v) => !v);
            }}
          >
            <MorphIcon icon={icons.more} size={18} reducedMotion="user" aria-hidden="true" />
          </button>
          {menuOpen && (
            <div className="menu glass" role="menu">
              <button
                type="button"
                role="menuitem"
                className="menu__item"
                onClick={() => {
                  setMenuOpen(false);
                  onEdit();
                }}
              >
                <MorphIcon icon={icons.edit} size={15} reducedMotion="user" aria-hidden="true" /> 编辑账户
              </button>
              <button
                type="button"
                role="menuitem"
                className="menu__item"
                onClick={() => {
                  setMenuOpen(false);
                  onExport();
                }}
              >
                <MorphIcon icon={icons.download} size={15} reducedMotion="user" aria-hidden="true" /> 导出 URI / 二维码
              </button>
              <button
                type="button"
                role="menuitem"
                className="menu__item menu__item--danger"
                onClick={() => {
                  setMenuOpen(false);
                  onDelete();
                }}
              >
                <MorphIcon icon={icons.trash} size={15} reducedMotion="user" aria-hidden="true" /> 删除账户
              </button>
            </div>
          )}
        </div>
      </header>

      {/* 验证码内层：不透明、无 backdrop-filter、无折射 —— 可读性的物理保障 */}
      <div className="account-card__code-row">
        <div
          className="code-surface account-card__code"
          role="button"
          tabIndex={-1}
          onClick={() => void handleCopy()}
          aria-label={`验证码 ${code.split('').join(' ')}，点击复制`}
        >
          <span className="code-text" aria-live="off">
            {code ? formatCode(code) : '······'}
          </span>
        </div>

        {isTimeBased(account) ? (
          <div
            className={cx('ring', warn && 'ring--warn')}
            role="img"
            aria-label={`剩余 ${remaining} 秒，共 ${period} 秒`}
          >
            <svg viewBox="0 0 36 36" width="40" height="40" aria-hidden="true">
              <circle className="ring__track" cx="18" cy="18" r={RADIUS} />
              <circle
                className="ring__progress"
                cx="18"
                cy="18"
                r={RADIUS}
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={dashOffset}
              />
            </svg>
            <span className="ring__label" aria-hidden="true">
              {remaining}
            </span>
          </div>
        ) : (
          <span className="account-card__counter" aria-label={`当前计数器 ${account.counter}`}>
            #{account.counter}
          </span>
        )}
      </div>

      <footer className="account-card__foot">
        <span className="badge">{typeLabel}</span>
        {account.type === 'hotp' ? (
          <button
            type="button"
            className="ghost-button ghost-button--accent"
            onClick={handleHotpNext}
            disabled={busy}
          >
            <MorphIcon icon={icons.refresh} size={14} reducedMotion="user" aria-hidden="true" />
            {busy ? '生成中…' : '生成下一个'}
          </button>
        ) : (
          <span className="account-card__hint" aria-hidden="true">
            点击验证码即可复制
          </span>
        )}
        <button
          type="button"
          className={cx('copy-button', copied && 'copy-button--done')}
          onClick={(event) => {
            event.stopPropagation();
            void handleCopy();
          }}
          aria-label={copied ? '已复制' : '复制验证码'}
        >
          {/* 复制 → 对勾：morphicons 在两条路径之间做 spring 形变 */}
          <MorphIcon
            icon={copied ? icons.check : icons.copy}
            size={15}
            spring="bouncy"
            reducedMotion="user"
            aria-hidden="true"
          />
          <span>{copied ? '已复制' : '复制'}</span>
        </button>
      </footer>
    </article>
  );
}
