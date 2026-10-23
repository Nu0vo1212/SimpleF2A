import { useEffect, useRef, type ReactNode } from 'react';
import { MorphIcon, icons } from './Icons';
import { cx } from '../lib/utils';

interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** mobile: 底部抽屉；desktop: 居中模态 */
  variant?: 'modal' | 'drawer';
  size?: 'sm' | 'md' | 'lg';
  /** 危险对话框禁止点击外部关闭 */
  dismissOnBackdrop?: boolean;
}

/**
 * 对话框：桌面居中模态（Tier A 玻璃），移动端底部抽屉（Tier B）。
 * 含焦点陷阱、Esc 关闭、滚动锁定、aria-modal。
 */
export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  variant = 'modal',
  size = 'md',
  dismissOnBackdrop = true,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  /**
   * onClose 保持最新引用，但不作为 effect 依赖。
   * 父组件每次渲染都会传入新的函数，若把它写进依赖数组，
   * effect 会反复清理+重建，导致 focus() 被反复调用、焦点在按钮间乱跳，
   * 输入框永远无法保持焦点（表现为「点一下就闪，打不了字」）。
   */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    restoreFocus.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // 只在面板首次挂载时聚焦一次
    const focusTimer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      // 面板内已有焦点（用户已在输入）时不要抢走
      if (panel.contains(document.activeElement)) return;
      const focusable = panel.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], select, [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    }, 60);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const nodes = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'input:not([type="hidden"]):not([disabled]), button:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      restoreFocus.current?.focus?.();
    };
    // 只依赖 open：onClose 通过 ref 读取，避免每次父组件渲染都重建 effect
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (dismissOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby={description ? 'dialog-desc' : undefined}
        className={cx(
          'dialog',
          variant === 'drawer' ? 'dialog--drawer' : 'dialog--modal',
          `dialog--${size}`,
          'glass',
          variant === 'modal' ? 'glass--refract glass--modal' : 'glass--drawer',
        )}
      >
        <header className="dialog__head">
          <div>
            <h2 className="dialog__title">{title}</h2>
            {description && (
              <p className="dialog__desc" id="dialog-desc">
                {description}
              </p>
            )}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            <MorphIcon icon={icons.close} size={18} reducedMotion="user" aria-hidden="true" />
          </button>
        </header>
        <div className="dialog__body">{children}</div>
        {footer && <footer className="dialog__foot">{footer}</footer>}
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  htmlFor: string;
  children: ReactNode;
  optional?: boolean;
}

export function Field({ label, hint, error, htmlFor, children, optional }: FieldProps) {
  return (
    <div className={cx('field', error && 'field--error')}>
      <label className="field__label" htmlFor={htmlFor}>
        {label}
        {optional && <span className="field__optional">可选</span>}
      </label>
      {children}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="field__hint">{hint}</p>
      ) : null}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="segmented" role="tablist" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          className={cx('segmented__item', value === option.value && 'segmented__item--active')}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}
