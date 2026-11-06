import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLogs } from '@/api/queries';
import type { LogLevel, LogQuery, LogsData, ProjectId, TimeRange } from '@/api/types';
import { LogDocument } from '@/components/LogDocument';
import { Card } from '@/components/ui/Card';
import { XAxis } from '@/components/ui/charts';
import { Icon } from '@/components/ui/Icon';
import { PageHeader, StatusDot, Swatch } from '@/components/ui/primitives';
import { EmptyState, QueryState } from '@/components/ui/QueryState';
import { Sheet } from '@/components/ui/Sheet';
import { config } from '@/lib/config';
import { useIsNarrow } from '@/lib/useMediaQuery';
import { formatClock, formatNumber } from '@/lib/format';
import { TIME_RANGES } from '@/lib/ranges';
import { levelText, projectName, projectText } from '@/lib/status';

const LEVEL_DOT: Record<string, string> = { error: 'var(--c-down)', warn: 'var(--c-warn)', info: 'var(--c-nx)', ok: 'var(--c-ok)' };

export function LogsPage() {
  // A deep link (/logs?q=…&entry=…) opens unfiltered on that search, with that line selected.
  const [params] = useSearchParams();
  const linkedQuery = params.get('q');
  const [draft, setDraft] = useState(linkedQuery ?? '');
  const [tail, setTail] = useState(false);
  const [query, setQuery] = useState<LogQuery>(
    linkedQuery !== null
      ? { query: linkedQuery, range: '24h', levels: [] }
      : { query: '', range: '24h', levels: ['error', 'warn'], project: 'finvault' },
  );
  const [selectedId, setSelectedId] = useState<string | null>(params.get('entry'));
  const logs = useLogs(query, tail);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setQuery((q) => ({ ...q, query: draft }));
  };
  const toggleLevel = (level: LogLevel) =>
    setQuery((q) => ({ ...q, levels: q.levels.includes(level) ? q.levels.filter((l) => l !== level) : [...q.levels, level] }));

  return (
    <>
      <PageHeader title="Logs" subtitle={<>Every container, service and node in one stream{config.useMocks && ' · sample data'}</>}>
        <button type="button" className="btn" aria-pressed={tail} onClick={() => setTail((t) => !t)}>
          <StatusDot live={tail} color={tail ? 'var(--c-ok)' : 'var(--subtle)'} />
          {tail ? 'Live tail on' : 'Live tail'}
        </button>
      </PageHeader>

      <form onSubmit={submit} style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <label className="box search" style={{ flex: '1 1 360px' }}>
          <Icon name="search" className="muted" />
          <span className="sr-only">Search logs</span>
          <input type="search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="message or service, e.g. healthcheck" />
        </label>
        <button type="submit" className="btn pri" style={{ minHeight: 46, padding: '0 22px' }}>
          Search
        </button>
        <label className="sr-only" htmlFor="log-range">Time range</label>
        <select
          id="log-range"
          className="btn mono"
          style={{ minHeight: 46 }}
          value={query.range}
          onChange={(e) => setQuery((q) => ({ ...q, range: e.target.value as TimeRange }))}
        >
          {TIME_RANGES.map((r) => (
            <option key={r.id} value={r.id}>Last {r.label}</option>
          ))}
        </select>
      </form>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <span className="subtle" style={{ fontSize: 12 }}>Filters</span>
        {query.project && (
          <button type="button" className="chip p-fv" onClick={() => setQuery((q) => ({ ...q, project: undefined }))} aria-label={`Remove filter project ${query.project}`}>
            <Swatch color={projectText[query.project]} /> project: {query.project} ✕
          </button>
        )}
        {query.levels.length > 0 && (
          <button type="button" className="chip p-info" onClick={() => setQuery((q) => ({ ...q, levels: [] }))} aria-label="Remove level filter">
            level: {query.levels.join(', ')} ✕
          </button>
        )}
        {!query.project && (
          <ProjectChip onPick={(project) => setQuery((q) => ({ ...q, project }))} />
        )}
      </div>

      <QueryState query={logs} skeletonHeight={700}>
        {(data) => (
          <LogsBody
            data={data}
            levels={query.levels}
            onToggleLevel={toggleLevel}
            onPickService={(svc) => {
              setDraft(svc);
              setQuery((q) => ({ ...q, query: svc }));
            }}
            selectedId={data.entries.some((e) => e.id === selectedId) ? selectedId : (data.entries[0]?.id ?? null)}
            onSelect={setSelectedId}
          />
        )}
      </QueryState>
    </>
  );
}

function ProjectChip({ onPick }: { onPick: (p: ProjectId) => void }) {
  return (
    <>
      {(['nexusinfra', 'finvault'] as const).map((p) => (
        <button key={p} type="button" className="chip muted" style={{ border: '1px dashed var(--border2)', background: 'transparent', fontWeight: 500 }} onClick={() => onPick(p)}>
          + project: {projectName[p]}
        </button>
      ))}
    </>
  );
}

function LogsBody({ data, levels, onToggleLevel, onPickService, selectedId, onSelect }: {
  data: LogsData;
  levels: LogLevel[];
  onToggleLevel: (l: LogLevel) => void;
  onPickService: (s: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  // Narrow screens: facets move into a sheet, and a tapped line opens its document full-screen.
  const narrow = useIsNarrow();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const peak = Math.max(1, ...data.histogram.map((b) => b.error + b.warn));
  const selected = data.entries.find((e) => e.id === selectedId) ?? null;

  const facets = (
    <Facets
      data={data}
      levels={levels}
      onToggleLevel={onToggleLevel}
      onPickService={(svc) => {
        setFiltersOpen(false);
        onPickService(svc);
      }}
    />
  );

  return (
    <>
      <Card labelledBy="hist" style={{ padding: '16px 20px' }}>
        <div className="bh flat" style={{ alignItems: 'baseline' }}>
          <h2 className="h" id="hist">
            <span className="num" style={{ fontSize: 22 }}>{formatNumber(data.total, 0)}</span> events
          </h2>
          <div className="legend end">
            <span><Swatch color="var(--c-down)" />error</span>
            <span><Swatch color="var(--c-warn)" />warn</span>
          </div>
        </div>
        <div aria-hidden="true" style={{ display: 'flex', alignItems: 'flex-end', gap: narrow ? 1 : 3, height: 110, borderBottom: '1px solid var(--border)' }}>
          {data.histogram.map((b, i) => (
            <div key={i} style={{ flex: '1 1 0', minWidth: 2, height: `${((b.error + b.warn) / peak) * 100}%`, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', borderRadius: '2px 2px 0 0', overflow: 'hidden' }}>
              <span style={{ display: 'block', flex: b.error, background: 'var(--c-down)' }} />
              <span style={{ display: 'block', flex: b.warn, background: 'var(--c-warn)' }} />
            </div>
          ))}
        </div>
        <XAxis labels={narrow ? ['-24h', '-16h', '-8h', 'now'] : ['-24h', '-20h', '-16h', '-12h', '-8h', '-4h', 'now']} />
      </Card>

      {narrow && (
        <>
          <button type="button" className="btn" aria-expanded={filtersOpen} aria-controls="log-fields" aria-haspopup="dialog" onClick={() => setFiltersOpen(true)}>
            <Icon name="filter" />
            Fields &amp; filters
            {levels.length > 0 && <span className="pill p-info">{levels.length} {levels.length > 1 ? 'levels' : 'level'}</span>}
          </button>
          <Sheet id="log-fields" title="Fields" open={filtersOpen} onClose={() => setFiltersOpen(false)}>
            {facets}
          </Sheet>
        </>
      )}

      <div className="cols">
        {!narrow && (
          <Card as="aside" label="Fields" style={{ flex: '0 1 240px', minWidth: 220, padding: '14px 10px' }}>
            {facets}
          </Card>
        )}

        <Card label="Log lines" style={{ flex: '3 1 560px', minWidth: 0, overflow: 'hidden' }}>
          {narrow ? (
            <>
              {data.entries.length === 0 && <EmptyState>No log lines match these filters.</EmptyState>}
              {data.entries.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className={`lr stacked${l.id === selectedId && docOpen ? ' sel' : ''}`}
                  aria-haspopup="dialog"
                  onClick={() => {
                    onSelect(l.id);
                    setDocOpen(true);
                  }}
                >
                  <span className="lr-meta">
                    <span className="subtle">{formatClock(l.time, 'ms')}</span>
                    <span style={{ fontWeight: 600, color: levelText[l.level], textTransform: 'uppercase' }}>{l.level}</span>
                    <span style={{ color: projectText[l.project] }}>{l.service}</span>
                  </span>
                  <span style={{ wordBreak: 'break-word' }}>{l.message}</span>
                </button>
              ))}
            </>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: 640 }}>
                <div className="lh">
                  <span style={{ flex: '0 0 96px' }}>Time</span>
                  <span style={{ flex: '0 0 58px' }}>Level</span>
                  <span style={{ flex: '0 0 130px' }}>Service</span>
                  <span style={{ flex: 1 }}>Message</span>
                </div>
                {data.entries.length === 0 && <EmptyState>No log lines match these filters.</EmptyState>}
                {data.entries.map((l) => (
                  <button key={l.id} type="button" className={`lr${l.id === selectedId ? ' sel' : ''}`} aria-pressed={l.id === selectedId} onClick={() => onSelect(l.id)}>
                    <span className="subtle" style={{ flex: '0 0 96px' }}>{formatClock(l.time, 'ms')}</span>
                    <span style={{ flex: '0 0 58px', fontWeight: 600, color: levelText[l.level], textTransform: 'uppercase' }}>{l.level}</span>
                    <span style={{ flex: '0 0 130px', color: projectText[l.project] }}>{l.service}</span>
                    <span style={{ flex: 1, wordBreak: 'break-word' }}>{l.message}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {selected && !narrow && <LogDocument entry={selected} link="service" />}
        </Card>
      </div>

      {narrow && selected && (
        <Sheet
          id="log-document"
          variant="full"
          title={<span className="mono" style={{ fontSize: 14 }}>{selected.service}</span>}
          open={docOpen}
          onClose={() => setDocOpen(false)}
        >
          <p className="mono" style={{ margin: 0, padding: '16px 20px', fontSize: 13, lineHeight: 1.6, wordBreak: 'break-word' }}>
            <span style={{ fontWeight: 600, color: levelText[selected.level], textTransform: 'uppercase', marginRight: 8 }}>{selected.level}</span>
            {selected.message}
          </p>
          <LogDocument entry={selected} link="service" />
        </Sheet>
      )}
    </>
  );
}

function Facets({ data, levels, onToggleLevel, onPickService }: {
  data: LogsData;
  levels: LogLevel[];
  onToggleLevel: (l: LogLevel) => void;
  onPickService: (s: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <div className="fh">Level</div>
        {data.facets.level.map((f) => (
          <button key={f.value} type="button" className={`fac${levels.includes(f.value as LogLevel) ? ' on' : ''}`} aria-pressed={levels.includes(f.value as LogLevel)} onClick={() => onToggleLevel(f.value as LogLevel)}>
            <StatusDot color={LEVEL_DOT[f.value]} />
            <span style={{ flex: 1 }}>{f.value}</span>
            <span className="muted">{f.count}</span>
          </button>
        ))}
      </div>
      <div>
        <div className="fh">Service</div>
        {data.facets.service.map((f) => (
          <button key={f.value} type="button" className="fac" onClick={() => onPickService(f.value)}>
            <Swatch color={['rabbitmq', 'billing-bridge'].includes(f.value) ? 'var(--c-nx)' : 'var(--c-fv)'} />
            <span style={{ flex: 1 }}>{f.value}</span>
            <span className="muted">{f.count}</span>
          </button>
        ))}
      </div>
      <div>
        <div className="fh">Node</div>
        {data.facets.node.map((f) => (
          <div key={f.value} className="fac" style={{ cursor: 'default' }}>
            <span style={{ flex: 1 }}>{f.value}</span>
            <span className="muted">{f.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
