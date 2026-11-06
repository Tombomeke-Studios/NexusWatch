import { useState } from 'react';
import { useAlerts } from '@/api/queries';
import type { AlertRule, AlertsData } from '@/api/types';
import { Kpi, PageHeader, Segmented } from '@/components/ui/primitives';
import { QueryState } from '@/components/ui/QueryState';
import { config } from '@/lib/config';
import '@/styles/alerts.css';
import { ActiveAlerts, EscalationPanel, HistoryPanel, MaintenancePanel, RulesPanel, SilencesPanel } from './alerts/panels';
import { RuleEditor, type RuleEditorMode } from './alerts/RuleEditor';

type Tab = 'active' | 'rules' | 'silences' | 'maintenance' | 'escalation' | 'history';

export function AlertsPage() {
  const [tab, setTab] = useState<Tab>('active');
  const [editor, setEditor] = useState<RuleEditorMode | null>(null);
  const query = useAlerts();

  return (
    <>
      <PageHeader title="Alerts" subtitle={<>Rules, notifications and history for all your projects{config.useMocks && ' · sample data'}</>}>
        <button type="button" className="btn pri" disabled={!query.data} onClick={() => setEditor({ kind: 'new' })}>
          + New rule
        </button>
      </PageHeader>

      <QueryState query={query} skeletonHeight={800}>
        {(data) => (
          <>
            <Summary data={data} />
            <div style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
              <Segmented
                tabs
                label="Alert view"
                value={tab}
                onChange={setTab}
                options={[
                  { id: 'active', label: `Active (${data.active.length})` },
                  { id: 'rules', label: 'Rules' },
                  { id: 'silences', label: `Silences (${data.silences.length})` },
                  { id: 'maintenance', label: 'Maintenance' },
                  { id: 'escalation', label: 'Escalation' },
                  { id: 'history', label: 'History' },
                ]}
              />
            </div>
            {tab === 'active' && <ActiveAlerts data={data} />}
            {tab === 'rules' && <RulesPanel data={data} onNew={() => setEditor({ kind: 'new' })} onEdit={(rule: AlertRule) => setEditor({ kind: 'edit', rule })} />}
            {tab === 'silences' && <SilencesPanel data={data} />}
            {tab === 'maintenance' && <MaintenancePanel data={data} />}
            {tab === 'escalation' && <EscalationPanel data={data} />}
            {tab === 'history' && <HistoryPanel data={data} />}
            {editor && (
              <RuleEditor
                // A new key remounts the form when "Duplicate" switches modes, so the draft starts fresh.
                key={editor.kind === 'new' ? 'new' : `${editor.kind}-${editor.rule.id}`}
                mode={editor}
                policies={data.policies}
                onClose={() => setEditor(null)}
                onModeChange={setEditor}
              />
            )}
          </>
        )}
      </QueryState>
    </>
  );
}

function Summary({ data }: { data: AlertsData }) {
  const s = data.summary;
  const names = (sev: 'critical' | 'warning') => data.active.filter((a) => a.severity === sev).map((a) => a.title.split(' ')[0]).join(', ') || 'none';
  const mutedAlerts = data.active.filter((a) => a.silenceId).length;
  return (
    <section className="kpis" aria-label="Summary">
      <Kpi label="Critical" value={s.critical} valueColor="var(--down)" foot={names('critical')} />
      <Kpi label="Warning" value={s.warning} valueColor="var(--warn)" foot={names('warning')} />
      <Kpi
        label="Muted"
        value={s.muted}
        foot={`${s.muted === 1 ? '1 silence' : `${s.muted} silences`} · ${mutedAlerts} ${mutedAlerts === 1 ? 'alert' : 'alerts'} muted${s.inMaintenance ? ` · ${s.inMaintenance} in maintenance` : ''}`}
      />
      <Kpi label="Resolved (24h)" value={s.resolved24h} foot={`${s.resolvedAuto24h} resolved on their own`} />
      <Kpi label="Mean time to recover" value={s.mttrMinutes} unit="min" foot="last 30 days" />
    </section>
  );
}
