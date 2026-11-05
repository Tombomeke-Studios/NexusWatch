import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface CardProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Adds the standard 18/20px padding. */
  padded?: boolean;
  /** Tints the border with a project colour. */
  accent?: 'nx' | 'fv';
  labelledBy?: string;
  label?: string;
  as?: 'section' | 'div' | 'article' | 'aside';
}

export function Card({ children, className = '', style, padded, accent, labelledBy, label, as: Tag = 'section' }: CardProps) {
  const cls = ['box', padded && 'pad', accent && `bd-${accent}`, className].filter(Boolean).join(' ');
  return (
    <Tag className={cls} style={style} aria-labelledby={labelledBy} aria-label={label}>
      {children}
    </Tag>
  );
}

interface CardHeaderProps {
  id?: string;
  title: ReactNode;
  hint?: ReactNode;
  /** Right-aligned content (legend, buttons). */
  end?: ReactNode;
  /** A "See all →" style link on the right. */
  link?: { to: string; label: string };
  /** Header inside a padded card: no own padding, no divider. */
  flat?: boolean;
}

export function CardHeader({ id, title, hint, end, link, flat }: CardHeaderProps) {
  return (
    <div className={`bh${flat ? ' flat' : ''}`}>
      <h2 className="h" id={id}>
        {title}
      </h2>
      {hint && <span className="subtle" style={{ fontSize: 13 }}>{hint}</span>}
      {end && <div className="end">{end}</div>}
      {link && (
        <Link className="end" to={link.to}>
          {link.label} →
        </Link>
      )}
    </div>
  );
}
