import { MorphIcon, icons } from './Icons';
import { useVault } from '../lib/context';

/** Toast 容器：右下角（移动端底部），滑入动画，aria-live 播报 */
export function ToastHost() {
  const { toasts, dismissToast } = useVault();

  const iconFor = (kind: string) => {
    switch (kind) {
      case 'success':
        return <MorphIcon icon={icons.shield} size={18} reducedMotion="user" aria-hidden="true" />;
      case 'warning':
        return <MorphIcon icon={icons.warning} size={18} reducedMotion="user" aria-hidden="true" />;
      case 'danger':
        return <MorphIcon icon={icons.close} size={18} reducedMotion="user" aria-hidden="true" />;
      default:
        return <MorphIcon icon={icons.sparkles} size={18} reducedMotion="user" aria-hidden="true" />;
    }
  };

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast glass glass--pill toast--${t.kind}`}>
          <span className="toast__icon">{iconFor(t.kind)}</span>
          <span className="toast__text">{t.message}</span>
          <button
            type="button"
            className="toast__close"
            onClick={() => dismissToast(t.id)}
            aria-label="关闭提示"
          >
            <MorphIcon icon={icons.close} size={14} reducedMotion="user" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
