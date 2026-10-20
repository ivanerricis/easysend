import { useMemo } from 'react';
import { encode } from 'uqr';
import { useTranslation } from 'react-i18next';

const QUIET_ZONE = 4;

interface QrCodeProps {
  /** Text to encode (e.g. an otpauth:// URI). */
  value: string;
  /** Rendered size in px (never wider than the container). */
  size?: number;
  /** Accessible description; defaults to the generic authenticator text. */
  label?: string;
}

/**
 * QR code as one SVG `<path>`. It always sits on a white box with black modules (and a quiet
 * zone), so it scans in the dark theme as well.
 */
export function QrCode({ value, size = 192, label }: QrCodeProps) {
  const { t } = useTranslation();
  const { path, dimension } = useMemo(() => {
    const { data, size: modules } = encode(value, { ecc: 'M', border: 0 });
    let d = '';
    data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) d += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`;
      });
    });
    return { path: d, dimension: modules + QUIET_ZONE * 2 };
  }, [value]);

  return (
    <div className="inline-block max-w-full bg-white text-black">
      <svg
        role="img"
        aria-label={label ?? t('common.qr.label')}
        viewBox={`0 0 ${dimension} ${dimension}`}
        width={size}
        height={size}
        shapeRendering="crispEdges"
        className="block max-w-full"
        style={{ height: 'auto' }}
      >
        <path d={path} fill="currentColor" />
      </svg>
    </div>
  );
}
