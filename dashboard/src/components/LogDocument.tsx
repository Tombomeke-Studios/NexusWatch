import { Link } from 'react-router-dom';
import type { LogEntry } from '@/api/types';
import { formatClock } from '@/lib/format';
import { levelText } from '@/lib/status';
import { routes } from '@/routes';

/**
 * The full structured document behind a log line, pretty-printed as JSON.
 * Shared by the Logs page (selected line) and expandable log lists elsewhere.
 */
export function LogDocument({ entry, link }: { entry: LogEntry; link?: 'service' | 'logs' }) {
  const fields = Object.entries(entry.fields);
  return (
    <div style={{ borderTop: '1px solid var(--border2)', background: 'var(--code)', padding: '16px 20px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span className="subtle" style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' }}>Document</span>
        <span className="mono subtle" style={{ fontSize: 12 }}>
          {formatClock(entry.time, 'ms')} · {entry.service} · {entry.node}
        </span>
        {link === 'service' && entry.serviceId && (
          <Link to={routes.service(entry.serviceId)} style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 600 }}>
            Open service →
          </Link>
        )}
        {link === 'logs' && (
          <Link to={routes.logsFor(entry.service, entry.id)} style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 600 }}>
            Show in log stream →
          </Link>
        )}
      </div>
      <pre className="mono muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.75, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {'{\n'}
        {fields.map(([k, v], i) => (
          <span key={k}>
            {'  '}
            <span style={{ color: 'var(--primary)' }}>"{k}"</span>:{' '}
            <span style={{ color: typeof v === 'number' ? 'var(--warn)' : k === 'level' ? levelText[entry.level] : 'var(--text)' }}>{typeof v === 'string' ? `"${v}"` : String(v)}</span>
            {i < fields.length - 1 ? ',' : ''}
            {'\n'}
          </span>
        ))}
        {'}'}
      </pre>
    </div>
  );
}
