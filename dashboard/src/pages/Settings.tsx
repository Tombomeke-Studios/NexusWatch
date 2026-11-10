import { useState } from 'react';
import { useSettings, useTestChannel, useUpdateSettings } from '@/api/queries';
import type { Channel, ChannelId, SettingsData, Severity } from '@/api/types';
import { Card, CardHeader } from '@/components/ui/Card';
import { StackBar } from '@/components/ui/charts';
import { Icon } from '@/components/ui/Icon';
import { PageHeader, Pill, Segmented, Swatch, Switch } from '@/components/ui/primitives';
import { QueryState } from '@/components/ui/QueryState';
import { config } from '@/lib/config';
import { formatBytes, formatNumber } from '@/lib/format';
import { severityLabel, severityPill, statusLabel, statusPill } from '@/lib/status';
import { useTheme, type ThemePreference } from '@/theme';

type Tab = 'agents' | 'notifications' | 'storage';
const TABS: { id: Tab; label: string }[] = [
  { id: 'agents', label: 'Agents' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'storage', label: 'Storage & appearance' },
];

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('agents');
  const query = useSettings();
  return (
    <>
      <PageHeader title="Settings" subtitle={<>Agents, notifications, storage and appearance{config.useMocks && ' · sample data'}</>} />
      <div style={{ alignSelf: 'flex-start' }}>
        <Segmented tabs label="Settings" options={TABS} value={tab} onChange={setTab} />
      </div>
      <QueryState query={query} skeletonHeight={600}>
        {(data) => (
          <>
            {tab === 'agents' && <Agents data={data} />}
            {tab === 'notifications' && <Notifications data={data} />}
            {tab === 'storage' && <StorageAndAppearance data={data} />}
          </>
        )}
      </QueryState>
    </>
  );
}

function Agents({ data }: { data: SettingsData }) {
  const snippet = [
    'docker run -d --name nexuswatch-agent --restart unless-stopped \\',
    `  -e NW_SERVER=${data.serverUrl} \\`,
    '  -e NW_TOKEN=nw_agent_[YOUR-TOKEN] \\',
    '  -v /var/run/docker.sock:/var/run/docker.sock:ro \\',
    '  nexuswatch/agent:latest',
  ].join('\n');
  return (
    <>
      <Card labelledBy="ag">
        <CardHeader id="ag" title="Node agents" hint="send heartbeats, metrics and logs to your home server" end={<button type="button" className="btn pri" disabled title="Coming soon">+ Add agent</button>} />
        <div className="tbl">
          <div className="tr th" style={{ minWidth: 760 }}>
            <span style={{ flex: '2 1 160px' }}>Name</span>
            <span style={{ flex: '2 1 200px' }}>Token</span>
            <span style={{ flex: '1 1 80px' }}>Version</span>
            <span style={{ flex: '1 1 110px' }}>Last seen</span>
            <span style={{ flex: '1 1 90px' }}>Status</span>
            <span className="r" style={{ flex: '0 0 80px' }}>Action</span>
          </div>
          {data.agents.map((a) => (
            <div key={a.id} className="tr" style={{ minWidth: 760 }}>
              <span style={{ flex: '2 1 160px', fontWeight: 600 }}>
                {a.name}
                <span className="mono subtle" style={{ fontWeight: 400, fontSize: 12, display: 'block' }}>{a.host}</span>
              </span>
              <span className="mono muted" data-label="Token" style={{ flex: '2 1 200px', fontSize: 12.5 }}>nw_agent_••••••••{a.tokenHint}</span>
              <span className="mono muted" data-label="Version" style={{ flex: '1 1 80px' }}>{a.version}</span>
              <span className="mono muted" data-label="Last seen" style={{ flex: '1 1 110px' }}>{a.lastSeenSeconds} s ago</span>
              <span style={{ flex: '1 1 90px' }}><Pill tone={statusPill[a.status]}>{statusLabel[a.status]}</Pill></span>
              <span className="r" style={{ flex: '0 0 80px' }}>
                <button type="button" className="btn sm" disabled title="Coming soon">Rotate</button>
              </span>
            </div>
          ))}
        </div>
      </Card>
      <Card padded labelledBy="in">
        <CardHeader flat id="in" title="Connect a new node" hint="run this on the machine you want to monitor" />
        <pre className="code">{snippet}</pre>
      </Card>
    </>
  );
}

const CHANNEL_COLUMNS: { id: ChannelId; label: string }[] = [
  { id: 'discord', label: 'Discord' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'email', label: 'Email' },
  { id: 'push', label: 'Push' },
];
const SEVERITIES: Severity[] = ['critical', 'warning', 'info'];

/** One channel: what it is, where it sends (masked), a test button with its outcome, and its switch. */
function ChannelRow({ channel: c, onToggle }: { channel: Channel; onToggle: (enabled: boolean) => void }) {
  const test = useTestChannel();
  const outcome = test.isError ? { ok: false, detail: 'The test could not be started' } : test.data;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 20px', padding: '16px 20px', borderBottom: '1px solid var(--surface2)' }}>
      <div style={{ flex: '1 1 220px' }}>
        <div style={{ fontWeight: 600 }}>{c.name}</div>
        <div className="muted" style={{ fontSize: 13 }}>{c.description}</div>
      </div>
      {c.configured ? (
        <label style={{ flex: '2 1 300px' }}>
          <span className="sr-only">{c.name} target</span>
          {/* Keyed on the value: an uncontrolled input would keep the text it was first rendered with. */}
          <input key={c.target} className="inp" type="text" defaultValue={c.target} readOnly />
        </label>
      ) : (
        // Plain text, so the variable names wrap instead of being cut off in a field.
        <div className="mono subtle" style={{ flex: '2 1 300px', fontSize: 12.5, overflowWrap: 'anywhere' }}>{c.target}</div>
      )}
      <button
        type="button"
        className="btn"
        disabled={!c.configured || test.isPending}
        title={c.configured ? undefined : 'Set its target on the collector first'}
        onClick={() => test.mutate(c.id)}
      >
        {test.isPending ? 'Sending…' : 'Send test'}
      </button>
      <Switch on={c.enabled} label={`${c.name} enabled`} onChange={onToggle} />
      {/* Always mounted so a screen reader announces the outcome when it arrives. */}
      <div role="status" style={{ flex: '1 1 100%', fontSize: 13, color: outcome?.ok ? 'var(--ok)' : 'var(--down)' }} hidden={!outcome || test.isPending}>
        {outcome && (outcome.ok ? `Test sent — ${outcome.detail}` : `Test failed — ${outcome.detail}`)}
      </div>
    </div>
  );
}

function Notifications({ data }: { data: SettingsData }) {
  const update = useUpdateSettings();
  const toggleChannel = (id: ChannelId, enabled: boolean) => update.mutate({ channels: data.channels.map((c) => (c.id === id ? { ...c, enabled } : c)) });
  const toggleRoute = (sev: Severity, ch: ChannelId) =>
    update.mutate({ routing: { ...data.routing, [sev]: { ...data.routing[sev], [ch]: !data.routing[sev][ch] } } });

  return (
    <>
      <Card labelledBy="kn">
        <CardHeader id="kn" title="Channels" hint="where notifications go" />
        {data.channels.map((c) => (
          <ChannelRow key={c.id} channel={c} onToggle={(v) => toggleChannel(c.id, v)} />
        ))}
      </Card>

      <Card labelledBy="rt">
        <CardHeader id="rt" title="Routing by severity" hint="which severity goes to which channel" />
        <div className="tbl">
          <div className="tr th" style={{ minWidth: 640 }}>
            <span style={{ flex: '2 1 160px' }}>Severity</span>
            {CHANNEL_COLUMNS.map((c) => (
              <span key={c.id} style={{ flex: '1 1 90px', textAlign: 'center' }}>{c.label}</span>
            ))}
          </div>
          {SEVERITIES.map((sev) => (
            <div key={sev} className="tr" style={{ minWidth: 640 }}>
              <span style={{ flex: '2 1 160px' }}><Pill tone={severityPill[sev]}>{severityLabel[sev]}</Pill></span>
              {CHANNEL_COLUMNS.map((ch) => {
                const on = data.routing[sev][ch.id];
                return (
                  <span key={ch.id} data-label={ch.label} style={{ flex: '1 1 90px', display: 'flex', justifyContent: 'center' }}>
                    <button
                      type="button"
                      className={`chk${on ? ' on' : ''}`}
                      role="checkbox"
                      aria-checked={on}
                      aria-label={`${severityLabel[sev]} via ${ch.label}`}
                      onClick={() => toggleRoute(sev, ch.id)}
                    >
                      {on && <Icon name="check" style={{ width: 14, height: 14, strokeWidth: 3 }} />}
                    </button>
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

const THEME_OPTIONS: { id: ThemePreference; title: string; note: string; swatches: string[] }[] = [
  { id: 'dark', title: 'Dark', note: 'Follows NexusInfra · deep blue-black with indigo.', swatches: ['#0b0e14', '#12161f', '#818cf8'] },
  { id: 'light', title: 'Light', note: 'Follows NexusInfra light · AA-contrast colours.', swatches: ['#f6f7f9', '#ffffff', '#4f46e5'] },
  { id: 'system', title: 'System', note: 'Switches along with your operating system.', swatches: ['linear-gradient(90deg,#0b0e14,#f6f7f9)'] },
];

function StorageAndAppearance({ data }: { data: SettingsData }) {
  const update = useUpdateSettings();
  const { preference, setPreference } = useTheme();
  const total = data.storage.totalBytes;
  const colors = ['var(--c-nx)', 'var(--c-fv)', 'var(--c-vi)'];

  return (
    <>
      <div className="cols">
        <Card padded labelledBy="bw" style={{ flex: '1 1 420px', minWidth: 0 }}>
          <CardHeader flat id="bw" title="Retention" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {data.retention.map((r) => (
              <div key={r.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px' }}>
                <div style={{ flex: '1 1 160px' }}>
                  <div style={{ fontWeight: 600 }}>{r.label}</div>
                  <div className="muted small">{formatBytes(r.usedBytes)} in use</div>
                </div>
                <Segmented
                  mono
                  small
                  label={`${r.label} retention`}
                  options={r.options.map((o) => ({ id: o, label: o }))}
                  value={r.current}
                  onChange={(v) => update.mutate({ retention: data.retention.map((x) => (x.id === r.id ? { ...x, current: v } : x)) })}
                />
              </div>
            ))}
          </div>
        </Card>
        <Card padded labelledBy="op" style={{ flex: '1 1 360px', minWidth: 0 }}>
          <CardHeader flat id="op" title="Storage" />
          <div className="baseline">
            <span className="num" style={{ fontSize: 30 }}>{formatNumber(data.storage.usedBytes / 1024 ** 3)}</span>
            <span className="num subtle" style={{ fontSize: 16 }}>/ {formatBytes(total)}</span>
          </div>
          <div style={{ margin: '12px 0 16px' }}>
            <StackBar
              height={12}
              label={`Storage split: ${data.retention.map((r) => `${r.label} ${formatBytes(r.usedBytes)}`).join(', ')}`}
              parts={data.retention.map((r, i) => ({ pct: (r.usedBytes / data.storage.usedBytes) * 100, color: colors[i % colors.length] }))}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
            {data.retention.map((r, i) => (
              <div key={r.id} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <Swatch color={colors[i % colors.length]} />
                <span style={{ flex: 1 }}>{r.label}</span>
                <span className="mono muted">{formatBytes(r.usedBytes)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card padded labelledBy="wg">
        <CardHeader flat id="wg" title="Appearance" hint="stored in this browser" />
        <div role="radiogroup" aria-label="Theme" style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
          {THEME_OPTIONS.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={preference === t.id} className={`opt${preference === t.id ? ' on' : ''}`} onClick={() => setPreference(t.id)}>
              <div style={{ display: 'flex', gap: 6 }} aria-hidden="true">
                {t.swatches.map((s) => (
                  <span key={s} style={{ width: t.swatches.length === 1 ? 140 : 44, height: 28, borderRadius: 6, background: s, border: '1px solid var(--border2)' }} />
                ))}
              </div>
              <div style={{ fontWeight: 600 }}>
                {t.title}
                {t.id === 'dark' && <Pill tone="p-info" style={{ marginLeft: 6 }}>default</Pill>}
              </div>
              <div className="muted small">{t.note}</div>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginTop: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Swatch color="var(--c-nx)" size={18} style={{ borderRadius: 6 }} />
            <div>
              <div style={{ fontWeight: 600 }}>NexusInfra</div>
              <div className="mono subtle" style={{ fontSize: 12 }}>indigo #818cf8</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Swatch color="var(--c-fv)" size={18} style={{ borderRadius: 6 }} />
            <div>
              <div style={{ fontWeight: 600 }}>FinVault</div>
              <div className="mono subtle" style={{ fontSize: 12 }}>emerald #34d399</div>
            </div>
          </div>
        </div>
      </Card>
    </>
  );
}
