import { CheckCircle2, AlertTriangle, Info, XCircle, X } from 'lucide-react';
import { useVault } from '../lib/context';

/** Toast 容器：右下角（移动端底部），滑入动画，aria-live 播报 */
export function ToastHost() {
  const { toasts, dismissToast } = useVault();

  const iconFor = (kind: string) => {
    switch (kind) {
      case 'success':
        return <CheckCircle2 size={18} aria-hidden="true" />;
      case 'warning':
        return <AlertTriangle size={18} aria-hidden="true" />;
      case 'danger':
        return <XCircle size={18} aria-hidden="true" />;
      default:
        return <Info size={18} aria-hidden="true" />;
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
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
