'use client';

// The whole component kit, on one page, working. Sample names and prices are not real.
import { useState } from 'react';
import { ConfirmButton, CountBadge } from '@/components/kit/confirm';
import { QuantityStepper } from '@/components/kit/stepper';
import { Segmented } from '@/components/kit/segmented';
import { StockState } from '@/components/kit/stock';
import { PriceHold } from '@/components/kit/hold';
import { CopyRow } from '@/components/kit/copy';
import { PartSearch, type PartHit } from '@/components/kit/partsearch';
import { SlideToConfirm } from '@/components/kit/slide';
import { PartPayment } from '@/components/kit/partpayment';
import { PhoneInput } from '@/components/kit/phone';
import { Switch, CheckRow } from '@/components/kit/switches';
import { Toast } from '@/components/kit/toast';
import { SerialCheck } from '@/components/kit/serial';
import { LottieMoment } from '@/components/kit/lottie';
import { formatNaira } from '@/lib/money';

const PARTS: PartHit[] = [
  { code: '6205-2RS', note: 'Bearing, sealed, 25 x 52 x 15 mm', size: '25 52 15', priceKobo: 480000n, stock: '48 in Ikeja' },
  { code: '6205-ZZ', note: 'Bearing, shielded, 25 x 52 x 15 mm', size: '25 52 15', priceKobo: 430000n, stock: '30 in Ikeja' },
  { code: '6204-2RS', note: 'Bearing, sealed, 20 x 47 x 14 mm', size: '20 47 14', priceKobo: 390000n, stock: '22 in Ikeja' },
  { code: 'A42', note: 'V-belt, section A, 42 inch', size: 'a 42', priceKobo: 320000n, stock: '15 in Ikeja' },
  { code: 'A44', note: 'V-belt, section A, 44 inch', size: 'a 44', priceKobo: 340000n, stock: '9 in Lekki' },
  { code: '10B-1', note: 'Roller chain, 5/8 inch pitch, per metre', size: '10b', priceKobo: 950000n, stock: '40 m in warehouse' },
];

function Card({ label, sub, wide = false, children }: { label: string; sub: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <section className={wide ? 'card wide' : 'card'} style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div>
        <div className="lab">{label}</div>
        <div className="sub">{sub}</div>
      </div>
      {children}
    </section>
  );
}

export default function Kit() {
  const [bag, setBag] = useState(2);
  const [qty, setQty] = useState(2);

  return (
    <main
      style={{
        minHeight: '100vh',
        boxSizing: 'border-box',
        padding: 'clamp(18px, 3vw, 40px) clamp(14px, 3vw, 44px) 48px',
        fontFamily: 'var(--sans)',
        color: '#10161E',
        background: 'radial-gradient(70% 420px at 70% 0, #FFFFFF 0%, rgba(255,255,255,0) 100%), #EEF1F4',
      }}
    >
      <div style={{ maxWidth: 1220, margin: '0 auto' }}>
        <h1 style={{ margin: 0, fontSize: 'clamp(28px, 3.2vw, 40px)', lineHeight: 1.08, fontWeight: 600, letterSpacing: '-.03em' }}>Components and feel</h1>
        <p style={{ margin: '8px 0 22px', maxWidth: 620, fontSize: 16, lineHeight: 1.5, color: '#434E5A' }}>
          The custom parts the whole store and back office are built from. Each one tells you what just happened. Press, type and drag them.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: 14 }}>
          <Card label="Add to bag" sub="Confirms, then the bag count responds.">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 'auto' }}>
              <ConfirmButton onDone={() => setBag((b) => b + 1)} />
              <CountBadge label="Bag" value={bag} />
            </div>
          </Card>

          <Card label="Quantity" sub="The number moves in the direction you press.">
            <QuantityStepper initial={qty} total={formatNaira(BigInt(qty) * 480000n)} />
          </Card>

          <Card label="Filter switch" sub="A glass thumb slides to your choice.">
            <Segmented options={['All', 'In stock', 'On order']} />
          </Card>

          <Card label="Stock states" sub="Never colour alone. Always words too.">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 'auto', fontSize: 14.5, fontWeight: 500 }}>
              <StockState stock="in" />
              <StockState stock="low" />
              <StockState stock="out" />
            </div>
          </Card>

          <Card label="Price hold" sub="The time left is always visible on a quote.">
            <PriceHold />
          </Card>

          <Card label="Bank details" sub="One tap to copy, with proof it worked.">
            <CopyRow label="[BANK NAME], for this order only" value="0123 456 789" />
          </Card>

          <Card label="Part search" sub="Any spelling, or a size. Try 62052rs, a42, or 25 52 15." wide>
            <PartSearch parts={PARTS} />
          </Card>

          <Card label="Slide to confirm" sub="For the owner, on actions that move money.">
            <SlideToConfirm />
          </Card>

          <Card label="Part payment" sub="A transfer counts only once the bank confirms it.">
            <PartPayment />
          </Card>

          <Card label="Phone number" sub="Checks as you type, without shouting.">
            <PhoneInput />
          </Card>

          <Card label="Switches" sub="They move like real ones.">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 'auto' }}>
              <Switch label="Send me reminders by email" />
              <CheckRow label="Same as delivery address" />
            </div>
          </Card>

          <Card label="Toast" sub="Calm news, with a way back.">
            <Toast />
          </Card>

          <Card label="Serial check" sub="Anyone can check a unit. Try PS-5K-204417, or anything else." wide>
            <SerialCheck />
          </Card>

          <Card label="Lottie moments" sub="Only four, each after something important. Made for this store. Press to replay." wide>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(130px, 100%), 1fr))', gap: 10 }}>
              <LottieMoment name="confirmed" label="Payment confirmed" />
              <LottieMoment name="genuine" label="Unit is genuine" />
              <LottieMoment name="delivered" label="Delivered" />
              <LottieMoment name="empty-bag" label="Empty bag" loop />
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}
