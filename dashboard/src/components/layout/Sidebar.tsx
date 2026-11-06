import { Link, NavLink } from 'react-router-dom';
import { useNavCounts } from '@/api/queries';
import type { NavCounts } from '@/api/types';
import { Icon } from '../ui/Icon';
import { Swatch } from '../ui/primitives';
import { HostCard } from './HostCard';
import { Logo } from './Logo';
import { navGroup, type NavItem } from './nav';
import { routes } from '@/routes';

const navClass = ({ isActive }: { isActive: boolean }) => `nav${isActive ? ' active' : ''}`;

/** One sidebar / More-sheet entry: icon or project swatch, label, alert badge or service count. */
export function NavEntry({ item, counts, onClick }: { item: NavItem; counts?: NavCounts; onClick?: () => void }) {
  return (
    <NavLink to={item.to} end={item.end} className={navClass} onClick={onClick}>
      {item.icon ? <Icon name={item.icon} /> : item.swatch && <Swatch color={item.swatch} />}
      {item.label}
      {item.badge === 'alerts' && !!counts?.openAlerts && (
        <span className="badge" aria-label={`${counts.openAlerts} open alerts`}>
          {counts.openAlerts}
        </span>
      )}
      {item.count && <span className="cnt">{counts?.services[item.count] ?? ''}</span>}
    </NavLink>
  );
}

/** The desktop sidebar (wider than 820px). Entries come from `nav.ts`. */
export function Sidebar() {
  const counts = useNavCounts().data;

  return (
    <aside className="side">
      <Link to={routes.overview} className="brand" aria-label="NexusWatch home">
        <Logo />
        NexusWatch
      </Link>

      <nav aria-label="Main navigation" className="navs">
        {navGroup('main').map((item) => <NavEntry key={item.to} item={item} counts={counts} />)}
      </nav>

      <div>
        <div className="sect">Projects</div>
        <nav aria-label="Projects" className="navs">
          {navGroup('projects').map((item) => <NavEntry key={item.to} item={item} counts={counts} />)}
        </nav>
      </div>

      <div className="navs">
        {navGroup('system').map((item) => <NavEntry key={item.to} item={item} counts={counts} />)}
      </div>

      <HostCard />
    </aside>
  );
}
