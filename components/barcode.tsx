import { code128 } from '@/lib/code128';

// The shop code as Code 128 bars, with the quiet margin scanners need on each side. Nothing is
// drawn for a code that holds a character Code 128 cannot carry; the label still shows the text.
export function Barcode({ value }: { value: string }) {
  const widths = code128(value);
  if (!widths) return null;
  let x = 10;
  let d = '';
  widths.forEach((n, i) => { if (i % 2 === 0) d += `M${x} 0h${n}v40h-${n}Z`; x += n; });
  return (
    <svg role="img" aria-label={`Barcode ${value}`} viewBox={`0 0 ${x + 10} 40`} preserveAspectRatio="none" width="100%" height="100%" shapeRendering="crispEdges">
      <rect width={x + 10} height="40" fill="#FFFFFF" />
      <path d={d} fill="#000000" />
    </svg>
  );
}
