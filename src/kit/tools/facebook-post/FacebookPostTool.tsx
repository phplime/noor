import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pickImageFiles } from '../../services/file-import';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useApp } from '../../app/AppContext';
import { ToolbarActions } from '../../layouts/AppLayout';
import { DragOverlay, LazyThumb } from '../../components/FileQueue';
import { BatchProgress } from '../../components/BatchProgress';
import { Callout, Checkbox, ColorField, Field, NumberField, Section, Segmented, Select } from '../../components/Field';
import { EmojiPicker } from '../../components/EmojiPicker';
import { Icon } from '../../components/Icon';
import { useImportQueue } from '../../hooks/useImportQueue';
import { useExportRunner } from '../../hooks/useExportRunner';
import { DEFAULT_RESIZE, getThumbnail, resizeOp } from '../../services/image-processing';
import { defaultExportOptions, mobileOutputDir, pickOutputFolder, savedFileActions } from '../../services/file-export';
import { chooseImageDestination, saveDataUrl } from '../../services/creative';
import { AppError } from '../../services/ipc';
import type { ToolProps } from '../../navigation/types';
import { isMobile } from '../../utils/platform';
import { basename, formatBytes } from '../../utils/format';
import { BACKGROUND_TEXT_LIMIT } from './layout';
import { BACKGROUNDS, CARD_W, renderCard, renderTextGraphic, type CardModel } from './renderCard';

const TOOL_ID = 'facebook-post';
const DRAFT_KEY = 'mackit.facebookDraft';
const MAX_PHOTOS = 20;
/** Facebook keeps photos up to 2048 px on the long side; larger uploads are re-compressed harder. */
const FB_LONG_EDGE = 2048;

interface Draft {
  name: string;
  time: string;
  audience: CardModel['audience'];
  text: string;
  mode: CardModel['mode'];
  backgroundId: string;
  theme: 'auto' | 'light' | 'dark';
  avatarColor: string;
  collapse: boolean;
  engagement: CardModel['engagement'];
}

const DEFAULT_DRAFT: Draft = {
  name: '',
  time: 'Just now',
  audience: 'public',
  text: '',
  mode: 'photos',
  backgroundId: 'purple',
  theme: 'auto',
  avatarColor: '#1877f2',
  collapse: true,
  engagement: { show: true, likes: 128, comments: 14, shares: 3 },
};

function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return { ...DEFAULT_DRAFT, ...(JSON.parse(raw) as Partial<Draft>) };
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_DRAFT;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = src;
  });
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) throw new Error('Clipboard is not available');
  }
}

const mimeFor = (path: string) => (/\.jpe?g$/i.test(path) ? 'image/jpeg' : 'image/png');

export default function FacebookPostTool({ active }: ToolProps) {
  const { notify, settings, resolvedTheme } = useApp();
  const queue = useImportQueue();
  const runner = useExportRunner(TOOL_ID);
  const [draft, setDraftState] = useState<Draft>(loadDraft);
  const setDraft = useCallback((patch: Partial<Draft>) => setDraftState((d) => ({ ...d, ...patch })), []);
  const [avatar, setAvatar] = useState<HTMLImageElement | null>(null);
  const [photos, setPhotos] = useState<Map<string, HTMLImageElement>>(new Map());
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [exportScale, setExportScale] = useState<'2' | '3'>('2');
  const [feedBackground, setFeedBackground] = useState(true);
  const [busy, setBusy] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } catch {
        /* storage unavailable */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [draft]);

  const files = queue.files.slice(0, MAX_PHOTOS);
  useEffect(() => {
    if (queue.files.length > MAX_PHOTOS) notify({ kind: 'warning', title: `Up to ${MAX_PHOTOS} photos per post`, message: 'Only the first photos are used.' });
  }, [queue.files.length, notify]);

  // Load preview-sized photos (decoded natively, EXIF orientation applied).
  useEffect(() => {
    let live = true;
    const missing = files.filter((f) => !photos.has(f.path));
    if (!missing.length) return;
    void Promise.all(
      missing.map(async (f) => {
        try {
          const t = await getThumbnail(f.path, 1200);
          return [f.path, await loadImage(t.dataUrl)] as const;
        } catch {
          return null;
        }
      }),
    ).then((loaded) => {
      if (!live) return;
      setPhotos((m) => {
        const next = new Map(m);
        for (const e of loaded) if (e) next.set(e[0], e[1]);
        return next;
      });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue.files]);

  const background = BACKGROUNDS.find((b) => b.id === draft.backgroundId) ?? BACKGROUNDS[0];
  const theme = draft.theme === 'auto' ? resolvedTheme : draft.theme;
  const model: CardModel = useMemo(
    () => ({
      theme,
      name: draft.name,
      avatar,
      avatarColor: draft.avatarColor,
      time: draft.time,
      audience: draft.audience,
      text: draft.text,
      mode: draft.mode,
      background,
      photos: files.flatMap((f) => {
        const img = photos.get(f.path);
        return img ? [{ img, w: img.naturalWidth, h: img.naturalHeight }] : [];
      }),
      collapse: draft.collapse,
      engagement: draft.engagement,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme, draft, avatar, background, photos, queue.files],
  );

  // Live preview: the same renderer as the export, at screen resolution.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !active) return;
    try {
      const { width, height } = renderCard(c, model, Math.max(2, window.devicePixelRatio || 1));
      c.style.width = `${width}px`;
      c.style.height = `${height}px`;
    } catch {
      /* canvas unavailable */
    }
  }, [model, active]);

  const charCount = [...draft.text].length;
  const bgTooLong = draft.mode === 'background' && charCount > BACKGROUND_TEXT_LIMIT;
  const pageColor = theme === 'dark' ? '#18191a' : '#f0f2f5';

  const insertEmoji = (e: string) => {
    const ta = textRef.current;
    const start = ta?.selectionStart ?? draft.text.length;
    const end = ta?.selectionEnd ?? draft.text.length;
    const next = draft.text.slice(0, start) + e + draft.text.slice(end);
    setDraft({ text: next });
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + e.length;
    });
  };

  const chooseAvatar = async () => {
    try {
      const [p] = await pickImageFiles(false, 'Choose profile photo');
      if (!p) return;
      const t = await getThumbnail(p, 240);
      setAvatar(await loadImage(t.dataUrl));
    } catch (e) {
      notify({ kind: 'error', title: 'Could not use that photo', message: AppError.from(e).message });
    }
  };

  const doCopy = async () => {
    if (!draft.text.trim()) return;
    try {
      await copyText(draft.text);
      notify({ kind: 'success', title: 'Post text copied', message: 'Paste it into Facebook (⌘V).' });
    } catch (e) {
      notify({ kind: 'error', title: 'Could not copy', message: AppError.from(e).message });
    }
  };

  const saveCanvas = async (canvas: HTMLCanvasElement, defaultName: string) => {
    const dest = await chooseImageDestination(defaultName, ['png', 'jpg']);
    if (!dest) return;
    setBusy(true);
    try {
      const r = await saveDataUrl(dest, canvas.toDataURL(mimeFor(dest), 0.92));
      notify({ kind: 'success', title: `Saved ${basename(r.path)}`, message: `${canvas.width} × ${canvas.height} px · ${formatBytes(r.bytes)}`, actions: savedFileActions([r.path], notify) });
    } catch (e) {
      notify({ kind: 'error', title: 'Image not saved', message: AppError.from(e).message });
    } finally {
      setBusy(false);
    }
  };

  const exportCard = async () => {
    if (busy) return;
    const scale = Number(exportScale);
    const card = document.createElement('canvas');
    const { width, height } = renderCard(card, model, scale);
    const out = document.createElement('canvas');
    const m = feedBackground ? 24 : 0;
    out.width = Math.round((width + m * 2) * scale);
    out.height = Math.round((height + m * 2) * scale);
    const ctx = out.getContext('2d');
    if (!ctx) return;
    // JPEG has no transparency, so the rounded corners always sit on the feed colour.
    ctx.fillStyle = pageColor;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(card, Math.round(m * scale), Math.round(m * scale));
    await saveCanvas(out, 'facebook-post-preview.png');
  };

  const exportTextGraphic = async () => {
    if (busy || !draft.text.trim()) return;
    const c = document.createElement('canvas');
    renderTextGraphic(c, draft.text, background, 1080);
    await saveCanvas(c, 'facebook-text-post.jpg');
  };

  const preparePhotos = async () => {
    if (!files.length || runner.running) return;
    const dir = isMobile() ? await mobileOutputDir() : await pickOutputFolder();
    if (!dir) return;
    const base = defaultExportOptions(settings, TOOL_ID, '-facebook');
    await runner.run(
      files.map((f) => ({ path: f.path, relDir: null })),
      [resizeOp({ ...DEFAULT_RESIZE, mode: 'within', width: FB_LONG_EDGE, height: FB_LONG_EDGE, allowUpscale: false })],
      { ...base, outputDir: dir, format: 'jpeg', quality: 90, suffix: '-facebook', filenameTemplate: '{name}{suffix}', conflict: 'rename', preserveStructure: false, allowSourceOverwrite: false },
    );
  };

  const openFacebook = async () => {
    try {
      if (draft.text.trim()) await copyText(draft.text);
      await openUrl('https://www.facebook.com/');
    } catch (e) {
      notify({ kind: 'error', title: 'Could not open Facebook', message: AppError.from(e).message });
    }
  };

  const reset = () => {
    setDraftState({ ...DEFAULT_DRAFT, name: draft.name, avatarColor: draft.avatarColor });
    setAvatar(null);
    queue.clear();
  };

  return (
    <div className="tool-layout">
      <ToolbarActions active={active}>
        <button className="btn" onClick={queue.addFiles} title="Add photos (⌘O)" disabled={draft.mode === 'background'}>
          <Icon name="plus" /> Photos
        </button>
        <button className="btn" onClick={() => void doCopy()} disabled={!draft.text.trim()} title="Copy the post text">
          <Icon name="copy" /> Copy Text
        </button>
        <button className="btn primary" onClick={() => void exportCard()} disabled={busy} title="Save the preview card as an image">
          Save Card Image…
        </button>
      </ToolbarActions>

      <div className="workspace" style={{ position: 'relative' }}>
        <DragOverlay show={queue.dragOver && active && draft.mode === 'photos'} label="Drop photos to add them to the post" />
        <div className="fb-stage" style={{ background: pageColor }}>
          <div className="fb-card-wrap" style={{ width: CARD_W }}>
            <canvas ref={canvasRef} className="fb-card" aria-label="Facebook post preview" />
          </div>
          <p className="fb-stage-note small" style={{ color: theme === 'dark' ? '#b0b3b8' : '#65676b' }}>
            Preview only — Noor never connects to Facebook. Copy the text and upload the photos in Facebook to post.
          </p>
        </div>
      </div>

      <aside className="inspector" aria-label="Post settings">
        <Section title="Post type">
          <Segmented<CardModel['mode']>
            value={draft.mode}
            onChange={(mode) => setDraft({ mode })}
            options={[
              { value: 'photos', label: 'Text & photos', icon: 'image' },
              { value: 'background', label: 'Colored background', icon: 'text' },
            ]}
          />
        </Section>

        <Section
          title="Post text"
          aside={
            <span className={`small ${bgTooLong ? 'danger-text' : 'muted'}`} title="Characters">
              {charCount}
              {draft.mode === 'background' ? ` / ${BACKGROUND_TEXT_LIMIT}` : ''}
            </span>
          }
        >
          <div style={{ position: 'relative' }}>
            <textarea
              ref={textRef}
              className="input fb-textarea"
              rows={draft.mode === 'background' ? 4 : 7}
              placeholder="What's on your mind? Use #hashtags and @mentions."
              value={draft.text}
              onChange={(e) => setDraft({ text: e.target.value })}
              spellCheck
            />
            <div className="fb-text-tools">
              <button className="btn ghost small" onClick={() => setEmojiOpen((o) => !o)} title="Insert emoji" aria-label="Insert emoji">
                <span style={{ fontSize: 16 }}>😊</span>
              </button>
              {emojiOpen && (
                <div style={{ position: 'absolute', right: 0, top: 30 }}>
                  <EmojiPicker onPick={insertEmoji} onClose={() => setEmojiOpen(false)} />
                </div>
              )}
            </div>
          </div>
          {bgTooLong && (
            <Callout kind="warning">Facebook only allows colored backgrounds for posts up to {BACKGROUND_TEXT_LIMIT} characters. Shorten the text, or save it as a text graphic below.</Callout>
          )}
          {draft.mode === 'photos' && (
            <div className="field" style={{ marginTop: 8 }}>
              <Checkbox checked={draft.collapse} onChange={(collapse) => setDraft({ collapse })} label="Shorten long text with “See more” like Facebook" />
            </div>
          )}
        </Section>

        {draft.mode === 'photos' ? (
          <Section title={`Photos (${files.length})`} aside={<button className="btn ghost small" onClick={queue.clear} disabled={!files.length}>Clear</button>}>
            <div className="collage-thumbs">
              {files.map((f) => (
                <div key={f.path} className="collage-thumb" title={f.name}>
                  <LazyThumb path={f.path} size={52} />
                  <button className="collage-thumb-x" aria-label={`Remove ${f.name}`} onClick={() => queue.remove(f.path)}>
                    ×
                  </button>
                </div>
              ))}
              {files.length < MAX_PHOTOS && (
                <button className="collage-add" onClick={queue.addFiles} title="Add photos">
                  <Icon name="plus" />
                </button>
              )}
            </div>
            <p className="field-hint">Facebook shows up to 5 photos in the feed; the rest appear as “+N”.</p>
          </Section>
        ) : (
          <Section title="Background">
            <div className="fb-bg-grid">
              {BACKGROUNDS.map((b) => (
                <button
                  key={b.id}
                  className={`fb-bg${b.id === background.id ? ' active' : ''}`}
                  title={b.label}
                  aria-label={b.label}
                  style={{ background: b.colors.length === 1 ? b.colors[0] : `linear-gradient(135deg, ${b.colors[0]}, ${b.colors[1]})`, color: b.text }}
                  onClick={() => setDraft({ backgroundId: b.id })}
                >
                  Aa
                </button>
              ))}
            </div>
          </Section>
        )}

        <Section title="Profile">
          <div className="fb-profile-row">
            <button className="fb-avatar-btn" onClick={() => void chooseAvatar()} title="Choose profile photo">
              {avatar ? <img src={avatar.src} alt="" /> : <span style={{ background: draft.avatarColor }}>{(draft.name.trim()[0] ?? '?').toUpperCase()}</span>}
            </button>
            <input className="input" placeholder="Your name or Page name" value={draft.name} onChange={(e) => setDraft({ name: e.target.value })} />
          </div>
          {avatar ? (
            <button className="btn ghost small" style={{ marginTop: 6 }} onClick={() => setAvatar(null)}>
              Use initials instead
            </button>
          ) : (
            <ColorField label="Initials color" value={draft.avatarColor} onChange={(avatarColor) => setDraft({ avatarColor })} swatches={false} />
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <Field label="Time">
              <input className="input" value={draft.time} onChange={(e) => setDraft({ time: e.target.value })} placeholder="Just now" />
            </Field>
            <Select<CardModel['audience']>
              label="Audience"
              value={draft.audience}
              onChange={(audience) => setDraft({ audience })}
              options={[
                { value: 'public', label: 'Public' },
                { value: 'friends', label: 'Friends' },
                { value: 'only-me', label: 'Only me' },
              ]}
            />
          </div>
        </Section>

        <Section title="Card">
          <Field label="Appearance">
            <Segmented<Draft['theme']>
              value={draft.theme}
              onChange={(t) => setDraft({ theme: t })}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'light', label: 'Light', icon: 'sun' },
                { value: 'dark', label: 'Dark', icon: 'moon' },
              ]}
            />
          </Field>
          <div className="field">
            <Checkbox checked={draft.engagement.show} onChange={(show) => setDraft({ engagement: { ...draft.engagement, show } })} label="Show reactions, comments and shares" />
          </div>
          {draft.engagement.show && (
            <div className="row">
              <NumberField label="Reactions" value={draft.engagement.likes} min={0} max={99_000_000} onChange={(likes) => setDraft({ engagement: { ...draft.engagement, likes } })} />
              <NumberField label="Comments" value={draft.engagement.comments} min={0} max={9_000_000} onChange={(comments) => setDraft({ engagement: { ...draft.engagement, comments } })} />
              <NumberField label="Shares" value={draft.engagement.shares} min={0} max={9_000_000} onChange={(shares) => setDraft({ engagement: { ...draft.engagement, shares } })} />
            </div>
          )}
        </Section>

        <Section title="Save & share">
          <Field label="Card image size">
            <Segmented<'2' | '3'>
              value={exportScale}
              onChange={setExportScale}
              options={[
                { value: '2', label: `${CARD_W * 2} px wide` },
                { value: '3', label: `${CARD_W * 3} px wide` },
              ]}
            />
          </Field>
          <div className="field">
            <Checkbox checked={feedBackground} onChange={setFeedBackground} label="Feed-colored margin around the card" />
          </div>
          <div className="fb-actions">
            <button className="btn" disabled={busy} onClick={() => void exportCard()}>
              <Icon name="image" /> Save Card Image…
            </button>
            {draft.mode === 'background' ? (
              <button className="btn" disabled={busy || !draft.text.trim()} onClick={() => void exportTextGraphic()} title="A 1080 × 1080 image of the text on its background, ready to upload as a photo">
                <Icon name="text" /> Save Text Graphic (1080²)…
              </button>
            ) : (
              <button className="btn" disabled={!files.length || runner.running} onClick={() => void preparePhotos()} title={`Copies of the photos resized to at most ${FB_LONG_EDGE} px, JPEG quality 90`}>
                <Icon name="resize" /> Prepare Photos for Facebook…
              </button>
            )}
            <button className="btn" disabled={!draft.text.trim()} onClick={() => void doCopy()}>
              <Icon name="copy" /> Copy Post Text
            </button>
            <button className="btn" onClick={() => void openFacebook()} title="Copies the text, then opens facebook.com in your browser">
              <Icon name="external" /> Copy Text & Open Facebook
            </button>
          </div>
          <p className="field-hint">
            “Prepare Photos” saves copies sized for Facebook ({FB_LONG_EDGE} px long edge, JPEG) so Facebook re-compresses them less. Originals are never changed.
          </p>
          <BatchProgress state={runner} onCancel={runner.cancel} onDismiss={runner.reset} showSizes />
          <button className="btn ghost small" style={{ marginTop: 8 }} onClick={reset}>
            Start a new post
          </button>
        </Section>
      </aside>
    </div>
  );
}
