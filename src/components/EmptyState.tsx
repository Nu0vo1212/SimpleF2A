import { Plus, ShieldCheck, QrCode, Keyboard } from 'lucide-react';
import { useVault } from '../lib/context';

/**
 * 空状态：几何插画 + 液态玻璃球体作为视觉锚点（纯装饰，不承载交互）。
 */
export function EmptyState({ onAdd }: { onAdd: () => void }) {
  const { tier } = useVault();
  return (
    <div className="empty-state">
      <div className="empty-state__art" aria-hidden="true">
        <div className={`empty-state__orb ${tier !== 'c' ? 'glass glass--refract' : 'glass'}`}>
          <ShieldCheck size={34} />
        </div>
        <div className="empty-state__ring empty-state__ring--1" />
        <div className="empty-state__ring empty-state__ring--2" />
        <div className="empty-state__ring empty-state__ring--3" />
      </div>

      <h2 className="empty-state__title">还没有任何账户</h2>
      <p className="empty-state__text">
        添加第一个 2FA 账户，验证码将在本设备离线生成。
        <br />
        密钥使用 AES-256-GCM 加密后只保存在这台设备的浏览器中。
      </p>

      <button type="button" className="primary-button primary-button--lg" onClick={onAdd}>
        <Plus size={18} aria-hidden="true" /> 添加第一个账户
      </button>

      <ul className="empty-state__ways">
        <li>
          <QrCode size={16} aria-hidden="true" /> 扫描二维码
        </li>
        <li>
          <Keyboard size={16} aria-hidden="true" /> 手动输入密钥
        </li>
        <li>
          <ShieldCheck size={16} aria-hidden="true" /> 导入迁移备份
        </li>
      </ul>
    </div>
  );
}
