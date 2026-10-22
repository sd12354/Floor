import { Link, NavLink, Outlet } from 'react-router-dom';
import { LayoutGrid, Search, Tags, Package, Boxes, BookOpen, MessageSquare, Settings, LogOut, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useDashboard, useMe, useSignOut } from '@/api/hooks';
import { formatCents } from '@/lib/money';
import { Wordmark } from './Wordmark';

interface NavItem { to: string; label: string; icon: LucideIcon; mobile?: boolean }

const nav: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutGrid, mobile: true },
  { to: '/discovery', label: 'Discovery', icon: Search, mobile: true },
  // Desktop sidebar only: the mobile bar holds five tabs, so phones reach this from Settings and Discovery.
  { to: '/products', label: 'Your products', icon: Boxes },
  { to: '/listings', label: 'Listings', icon: Tags, mobile: true },
  { to: '/orders', label: 'Orders', icon: Package, mobile: true },
  { to: '/ledger', label: 'Ledger', icon: BookOpen },
  { to: '/messages', label: 'Messages', icon: MessageSquare },
  { to: '/settings', label: 'Settings', icon: Settings, mobile: true },
];

function FloatPeek() {
  const { data } = useDashboard();
  if (!data) return null;
  return (
    <div className="px-3 py-3 mt-auto border-t border-rule">
      <div className="text-[12px] text-muted">Float outstanding</div>
      <div className="num font-display text-[20px] leading-tight">{formatCents(data.float.outstandingCents)}</div>
      <div className="text-[12px] text-muted">across {data.float.byOrder.length} orders</div>
    </div>
  );
}

function AccountPeek() {
  const { data: user } = useMe();
  const signOut = useSignOut();
  return (
    <div className="px-3 py-3 border-t border-rule">
      <div className="text-[12px] text-muted">Signed in as</div>
      <div className="text-[13px] truncate" title={user?.email}>{user?.email}</div>
      <Link to="/welcome" className="mt-1.5 block text-[13px] text-muted hover:text-ink">Replay intro</Link>
      <button type="button" onClick={() => signOut.mutate()} className="mt-1.5 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink">
        <LogOut className="h-3.5 w-3.5" aria-hidden /> Sign out
      </button>
    </div>
  );
}

export function AppShell() {
  const signOut = useSignOut();
  return (
    <div className="min-h-dvh md:flex">
      <aside className="hidden md:flex md:flex-col md:w-[208px] md:shrink-0 md:sticky md:top-0 md:h-dvh bg-surface border-r border-rule">
        <div className="px-4 pt-4 pb-3">
          <Wordmark />
        </div>
        <nav aria-label="Main" className="flex flex-col gap-0.5 px-2">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded px-2.5 py-1.5 text-[14px]',
                  isActive ? 'bg-sunken text-ink font-medium' : 'text-muted hover:text-ink hover:bg-sunken/60',
                )
              }
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <FloatPeek />
        <AccountPeek />
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="md:hidden flex items-center justify-between px-4 h-12 bg-surface border-b border-rule sticky top-0 z-30">
          <Wordmark />
          <div className="flex items-center gap-4">
            <NavLink to="/messages" className="text-muted text-[13px] flex items-center gap-1.5">
              <MessageSquare className="h-4 w-4" aria-hidden /> Messages
            </NavLink>
            <button type="button" onClick={() => signOut.mutate()} className="text-muted text-[13px] flex items-center gap-1.5" aria-label="Sign out">
              <LogOut className="h-4 w-4" aria-hidden /> Sign out
            </button>
          </div>
        </header>

        <main className="flex-1 w-full max-w-page px-4 md:px-6 py-4 md:py-6 pb-[calc(env(safe-area-inset-bottom)+76px)] md:pb-8">
          <Outlet />
        </main>

        <nav
          aria-label="Main"
          className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-surface border-t border-rule grid grid-cols-5 pb-[env(safe-area-inset-bottom)]"
        >
          {nav
            .filter((n) => n.mobile)
            .map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  cn('flex flex-col items-center gap-0.5 py-2 text-[11px]', isActive ? 'text-ink' : 'text-muted')
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className={cn('h-5 w-5', isActive && 'text-accent')} aria-hidden />
                    {label}
                  </>
                )}
              </NavLink>
            ))}
        </nav>
      </div>
    </div>
  );
}
