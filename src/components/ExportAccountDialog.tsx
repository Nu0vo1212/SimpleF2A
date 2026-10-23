import { useEffect, useState } from 'react';
import { Copy, Download, Loader2, QrCode } from 'lucide-react';
import { Dialog } from './Dialog';
import type { OtpAccount } from '../otp/types';
import { buildOtpAuthUri } from '../otp/uri';
import { qrSvg, qrDataUrl } from '../lib/qr';
import { copyText, downloadBlob, OTP_TYPE_LABELS } from '../lib/utils';
import { useVault } from '../lib/context';

/** 单账户导出：otpauth:// URI + 二维码（SVG 预览，可下载 PNG/SVG） */
export function ExportAccountDialog({
  account,
  onClose,
}: {
  account: OtpAccount | null;
  onClose: () => void;
}) {
  const { toast } = useVault();
  const [svg, setSvg] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const uri = account
    ? buildOtpAuthUri(account, { includePin: !!account.pin })
    : '';

  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    setBusy(true);
    void (async () => {
      try {
        const markup = await qrSvg(uri, 240);
        if (!cancelled) setSvg(markup);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account, uri]);

  if (!account) return null;

  const downloadPng = async () => {
    const url = await qrDataUrl(uri, 720);
    const response = await fetch(url);
    const blob = await response.blob();
    downloadBlob(`${safeName(account)}-qr.png`, blob);
    toast('二维码图片已下载', 'success');
  };

  const downloadSvg = () => {
    downloadBlob(`${safeName(account)}-qr.svg`, new Blob([svg], { type: 'image/svg+xml' }));
    toast('SVG 二维码已下载', 'success');
  };

  return (
    <Dialog
      open={!!account}
      title="导出账户"
      description="在其它验证器中导入这段链接或扫描二维码即可迁移。链接包含原始密钥，请谨慎分享。"
      onClose={onClose}
      size="md"
      footer={
        <>
          <button type="button" className="ghost-button" onClick={onClose}>
            关闭
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={async () => {
              const ok = await copyText(uri);
              toast(ok ? 'otpauth:// 链接已复制' : '复制失败', ok ? 'success' : 'warning');
            }}
          >
            <Copy size={15} aria-hidden="true" /> 复制链接
          </button>
          <button type="button" className="primary-button" onClick={() => void downloadPng()}>
            <Download size={15} aria-hidden="true" /> 下载二维码
          </button>
        </>
      }
    >
      <div className="export-panel">
        <div className="export-qr">
          {busy || !svg ? (
            <div className="export-qr__loading">
              <Loader2 size={20} className="spin" aria-hidden="true" />
            </div>
          ) : (
            <div className="export-qr__svg" dangerouslySetInnerHTML={{ __html: svg }} role="img" aria-label="账户二维码" />
          )}
        </div>
        <div className="export-meta">
          <div className="export-meta__row">
            <span>服务</span>
            <strong>{account.issuer || '—'}</strong>
          </div>
          <div className="export-meta__row">
            <span>账户</span>
            <strong>{account.account || '—'}</strong>
          </div>
          <div className="export-meta__row">
            <span>类型</span>
            <strong>
              {OTP_TYPE_LABELS[account.type]} · {account.algorithm} · {account.digits} 位
            </strong>
          </div>
          <div className="export-uri">
            <code>{uri}</code>
          </div>
          <div className="export-actions">
            <button type="button" className="ghost-button" onClick={downloadSvg}>
              <QrCode size={15} aria-hidden="true" /> 下载 SVG
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function safeName(account: OtpAccount): string {
  const base = `${account.issuer || 'account'}-${account.account || ''}`
    .replace(/[^\w\u4e00-\u9fa5.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base || 'account';
}
