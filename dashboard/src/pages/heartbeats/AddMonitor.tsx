/** "+ Add monitor": a name, a project, the URL to check and how often. Same validator as the collector. */
import { useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAddMonitor } from '@/api/queries';
import type { ProjectId } from '@/api/types';
import { Dialog } from '@/components/ui/Dialog';
import { MONITOR_INTERVALS, validateMonitor } from '@/lib/monitors';
import { routes } from '@/routes';
import { Field, fieldProps } from '../alerts/shared';

export function AddMonitorDialog({ onClose }: { onClose: () => void }) {
  const id = useId();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [project, setProject] = useState<ProjectId>('nexusinfra');
  const [url, setUrl] = useState('');
  const [interval, setInterval] = useState(30);
  const [submitted, setSubmitted] = useState(false);
  const add = useAddMonitor();

  const check = validateMonitor({ name, project, url, intervalSeconds: interval });
  const errorFor = (field: string, value: string) => (!check.ok && check.field === field && (submitted || value) ? check.error : undefined);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!check.ok) return;
    add.mutate(check.value, { onSuccess: (m) => navigate(routes.service(m.serviceId)) });
  };

  return (
    <Dialog
      title="Add monitor"
      description="NexusWatch checks this URL and alerts when it stops answering."
      onClose={onClose}
      size="sm"
      closeOnBackdrop={false}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" form={`${id}-form`} className="btn pri" disabled={add.isPending}>{add.isPending ? 'Adding…' : 'Add monitor'}</button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field id={`${id}-name`} label="Name" error={errorFor('name', name)}>
          <input {...fieldProps(`${id}-name`, errorFor('name', name))} className="inp" value={name} maxLength={60} placeholder="FinVault gateway" onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id={`${id}-url`} label="URL to check" error={errorFor('url', url)} hint="Answers 2xx when healthy. From the collector's container: a container name, or host.docker.internal for a published port.">
          <input {...fieldProps(`${id}-url`, errorFor('url', url), true)} className="inp mono" value={url} placeholder="http://finvault-gateway:8000/health" spellCheck={false} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <div className="frow">
          <Field id={`${id}-project`} label="Project">
            <select id={`${id}-project`} className="inp" value={project} onChange={(e) => setProject(e.target.value as ProjectId)}>
              <option value="nexusinfra">NexusInfra</option>
              <option value="finvault">FinVault</option>
            </select>
          </Field>
          <Field id={`${id}-interval`} label="Check every">
            <select id={`${id}-interval`} className="inp" value={interval} onChange={(e) => setInterval(Number(e.target.value))}>
              {MONITOR_INTERVALS.map((s) => <option key={s} value={s}>{s < 60 ? `${s} s` : `${s / 60} min`}</option>)}
            </select>
          </Field>
        </div>
        {add.isError && <div className="form-err" role="alert">{add.error instanceof Error ? add.error.message : 'Could not add the monitor'}</div>}
      </form>
    </Dialog>
  );
}
