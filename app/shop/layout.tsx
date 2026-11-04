import type { Metadata } from 'next';

const description = "Today's prices on solar panels, inverters, batteries, bearings, belts and chains. Search by part number or size, add what you need, and ask for a quote.";

export const metadata: Metadata = {
  title: 'Shop',
  description,
  openGraph: { title: 'Shop · Power Store', description, url: '/shop' },
  twitter: { title: 'Shop · Power Store', description },
  alternates: { canonical: '/shop' },
};

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return children;
}
