'use client';

// Shared feel helpers: honour reduced motion, bump an element, tick and spinner glyphs.
import { useEffect, useState } from 'react';

export const useReducedMotion = (): boolean => {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
};

export const bump = (el: HTMLElement | null, keyframes: Keyframe[], opts: KeyframeAnimationOptions = {}) => {
  if (el && el.animate) el.animate(keyframes, { duration: 170, easing: 'ease-out', ...opts });
};

export const Tick = ({ size = 20, stroke = '#FFFFFF', className = '' }: { size?: number; stroke?: string; className?: string }) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} style={{ fill: 'none', stroke, strokeWidth: 2.6, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
    <path className={`tickdraw ${className}`} pathLength={1} d="M5 12.500 10 17.500 19.500 7" />
  </svg>
);

export const Spinner = ({ size = 20, stroke = '#FFFFFF' }: { size?: number; stroke?: string }) => (
  <svg className="spin" aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} style={{ fill: 'none', stroke, strokeWidth: 2.4, strokeLinecap: 'round' }}>
    <path d="M12 3a9 9 0 1 0 9 9" />
  </svg>
);
