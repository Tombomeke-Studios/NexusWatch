import type { ReactNode } from 'react';
import { ApiError } from '@/api/client';
import { useSettings } from '@/api/queries';
import type { Channel, ChannelId } from '@/api/types';

/** Shown until Settings has loaded, so a channel never renders as a bare id. */
const FALLBACK_NAMES: Record<ChannelId, string> = { discord: 'Discord', telegram: 'Telegram', email: 'Email', push: 'Push (ntfy)' };

/** The notification channels configured in Settings, plus a name lookup. */
export function useChannels(): { channels: Channel[]; name: (id: ChannelId) => string } {
  const { data } = useSettings();
  const channels = data?.channels ?? [];
  return { channels, name: (id) => channels.find((c) => c.id === id)?.name ?? FALLBACK_NAMES[id] };
}

/** The message to show for a failed mutation: the backend's 422 reason, or a generic line. */
export function mutationError(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof ApiError || error instanceof Error) return error.message || 'Something went wrong.';
  return 'Something went wrong.';
}

export function FormError({ error }: { error: unknown }) {
  const message = mutationError(error);
  return message ? <div className="form-err" role="alert">{message}</div> : null;
}

/** A labelled form field with its hint and error wired to the control through aria attributes. */
export function Field({ id, label, error, hint, children, narrow }: { id: string; label: ReactNode; error?: string; hint?: ReactNode; children: ReactNode; narrow?: boolean }) {
  return (
    <div className={`fld${narrow ? ' narrow' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && !error && <div id={`${id}-hint`} className="hint">{hint}</div>}
      {error && <div id={`${id}-err`} className="err">{error}</div>}
    </div>
  );
}

/** Props that tie an input to its Field's error/hint. */
export function fieldProps(id: string, error?: string, hint?: boolean) {
  return {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-err` : hint ? `${id}-hint` : undefined,
  } as const;
}
