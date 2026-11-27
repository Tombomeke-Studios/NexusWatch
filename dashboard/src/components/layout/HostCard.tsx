import { useHost } from '@/api/queries';
import { formatDuration } from '@/lib/format';
import { StatusDot } from '../ui/primitives';

/** The monitoring host: online state, address, uptime, connected nodes. Sidebar foot and More sheet. */
export function HostCard() {
  const host = useHost().data;
  if (!host) return null;
  return (
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
        {host.nodesConnected ? `${host.nodesConnected} node${host.nodesConnected === 1 ? '' : 's'} connected` : 'no nodes reporting'}
      </div>
    </div>
  );
}
