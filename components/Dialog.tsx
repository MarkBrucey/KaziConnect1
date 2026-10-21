'use client';

// A modal built on the browser's own <dialog>, styled like the original page's cards.
// Open it with `open`; it calls onClose when the person presses Escape or clicks outside it.
// Its content is only built while it is open, so a form never keeps what was typed last time.

import { useEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';

export function Dialog({ open, onClose, labelledBy, width = 520, children }: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  width?: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ '--dialog-width': `${width}px` } as CSSProperties}
      className="w-[min(var(--dialog-width),calc(100vw-28px))] rounded-[18px] border border-line px-[22px] pb-6 pt-7 shadow-[0_30px_80px_rgba(17,17,17,0.25)] sm:px-10 sm:pb-8 sm:pt-9"
    >
      {open ? children : null}
    </dialog>
  );
}

export function DialogHead({ id, title, children }: { id: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-[22px] text-center">
      <h3 id={id} className="m-0 text-2xl font-extrabold tracking-tight">{title}</h3>
      {children ? <p className="m-0 mt-1.5 text-muted">{children}</p> : null}
    </div>
  );
}
