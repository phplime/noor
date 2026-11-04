import { useEffect, useRef, useState } from 'react';
import { getThumbnail } from '../../services/image-processing';
import { dragRect, type Handle, type Ratio, type Rect } from '../../utils/cropMath';
import type { ScannedFile } from '../../types/engine';

const HANDLES: { h: Handle; x: number; y: number; cursor: string }[] = [
  { h: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
  { h: 'n', x: 0.5, y: 0, cursor: 'ns-resize' },
  { h: 'ne', x: 1, y: 0, cursor: 'nesw-resize' },
  { h: 'e', x: 1, y: 0.5, cursor: 'ew-resize' },
  { h: 'se', x: 1, y: 1, cursor: 'nwse-resize' },
  { h: 's', x: 0.5, y: 1, cursor: 'ns-resize' },
  { h: 'sw', x: 0, y: 1, cursor: 'nesw-resize' },
  { h: 'w', x: 0, y: 0.5, cursor: 'ew-resize' },
];

interface CropEditorProps {
  file: ScannedFile;
  rect: Rect;
  ratio: Ratio;
  scale: number;
  onChange: (r: Rect) => void;
}

/**
 * Interactive crop box. Everything outside the box is shaded; the box can be
 * moved and resized with handles, honouring the locked ratio. Arrow keys nudge
 * (Shift = 10 px).
 */
export function CropEditor({ file, rect, ratio, scale, onChange }: CropEditorProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [alpha, setAlpha] = useState(false);
  const drag = useRef<{ handle: Handle; start: Rect; px: number; py: number } | null>(null);
  const bounds = { w: file.width, h: file.height };

  useEffect(() => {
    let live = true;
    setSrc(null);
    getThumbnail(file.path, 2048)
      .then((t) => {
        if (!live) return;
        setSrc(t.dataUrl);
        setAlpha(t.hasAlpha);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [file.path]);

  const begin = (handle: Handle) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { handle, start: rect, px: e.clientX, py: e.clientY };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.px) / scale;
    const dy = (e.clientY - d.py) / scale;
    onChange(dragRect(d.start, d.handle, dx, dy, ratio, bounds));
  };
  const end = () => {
    drag.current = null;
  };

  const onKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1;
    const map: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const d = map[e.key];
    if (!d) return;
    e.preventDefault();
    onChange(dragRect(rect, 'move', d[0], d[1], ratio, bounds));
  };

  const W = file.width * scale;
  const H = file.height * scale;
  const box = { left: rect.x * scale, top: rect.y * scale, width: rect.w * scale, height: rect.h * scale };

  return (
    <div className={`stage-canvas${alpha ? ' checker' : ''}`} style={{ width: W, height: H }}>
      <div className="crop-area" style={{ width: W, height: H }} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        {src ? <img src={src} alt="Image being cropped" draggable={false} /> : null}
        {/* Shade everything outside the selection (clipped to the image). */}
        <div className="crop-area-clip" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <div className="crop-shade" style={box} />
        </div>
        <div
          className="crop-box"
          style={box}
          tabIndex={0}
          role="slider"
          aria-label="Crop area. Use arrow keys to move it."
          aria-valuetext={`${Math.round(rect.w)} by ${Math.round(rect.h)} pixels at ${Math.round(rect.x)}, ${Math.round(rect.y)}`}
          onPointerDown={begin('move')}
          onKeyDown={onKey}
        >
          {[1 / 3, 2 / 3].map((f) => (
            <div key={`v${f}`} className="grid-line" style={{ left: `${f * 100}%`, top: 0, bottom: 0, width: 1 }} />
          ))}
          {[1 / 3, 2 / 3].map((f) => (
            <div key={`h${f}`} className="grid-line" style={{ top: `${f * 100}%`, left: 0, right: 0, height: 1 }} />
          ))}
          {HANDLES.map((h) => (
            <div key={h.h} className="crop-handle" style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%`, cursor: h.cursor }} onPointerDown={begin(h.h)} />
          ))}
          <span className="dim-label" style={{ left: 4, top: 4 }}>
            {Math.round(rect.w)} × {Math.round(rect.h)}
          </span>
        </div>
      </div>
    </div>
  );
}
