// Words and links shared by the orders board, the rider's screen and the tracking page.
import { friendly } from '@/lib/errors';
import { formatNaira } from '@/lib/money';

export type Stage = 'placed' | 'approval' | 'paid' | 'on_the_way' | 'delivered' | 'cancelled';
export const stageWords: Record<Stage, string> = {
  placed: 'Waiting for money', approval: 'Waiting for the owner', paid: 'Paid, ready to go', on_the_way: 'On the way', delivered: 'Delivered', cancelled: 'Cancelled',
};
export const timeWords: Record<string, string> = { morning: 'morning, 9 to 12', afternoon: 'afternoon, 12 to 4', evening: 'evening, 4 to 7' };

export const dayWords = (iso: string, time?: string | null) =>
  `${new Date(`${iso}T12:00:00`).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' })}${time ? `, ${time}` : ''}`;
export const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};
export const localPhone = (p: string) => (p.startsWith('234') ? `0${p.slice(3)}` : p);
export const today = () => new Date(Date.now() + 3600000).toISOString().slice(0, 10); // Lagos is UTC+1 all year.

export const trackUrl = (token: string) => `${window.location.origin}/track?r=${token}`;
// WhatsApp click-to-chat, which staff tap and send themselves (owner's decision, 1 Nov 2026: no WhatsApp API).
export const waLink = (phone234: string, text: string) => `https://wa.me/${phone234}?text=${encodeURIComponent(text)}`;
export const trackMessage = (o: { name?: string | null; invoice?: string | null; token: string; day?: string | null; time?: string | null; out?: boolean; shop?: string | null }) => {
  const order = `Your order${o.invoice ? ` ${o.invoice}` : ''}`;
  return `Hello${o.name ? ` ${o.name.split(' ')[0]}` : ''}, this is ${o.shop || 'the shop'}.`
    + (o.out ? ` ${order} is on the way.` : o.day ? ` ${order} is booked for delivery on ${dayWords(o.day, o.time)}.` : '')
    // Pin and code only mean something once a delivery is booked; a pickup order just gets its page.
    + ` Follow your order here${o.out || o.day ? '. Drop your pin so the rider finds you, and give the rider the 4-digit code on the page when they arrive' : ''}: ${trackUrl(o.token)}`;
};

export const errorOf = (message: string) => {
  const [n, ...rest] = message.split(':');
  const detail = rest.join(':').trim();
  // The database sends money in kobo; the words already carry the naira sign.
  return friendly(n.trim(), n.trim() === 'payment_required' ? formatNaira(detail.replace(/\D/g, '') || '0').slice(1).replace(/\.00$/, '') : detail);
};
