import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { AuthProvider } from '@/components/AuthProvider';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { WakingNotice } from '@/components/WakingNotice';

export const metadata: Metadata = {
  title: 'Kazi Connect: find work nearby',
  description: 'Short jobs and services near where you stay in Kenya. Apply with your student ID and follow your application live.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* A plain link, not next/font: the build then needs no internet. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>
        <AuthProvider>
          <Header />
          <WakingNotice />
          <main id="top">{children}</main>
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}
