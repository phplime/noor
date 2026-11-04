import { useApp } from '../../app/AppContext';
import { BRAND } from '../../app/brand';
import { Icon } from '../../components/Icon';
import { navigableTools } from '../../navigation/registry';

export default function AboutPage() {
  const { appInfo } = useApp();
  const tools = navigableTools().filter((t) => t.category !== 'application');
  return (
    <div className="page">
      <div className="page-narrow">
        <div className="card">
          <div className="card-body" style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <img src={BRAND.iconSrc} alt="" width={72} height={72} />
            <div>
              <h2 style={{ fontSize: 22 }}>{appInfo.name}</h2>
              <div className="muted">{BRAND.tagline}</div>
              <div className="small subtle" style={{ marginTop: 4 }}>
                Version {appInfo.version}
                {appInfo.arch && ` · ${appInfo.arch === 'aarch64' ? 'Apple Silicon' : appInfo.arch === 'x86_64' ? 'Intel' : appInfo.arch}`}
                {appInfo.identifier && ` · ${appInfo.identifier}`}
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2>Privacy</h2>
          </div>
          <div className="card-body">
            <p className="small" style={{ display: 'flex', gap: 8 }}>
              <Icon name="shield" size={16} style={{ color: 'var(--success)', flex: 'none' }} />
              {BRAND.privacyNote} No account, no internet connection and no analytics are needed. Exported files contain pixels only — camera metadata (EXIF, GPS) is not copied.
            </p>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2>What the words mean</h2>
            <p>MacKit uses these terms consistently.</p>
          </div>
          <div className="card-body">
            <dl className="terms">
              <dt>Crop</dt>
              <dd>Removes part of the image. The only operation that discards content, and only in the Crop tool.</dd>
              <dt>Resize</dt>
              <dd>Changes the image's pixel dimensions.</dd>
              <dt>Fit / Contain</dt>
              <dd>Scales the entire image proportionally to fit inside the target size; leftover space becomes padding.</dd>
              <dt>Canvas Resize / Padding</dt>
              <dd>Changes the canvas and adds background space around the whole image.</dd>
              <dt>Stretch</dt>
              <dd>Changes dimensions without preserving the aspect ratio (may distort).</dd>
              <dt>Adjust</dt>
              <dd>Changes light, color or orientation. Rotation swaps width and height but keeps every pixel.</dd>
              <dt>Export</dt>
              <dd>Saves the processed result to disk as a new file. Originals are never modified unless you explicitly allow it.</dd>
            </dl>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2>Installed tools</h2>
          </div>
          <div className="card-body">
            <dl className="kv">
              {tools.map((t) => (
                <div key={t.id} style={{ display: 'contents' }}>
                  <dt>
                    <Icon name={t.icon} size={13} style={{ verticalAlign: -2 }} /> {t.name}
                  </dt>
                  <dd>
                    v{t.version}
                    {t.permissions?.length ? <span className="muted"> · may request: {t.permissions.join(', ')}</span> : null}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2>Keyboard shortcuts</h2>
          </div>
          <div className="card-body">
            <dl className="kv">
              <dt>
                <kbd>⌘1</kbd> … <kbd>⌘8</kbd>
              </dt>
              <dd>Switch tools</dd>
              <dt>
                <kbd>⌘,</kbd>
              </dt>
              <dd>Settings</dd>
              <dt>
                <kbd>⌘O</kbd> / <kbd>⇧⌘O</kbd>
              </dt>
              <dd>Add images / add a folder</dd>
              <dt>
                <kbd>⌘↩</kbd>
              </dt>
              <dd>Export / process</dd>
              <dt>
                <kbd>⌘Z</kbd>
              </dt>
              <dd>Undo the last settings change</dd>
              <dt>
                <kbd>⌘+</kbd> <kbd>⌘−</kbd> <kbd>⌘0</kbd>
              </dt>
              <dd>Zoom in, zoom out, fit to window</dd>
              <dt>
                <kbd>Esc</kbd>
              </dt>
              <dd>Cancel a running batch</dd>
            </dl>
          </div>
        </div>

        <p className="small subtle" style={{ marginTop: 16 }}>
          Text watermarks use DejaVu Sans (Bitstream Vera license). Built with Tauri, React and Rust.
        </p>
      </div>
    </div>
  );
}
