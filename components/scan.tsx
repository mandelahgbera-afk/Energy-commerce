'use client';

// Scanning that can be trusted. A scanned code adds a part only when it is that part's own number
// (a near miss is offered, never added), the camera reads barcodes where the browser can, and
// every scan answers with a sound and a buzz, so the person knows without looking.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { browserDb } from '@/lib/supabase';
import { friendly } from '@/lib/errors';
import { formatNaira } from '@/lib/money';

// The same rule as the database's i_norm_part: letters and digits only, upper case.
export const normPart = (s: string | null | undefined) => (s ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

export function exactHit<T extends { sku: string; part_number: string | null; match?: string }>(hits: T[], q: string): T | undefined {
  const n = normPart(q);
  return n ? hits.find((h) => h.match === 'barcode' || normPart(h.part_number) === n || normPart(h.sku) === n) : undefined;
}

// A maker's barcode: only digits, 8 to 14 of them (EAN-8, UPC, EAN-13, ITF-14).
export const looksLikeBarcode = (q: string) => /^\d{8,14}$/.test(normPart(q));

let ear: AudioContext | null = null;
export function scanSound(ok: boolean) {
  try {
    ear ??= new AudioContext();
    const t = ear.currentTime;
    const o = ear.createOscillator();
    const g = ear.createGain();
    o.type = ok ? 'sine' : 'triangle';
    o.frequency.setValueAtTime(ok ? 1240 : 330, t);
    if (!ok) o.frequency.setValueAtTime(247, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(ok ? 0.12 : 0.1, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (ok ? 0.1 : 0.26));
    o.connect(g).connect(ear.destination);
    o.start(t);
    o.stop(t + 0.3);
  } catch {}
  try { navigator.vibrate?.(ok ? 25 : [40, 60, 40]); } catch {}
}

type Detector = { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> };
type DetectorClass = (new (o?: { formats: string[] }) => Detector) & { getSupportedFormats?: () => Promise<string[]> };
const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code', 'data_matrix'];

// Chrome on Android and Macs reads barcodes itself. Everywhere else (iPhone, Windows, Firefox)
// the bundled reader does the same job; it is fetched only when the camera first opens here.
async function makeDetector(): Promise<Detector> {
  const native = (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  if (native) {
    const have = await native.getSupportedFormats?.().catch(() => []) ?? [];
    const use = formats.filter((f) => have.includes(f));
    if (use.length) return new native({ formats: use });
  }
  const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill');
  const wasm = new URL('zxing-wasm/reader/zxing_reader.wasm', import.meta.url).href;
  prepareZXingModule({ overrides: { locateFile: (file: string, prefix: string) => (file.endsWith('.wasm') ? wasm : prefix + file) } });
  return new BarcodeDetector({ formats: formats as never }) as Detector;
}

export function CameraScan({ onCode, label = 'Scan with the camera' }: { onCode: (code: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={label} title={label} className="press cam-btn">
        <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M7 9v6M10 9v6M13 9v6M16.5 9v6" /></svg>
      </button>
      {open ? createPortal(<Viewfinder onClose={() => setOpen(false)} onCode={(c) => { setOpen(false); onCode(c); }} />, document.body) : null}
    </>
  );
}

function Viewfinder({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const got = useRef(onCode);
  got.current = onCode;
  const [problem, setProblem] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    close.current?.focus();
    if (!navigator.mediaDevices?.getUserMedia) { setProblem('There is no camera this page can use. Type the number instead.'); return; }
    let live = true;
    let timer = 0;
    let stream: MediaStream | null = null;
    (async () => {
      let det: Detector;
      try { det = await makeDetector(); } catch {
        if (live) setProblem('The barcode reader could not load. Check the connection and try again, or type the number.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
        const v = video.current;
        if (!live || !v) { stream.getTracks().forEach((t) => t.stop()); return; }
        v.srcObject = stream;
        await v.play();
        setReady(true);
        const look = async () => {
          if (!live) return;
          try {
            const [hit] = await det.detect(v);
            const code = hit?.rawValue?.trim();
            if (code && live) { live = false; got.current(code); return; }
          } catch {}
          timer = window.setTimeout(look, 120);
        };
        void look();
      } catch (e) {
        if (!live) return;
        setProblem((e as Error).name === 'NotAllowedError'
          ? 'The camera is blocked for this site. Allow it in the browser’s address bar, then try again.'
          : 'The camera could not start. Close any other app using it, then try again.');
      }
    })();
    return () => { live = false; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  return (
    <div className="scan-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Scan a barcode" className="glass rise scan-sheet">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 16.5, fontWeight: 600, letterSpacing: '-.01em' }}>Scan a barcode</div>
            <div style={{ marginTop: 2, fontSize: 13.5, color: '#55606C' }}>Hold the code inside the frame. It adds itself.</div>
          </div>
          <button ref={close} type="button" onClick={onClose} className="press" style={{ flex: 'none', minHeight: 44, padding: '0 14px', border: '1px solid rgba(16,24,34,.12)', borderRadius: 12, background: '#FFFFFF', color: '#10161E', font: '500 14px var(--sans)', cursor: 'pointer' }}>Close</button>
        </div>
        {problem ? (
          <p role="alert" style={{ margin: '14px 0 2px', padding: '12px 14px', borderRadius: 13, background: '#FDF3E7', color: '#7A3A0A', fontSize: 14.5, lineHeight: 1.45 }}>{problem}</p>
        ) : (
          <div className="scan-view">
            <video ref={video} muted playsInline aria-label="Camera view" />
            <span aria-hidden="true" className="scan-frame"><i /><i /><i /><i />{ready ? <b className="scan-line" /> : null}</span>
            {!ready ? <span role="status" className="scan-wait">Starting the camera…</span> : null}
          </div>
        )}
      </div>
    </div>
  );
}

type Found = { product: string; sku: string; name: string; part_number: string | null; price: number | string; state: string; match?: string };

// A code nobody has seen yet. Find its part once, and every scan of it after this adds it at once.
// The database refuses a code that is already another part's, so a slip can't ring up the wrong item.
export function TeachBarcode({ code, onTaught }: { code: string; onTaught: (hit: Found) => void }) {
  const db = useRef(browserDb()).current;
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Found[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); return; }
    let live = true;
    const t = setTimeout(async () => {
      const { data } = await db.rpc('search_parts', { p_query: term, p_limit: 5 });
      if (live) setHits(((data ?? []) as Found[]).filter((h) => h.match !== 'barcode'));
    }, 160);
    return () => { live = false; clearTimeout(t); };
  }, [q, db]);
  const teach = async (h: Found) => {
    setBusy(h.product);
    setProblem(null);
    const { error } = await db.rpc('link_barcode', { p_product: h.product, p_code: code });
    setBusy(null);
    if (error) {
      const [name, ...rest] = error.message.split(':');
      setProblem(friendly(name, rest.join(':').trim()));
      scanSound(false);
      return;
    }
    scanSound(true);
    onTaught({ ...h, match: 'barcode' });
  };
  return (
    <div role="group" aria-label={`Teach the code ${code}`} className="rise teach">
      <div style={{ fontSize: 14.5, fontWeight: 600 }}>New code <span style={{ fontFamily: 'var(--mono)' }}>{code}</span></div>
      <div style={{ marginTop: 2, fontSize: 13.5, color: '#55606C' }}>Which part is it? Pick it once, and every scan of this code adds it straight away.</div>
      <input value={q} onChange={(e) => setQ(e.target.value.slice(0, 80))} aria-label="Find the part for this code" autoComplete="off" autoFocus
        placeholder="Name, part number or size" className="note-box" style={{ marginTop: 8, height: 46 }} />
      {problem ? <p role="alert" className="scan-miss">{problem}</p> : null}
      {hits.length ? (
        <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'grid', gap: 2 }}>
          {hits.map((h) => (
            <li key={h.product}>
              <button type="button" onClick={() => teach(h)} disabled={busy !== null} className="press teach-pick">
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14.5, fontWeight: 500 }}>{h.name}</span>
                  <span style={{ display: 'block', fontSize: 12.5, color: '#55606C', fontFamily: 'var(--mono)' }}>{h.part_number ?? h.sku}</span>
                </span>
                <span style={{ flex: 'none', textAlign: 'right', fontSize: 13.5, fontWeight: 600 }}>
                  {busy === h.product ? 'Saving…' : <>{formatNaira(h.price)}<span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#1B5CF0' }}>This one</span></>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : q.trim().length >= 2 ? <p style={{ margin: '8px 2px 0', fontSize: 13.5, color: '#92400E' }}>Nothing matches. Try the size, or fewer words.</p> : null}
    </div>
  );
}
