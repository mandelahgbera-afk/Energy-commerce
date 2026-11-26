import type { Metadata } from 'next';

const description = 'Add the appliances you will run and see the inverter, battery and solar panels you need, then ask the shop for a quote on a matching set.';

export const metadata: Metadata = {
  title: 'Solar sizer',
  description,
  openGraph: { title: 'Solar sizer · Power Store', description, url: '/shop/sizer' },
  twitter: { title: 'Solar sizer · Power Store', description },
  alternates: { canonical: '/shop/sizer' },
};

export default function SizerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
