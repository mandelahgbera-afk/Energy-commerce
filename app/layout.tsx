import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Power Store',
  description: 'The shop runs on its database.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
