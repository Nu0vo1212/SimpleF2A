import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MorphIcon, icons } from './Icons';
import { Dialog, Field, Segmented } from './Dialog';
import { useVault } from '../lib/context';
import { isOtpAuthUri, isMigrationUri, parseOtpAuthUri } from '../otp/uri';
import { parseMigrationUri } from '../otp/migration';
import {
  OTP_TYPES,
  OTP_TYPE_SPECS,
  createAccountFromDraft,
  normalizeByType,
  type OtpAccountDraft,
  type OtpType,
} from '../otp/types';
import { generateSecret, isValidBase32, normalizeBase32 } from '../otp/base32';
import { decodeQrFromClipboard, decodeQrFromFile } from '../lib/qr';
import { cx } from '../lib/utils';

type Tab = 'scan' | 'uri' | 'manual';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 编辑模式：传入已有账户则进入编辑 */
  editingId?: string | null;
}

export function AddAccountDialog({ open, onClose, editingId }: Props) {
  const { accounts, addAccounts, updateAccount, toast } = useVault();
  const editing = useMemo(
    () => (editingId ? accounts.find((a) => a.id === editingId) ?? null : null),
    [accounts, editingId],
  );

  const [tab, setTab] = useState<Tab>(editing ? 'manual' : 'scan');
  const [pending, setPending] = useState<OtpAccountDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setTab(editing ? 'manual' : 'scan');
    setPending(null);
    setBusy(false);
    setError(null);
  }, [editing]);

  const handleClose = () => {
    reset();
    onClose();
  };

  const commit = async (drafts: OtpAccountDraft[]) => {
    if (drafts.length === 0) return;
    setBusy(true);
    try {
      if (editing) {
        const base = editing;
        await updateAccount({
          ...base,
          ...normalizeByType({ ...drafts[0], type: drafts[0].type }),
          id: base.id,
          order: base.order,
          createdAt: base.createdAt,
          updatedAt: Date.now(),
        });
        toast('账户已更新', 'success');
      } else {
        const start = accounts.length;
        const list = drafts.map((draft, i) => createAccountFromDraft(draft, start + i));
        await addAccounts(list);
        toast(
          drafts.length === 1
            ? `已添加 ${drafts[0].issuer || drafts[0].account}`
            : `已导入 ${drafts.length} 个账户`,
          'success',
        );
      }
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={editing ? '编辑账户' : '添加账户'}
      description={
        editing ? '修改该账户的显示信息或密钥参数。' : '所有解析与加密都在本设备完成，不会上传任何数据。'
      }
      onClose={handleClose}
      size="lg"
      variant="modal"
      footer={
        pending ? (
          <div className="dialog__preview-actions">
            <button type="button" className="ghost-button" onClick={() => setPending(null)} disabled={busy}>
              返回
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => void commit([pending])}
              disabled={busy}
            >
              {busy ? <MorphIcon icon={icons.loader} size={15} className="spin" reducedMotion="user" aria-hidden="true" /> : null}
              {editing ? '保存修改' : '确认添加'}
            </button>
          </div>
        ) : null
      }
    >
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {pending ? (
        <PendingReview draft={pending} />
      ) : (
        <>
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            ariaLabel="添加账户方式"
            options={[
              { value: 'scan', label: '扫码 / 图片', icon: <MorphIcon icon={icons.qr} size={15} reducedMotion="user" aria-hidden="true" /> },
              { value: 'uri', label: '粘贴 URI', icon: <MorphIcon icon={icons.paste} size={15} reducedMotion="user" aria-hidden="true" /> },
              {
                value: 'manual',
                label: editing ? '编辑字段' : '手动输入',
                icon: <MorphIcon icon={icons.keyboard} size={15} reducedMotion="user" aria-hidden="true" />,
              },
            ]}
          />

          <div className="dialog__tab-body">
            {tab === 'scan' && (
              <ScanPanel
                disabled={!!editing}
                onParsed={(draft) => setPending(draft)}
                onError={setError}
              />
            )}
            {tab === 'uri' && (
              <UriPanel
                onParsed={(draft) => setPending(draft)}
                onError={setError}
                onBatch={(drafts) => void commit(drafts)}
              />
            )}
            {tab === 'manual' && (
              <ManualPanel
                initial={editing ?? undefined}
                onSubmit={(draft) => setPending(draft)}
                onError={setError}
              />
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}

/* ------------------------------------------------------------------ 预览 */

function PendingReview({ draft }: { draft: OtpAccountDraft }) {
  const spec = OTP_TYPE_SPECS[draft.type];
  return (
    <div className="preview glass glass--opaque">
      <h3 className="preview__title">确认账户信息</h3>
      <dl className="preview__list">
        <Row label="服务" value={draft.issuer || '—'} />
        <Row label="账户" value={draft.account || '—'} />
        <Row label="类型" value={spec.label} />
        <Row label="算法" value={draft.algorithm} />
        <Row label="位数" value={String(draft.digits)} />
        {draft.type === 'hotp' ? (
          <Row label="计数器" value={String(draft.counter)} />
        ) : (
          <Row label="周期" value={`${spec.type === 'motp' ? 10 : draft.period} 秒`} />
        )}
        <Row label="密钥" value={`${draft.secret.slice(0, 4)}••••${draft.secret.slice(-4)}`} mono />
        {draft.pin ? <Row label="PIN" value="••••" mono /> : null}
      </dl>
      <p className="preview__note">确认无误后点击「确认添加」，该账户将保存到本机浏览器。</p>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="preview__row">
      <dt>{label}</dt>
      <dd className={cx(mono && 'mono')}>{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------- 上传二维码 */

function ScanPanel({
  disabled,
  onParsed,
  onError,
}: {
  disabled: boolean;
  onParsed: (draft: OtpAccountDraft) => void;
  onError: (message: string | null) => void;
}) {
  const [manualText, setManualText] = useState('');

  const handleValue = useCallback(
    (value: string) => {
      onError(null);
      try {
        if (isMigrationUri(value)) {
          const list = parseMigrationUri(value);
          if (list.length === 0) throw new Error('迁移载荷中没有账户');
          // 批量导入直接回调第一项作为预览；实际批量在下方 commit
          onParsed(list[0]);
          return;
        }
        if (isOtpAuthUri(value)) {
          onParsed(parseOtpAuthUri(value));
          return;
        }
        throw new Error('二维码内容不是 otpauth:// 链接');
      } catch (err) {
        onError(err instanceof Error ? err.message : '无法识别二维码内容');
      }
    },
    [onError, onParsed],
  );

  const [decoding, setDecoding] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    onError(null);
    setDecoding(true);
    // 显示缩略图，让用户确认选对了图
    try {
      setPreview(URL.createObjectURL(file));
    } catch {
      setPreview(null);
    }
    try {
      const { text } = await decodeQrFromFile(file);
      handleValue(text);
    } catch (err) {
      onError(err instanceof Error ? err.message : '图片解析失败，请换一张更清晰的截图');
    } finally {
      setDecoding(false);
    }
  };

  const onPaste = async () => {
    onError(null);
    setDecoding(true);
    try {
      const { text } = await decodeQrFromClipboard();
      handleValue(text);
    } catch (err) {
      onError(err instanceof Error ? err.message : '剪贴板读取失败');
    } finally {
      setDecoding(false);
    }
  };

  return (
    <div className="panel">
      {/* 拖拽 / 点击上传区 */}
      <label
        className={cx('upload-zone', dragOver && 'upload-zone--over', decoding && 'upload-zone--busy')}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (disabled) return;
          const file = e.dataTransfer.files?.[0];
          if (file) void onFile(file);
        }}
      >
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={disabled || decoding}
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />

        {preview ? (
          <img className="upload-zone__preview" src={preview} alt="已选择的二维码图片" />
        ) : (
          <span className="upload-zone__icon" aria-hidden="true">
            <MorphIcon
              icon={decoding ? icons.loader : icons.upload}
              size={26}
              className={decoding ? 'spin' : undefined}
              reducedMotion="user"
              aria-hidden="true"
            />
          </span>
        )}

        <span className="upload-zone__title">
          {decoding ? '正在识别二维码…' : '点击选择二维码图片'}
        </span>
        <span className="upload-zone__hint">也可以把图片直接拖到这里</span>
      </label>

      <div className="panel__actions">
        <label className={cx('ghost-button', 'file-button')}>
          <MorphIcon icon={icons.upload} size={16} reducedMotion="user" aria-hidden="true" /> 选择图片
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={disabled || decoding}
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        <button
          type="button"
          className="ghost-button"
          onClick={() => void onPaste()}
          disabled={disabled || decoding}
        >
          <MorphIcon icon={icons.paste} size={16} reducedMotion="user" aria-hidden="true" /> 粘贴截图
        </button>
      </div>

      <p className="panel__hint">
        支持 PNG / JPG / WebP 截图。图片只在本设备解析，不会上传到任何服务器。
      </p>

      <details className="panel__fallback">
        <summary>识别不出？直接粘贴 otpauth:// 或迁移链接</summary>
        <textarea
          className="text-input text-area"
          rows={3}
          placeholder="otpauth://totp/Issuer:account?secret=..."
          value={manualText}
          onChange={(e) => setManualText(e.target.value)}
        />
        <button
          type="button"
          className="ghost-button ghost-button--accent"
          onClick={() => handleValue(manualText)}
          disabled={!manualText.trim()}
        >
          <MorphIcon icon={icons.wand} size={15} reducedMotion="user" aria-hidden="true" /> 解析
        </button>
      </details>
    </div>
  );
}

/* ------------------------------------------------------------------- URI */

function UriPanel({
  onParsed,
  onError,
  onBatch,
}: {
  onParsed: (draft: OtpAccountDraft) => void;
  onError: (message: string | null) => void;
  onBatch: (drafts: OtpAccountDraft[]) => void;
}) {
  const [text, setText] = useState('');
  const [batch, setBatch] = useState<OtpAccountDraft[] | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 面板重新挂载时强制同步 DOM 值，避免浏览器保留上次的文本节点
  useEffect(() => {
    if (textareaRef.current && textareaRef.current.value !== text) {
      textareaRef.current.value = text;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parse = () => {
    onError(null);
    setBatch(null);
    // 以 DOM 中的实际内容为准（防止受控值不同步）
    const value = (textareaRef.current?.value ?? text).trim();
    if (!value) {
      onError('请粘贴 otpauth:// 或 otpauth-migration:// 链接');
      return;
    }
    try {
      if (isMigrationUri(value)) {
        const list = parseMigrationUri(value);
        if (list.length === 1) {
          setText('');
          onParsed(list[0]);
        } else {
          setBatch(list);
        }
        return;
      }
      setText('');
      onParsed(parseOtpAuthUri(value));
    } catch (err) {
      onError(err instanceof Error ? err.message : '解析失败');
    }
  };

  return (
    <div className="panel">
      <Field
        label="otpauth:// 或 otpauth-migration:// 链接"
        htmlFor="uri-input"
        hint="支持 Google Authenticator 迁移链接（批量导入）与单个 Key URI。"
      >
        <textarea
          ref={textareaRef}
          id="uri-input"
          className="text-input text-area"
          rows={4}
          placeholder="otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
        />
      </Field>
      <div className="panel__actions">
        <button type="button" className="primary-button" onClick={parse} disabled={!text.trim()}>
          <MorphIcon icon={icons.wand} size={16} reducedMotion="user" aria-hidden="true" /> 解析链接
        </button>
      </div>

      {batch && batch.length > 0 && (
        <div className="batch glass glass--opaque">
          <h3 className="batch__title">识别到 {batch.length} 个账户</h3>
          <ul className="batch__list">
            {batch.map((item, i) => (
              <li key={`${item.account}-${i}`} className="batch__item">
                <span className="batch__issuer">{item.issuer || '未命名'}</span>
                <span className="batch__account">{item.account}</span>
                <span className="badge">{OTP_TYPE_SPECS[item.type].label}</span>
              </li>
            ))}
          </ul>
          <button type="button" className="primary-button primary-button--block" onClick={() => onBatch(batch)}>
            导入全部 {batch.length} 个账户
          </button>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- 手动 */

interface ManualState {
  type: OtpType;
  issuer: string;
  account: string;
  secret: string;
  algorithm: string;
  digits: number;
  period: number;
  counter: number;
  pin: string;
}

function ManualPanel({
  initial,
  onSubmit,
  onError,
}: {
  initial?: { type: OtpType; issuer: string; account: string; secret: string; algorithm: string; digits: number; period: number; counter: number; pin?: string };
  onSubmit: (draft: OtpAccountDraft) => void;
  onError: (message: string | null) => void;
}) {
  const [form, setForm] = useState<ManualState>({
    type: initial?.type ?? 'totp',
    issuer: initial?.issuer ?? '',
    account: initial?.account ?? '',
    secret: initial?.secret ?? '',
    algorithm: initial?.algorithm ?? 'SHA1',
    digits: initial?.digits ?? 6,
    period: initial?.period ?? 30,
    counter: initial?.counter ?? 0,
    pin: initial?.pin ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const spec = OTP_TYPE_SPECS[form.type];

  const patch = (next: Partial<ManualState>) => {
    setForm((prev) => {
      const merged = { ...prev, ...next };
      if (next.type) {
        const nextSpec = OTP_TYPE_SPECS[next.type];
        merged.algorithm = nextSpec.algorithmFixed ?? nextSpec.defaultAlgorithm;
        merged.digits = nextSpec.digitsFixed ?? nextSpec.defaultDigits;
        merged.period = nextSpec.defaultPeriod;
      }
      return merged;
    });
    onError(null);
  };

  const validate = (): Record<string, string> => {
    const errs: Record<string, string> = {};
    const normalizedSecret = normalizeBase32(form.secret);
    if (!normalizedSecret) errs.secret = '请填写密钥';
    else if (!isValidBase32(normalizedSecret)) errs.secret = '密钥不是合法的 Base32（A–Z 与 2–7）';
    if (!form.issuer.trim()) errs.issuer = '请填写服务名称';
    if (!form.account.trim()) errs.account = '请填写账户名';
    if (form.digits < 1 || form.digits > 10) errs.digits = '位数需在 1–10 之间';
    if (form.type !== 'hotp' && form.period <= 0) errs.period = '周期必须大于 0';
    if (form.counter < 0) errs.counter = '计数器不能为负';
    if (spec.requiresPin) {
      const { min, max } = spec.requiresPin;
      if (form.pin.length < min || form.pin.length > max) {
        errs.pin = `PIN 需为 ${min}${max !== min ? `–${max}` : ''} 位数字`;
      } else if (!/^\d+$/.test(form.pin)) {
        errs.pin = 'PIN 只能包含数字';
      }
    }
    return errs;
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    const draft = normalizeByType({
      type: form.type,
      issuer: form.issuer.trim(),
      account: form.account.trim(),
      secret: normalizeBase32(form.secret),
      algorithm: form.algorithm as OtpAccountDraft['algorithm'],
      digits: form.digits,
      period: form.period,
      counter: form.counter,
      ...(spec.requiresPin ? { pin: form.pin } : {}),
    });
    onSubmit(draft);
  };

  const fillRandom = () => patch({ secret: generateSecret() });

  return (
    <form className="manual-form" onSubmit={submit} noValidate>
      <Field label="类型" htmlFor="f-type" hint={spec.description}>
        <div className="chip-row" role="radiogroup" aria-label="OTP 类型">
          {OTP_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              role="radio"
              aria-checked={form.type === type}
              className={cx('chip', form.type === type && 'chip--active')}
              onClick={() => patch({ type })}
            >
              {OTP_TYPE_SPECS[type].label}
            </button>
          ))}
        </div>
      </Field>

      <div className="form-grid">
        <Field label="服务名称" htmlFor="f-issuer" error={errors.issuer}>
          <input
            id="f-issuer"
            className="text-input"
            value={form.issuer}
            onChange={(e) => patch({ issuer: e.target.value })}
            placeholder="例如 GitHub"
            autoComplete="off"
          />
        </Field>
        <Field label="账户名" htmlFor="f-account" error={errors.account}>
          <input
            id="f-account"
            className="text-input"
            value={form.account}
            onChange={(e) => patch({ account: e.target.value })}
            placeholder="例如 you@example.com"
            autoComplete="off"
          />
        </Field>
      </div>

      <Field
        label="密钥（Base32）"
        htmlFor="f-secret"
        error={errors.secret}
        hint="通常由服务方提供，仅含 A–Z 与 2–7，空格会被自动忽略。"
      >
        <div className="input-row">
          <input
            id="f-secret"
            className="text-input mono-input"
            value={form.secret}
            onChange={(e) => patch({ secret: e.target.value })}
            placeholder="JBSWY3DPEHPK3PXP"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className="ghost-button" onClick={fillRandom} title="生成随机密钥">
            生成
          </button>
        </div>
      </Field>

      <div className="form-grid">
        <Field label="算法" htmlFor="f-algorithm">
          <select
            id="f-algorithm"
            className="text-input select-input"
            value={form.algorithm}
            disabled={!!spec.algorithmFixed}
            onChange={(e) => patch({ algorithm: e.target.value })}
          >
            {spec.algorithms.map((alg) => (
              <option key={alg} value={alg}>
                {alg}
              </option>
            ))}
          </select>
        </Field>
        <Field label="位数" htmlFor="f-digits" error={errors.digits}>
          <select
            id="f-digits"
            className="text-input select-input"
            value={form.digits}
            disabled={spec.digitsFixed !== null}
            onChange={(e) => patch({ digits: Number(e.target.value) })}
          >
            {[5, 6, 7, 8].map((d) => (
              <option key={d} value={d}>
                {d} 位
              </option>
            ))}
          </select>
        </Field>
        {form.type === 'hotp' ? (
          <Field label="计数器" htmlFor="f-counter" error={errors.counter}>
            <input
              id="f-counter"
              type="number"
              min={0}
              className="text-input"
              value={form.counter}
              onChange={(e) => patch({ counter: Number(e.target.value) })}
            />
          </Field>
        ) : (
          <Field label="周期（秒）" htmlFor="f-period" error={errors.period}>
            <input
              id="f-period"
              type="number"
              min={1}
              max={300}
              className="text-input"
              value={form.period}
              disabled={form.type !== 'totp'}
              onChange={(e) => patch({ period: Number(e.target.value) })}
            />
          </Field>
        )}
        {spec.requiresPin && (
          <Field label={spec.requiresPin.label} htmlFor="f-pin" error={errors.pin}>
            <input
              id="f-pin"
              className="text-input mono-input"
              inputMode="numeric"
              value={form.pin}
              onChange={(e) => patch({ pin: e.target.value.replace(/\D/g, '') })}
              placeholder={spec.requiresPin.min === 4 && spec.requiresPin.max === 4 ? '1234' : '4–16 位数字'}
            />
          </Field>
        )}
      </div>

      <button type="submit" className="primary-button primary-button--block">
        预览并继续
      </button>
    </form>
  );
}
