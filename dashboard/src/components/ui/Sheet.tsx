import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Pure: where Tab (or Shift+Tab) moves focus inside a trap of `count` elements. -1 = let it be. */
export function trapIndex(count: number, current: number, shift: boolean): number {
  if (count === 0) return -1;
  if (shift && current <= 0) return count - 1;
  if (!shift && current === count - 1) return 0;
  if (current === -1) return shift ? count - 1 : 0;
  return -1;
}

interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Visible heading, also the dialog's accessible name. */
  title: ReactNode;
  id?: string;
  /** `bottom`: a sheet sliding up from the bottom bar. `full`: covers the screen (log documents). */
  variant?: 'bottom' | 'full';
  children: ReactNode;
}

/**
 * A modal sheet for narrow screens: focus is trapped inside, Escape and the backdrop close it,
 * the page behind is inert and does not scroll, and focus returns to the opener on close.
 */
export function Sheet({ open, onClose, title, id, variant = 'bottom', children }: SheetProps) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const root = document.getElementById('root');
    root?.setAttribute('inert', '');
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const el = panel.current;
    (el?.querySelector<HTMLElement>('[data-autofocus]') ?? el)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const next = trapIndex(items.length, items.indexOf(document.activeElement as HTMLElement), e.shiftKey);
      if (next >= 0) {
        e.preventDefault();
        items[next].focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      root?.removeAttribute('inert');
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  const titleId = `${id ?? 'sheet'}-title`;
  return createPortal(
    <div className={`sheet-wrap ${variant}`}>
      <div className="sheet-backdrop" aria-hidden="true" onClick={onClose} />
      <div ref={panel} id={id} className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="sheet-head">
          <h2 className="h" id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
