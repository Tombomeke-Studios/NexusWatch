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

/** Burn rate as a multiple, e.g. `14.4×`; `no data` when unknown. */
export function formatBurn(rate: number | null): string {
  if (rate === null) return 'no data';
  return `${rate >= 100 ? Math.round(rate) : Number(rate.toFixed(1))}×`;
}

/** Error budget in minutes, signed when overspent: `21.6 min`, `-33 min`; `no data` when unknown. */
export function formatBudgetMinutes(minutes: number | null): string {
  if (minutes === null) return 'no data';
  const abs = Math.abs(minutes);
  const text = abs >= 100 ? formatDuration(abs * 60) : `${Number(abs.toFixed(1))} min`;
  return minutes < 0 ? `-${text}` : text;
}

/** Time until an error budget runs out: `never`, `exhausted`, `6h 4m`; `no data` when unknown. */
export function formatExhaustion(minutes: number | null): string {
  if (minutes === null) return 'no data';
  if (minutes === Infinity) return 'never';
  if (minutes <= 0) return 'exhausted';
  return formatDuration(minutes * 60);
}
