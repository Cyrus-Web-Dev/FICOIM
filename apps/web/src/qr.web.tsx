import { useMemo } from 'react';
import { qrMatrix, qrSvgPath } from '@ficoim/client';
import type { QrCodeProps } from '@ficoim/screens';

/** QR vektor (satu <path>) — tetap tajam saat dicetak. Warna SELALU hitam di atas putih (aman di tema gelap, terbaca pemindai). */
export function QrCodeWeb({ value, className, testID }: QrCodeProps) {
  const svg = useMemo(() => { try { return qrSvgPath(qrMatrix(value), 3); } catch { return null; } }, [value]);
  if (!svg) return <div className={className} data-testid={testID} />;
  return (
    <svg className={`qr ${className ?? ''}`} data-testid={testID} viewBox={`0 0 ${svg.size} ${svg.size}`} shapeRendering="crispEdges" role="img" aria-label={`QR ${value}`}>
      <rect width={svg.size} height={svg.size} fill="#fff" />
      <path d={svg.d} fill="#000" />
    </svg>
  );
}
