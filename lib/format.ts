// How the website writes numbers, money and dates (kept from the original page).

export const num = (n: number): string =>
  Number(n).toLocaleString('en-KE', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });

export interface PayRange { min: number; max: number }

export const kesText = (p: PayRange): string => (p.min === p.max ? `KES ${num(p.min)}` : `KES ${num(p.min)} to ${num(p.max)}`);

export const cap = (s: string): string => String(s).charAt(0).toUpperCase() + String(s).slice(1);

export const firstName = (name: string): string => String(name).trim().split(/\s+/)[0];

// A date-time-local input value ("2027-01-15T09:00") -> the API's date-time ("2027-01-15T09:00:00Z")
export const toIso = (local: string): string => new Date(local).toISOString().replace(/\.\d{3}Z$/, 'Z');

// ...and back, in the reader's own time zone
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

// The earliest start the date picker allows: an hour from now
export const soonest = (): string => toLocalInput(new Date(Date.now() + 60 * 60 * 1000).toISOString());

export const readable = (iso: string): string =>
  new Date(iso).toLocaleString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// Kinds of work and counties suggested when posting a job (suggestions only: the API accepts any text).
export const KINDS = ['accommodation', 'campus', 'catering', 'cleaning', 'cooking', 'driving', 'electrical', 'events', 'gardening', 'moving', 'painting', 'plumbing', 'security', 'tutoring'];
export const COUNTIES = ['Kiambu', 'Kajiado', 'Kisumu', 'Machakos', 'Mombasa', 'Nairobi', 'Nakuru', 'Uasin Gishu'];
