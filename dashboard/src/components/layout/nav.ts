import { matchPath } from 'react-router-dom';
import { routes } from '@/routes';
import type { IconName } from '../ui/Icon';

/**
 * Every navigation entry in the app, shared by the desktop sidebar and the mobile shell.
 * A new page adds ONE entry here; both shells pick it up. `tab: true` puts it in the
 * mobile bottom bar (keep that at four — the fifth slot is "More"); everything else
 * lands in the mobile "More" sheet automatically.
 */
export type NavGroup = 'main' | 'projects' | 'system';

export interface NavItem {
  to: string;
  label: string;
  group: NavGroup;
  icon?: IconName;
  /** Project colour for a swatch instead of an icon. */
  swatch?: string;
  /** Match the path exactly (only for `/`). */
  end?: boolean;
  /** Shown in the mobile bottom tab bar. */
  tab?: boolean;
  /** Carries the open-alert badge. */
  badge?: 'alerts';
  /** Key into the nav counts for a service count (projects). */
  count?: 'nexusinfra' | 'finvault';
}

export const NAV: NavItem[] = [
  { to: routes.overview, label: 'Overview', icon: 'overview', group: 'main', end: true, tab: true },
  { to: routes.heartbeats, label: 'Heartbeats', icon: 'heartbeat', group: 'main', tab: true },
  { to: routes.logs, label: 'Logs', icon: 'logs', group: 'main', tab: true },
  { to: routes.metrics, label: 'Metrics', icon: 'metrics', group: 'main' },
  { to: routes.alerts, label: 'Alerts', icon: 'alerts', group: 'main', tab: true, badge: 'alerts' },
  { to: routes.slo, label: 'SLOs', icon: 'slo', group: 'main' },
  { to: routes.incidents, label: 'Incidents', icon: 'incident', group: 'main' },
  { to: routes.project('nexusinfra'), label: 'NexusInfra', swatch: 'var(--c-nx)', group: 'projects', count: 'nexusinfra' },
  { to: routes.project('finvault'), label: 'FinVault', swatch: 'var(--c-fv)', group: 'projects', count: 'finvault' },
  { to: routes.business, label: 'Business', swatch: 'linear-gradient(135deg, var(--c-fv), var(--c-nx))', group: 'projects' },
  { to: routes.settings, label: 'Settings', icon: 'settings', group: 'system' },
];

export const navGroup = (group: NavGroup, items: NavItem[] = NAV) => items.filter((i) => i.group === group);

/** The bottom-bar tabs, in order. */
export const tabItems = (items: NavItem[] = NAV) => items.filter((i) => i.tab);

/** Everything that is not a tab: the contents of the mobile "More" sheet. */
export const moreItems = (items: NavItem[] = NAV) => items.filter((i) => !i.tab);

/** Pure: does this nav item match the current path (same rule as `NavLink`)? */
export function isNavActive(item: NavItem, pathname: string): boolean {
  return matchPath({ path: item.to, end: !!item.end }, pathname) !== null;
}

/** Pure: the "More" tab is active when the current page lives in the sheet. */
export const isMoreActive = (pathname: string, items: NavItem[] = NAV) => moreItems(items).some((i) => isNavActive(i, pathname));

/** Pure: the page title shown in the mobile top bar. */
export function titleFor(pathname: string, items: NavItem[] = NAV): string {
  const hit = items.find((i) => isNavActive(i, pathname));
  if (hit) return hit.label;
  if (matchPath('/services/:serviceId', pathname)) return 'Service';
  if (matchPath('/incidents/:id', pathname)) return 'Incident';
  return 'NexusWatch';
}
