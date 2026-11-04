import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { site } from '@/lib/site';

// Fetched and self-hosted by Next at build time, so browsers never call Google for it.
const sans = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });

const description = 'Solar panels, inverters, batteries, bearings, belts and chains: real stock, at today\'s price. Search by part number or size and ask for a quote, no account needed.';

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: { default: 'Power Store · Steady power, honestly priced', template: '%s · Power Store' },
  description,
  applicationName: 'Power Store',
  keywords: ['solar panels Nigeria', 'inverter batteries', 'lithium battery', 'car battery', 'bearings', 'V-belts', 'roller chain', 'solar shop Lagos'],
  openGraph: { type: 'website', siteName: 'Power Store', title: 'Power Store · Steady power, honestly priced', description, locale: 'en_NG', url: '/' },
  twitter: { card: 'summary_large_image', title: 'Power Store · Steady power, honestly priced', description },
  alternates: { canonical: '/' },
};

export const viewport: Viewport = { themeColor: '#EEF1F4' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
