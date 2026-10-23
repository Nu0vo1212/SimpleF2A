import { useState, useEffect } from 'react';
import { useVault } from '../lib/context';
import { validateMasterPassword } from '../vault/vault';
import { Logo } from './Logo';
import { Eye, EyeOff, Lock, ShieldCheck, Loader2, Plus } from 'lucide-react';

type Mode = 'unlock' | 'create';

/**
 * 解锁页 / 首次设置主密码。
 *
 * 玻璃材质用 Tier B（安全场景不追求强折射），输入框内部为不透明深色底，
 * 绝不对输入框本身做 backdrop-filter。
 */
export function LockScreen({ mode }: { mode: Mode }) {
  const { unlock, createVault, state, toast } = useVault();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maskedCount, setMaskedCount] = useState(state.accountCount);

  useEffect(() => {
    setMaskedCount(state.accountCount);
  }, [state.accountCount]);

  const isCreate = mode === 'create';

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);

    if (isCreate) {
      const strengthError = validateMasterPassword(password);
      if (strengthError) {
        setError(strengthError);
        return;
      }
      if (password !== confirm) {
        setError('两次输入的主密码不一致');
        return;
      }
    } else if (!password) {
      setError('请输入主密码');
      return;
    }

    setBusy(true);
    try {
      if (isCreate) {
        await createVault(password);
        toast('已创建加密 vault，请牢记主密码', 'success');
      } else {
        await unlock(password);
        toast('已解锁', 'success');
      }
      // 立刻清除输入中的密码
      setPassword('');
      setConfirm('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="lock-screen">
      <section className="lock-card glass" aria-labelledby="lock-title">
        <div className="lock-card__brand">
          <Logo size={44} />
        </div>

        <h1 className="lock-card__title" id="lock-title">
          {isCreate ? '创建你的加密保险库' : '解锁 SimpleF2A'}
        </h1>
        <p className="lock-card__subtitle">
          {isCreate
            ? '设置一个主密码。它不会离开这台设备，也不会上传到任何服务器。'
            : maskedCount > 0
              ? `输入主密码以解密 ${maskedCount} 个账户的验证码。`
              : '输入主密码以解密本地账户。'}
        </p>

        <form onSubmit={handleSubmit} className="lock-form" noValidate>
          <div className="input-wrap">
            <label htmlFor="master-password" className="sr-only">
              主密码
            </label>
            <Lock size={16} className="input-icon" aria-hidden="true" />
            <input
              id="master-password"
              className="text-input text-input--with-icon text-input--with-action"
              type={show ? 'text' : 'password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
              placeholder="主密码"
              autoComplete={isCreate ? 'new-password' : 'current-password'}
              autoFocus
              aria-invalid={!!error}
              aria-describedby={error ? 'lock-error' : 'lock-privacy'}
              disabled={busy}
            />
            <button
              type="button"
              className="input-action"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? '隐藏密码' : '显示密码'}
              tabIndex={-1}
            >
              {show ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
            </button>
          </div>

          {isCreate && (
            <div className="input-wrap">
              <label htmlFor="master-password-confirm" className="sr-only">
                再次输入主密码
              </label>
              <ShieldCheck size={16} className="input-icon" aria-hidden="true" />
              <input
                id="master-password-confirm"
                className="text-input text-input--with-icon"
                type={show ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value);
                  setError(null);
                }}
                placeholder="再次输入主密码"
                autoComplete="new-password"
                disabled={busy}
              />
            </div>
          )}

          {isCreate && <PasswordMeter password={password} />}

          {error && (
            <p className="form-error" id="lock-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="primary-button primary-button--block" disabled={busy}>
            {busy ? (
              <>
                <Loader2 size={16} className="spin" aria-hidden="true" />
                {isCreate ? '正在加密（PBKDF2 600k 迭代）…' : '正在解密…'}
              </>
            ) : isCreate ? (
              <>
                <Plus size={16} aria-hidden="true" /> 创建保险库
              </>
            ) : (
              <>
                <Lock size={16} aria-hidden="true" /> 解锁
              </>
            )}
          </button>
        </form>

        <p className="lock-card__privacy" id="lock-privacy">
          <ShieldCheck size={14} aria-hidden="true" />
          主密码不会离开本设备 · AES-256-GCM 本地加密 · 无服务器
        </p>
        {isCreate && (
          <p className="lock-card__warning">
            主密码无法找回。忘记它将永久失去所有账户的访问权限。
          </p>
        )}
      </section>
    </main>
  );
}

function PasswordMeter({ password }: { password: string }) {
  const score = (() => {
    if (!password) return 0;
    let s = 0;
    if (password.length >= 8) s++;
    if (password.length >= 14) s++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) s++;
    if (/\d/.test(password)) s++;
    if (/[^A-Za-z0-9]/.test(password)) s++;
    return Math.min(s, 4);
  })();

  const labels = ['太短', '偏弱', '一般', '较好', '很强'];

  return (
    <div className="password-meter" aria-hidden="true">
      <div className="password-meter__bars">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`password-meter__bar ${i < score ? `password-meter__bar--${score}` : ''}`}
          />
        ))}
      </div>
      <span className="password-meter__label">{labels[score]}</span>
    </div>
  );
}
