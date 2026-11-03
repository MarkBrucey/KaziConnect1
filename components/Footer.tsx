import Link from 'next/link';
import { Wrap } from './ui';

export function Footer() {
  return (
    <footer className="border-t border-line pb-11 pt-[34px] text-[15px] text-muted">
      <Wrap>
        This website runs on the Kazi Connect API. Developers can explore every endpoint at <Link href="/docs">/docs</Link>.
      </Wrap>
    </footer>
  );
}
