import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useNavCounts } from '@/api/queries';
import { routes } from '@/routes';
import { Icon } from '../ui/Icon';
import { Sheet } from '../ui/Sheet';
import { HostCard } from './HostCard';
import { Logo } from './Logo';
import { isMoreActive, moreItems, tabItems, titleFor, type NavGroup } from './nav';
import { NavEntry } from './Sidebar';

/** Narrow screens: logo, current page title and the open-alert badge. Sticky under the status bar. */
export function MobileTopBar() {
  const { pathname } = useLocation();
  const open = useNavCounts().data?.openAlerts ?? 0;
  return (
    <header className="topbar">
      <Link to={routes.overview} className="topbar-logo" aria-label="NexusWatch home">
        <Logo size={26} />
      </Link>
      <span className="topbar-title">{titleFor(pathname)}</span>
      <Link to={routes.alerts} className="topbar-alerts" aria-label={open ? `${open} open alerts` : 'Alerts, none open'}>
        <Icon name="alerts" />
        {open > 0 && <span className="badge" aria-hidden="true">{open}</span>}
      </Link>
    </header>
  );
}

const SHEET_GROUPS: { group: NavGroup; title?: string }[] = [
  { group: 'main' },
  { group: 'projects', title: 'Projects' },
  { group: 'system' },
];

/** Narrow screens: four tabs plus "More", which opens a sheet with every other page from `nav.ts`. */
export function MobileTabBar() {
  const { pathname } = useLocation();
  const counts = useNavCounts().data;
  const [open, setOpen] = useState(false);

  // Any navigation closes the sheet.
  useEffect(() => setOpen(false), [pathname]);

  const more = moreItems();
  const moreActive = isMoreActive(pathname);

  return (
    <>
      <nav aria-label="Main navigation" className="tabbar">
        {tabItems().map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
            <span className="tab-ic">
              {item.icon && <Icon name={item.icon} />}
              {item.badge === 'alerts' && !!counts?.openAlerts && (
                <span className="tab-badge" aria-label={`${counts.openAlerts} open`}>{counts.openAlerts}</span>
              )}
            </span>
            {item.label}
          </NavLink>
        ))}
        <button
          type="button"
          className={`tab${moreActive || open ? ' active' : ''}`}
          aria-expanded={open}
          aria-controls="more-sheet"
          aria-haspopup="dialog"
          aria-current={moreActive ? 'page' : undefined}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="tab-ic"><Icon name="more" /></span>
          More
        </button>
      </nav>

      <Sheet id="more-sheet" title="More" open={open} onClose={() => setOpen(false)}>
        <div className="sheet-nav">
          {SHEET_GROUPS.map(({ group, title }) => {
            const items = more.filter((i) => i.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group}>
                {title && <div className="sect">{title}</div>}
                <nav aria-label={title ?? (group === 'main' ? 'More pages' : 'System')} className="navs">
                  {items.map((item) => (
                    <NavEntry key={item.to} item={item} counts={counts} onClick={() => setOpen(false)} />
                  ))}
                </nav>
              </div>
            );
          })}
          <HostCard />
        </div>
      </Sheet>
    </>
  );
}
