import { MorphIcon, icons } from './Icons';
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
          <MorphIcon icon={icons.shield} size={34} reducedMotion="user" aria-hidden="true" />
        </div>
        <div className="empty-state__ring empty-state__ring--1" />
        <div className="empty-state__ring empty-state__ring--2" />
        <div className="empty-state__ring empty-state__ring--3" />
      </div>

      <h2 className="empty-state__title">还没有任何账户</h2>
      <p className="empty-state__text">
        添加第一个 2FA 账户，验证码将在本设备离线生成。
        <br />
        账户数据只保存在这台设备的浏览器中，不会上传到任何服务器。
      </p>

      <button type="button" className="primary-button primary-button--lg" onClick={onAdd}>
        <MorphIcon icon={icons.add} size={18} reducedMotion="user" aria-hidden="true" /> 添加第一个账户
      </button>

      <ul className="empty-state__ways">
        <li>
          <MorphIcon icon={icons.qr} size={16} reducedMotion="user" aria-hidden="true" /> 扫描二维码
        </li>
        <li>
          <MorphIcon icon={icons.keyboard} size={16} reducedMotion="user" aria-hidden="true" /> 手动输入密钥
        </li>
        <li>
          <MorphIcon icon={icons.shield} size={16} reducedMotion="user" aria-hidden="true" /> 导入迁移备份
        </li>
      </ul>
    </div>
  );
}
