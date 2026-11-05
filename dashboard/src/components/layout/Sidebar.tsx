import { Link, NavLink } from 'react-router-dom';
import { useHost, useNavCounts } from '@/api/queries';
import { formatDuration } from '@/lib/format';
import { Icon, type IconName } from '../ui/Icon';
import { StatusDot, Swatch } from '../ui/primitives';
import { Logo } from './Logo';
import { routes } from '@/routes';

const MAIN_NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: routes.overview, label: 'Overview', icon: 'overview', end: true },
  { to: routes.heartbeats, label: 'Heartbeats', icon: 'heartbeat' },
  { to: routes.logs, label: 'Logs', icon: 'logs' },
  { to: routes.metrics, label: 'Metrics', icon: 'metrics' },
  { to: routes.alerts, label: 'Alerts', icon: 'alerts' },
];

const navClass = ({ isActive }: { isActive: boolean }) => `nav${isActive ? ' active' : ''}`;

export function Sidebar() {
  const counts = useNavCounts().data;
  const host = useHost().data;

  return (
    <aside className="side">
      <Link to={routes.overview} className="brand" aria-label="NexusWatch home">
        <Logo />
        NexusWatch
      </Link>

      <nav aria-label="Main navigation" className="navs">
        {MAIN_NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>
            <Icon name={item.icon} />
            {item.label}
            {item.icon === 'alerts' && !!counts?.openAlerts && (
              <span className="badge" aria-label={`${counts.openAlerts} open alerts`}>
                {counts.openAlerts}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div>
        <div className="sect">Projects</div>
        <nav aria-label="Projects" className="navs">
          <NavLink to={routes.project('nexusinfra')} className={navClass}>
            <Swatch color="var(--c-nx)" />
            NexusInfra
            <span className="cnt">{counts?.services.nexusinfra ?? ''}</span>
          </NavLink>
          <NavLink to={routes.project('finvault')} className={navClass}>
            <Swatch color="var(--c-fv)" />
            FinVault
            <span className="cnt">{counts?.services.finvault ?? ''}</span>
          </NavLink>
        </nav>
      </div>

      <div className="navs">
        <NavLink to={routes.settings} className={navClass}>
          <Icon name="settings" />
          Settings
        </NavLink>
      </div>

      {host && (
        <div className="host">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
            <StatusDot status={host.online ? 'up' : 'down'} live={host.online} />
            {host.name}
          </div>
          <div className="mono muted" style={{ fontSize: 12, lineHeight: 1.7 }}>
            {host.address}
            <br />
            uptime {formatDuration(host.uptimeSeconds)}
            <br />
            {host.nodesConnected} nodes connected
          </div>
        </div>
      )}
    </aside>
  );
}
