import { useMemo, useRef, useState } from 'react';
import { Dialog, Field } from './Dialog';
import { MorphIcon, icons } from './Icons';
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
import { downloadFile, readFileAsText, cx } from '../lib/utils';
import { PlaintextExportConfirm, ResetVaultConfirm } from './DangerDialogs';

type Section = 'appearance' | 'backup' | 'about';

/** 设置：外观（主题/背景/图标）、备份导出/导入、危险操作、关于 */
export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, updateSettings, accounts, toast, state, tier, addAccounts } = useVault();
  const [section, setSection] = useState<Section>('appearance');

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

  const accountCount = accounts.length;
  const tierLabel =
    tier === 'a' ? 'Tier A · 完整折射' : tier === 'b' ? 'Tier B · 纯 CSS 玻璃' : 'Tier C · 极简';

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
      toast('明文备份已下载，请妥善保存', 'warning');
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
      if (parsed.needsPassword) setImportNeedsPassword(true);
      else setImportPreview(parsed);
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

  const sections = useMemo(
    () => [
      { id: 'appearance' as const, label: '外观', icon: icons.palette },
      { id: 'backup' as const, label: '备份与迁移', icon: icons.fileJson },
      { id: 'about' as const, label: '关于', icon: icons.shieldAlert },
    ],
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
                <MorphIcon icon={item.icon} size={15} reducedMotion="user" aria-hidden="true" />
                {item.label}
              </button>
            ))}
            <div className="settings__meta">
              <span>{accountCount} 个账户</span>
              <span>本地浏览器存储</span>
              <span>{tierLabel}</span>
            </div>
          </nav>

          <div className="settings__panel">
            {section === 'appearance' && (
              <div className="settings__group">
                <h3 className="settings__title">主题</h3>
                <p className="settings__desc">深浅色可随时切换，玻璃材质会随主题重新配比。</p>
                <div className="theme-cards" role="radiogroup" aria-label="主题">
                  {[
                    { id: 'dark' as const, label: '深色', hint: '暗色基底 · 高对比', icon: icons.moon },
                    { id: 'light' as const, label: '浅色', hint: '乳浊玻璃 · 柔和', icon: icons.sun },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      role="radio"
                      aria-checked={settings.theme === opt.id}
                      className={cx(
                        'theme-card',
                        `theme-card--${opt.id}`,
                        settings.theme === opt.id && 'theme-card--active',
                      )}
                      onClick={() => updateSettings({ theme: opt.id })}
                    >
                      <span className="theme-card__swatch" aria-hidden="true">
                        <MorphIcon
                          icon={opt.icon}
                          size={18}
                          spring="bouncy"
                          reducedMotion="user"
                          aria-hidden="true"
                        />
                      </span>
                      <span className="theme-card__text">
                        <span className="theme-card__label">{opt.label}</span>
                        <span className="theme-card__hint">{opt.hint}</span>
                      </span>
                      {settings.theme === opt.id && (
                        <MorphIcon
                          icon={icons.check}
                          size={14}
                          className="theme-card__check"
                          reducedMotion="user"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  ))}
                </div>

                <h3 className="settings__title settings__title--sub">背景</h3>
                <label className="toggle-row">
                  <span>
                    <span className="toggle-row__label">
                      <MorphIcon
                        icon={icons.background}
                        size={14}
                        reducedMotion="user"
                        aria-hidden="true"
                      />{' '}
                      使用随机图片背景
                    </span>
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
                      DuckDuckGo / Google 图标服务请求图标——这会暴露你使用了哪些服务。
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

            {section === 'backup' && (
              <div className="settings__group">
                <h3 className="settings__title">导出备份</h3>
                <p className="settings__desc">
                  备份文件包含全部账户密钥。推荐使用密码加密模式，便于安全保存或迁移到其它验证器。
                </p>

                <div className="settings__card">
                  <div className="settings__card-head">
                    <MorphIcon icon={icons.shield} size={16} reducedMotion="user" aria-hidden="true" />
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
                      <MorphIcon
                        icon={encrypting ? icons.loader : icons.download}
                        size={15}
                        className={encrypting ? 'spin' : undefined}
                        reducedMotion="user"
                        aria-hidden="true"
                      />
                      导出
                    </button>
                  </div>
                </div>

                <div className="settings__card settings__card--warn">
                  <div className="settings__card-head">
                    <MorphIcon
                      icon={icons.shieldAlert}
                      size={16}
                      reducedMotion="user"
                      aria-hidden="true"
                    />
                    <span>明文 JSON（等同于裸密钥）</span>
                  </div>
                  <button
                    type="button"
                    className="ghost-button ghost-button--danger"
                    onClick={() => setConfirmPlain(true)}
                    disabled={exporting || accounts.length === 0}
                  >
                    <MorphIcon icon={icons.download} size={15} reducedMotion="user" aria-hidden="true" />
                    导出明文备份
                  </button>
                </div>

                <h3 className="settings__title settings__title--sub">导入备份</h3>
                <p className="settings__desc">
                  支持本应用导出文件，以及 Aegis、2FAS、Bitwarden、AndOTP 的 JSON 导出。导入的账户会追加到现有列表。
                </p>
                <div className="settings__card">
                  <label className="ghost-button file-button">
                    <MorphIcon icon={icons.upload} size={15} reducedMotion="user" aria-hidden="true" />
                    选择 JSON 备份文件
                    <input
                      ref={fileInput}
                      type="file"
                      accept="application/json,.json"
                      className="sr-only"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) handleImportText(await readFileAsText(file));
                        e.target.value = '';
                      }}
                    />
                  </label>

                  {importNeedsPassword && (
                    <Field label="备份密码" htmlFor="import-pw" hint="该备份由密码加密。">
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
                        {importPreview.skipped > 0 && (
                          <span>（跳过 {importPreview.skipped} 条无效记录）</span>
                        )}
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
                      {importBusy && (
                        <MorphIcon
                          icon={icons.loader}
                          size={15}
                          className="spin"
                          reducedMotion="user"
                          aria-hidden="true"
                        />
                      )}
                      导入到本地
                    </button>
                  )}
                </div>

                <h3 className="settings__title settings__title--sub">清空数据</h3>
                <p className="settings__desc">
                  删除本机保存的全部账户。请先导出备份，此操作不可恢复。
                </p>
                <button
                  type="button"
                  className="ghost-button ghost-button--danger"
                  onClick={() => setConfirmReset(true)}
                >
                  <MorphIcon icon={icons.trash} size={15} reducedMotion="user" aria-hidden="true" />
                  清空全部账户
                </button>
              </div>
            )}

            {section === 'about' && (
              <div className="settings__group">
                <h3 className="settings__title">SimpleF2A</h3>
                <dl className="about-list">
                  <div>
                    <dt>存储</dt>
                    <dd>浏览器 IndexedDB · 数据不出本机</dd>
                  </div>
                  <div>
                    <dt>账户数</dt>
                    <dd>{state.accountCount} 个</dd>
                  </div>
                  <div>
                    <dt>网络</dt>
                    <dd>无服务器 · 仅加载背景图与服务图标</dd>
                  </div>
                  <div>
                    <dt>OTP</dt>
                    <dd>TOTP / HOTP / Steam / Yandex / MOTP</dd>
                  </div>
                  <div>
                    <dt>快捷键</dt>
                    <dd>Ctrl/⌘ + Shift + L 切换深浅色</dd>
                  </div>
                </dl>
                <p className="settings__desc">
                  详见仓库中的 SECURITY.md（使用边界）与 README.md（部署与性能说明）。
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
