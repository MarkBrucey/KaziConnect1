// The small pieces every page is built from. Tailwind classes only; the colours are the ones in globals.css.

import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react';
import Link from 'next/link';

const BUTTON_BASE = 'inline-flex items-center justify-center rounded-md px-[22px] py-3 font-semibold no-underline cursor-pointer whitespace-nowrap disabled:opacity-60 disabled:cursor-wait';
const BUTTON_LOOK = {
  solid: 'bg-brown text-white hover:bg-brown-dark',
  outline: 'bg-white text-ink border border-line hover:bg-cream',
  danger: 'bg-white text-bad border border-bad',
} as const;

type Look = keyof typeof BUTTON_LOOK;

export function buttonClass(look: Look = 'solid', { pill = false, full = false, small = false }: { pill?: boolean; full?: boolean; small?: boolean } = {}): string {
  return [
    BUTTON_BASE, BUTTON_LOOK[look],
    pill ? '!rounded-full !px-5 !py-2.5' : '',
    small ? '!px-[18px] !py-[9px] text-[15px]' : '',
    full ? 'w-full !p-[15px] text-[17px]' : '',
  ].filter(Boolean).join(' ');
}

export function Button({ look = 'solid', pill, full, small, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { look?: Look; pill?: boolean; full?: boolean; small?: boolean }) {
  return <button type="button" {...props} className={`${buttonClass(look, { pill, full, small })} ${className}`} />;
}

export function LinkButton({ look = 'solid', pill, full, small, className = '', ...props }: ComponentProps<typeof Link> & { look?: Look; pill?: boolean; full?: boolean; small?: boolean }) {
  return <Link {...props} className={`${buttonClass(look, { pill, full, small })} ${className}`} />;
}

// A button that looks like a link, for "Forgot password?" and "Not now".
export function TextButton({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className={`cursor-pointer border-0 bg-transparent p-0 font-semibold text-ink underline ${className}`} />;
}

const STATUS_LOOK: Record<string, string> = {
  pending: 'bg-cream text-brown border border-line',
  accepted: 'bg-ok-soft text-ok',
  active: 'bg-ok-soft text-ok',
  filled: 'bg-tag text-[#5A5550]',
  closed: 'bg-tag text-[#5A5550]',
  cancelled: 'bg-bad-soft text-bad',
  declined: 'bg-bad-soft text-bad',
};

export function StatusPill({ status, children }: { status: string; children: ReactNode }) {
  return <span className={`inline-block rounded-full px-3.5 py-1 text-[15px] font-bold ${STATUS_LOOK[status] || ''}`}>{children}</span>;
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="self-start rounded-full bg-tag px-3 py-[3px] text-[15px] font-semibold text-[#4A4541]">{children}</span>;
}

export function UrgentTag() {
  return <span className="rounded-full bg-tag px-[11px] py-[3px] text-sm font-bold text-ink">Urgent</span>;
}

export function Wrap({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto max-w-[1240px] px-5 sm:px-10 ${className}`}>{children}</div>;
}

// The black band with a heading that opens the dashboard and the applications page.
export function Band({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="bg-black pb-11 pt-[52px] text-white">
      <Wrap>
        <h2 className="mb-1.5 text-[34px] font-extrabold leading-[1.15] tracking-tight text-white sm:text-[40px]">{title}</h2>
        {children ? <p className="m-0 text-lg text-[#BDBDBD]">{children}</p> : null}
      </Wrap>
    </div>
  );
}

export function EmptyBox({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-edge bg-cream px-6 py-12 text-center">
      <h3 className="mb-1.5 text-[22px] font-bold">{title}</h3>
      {children ? <p className="mb-[18px] text-muted">{children}</p> : null}
      {action}
    </div>
  );
}

export const ErrorText = ({ children, className = '' }: { children: ReactNode; className?: string }) =>
  <p role="alert" className={`m-0 font-semibold text-bad ${className}`}>{children}</p>;

export const SuccessText = ({ children, className = '' }: { children: ReactNode; className?: string }) =>
  <p role="status" className={`mb-3.5 font-semibold text-ok ${className}`}>{children}</p>;

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="grid gap-[7px] font-semibold">
      <span>{label}{hint ? <> <span className="text-sm font-normal text-muted">{hint}</span></> : null}</span>
      {children}
    </label>
  );
}

// A card for one job or one offer in a dashboard list.
export function ListCard({ id, children }: { id?: string; children: ReactNode }) {
  return <li id={id} className="rounded-xl border border-edge px-6 py-[22px]">{children}</li>;
}
