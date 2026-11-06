/** Display formatting. One place so every page writes numbers the same way. */

const eur = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
const eurWhole = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

export function formatEur(amount: number, whole = false): string {
  return (whole ? eurWhole : eur).format(amount);
}

/** Signed amount, e.g. `+ €25.00` / `- €12.50`. */
export function formatSignedEur(amount: number): string {
  return `${amount >= 0 ? '+' : '-'} ${formatEur(Math.abs(amount))}`;
}

export function formatPercent(value: number, digits = 2): string {
  return `${Number(value.toFixed(digits))}%`;
}

/** Latency in ms, or "timeout" when the check got no answer. */
export function formatLatency(ms: number | null): string {
  return ms === null ? 'timeout' : `${Math.round(ms)} ms`;
}

export function formatNumber(value: number, digits = 1): string {
  return Number(value.toFixed(digits)).toLocaleString('en-GB');
}

/** Compact duration: 45 s, 16 min, 6h 4m, 14d 6h. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
// Fixed list: Intl's short month names differ per ICU version ("Sep" vs "Sept").
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Local wall-clock time: `11:14` or `11:14:08` (or `11:14:08.412` with `ms`). */
export function formatClock(iso: string, precision: 'min' | 's' | 'ms' = 's'): string {
  const d = new Date(iso);
  const base = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (precision === 'min') return base;
  const withSeconds = `${base}:${pad(d.getSeconds())}`;
  return precision === 'ms' ? `${withSeconds}.${pad(d.getMilliseconds(), 3)}` : withSeconds;
}

/** `today 11:08`, `yesterday 22:10`, or `4 Sep 21:40`. `now` is injectable for tests. */
export function formatWhen(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  const time = formatClock(iso, 'min');
  if (dayDiff === 0) return `today ${time}`;
  if (dayDiff === 1) return `yesterday ${time}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${time}`;
}

/** Bytes as MB/GB with one decimal for GB. */
export function formatBytes(bytes: number): string {
  const mb = bytes / 1024 ** 2;
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${formatNumber(mb / 1024, 1)} GB`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Weekday and local time, for weekly schedules: `Sun 03:00`. */
export function formatWeekly(iso: string): string {
  return `${WEEKDAYS[new Date(iso).getDay()]} ${formatClock(iso, 'min')}`;
}

/** A UTC instant as the value of an `<input type="datetime-local">` (local wall clock, minutes). */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The inverse of `toLocalInput`: a local wall-clock value back to UTC ISO; '' when empty or invalid. */
export function fromLocalInput(value: string): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}
