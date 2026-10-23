import { useState } from 'react';
import { MorphIcon, icons } from './Icons';
import { Dialog } from './Dialog';
import { useVault } from '../lib/context';

/** 危险操作确认：按钮文案具体，禁止只写「确定」。 */
export function DangerConfirm({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
  requireTyping,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
  /** 需要输入指定词才能确认 */
  requireTyping?: string;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  const canConfirm = requireTyping ? typed.trim() === requireTyping : true;

  const run = async () => {
    if (!canConfirm || busy) return;
    setBusy(true);
    try {
      await onConfirm();
      setTyped('');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={title}
      onClose={() => {
        setTyped('');
        onClose();
      }}
      size="sm"
      dismissOnBackdrop={false}
      footer={
        <>
          <button type="button" className="ghost-button" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className="danger-button"
            onClick={() => void run()}
            disabled={!canConfirm || busy}
          >
            {busy ? <MorphIcon icon={icons.loader} size={15} className="spin" reducedMotion="user" aria-hidden="true" /> : <MorphIcon icon={icons.trash} size={15} reducedMotion="user" aria-hidden="true" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="danger-body">
        <span className="danger-icon" aria-hidden="true">
          <MorphIcon icon={icons.warning} size={20} reducedMotion="user" aria-hidden="true" />
        </span>
        <p className="danger-text">{description}</p>
      </div>
      {requireTyping && (
        <label className="field" htmlFor="danger-typing">
          <span className="field__label">
            请输入 <code className="inline-code">{requireTyping}</code> 以确认
          </span>
          <input
            id="danger-typing"
            className="text-input mono-input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      )}
    </Dialog>
  );
}

/** 删除账户确认（组合组件，避免每个调用点重复文案逻辑） */
export function DeleteAccountConfirm({
  accountLabel,
  open,
  onClose,
  onConfirm,
}: {
  accountLabel: string;
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <DangerConfirm
      open={open}
      title="删除这个账户？"
      description={`删除「${accountLabel}」后，其密钥将从本机浏览器中永久移除，无法撤销。你仍可在服务方重新绑定。`}
      confirmLabel="永久删除该账户"
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}

/** 提示：明文导出的风险确认 */
export function PlaintextExportConfirm({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <DangerConfirm
      open={open}
      title="导出明文备份？"
      description="明文备份包含可直接生成验证码的原始密钥，等同于裸密钥。任何拿到该文件的人都能登录你的账户。请仅在离线、可信的介质中保存，并在迁移完成后删除。"
      confirmLabel="仍要导出明文"
      onClose={onClose}
      onConfirm={onConfirm}
      requireTyping="导出明文"
    />
  );
}

/** 重置 vault 确认 */
export function ResetVaultConfirm({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { resetVault, toast } = useVault();
  return (
    <DangerConfirm
      open={open}
      title="重置保险库？"
      description="这会销毁本设备上的加密 vault 与所有账户密钥。如果你没有备份，将永久失去这些账户的 2FA 访问权限。此操作不可恢复。"
      confirmLabel="销毁全部数据"
      onClose={onClose}
      onConfirm={async () => {
        await resetVault();
        toast('保险库已重置，请重新设置主密码', 'warning');
      }}
      requireTyping="重置"
    />
  );
}
