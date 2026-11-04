import { Callout } from './Field';
import type { AppError } from '../services/ipc';

/**
 * Shown when Canvas Resize is asked to place an image on a smaller canvas
 * without scaling. Explains why nothing happens and offers the two safe fixes.
 */
export function DoesNotFit({ error, onScale, onEnlarge }: { error: AppError; onScale: () => void; onEnlarge: (w: number, h: number) => void }) {
  if (error.code !== 'does_not_fit' || !error.details) return <Callout kind="danger">{error.message}</Callout>;
  const { srcW, srcH, canvasW, canvasH } = error.details;
  const needW = Math.max(srcW, canvasW);
  const needH = Math.max(srcH, canvasH);
  return (
    <Callout kind="warning">
      <strong>The whole image doesn't fit on a {canvasW} × {canvasH} canvas at its original size ({srcW} × {srcH}).</strong>
      <span>Canvas Resize never crops, so Noor won't cut anything off. Choose one:</span>
      <div className="btn-row">
        <button className="btn primary" onClick={onScale}>
          Scale image down to fit
        </button>
        <button className="btn" onClick={() => onEnlarge(needW, needH)}>
          Use {needW} × {needH} canvas
        </button>
      </div>
    </Callout>
  );
}
