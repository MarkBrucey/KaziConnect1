import type { ReactNode } from 'react';

export const metadata = { title: 'Kazi Connect: find work nearby' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
