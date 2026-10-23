import { useMemo, useRef, useState } from 'react';
import {
  Download,
  FileJson,
  KeyRound,
  Loader2,
  Lock,
  ShieldAlert,
  ShieldCheck,
  Upload,
  Trash2,
} from 'lucide-react';
import { Dialog, Field } from './Dialog';
import { useVault } from '../lib/context';
import {
  backupFileName,
  backupToJson,
  buildEncryptedBackup,
  buildPlainBackup,
  decryptBackup,
  parseBackupJson,
  type ImportResult,
} from '../vault/backup';
import { downloadFile, readFileAsText } from '../lib/utils';
import { PlaintextExportConfirm, ResetVaultConfirm } from './DangerDialogs';
import { cx } from '../lib/utils';

type Section = 'theme' | 'security' | 'backup' | 'about';

/** 设置：主题、自动锁定、备份导出/导入、主密码、重置 */
export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    settings,
    updateSettings,
    accounts,
    toast,
    changePassword,
    state,
    tier,
    addAccounts,
  } = useVault();
  const [section, setSection] = useState<Section>('backup');

  const [exporting, setExporting] = useState(false);
  const [confirmPlain, setConfirmPlain] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [encryptPassword, setEncryptPassword] = useState('');
  const [encrypting, setEncrypting] = useState(false);

  const [importPreview, setImportPreview] = useState<ImportResult | null>(null);
  const [importText, setImportText] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [importNeedsPassword, setImportNeedsPassword] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const [currentPw, setCurrentPw] = useState('');
  const [nextPw, setNextPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  const accountCount = accounts.length;
  const tierLabel = tier === 'a' ? 'Tier A · 完整折射' : tier === 'b' ? 'Tier B · 纯 CSS 玻璃' : 'Tier C · 极简';

  const doEncryptedExport = async () => {
    if (encryptPassword.length < 8) {
      toast('备份密码至少 8 个字符', 'warning');
      return;
    }
    setEncrypting(true);
    try {
      const backup = await buildEncryptedBackup(accounts, encryptPassword);
      downloadFile(backupFileName(true), backupToJson(backup));
      setEncryptPassword('');
      toast('加密备份已下载', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : '导出失败', 'danger');
    } finally {
      setEncrypting(false);
    }
  };

  const doPlainExport = async () => {
    setExporting(true);
    try {
      downloadFile(backupFileName(false), backupToJson(buildPlainBackup(accounts)));
      toast('明文备份已下载，请尽快妥善保存', 'warning');
    } finally {
      setExporting(false);
    }
  };

  const handleImportText = (text: string) => {
    setImportText(text);
    setImportPreview(null);
    setImportNeedsPassword(false);
    try {
      const parsed = parseBackupJson(text);
      if (parsed.needsPassword) {
        setImportNeedsPassword(true);
      } else {
        setImportPreview(parsed);
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : '备份解析失败', 'danger');
    }
  };

  const doImport = async () => {
    setImportBusy(true);
    try {
      const result = importNeedsPassword
        ? await decryptBackup(importText, importPassword)
        : parseBackupJson(importText);
      if (result.accounts.length === 0) {
        toast('备份中没有可导入的账户', 'warning');
        return;
      }
      // 重新分配 id，避免与现有账户冲突
      const fresh = result.accounts.map((a) => ({ ...a, id: crypto.randomUUID() }));
      await addAccounts(fresh);
      toast(`已导入 ${fresh.length} 个账户`, 'success');
      setImportPreview(null);
      setImportText('');
      setImportPassword('');
      setImportNeedsPassword(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : '导入失败', 'danger');
    } finally {
      setImportBusy(false);
    }
  };

  const doChangePassword = async () => {
    setPwBusy(true);
    try {
      await changePassword(currentPw, nextPw);
      setCurrentPw('');
      setNextPw('');
      toast('主密码已更新，所有记录已用新密钥重新加密', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : '修改失败', 'danger');
    } finally {
      setPwBusy(false);
    }
  };

  const sections = useMemo(
    () =>
      [
        { id: 'backup' as const, label: '备份与迁移', icon: <FileJson size={15} /> },
        { id: 'security' as const, label: '安全', icon: <ShieldCheck size={15} /> },
        { id: 'theme' as const, label: '外观', icon: <Lock size={15} /> },
        { id: 'about' as const, label: '关于', icon: <ShieldAlert size={15} /> },
      ] satisfies Array<{ id: Section; label: string; icon: React.ReactNode }>,
    [],
  );

  return (
    <>
      <Dialog open={open} title="设置" onClose={onClose} size="lg" variant="modal">
        <div className="settings">
          <nav className="settings__nav" aria-label="设置分类">
            {sections.map((item) => (
              <button
                key={item.id}
                type="button"
                className={cx('settings__tab', section === item.id && 'settings__tab--active')}
                onClick={() => setSection(item.id)}
                aria-current={section === item.id}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
            <div className="settings__meta">
              <span>{accountCount} 个账户</span>
              <span>{state.exists ? '已加密存储' : '未创建'}</span>
              <span>{tierLabel}</span>
            </div>
          </nav>

          <div className="settings__panel">
            {section === 'backup' && (
              <div className="settings__group">
                <h3 className="settings__title">导出备份</h3>
                <p className="settings__desc">
                  备份文件包含全部账户密钥。推荐使用密码加密模式；加密备份可重新导入本应用或解码后迁移到其它验证器。
                </p>

                <div className="settings__card">
                  <div className="settings__card-head">
                    <KeyRound size={16} aria-hidden="true" />
                    <span>密码加密的 JSON（推荐）</span>
                  </div>
                  <div className="input-row">
                    <input
                      className="text-input"
                      type="password"
                      placeholder="为备份设置密码（至少 8 位）"
                      value={encryptPassword}
                      onChange={(e) => setEncryptPassword(e.target.value)}
                      autoComplete="new-password"
                      aria-label="备份密码"
                    />
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => void doEncryptedExport()}
                      disabled={encrypting || accounts.length === 0}
                    >
                      {encrypting ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
                      导出
                    </button>
                  </div>
                </div>

                <div className="settings__card settings__card--warn">
                  <div className="settings__card-head">
                    <ShieldAlert size={16} aria-hidden="true" />
                    <span>明文 JSON（等同于裸密钥）</span>
                  </div>
                  <button
                    type="button"
                    className="ghost-button ghost-button--danger"
                    onClick={() => setConfirmPlain(true)}
                    disabled={exporting || accounts.length === 0}
                  >
                    <Download size={15} aria-hidden="true" /> 导出明文备份
                  </button>
                </div>

                <h3 className="settings__title settings__title--sub">导入备份</h3>
                <p className="settings__desc">
                  支持本应用导出文件，以及 Aegis、2FAS、Bitwarden、AndOTP 的 JSON 导出。导入的账户会追加到现有列表。
                </p>
                <div className="settings__card">
                  <label className="ghost-button file-button">
                    <Upload size={15} aria-hidden="true" /> 选择 JSON 备份文件
                    <input
                      ref={fileInput}
                      type="file"
                      accept="application/json,.json"
                      className="sr-only"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const text = await readFileAsText(file);
                          handleImportText(text);
                        }
                        e.target.value = '';
                      }}
                    />
                  </label>

                  {importNeedsPassword && (
                    <Field label="备份密码" htmlFor="import-pw" hint="该备份由主密码/备份密码加密。">
                      <input
                        id="import-pw"
                        className="text-input"
                        type="password"
                        value={importPassword}
                        onChange={(e) => setImportPassword(e.target.value)}
                        autoComplete="off"
                      />
                    </Field>
                  )}

                  {importPreview && (
                    <div className="import-preview">
                      <p>
                        识别到 <strong>{importPreview.accounts.length}</strong> 个账户
                        {importPreview.skipped > 0 && <span>（跳过 {importPreview.skipped} 条无效记录）</span>}
                        <span className="badge badge--subtle">{formatSource(importPreview.source)}</span>
                      </p>
                      <ul className="import-preview__list">
                        {importPreview.accounts.slice(0, 6).map((a) => (
                          <li key={a.id}>
                            {a.issuer || '未命名'} · {a.account}
                          </li>
                        ))}
                        {importPreview.accounts.length > 6 && (
                          <li>… 以及另外 {importPreview.accounts.length - 6} 个</li>
                        )}
                      </ul>
                    </div>
                  )}

                  {(importPreview || importNeedsPassword) && (
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => void doImport()}
                      disabled={importBusy || (importNeedsPassword && !importPassword)}
                    >
                      {importBusy ? <Loader2 size={15} className="spin" aria-hidden="true" /> : null}
                      导入到 vault
                    </button>
                  )}
                </div>
              </div>
            )}

            {section === 'security' && (
              <div className="settings__group">
                <h3 className="settings__title">自动锁定</h3>
                <label className="toggle-row">
                  <span>
                    <span className="toggle-row__label">页面隐藏时自动锁定</span>
                    <span className="toggle-row__desc">
                      切换到其它标签页或最小化窗口时立刻清除内存中的密钥。建议保持开启。
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    className="switch"
                    checked={settings.autoLockOnHide}
                    onChange={(e) => updateSettings({ autoLockOnHide: e.target.checked })}
                  />
                </label>

                <h3 className="settings__title settings__title--sub">修改主密码</h3>
                <p className="settings__desc">
                  使用旧主密码解出全部记录，再用新密码重新派生密钥并加密写回。
                </p>
                <div className="settings__card">
                  <Field label="当前主密码" htmlFor="cur-pw">
                    <input
                      id="cur-pw"
                      className="text-input"
                      type="password"
                      value={currentPw}
                      onChange={(e) => setCurrentPw(e.target.value)}
                      autoComplete="current-password"
                    />
                  </Field>
                  <Field label="新主密码" htmlFor="next-pw" hint="至少 8 个字符。忘记将无法恢复。">
                    <input
                      id="next-pw"
                      className="text-input"
                      type="password"
                      value={nextPw}
                      onChange={(e) => setNextPw(e.target.value)}
                      autoComplete="new-password"
                    />
                  </Field>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => void doChangePassword()}
                    disabled={pwBusy || !currentPw || nextPw.length < 8}
                  >
                    {pwBusy ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <KeyRound size={15} aria-hidden="true" />}
                    更新主密码
                  </button>
                </div>

                <h3 className="settings__title settings__title--sub">销毁数据</h3>
                <p className="settings__desc">
                  重置会删除本设备上的整个加密 vault。请先导出备份。
                </p>
                <button type="button" className="ghost-button ghost-button--danger" onClick={() => setConfirmReset(true)}>
                  <Trash2 size={15} aria-hidden="true" /> 重置保险库
                </button>
              </div>
            )}

            {section === 'theme' && (
              <div className="settings__group">
                <h3 className="settings__title">主题</h3>
                <div className="chip-row" role="radiogroup" aria-label="主题">
                  {(['dark', 'light'] as const).map((theme) => (
                    <button
                      key={theme}
                      type="button"
                      role="radio"
                      aria-checked={settings.theme === theme}
                      className={cx('chip', settings.theme === theme && 'chip--active')}
                      onClick={() => updateSettings({ theme })}
                    >
                      {theme === 'dark' ? '深色' : '浅色'}
                    </button>
                  ))}
                </div>

                <h3 className="settings__title settings__title--sub">背景</h3>
                <label className="toggle-row">
                  <span>
                    <span className="toggle-row__label">使用随机图片背景</span>
                    <span className="toggle-row__desc">
                      关闭后仅保留渐变与光斑，可减少流量与 GPU 合成开销。
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    className="switch"
                    checked={settings.backgroundImage}
                    onChange={(e) => updateSettings({ backgroundImage: e.target.checked })}
                  />
                </label>

                <h3 className="settings__title settings__title--sub">服务图标</h3>
                <label className="toggle-row">
                  <span>
                    <span className="toggle-row__label">联网获取服务图标</span>
                    <span className="toggle-row__desc">
                      GitHub、Steam、Claude 等常见服务使用内置图标，无需联网。开启后，未收录的服务会向
                      DuckDuckGo / Google 图标服务请求真实网站图标——这会让第三方得知你使用了哪些服务。
                      关闭后仅显示内置图标或首字母。
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    className="switch"
                    checked={settings.fetchRemoteIcons}
                    onChange={(e) => updateSettings({ fetchRemoteIcons: e.target.checked })}
                  />
                </label>

                <h3 className="settings__title settings__title--sub">玻璃质量</h3>
                <p className="settings__desc">
                  当前：<strong>{tierLabel}</strong>。层级由设备能力、系统偏好与实测帧率自动决定，不可手动切换。
                </p>
              </div>
            )}

            {section === 'about' && (
              <div className="settings__group">
                <h3 className="settings__title">SimpleF2A</h3>
                <dl className="about-list">
                  <div>
                    <dt>加密</dt>
                    <dd>AES-256-GCM · PBKDF2-SHA256 · 600,000 迭代</dd>
                  </div>
                  <div>
                    <dt>存储</dt>
                    <dd>IndexedDB（仅密文）· 主密码不落盘</dd>
                  </div>
                  <div>
                    <dt>网络</dt>
                    <dd>无服务器 · 不上传密钥 · 仅加载背景图片</dd>
                  </div>
                  <div>
                    <dt>OTP</dt>
                    <dd>TOTP / HOTP / Steam / Yandex / MOTP</dd>
                  </div>
                </dl>
                <p className="settings__desc">
                  详见仓库中的 SECURITY.md（威胁模型）与 README.md（部署与性能说明）。
                </p>
              </div>
            )}
          </div>
        </div>
      </Dialog>

      <PlaintextExportConfirm
        open={confirmPlain}
        onClose={() => setConfirmPlain(false)}
        onConfirm={doPlainExport}
      />
      <ResetVaultConfirm open={confirmReset} onClose={() => setConfirmReset(false)} />
    </>
  );
}

function formatSource(source: ImportResult['source']): string {
  switch (source) {
    case 'simplef2a':
      return 'SimpleF2A';
    case 'simplef2a-encrypted':
      return 'SimpleF2A 加密备份';
    case 'aegis':
      return 'Aegis';
    case '2fas':
      return '2FAS';
    case 'bitwarden':
      return 'Bitwarden';
    case 'andotp':
      return 'AndOTP';
    default:
      return source;
  }
}
