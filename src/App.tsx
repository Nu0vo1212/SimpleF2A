import { useCallback, useMemo, useState } from 'react';
import { useVault } from './lib/context';
import { BackgroundLayer } from './components/BackgroundLayer';
import { GlassFilters } from './components/GlassFilters';
import { ToastHost } from './components/ToastHost';
import { TopBar } from './components/TopBar';
import { AccountList } from './components/AccountList';
import { EmptyState } from './components/EmptyState';
import { AddAccountDialog } from './components/AddAccountDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { ExportAccountDialog } from './components/ExportAccountDialog';
import { DeleteAccountConfirm } from './components/DangerDialogs';
import { MorphIcon, icons } from './components/Icons';
import type { OtpAccount } from './otp/types';

export default function App() {
  const { state, accounts, deleteAccount, toast } = useVault();
  const [query, setQuery] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportAccount, setExportAccount] = useState<OtpAccount | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OtpAccount | null>(null);

  const openAdd = useCallback(() => {
    setEditingId(null);
    setAddOpen(true);
  }, []);

  const openEdit = useCallback((account: OtpAccount) => {
    setEditingId(account.id);
    setAddOpen(true);
  }, []);

  const closeAdd = useCallback(() => {
    setAddOpen(false);
    setEditingId(null);
  }, []);

  const mainContent = useMemo(() => {
    if (state.loading) {
      return (
        <div className="loading-state" role="status" aria-live="polite">
          <MorphIcon
            icon={icons.loader}
            size={22}
            className="spin"
            reducedMotion="user"
            aria-hidden="true"
          />
          <span>正在读取本地数据…</span>
        </div>
      );
    }
    if (accounts.length === 0) {
      return <EmptyState onAdd={openAdd} />;
    }
    return (
      <AccountList
        accounts={accounts}
        query={query}
        onEdit={openEdit}
        onExport={setExportAccount}
        onDelete={setDeleteTarget}
      />
    );
  }, [accounts, state.loading, query, openAdd, openEdit]);

  return (
    <>
      <GlassFilters />
      <BackgroundLayer />

      <div className="app-shell">
        <TopBar
          onAdd={openAdd}
          onSettings={() => setSettingsOpen(true)}
          query={query}
          onQueryChange={setQuery}
        />

        <main className="app-main" id="main" tabIndex={-1}>
          <div className="app-main__inner">
            <div className="app-hero">
              <div className="app-hero__text">
                <h1 className="app-hero__title">你的验证码</h1>
                <p className="app-hero__subtitle">
                  <MorphIcon
                    icon={icons.shield}
                    size={14}
                    reducedMotion="user"
                    aria-hidden="true"
                  />
                  全部在本设备离线生成，账户数据仅保存在本机浏览器
                </p>
              </div>
              {accounts.length > 0 && (
                <div className="app-hero__count" aria-live="polite">
                  <span className="app-hero__count-num">{accounts.length}</span>
                  <span className="app-hero__count-label">个账户</span>
                </div>
              )}
            </div>

            {mainContent}

            <footer className="app-footer">
              <span>SimpleF2A · 零服务器 · 本地存储</span>
              <span className="app-footer__dot" aria-hidden="true">
                ·
              </span>
              <span>
                按 <kbd className="kbd">Ctrl/⌘ + Shift + L</kbd> 切换深浅色
              </span>
            </footer>
          </div>
        </main>
      </div>

      <AddAccountDialog open={addOpen} onClose={closeAdd} editingId={editingId} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ExportAccountDialog account={exportAccount} onClose={() => setExportAccount(null)} />
      <DeleteAccountConfirm
        open={!!deleteTarget}
        accountLabel={
          deleteTarget ? `${deleteTarget.issuer || '未命名'} · ${deleteTarget.account}` : ''
        }
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteAccount(deleteTarget.id);
          toast('账户已删除', 'success');
        }}
      />
      <ToastHost />
    </>
  );
}
