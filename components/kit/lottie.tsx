'use client';

// The four moments, and only these four: payment confirmed, unit genuine, delivered, empty bag.
// The animations are our own files in /lottie. The light player is loaded only when a moment
// happens (window.lottie, the same contract the prototype used); until the owner approves the
// lottie_light package, the component plays nothing and shows a calm stand-in instead.
import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './feel';

const FILES: Record<string, string> = {
  confirmed: '/lottie/confirmed.json',
  genuine: '/lottie/genuine.json',
  delivered: '/lottie/delivered.json',
  'empty-bag': '/lottie/empty-bag.json',
};

type LottieWindow = Window & { lottie?: { loadAnimation: (o: object) => { destroy: () => void; goToAndStop: (f: number, b: boolean) => void; goToAndPlay: (f: number) => void; addEventListener: (e: string, fn: () => void) => void; totalFrames: number } } };

export function LottieMoment({ name, label, loop = false }: { name: keyof typeof FILES; label: string; loop?: boolean }) {
  const box = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const anim = useRef<{ destroy: () => void; goToAndPlay: (f: number) => void } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (!box.current) return;
    const tries = [0];
    const timer = setInterval(() => {
      tries[0]++;
      const w = window as LottieWindow;
      if (!w.lottie) {
        if (tries[0] > 50) clearInterval(timer);
        return;
      }
      clearInterval(timer);
      if (!box.current?.isConnected || anim.current) return;
      const a = w.lottie.loadAnimation({ container: box.current, renderer: 'svg', loop: loop && !reduced, autoplay: !reduced, path: FILES[name] });
      if (reduced) a.addEventListener('DOMLoaded', () => a.goToAndStop(a.totalFrames - 1, true));
      anim.current = a;
      setMounted(true);
    }, 100);
    return () => {
      clearInterval(timer);
      anim.current?.destroy();
      anim.current = null;
    };
  }, [name, loop, reduced]);

  return (
    <button
      type="button"
      onClick={() => anim.current?.goToAndPlay(0)}
      className="press"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        padding: '12px 8px',
        border: '1px solid rgba(16,24,34,.07)',
        borderRadius: 16,
        background: '#F7F8FA',
        color: '#10161E',
        font: '500 13.5px var(--sans)',
        cursor: 'pointer',
      }}
    >
      <span ref={box} style={{ display: 'block', width: 96, height: 96 }}>
        {!mounted ? (
          <span
            aria-hidden="true"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 96,
              height: 96,
              borderRadius: '50%',
              background: '#E6EAEE',
              color: '#55606C',
            }}
          >
            {name === 'empty-bag' ? '○' : '✓'}
          </span>
        ) : null}
      </span>
      {label}
    </button>
  );
}
