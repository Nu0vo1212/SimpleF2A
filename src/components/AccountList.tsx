import { useEffect, useMemo, useState } from 'react';
import { useVault } from '../lib/context';
import { generateCode, effectivePeriod, isTimeBased } from '../otp/engine';
import type { OtpAccount } from '../otp/types';
import { AccountCard } from './AccountCard';

interface Props {
  accounts: OtpAccount[];
  onEdit: (account: OtpAccount) => void;
  onExport: (account: OtpAccount) => void;
  onDelete: (account: OtpAccount) => void;
  query: string;
}

/** 输入变化时重新计算的验证码（HOTP 与时间型共用一套渲染逻辑） */
function useCodes(accounts: OtpAccount[], now: number) {
  const [codes, setCodes] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        accounts.map(async (account) => {
          const result = await generateCode(account, now);
          return [account.id, result.code] as const;
        }),
      );
      if (!cancelled) setCodes(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
    // HOTP 只在 counter 变化时更新；时间型随 now 更新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    accounts.map((a) => `${a.id}:${a.counter}:${a.secret}:${a.digits}:${a.algorithm}:${a.period}:${a.pin ?? ''}:${a.type}`).join('|'),
    now,
  ]);

  return codes;
}

export function AccountList({ accounts, onEdit, onExport, onDelete, query }: Props) {
  const { now, settings } = useVault();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? accounts.filter(
          (a) =>
            a.issuer.toLowerCase().includes(q) ||
            a.account.toLowerCase().includes(q) ||
            a.type.includes(q),
        )
      : accounts;
    return list;
  }, [accounts, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, OtpAccount[]>();
    for (const account of filtered) {
      const key = account.issuer || '未分组';
      const bucket = map.get(key);
      if (bucket) bucket.push(account);
      else map.set(key, [account]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-Hans-CN'));
  }, [filtered]);

  /**
   * 分组展示策略：
   *  - 每组通常只有 1 个账户时（如每个服务一个账号），分组标题反而是噪音，
   *    此时直接渲染为一个扁平网格，避免「一卡一行」的稀疏布局。
   *  - 存在真正的多账户分组时才启用分组标题。
   */
  const hasMultiAccountGroup = useMemo(
    () => grouped.some(([, items]) => items.length > 1),
    [grouped],
  );

  const codes = useCodes(filtered, now);

  if (filtered.length === 0 && query) {
    return (
      <div className="empty-search glass">
        <p>没有匹配「{query}」的账户</p>
        <p className="empty-search__hint">试试搜索服务名或邮箱，或清空搜索框</p>
      </div>
    );
  }

  const renderCard = (account: OtpAccount, index: number) => {
    const code = codes[account.id];
    const period = effectivePeriod(account);
    const remaining = isTimeBased(account)
      ? period - (((Math.floor(now / 1000) % period) + period) % period)
      : 0;
    return (
      <AccountCard
        key={account.id}
        account={account}
        code={code ?? ''}
        remaining={remaining}
        period={period}
        index={index}
        onEdit={() => onEdit(account)}
        onExport={() => onExport(account)}
        onDelete={() => onDelete(account)}
      />
    );
  };

  if (!hasMultiAccountGroup) {
    return (
      <div className="account-grid account-grid--flat" role="list">
        {filtered.map((account, index) => renderCard(account, index))}
      </div>
    );
  }

  return (
    <div className={`account-groups ${settings.theme}`} role="list">
      {grouped.map(([issuer, items]) => (
        <section key={issuer} className="account-group" aria-label={`${issuer} 分组`}>
          <h2 className="account-group__title">
            <span>{issuer}</span>
            <span className="account-group__count">{items.length}</span>
          </h2>
          <div className="account-grid">{items.map((a, i) => renderCard(a, i))}</div>
        </section>
      ))}
    </div>
  );
}
