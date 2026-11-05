import { useEffect, useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import '@/styles/dialog.css';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[inert]'));
}

/** How many dialogs are open, so page scrolling is locked once and restored by the last to close. */
let openCount = 0;
let savedOverflow = '';

interface DialogProps {
  title: ReactNode;
  /** Short line under the title; becomes the dialog's accessible description. */
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Receives focus on open; defaults to the first focusable element. */
  initialFocus?: RefObject<HTMLElement | null>;
  size?: 'sm' | 'md' | 'lg';
  /** Close on a click outside the panel. Off for forms, where a stray click would lose input. */
  closeOnBackdrop?: boolean;
}

/**
 * Modal dialog: rendered in a portal, traps Tab inside, closes on Escape,
 * and returns focus to whatever opened it. Mount it to open, unmount to close.
 */
export function Dialog({ title, description, onClose, children, footer, initialFocus, size = 'md', closeOnBackdrop = true }: DialogProps) {
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = panel.current!;
    (initialFocus?.current ?? focusables(root)[0] ?? root).focus();
    if (openCount++ === 0) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    return () => {
      if (--openCount === 0) document.body.style.overflow = savedOverflow;
      if (opener?.isConnected) opener.focus();
    };
    // Focus moves only on open; initialFocus is read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    // A nested dialog's keys bubble through the React tree too; only the dialog they happened in handles them.
    if (!(e.target instanceof Element) || e.target.closest('.dlg') !== panel.current) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      close.current();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = focusables(panel.current!);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panel.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div
      className="dlg-back"
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) close.current();
      }}
    >
      <div
        ref={panel}
        className={`dlg ${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        aria-describedby={description ? `${id}-d` : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="dlg-h">
          <div className="grow">
            <h2 id={`${id}-t`} className="dlg-t">{title}</h2>
            {description && <div id={`${id}-d`} className="muted small">{description}</div>}
          </div>
          <button type="button" className="dlg-x" aria-label="Close" onClick={() => close.current()}>×</button>
        </div>
        <div className="dlg-b">{children}</div>
        {footer && <div className="dlg-f">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Asks before something irreversible. Cancel has focus, so Enter never confirms by accident. */
export function ConfirmDialog({ title, children, confirmLabel, onConfirm, onCancel, busy, danger = true }: {
  title: ReactNode;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  danger?: boolean;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      size="sm"
      initialFocus={cancel}
      footer={
        <>
          <button ref={cancel} type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="button" className={`btn ${danger ? 'danger' : 'pri'}`} disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
        </>
      }
    >
      <div className="muted">{children}</div>
    </Dialog>
  );
}
