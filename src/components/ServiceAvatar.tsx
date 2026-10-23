import { useEffect, useMemo, useState } from 'react';
import type { OtpAccount } from '../otp/types';
import { derivedHue, initialsOf } from '../lib/utils';
import { findBrandIcon } from './BrandIcons';
import { resolveFavicon } from '../lib/favicon';
import { useVault } from '../lib/context';

/**
 * 服务头像：三级回退
 *  1. 内置品牌图标（内联 SVG，零网络、零延迟）—— GitHub / Steam / Claude 等
 *  2. 联网 favicon（可选，需在设置中开启；未命中域名时很可能失败）
 *  3. 首字母 + 稳定派生色（永远可用的兜底）
 *
 * 账户若自带 icon（DataURL 或 URL），优先使用。
 */
export function ServiceAvatar({
  account,
  size = 36,
  radius = 11,
}: {
  account: OtpAccount;
  size?: number;
  radius?: number;
}) {
  const { settings } = useVault();
  const brand = useMemo(
    () => findBrandIcon(account.issuer, account.account, account.type),
    [account.issuer, account.account, account.type],
  );

  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [remoteFailed, setRemoteFailed] = useState(false);

  // 仅当没有内置图标、没有自定义 icon、且用户允许联网时，才去抓 favicon
  const shouldFetchRemote =
    !brand && !account.icon && settings.fetchRemoteIcons && !remoteFailed;

  useEffect(() => {
    if (!shouldFetchRemote) return;
    let cancelled = false;
    void (async () => {
      const url = await resolveFavicon(account.issuer, account.account);
      if (cancelled) return;
      if (url) setRemoteUrl(url);
      else setRemoteFailed(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [shouldFetchRemote, account.issuer, account.account]);

  const fallback = useMemo(() => {
    const seed = account.issuer || account.account;
    const { hue, saturation, lightness } = derivedHue(seed);
    return {
      background: `linear-gradient(140deg, hsl(${hue} ${saturation}% ${lightness}%), hsl(${(hue + 32) % 360} ${saturation}% ${Math.max(24, lightness - 14)}%))`,
      label: initialsOf(account.issuer || account.account),
    };
  }, [account.issuer, account.account]);

  const shared: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: radius,
  };

  const styleAttr = { ...shared, backgroundColor: account.color ?? undefined };

  // 1) 自定义 icon（用户手动指定）
  if (account.icon) {
    return (
      <span className="account-card__avatar" style={styleAttr} aria-hidden="true">
        <img src={account.icon} alt="" width={size} height={size} />
      </span>
    );
  }

  // 2) 内置品牌图标
  if (brand) {
    return (
      <span
        className="account-card__avatar account-card__avatar--brand"
        style={{
          ...shared,
          background: `linear-gradient(140deg, ${brand.color}, ${brand.colorEnd ?? brand.color})`,
          color: brand.foreground,
        }}
        aria-hidden="true"
      >
        {brand.render()}
      </span>
    );
  }

  // 3) 联网 favicon（白底，避免深色图标在暗底上消失）
  if (remoteUrl) {
    return (
      <span
        className="account-card__avatar account-card__avatar--remote"
        style={shared}
        aria-hidden="true"
      >
        <img
          src={remoteUrl}
          alt=""
          width={Math.round(size * 0.62)}
          height={Math.round(size * 0.62)}
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => {
            setRemoteUrl(null);
            setRemoteFailed(true);
          }}
        />
      </span>
    );
  }

  // 4) 首字母兜底
  return (
    <span className="account-card__avatar" style={{ ...shared, background: fallback.background }} aria-hidden="true">
      {fallback.label}
    </span>
  );
}
