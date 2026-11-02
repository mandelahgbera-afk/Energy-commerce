import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'How the counter works · Power Store' };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: '-.012em' }}>{title}</h2>
      <div style={{ fontSize: 14.5, lineHeight: 1.55, color: '#434E5A', display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </section>
  );
}

function Row({ state, words }: { state: string; words: string }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: '1px solid #F1F3F5' }}>
      <span className="tabular" style={{ flex: '0 0 190px', fontSize: 13.5, fontWeight: 600, color: '#10161E' }}>{state}</span>
      <span style={{ fontSize: 13.5, color: '#434E5A' }}>{words}</span>
    </div>
  );
}

export default function Help() {
  return (
    <main style={{ minHeight: '100vh', boxSizing: 'border-box', padding: 'clamp(18px, 3vw, 40px) clamp(14px, 3vw, 44px) 48px', fontFamily: 'var(--sans)', color: '#10161E', background: 'radial-gradient(70% 420px at 70% 0, #FFFFFF 0%, rgba(255,255,255,0) 100%), #EEF1F4' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <h1 style={{ margin: 0, fontSize: 'clamp(28px, 3.2vw, 40px)', lineHeight: 1.08, fontWeight: 600, letterSpacing: '-.03em' }}>How the counter works</h1>
        <p style={{ margin: '8px 0 22px', fontSize: 16, lineHeight: 1.5, color: '#434E5A', maxWidth: 640 }}>
          Every state of the sale screen, and what it means. The golden rule: the database decides every naira and every stock move — this screen only asks it nicely.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Section title="The five actions">
            A simple cash sale is exactly five touches: <b style={{ fontWeight: 600 }}>scan, scan, Cash, Exact, Complete</b>. Scan or type a part number, press Enter; repeat; choose how they pay; tap Exact; Complete. Nothing else is ever needed. If the network drops after Complete, the screen retries with the same key — it can never sell twice.
          </Section>
          <Section title="The sale panel">
            <Row state="Scan box empty" words="Type a part number, any spelling (6205 2RS, 62052rs), or a size (25 52 15). Arrow keys move, Enter adds the top match. The cursor always comes back here." />
            <Row state="Nothing matches" words="The amber line says so, calmly. Check the number, or search by size. No sale is affected." />
            <Row state="A line with a battery" words="Serials appear under the line, oldest first. The sale cannot complete until every unit has its serial — warranty starts today on the one you chose." />
            <Row state="Quantity − on the last unit" words="It removes the line. Nothing was recorded yet, so nothing needs undoing." />
          </Section>
          <Section title="Customer and prices">
            <Row state="Phone typed, customer known" words="Their name appears, trade prices apply to every line, and Credit unlocks. What they owe and hold shows under their name." />
            <Row state="Discount 0–5%" words="Within the counter's limit — it lands on every line at the same percentage, rounded exactly as the books round." />
            <Row state="Discount above your limit" words="Complete stays off with the honest reason. Lower it, or ask the owner — the books would put the order on hold for them anyway." />
          </Section>
          <Section title="How they pay">
            <Row state="Cash" words="Exact, or rounded up to ₦1,000 / ₦5,000 / ₦10,000. The change to give is shown. Your till must be open, or the screen says so and offers to open it with the float you received." />
            <Row state="POS (card)" words="Goods leave now. The money lands once finance matches the card against the bank line — the receipt says so honestly." />
            <Row state="Transfer" words="Goods stay here. A screenshot alone does not count — finance confirms against the bank, then the goods are released." />
            <Row state="Credit" words="Only for a known customer. The order goes through the credit rules; if it is over their limit, the owner decides." />
          </Section>
          <Section title="After Complete">
            <Row state="Sale complete" words="Receipt on screen, stock and books updated, one key retired. New sale clears everything and the cursor is back in the scan box." />
            <Row state="Waiting on the bank" words="Transfer recorded. The counter's job is done; finance releases the goods." />
            <Row state="Waiting for the owner" words="The order needs the owner's yes. Nothing leaves until then." />
            <Row state="An error line" words="Always plain words and what to do next — never a raw database message." />
          </Section>
          <Section title="Closing the till">
            Count the drawer and type each note denomination (₦1000, ₦500, ₦200, ₦100, ₦50). The system's expected figure is <b style={{ fontWeight: 600 }}>never shown</b> — not before, not after — so the count stays honest. Any difference goes to the books and to the owner; it never stops the close.
          </Section>
        </div>
      </div>
    </main>
  );
}
