/**
 * Set up a notification channel. Every field is write-only: the form starts empty (the backend never
 * returns a target), secrets are password fields, and the same validator as the backend checks each
 * field as you type. Saving replaces the channel's whole target.
 */
import { useId, useState, type FormEvent } from 'react';
import { useConfigureChannel } from '@/api/queries';
import type { Channel } from '@/api/types';
import { Dialog } from '@/components/ui/Dialog';
import { CHANNEL_FIELDS, validateChannelConfig } from '@/lib/channels';
import { Field, fieldProps } from '../alerts/shared';

export function ChannelSetupDialog({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const id = useId();
  const fields = CHANNEL_FIELDS[channel.id];
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.name, ''])));
  const [submitted, setSubmitted] = useState(false);
  const save = useConfigureChannel();

  const check = validateChannelConfig(channel.id, values);
  // Show a field's problem once it has text, or after a submit attempt.
  const errorFor = (name: string) => (!check.ok && check.field === name && (submitted || values[name]) ? check.error : undefined);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!check.ok) return;
    save.mutate({ id: channel.id, body: values }, { onSuccess: onClose });
  };

  return (
    <Dialog
      title={`${channel.configured ? 'Change' : 'Set up'} ${channel.name}`}
      description="Stored on the collector and never shown again — only a masked hint."
      onClose={onClose}
      size="sm"
      closeOnBackdrop={false}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" form={`${id}-form`} className="btn pri" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }} autoComplete="off">
        {fields.map((f) => {
          const fid = `${id}-${f.name}`;
          const error = errorFor(f.name);
          return (
            <Field key={f.name} id={fid} label={`${f.label}${f.optional ? ' (optional)' : ''}`} error={error} hint={f.help}>
              <input
                {...fieldProps(fid, error, Boolean(f.help))}
                className="inp"
                type={f.secret ? 'password' : 'text'}
                autoComplete={f.secret ? 'new-password' : 'off'}
                spellCheck={false}
                placeholder={f.placeholder}
                value={values[f.name]}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              />
            </Field>
          );
        })}
        {save.isError && <div className="form-err" role="alert">{save.error instanceof Error ? save.error.message : 'Could not save'}</div>}
      </form>
    </Dialog>
  );
}
