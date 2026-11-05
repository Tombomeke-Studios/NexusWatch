import type { NodeSummary } from '@/api/types';
import { meterColor, statusPill, statusLabel } from '@/lib/status';
import { Meter } from './ui/charts';
import { Pill, StatusDot } from './ui/primitives';

/** A node with its CPU/memory/disk meters. Shared by Heartbeats and the NexusInfra project page. */
export function NodeCard({ node, showMeta = true }: { node: NodeSummary; showMeta?: boolean }) {
  return (
    <div className="box pad" style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <StatusDot status={node.status} ring size={10} />
        <span className="num" style={{ fontSize: 18 }}>{node.name}</span>
        <Pill tone={statusPill[node.status]} style={{ marginLeft: 'auto' }}>{statusLabel[node.status]}</Pill>
      </div>
      <div className="mono subtle" style={{ fontSize: 12 }}>
        {node.host} · beat {node.lastBeatSeconds} s ago
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {node.gauges.map((g) => (
          <div key={g.label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
              <span className="muted">{g.label}</span>
              <span className="mono">{g.text}</span>
            </div>
            <Meter pct={g.pct} color={meterColor(g.pct)} />
          </div>
        ))}
      </div>
      {showMeta && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Pill tone="p-mute" plain>{node.containers} containers</Pill>
          <Pill tone="p-mute" plain>agent {node.agentVersion}</Pill>
        </div>
      )}
    </div>
  );
}
