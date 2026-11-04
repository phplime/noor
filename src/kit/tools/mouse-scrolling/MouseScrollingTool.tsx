import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { ToolbarActions } from '../../layouts/AppLayout';
import { Callout, Segmented } from '../../components/Field';
import { Icon } from '../../components/Icon';
import {
  applyDeviceDirections,
  getScrollStatus,
  openSystemSettings,
  requestAccessibility,
  restoreScrollDefaults,
  setNaturalScrolling,
} from '../../services/system/scrolling';
import { AppError } from '../../services/ipc';
import type { DeviceDirection, ScrollOpResult, ScrollStatus } from '../../types/settings';
import type { ToolProps } from '../../navigation/types';

const dirName = (natural: boolean | null | undefined) => (natural === null || natural === undefined ? 'unknown' : natural ? 'Natural' : 'Reversed');

function DeviceRow({ icon, label, hint, value, onChange, systemNatural }: { icon: 'mouse' | 'trackpad'; label: string; hint: string; value: DeviceDirection; onChange: (v: DeviceDirection) => void; systemNatural: boolean | null }) {
  return (
    <div className="setting-row" style={{ gridTemplateColumns: 'minmax(0,1fr) 340px' }}>
      <div>
        <div className="label">
          <Icon name={icon} size={14} style={{ verticalAlign: -2 }} /> {label}
        </div>
        <div className="help">{hint}</div>
      </div>
      <Segmented<DeviceDirection>
        value={value}
        onChange={onChange}
        ariaLabel={`${label} scroll direction`}
        options={[
          { value: 'system', label: `macOS (${dirName(systemNatural)})`, title: 'Leave this device as macOS sets it' },
          { value: 'natural', label: 'Natural', title: 'Content follows your fingers: wheel down moves the page up' },
          { value: 'standard', label: 'Reversed', title: 'Classic / Windows style: wheel down moves the page down' },
        ]}
      />
    </div>
  );
}

export default function MouseScrollingTool({ active }: ToolProps) {
  const { confirm } = useApp();
  const [status, setStatus] = useState<ScrollStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [natural, setNatural] = useState<'natural' | 'standard'>('natural');
  const [mouse, setMouse] = useState<DeviceDirection>('system');
  const [trackpad, setTrackpad] = useState<DeviceDirection>('system');
  const [dirty, setDirty] = useState(false);
  const [result, setResult] = useState<ScrollOpResult | null>(null);
  const [busy, setBusy] = useState(false);

  const sync = useCallback((s: ScrollStatus, resetChoices: boolean) => {
    setStatus(s);
    if (resetChoices) {
      if (s.storedNatural !== null) setNatural(s.storedNatural ? 'natural' : 'standard');
      setMouse(s.mouse);
      setTrackpad(s.trackpad);
      setDirty(false);
    }
  }, []);

  const refresh = useCallback(
    async (resetChoices = false) => {
      try {
        sync(await getScrollStatus(), resetChoices);
        setLoadError(null);
      } catch (e) {
        setLoadError(AppError.from(e).message);
      }
    },
    [sync],
  );

  useEffect(() => {
    if (active) void refresh(true);
  }, [active, refresh]);

  // Live diagnostics: poll while the page is visible.
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => void refresh(false), 1000);
    return () => window.clearInterval(t);
  }, [active, refresh]);

  const run = async (op: () => Promise<ScrollOpResult>) => {
    setBusy(true);
    try {
      const r = await op();
      setResult(r);
      sync(r.status, true);
    } catch (e) {
      setResult({ ok: false, message: AppError.from(e).message, status: status! });
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <div className="page">
        <div className="page-narrow">
          <Callout kind="danger">{loadError}</Callout>
        </div>
      </div>
    );
  }
  if (!status) {
    return (
      <div className="page" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="spinner" />
      </div>
    );
  }
  if (!status.supported) {
    return (
      <div className="page">
        <div className="page-narrow">
          <Callout kind="warning">Scrolling controls are only available on macOS.</Callout>
        </div>
      </div>
    );
  }

  const wantsOverride = mouse !== 'system' || trackpad !== 'system';
  const needsPermission = wantsOverride && !status.accessibilityTrusted;
  const s = status.stats;
  const naturalChanged = status.storedNatural !== null && (natural === 'natural') !== status.storedNatural;

  return (
    <div className="page">
      <ToolbarActions active={active}>
        <button className="btn" onClick={() => void refresh(true)} title="Read the current configuration again">
          <Icon name="reset" /> Refresh
        </button>
      </ToolbarActions>
      <div className="page-narrow">
        {result && (
          <div style={{ marginBottom: 16 }}>
            <Callout kind={result.ok ? 'success' : 'warning'}>{result.message}</Callout>
          </div>
        )}

        {/* ---- Primary: instant per-device reversal ---- */}
        <div className="card">
          <div className="card-header">
            <h2>
              Reverse scrolling{' '}
              {status.overrideActive ? <span className="badge success">Active</span> : <span className="badge">Off</span>}
            </h2>
            <p>Takes effect immediately and lets the mouse and trackpad scroll in different directions. Works while MacKit is running.</p>
          </div>
          <div className="card-body" style={{ paddingTop: 4 }}>
            <DeviceRow
              icon="mouse"
              label="Mouse"
              hint="Scroll-wheel mice, including Logitech and other “smooth scrolling” mice"
              value={mouse}
              onChange={(v) => {
                setMouse(v);
                setDirty(true);
              }}
              systemNatural={status.effectiveNatural}
            />
            <DeviceRow
              icon="trackpad"
              label="Trackpad"
              hint="Built-in and Magic Trackpad, and the Magic Mouse (it scrolls like a trackpad)"
              value={trackpad}
              onChange={(v) => {
                setTrackpad(v);
                setDirty(true);
              }}
              systemNatural={status.effectiveNatural}
            />

            {needsPermission && (
              <div className="field">
                <Callout kind="warning">
                  <strong>Accessibility permission needed</strong>
                  <span>
                    macOS only lets an app change scroll events after you allow it. Turn on <strong>{status.permissionApp}</strong> in System Settings → Privacy &amp; Security → Accessibility, then click Apply.
                  </span>
                  {!status.runningFromBundle && (
                    <span className="small">
                      You're running a development build (<span className="mono">npm run app:dev</span>), so macOS asks about the terminal or editor that started it — not “mackit”. If it was already on, switch it off and on again, then restart <span className="mono">npm run app:dev</span>.
                    </span>
                  )}
                  <div className="btn-row">
                    <button className="btn primary" disabled={busy} onClick={() => run(requestAccessibility)}>
                      Grant Access…
                    </button>
                    <button className="btn" onClick={() => void openSystemSettings('accessibility')}>
                      <Icon name="external" /> Open Privacy &amp; Security
                    </button>
                  </div>
                </Callout>
              </div>
            )}
            {status.overrideError && !needsPermission && (
              <div className="field">
                <Callout kind="danger">{status.overrideError}</Callout>
              </div>
            )}

            <div className="btn-row" style={{ marginTop: 14, alignItems: 'center' }}>
              <button className="btn primary" disabled={busy || (!dirty && status.overrideActive === wantsOverride)} onClick={() => run(() => applyDeviceDirections(mouse, trackpad))}>
                Apply
              </button>
              {dirty && <span className="small muted">Not applied yet</span>}
            </div>

            {status.overrideActive && (
              <div className="field" style={{ marginTop: 16 }}>
                <Callout kind="info">
                  <strong>Live check — scroll with your mouse and trackpad now</strong>
                  <span>
                    Mouse: <span className="mono">{s.mouseEvents}</span> scroll events, <span className="mono">{s.mouseReversed}</span> reversed {s.reverseMouse ? '(reversing)' : '(left as is)'}
                    <br />
                    Trackpad / Magic Mouse: <span className="mono">{s.trackpadEvents}</span> scroll events, <span className="mono">{s.trackpadReversed}</span> reversed {s.reverseTrackpad ? '(reversing)' : '(left as is)'}
                  </span>
                  <span className="small muted">
                    If a count stays at 0 while you scroll that device, macOS isn't delivering events to MacKit — check the Accessibility permission above. If your mouse is counted under Trackpad, tell us the mouse model.
                  </span>
                </Callout>
              </div>
            )}
          </div>
        </div>

        {/* ---- macOS preference ---- */}
        <div className="card">
          <div className="card-header">
            <h2>macOS default direction</h2>
            <p>
              The same switch as System Settings → Mouse / Trackpad → “Natural scrolling”. It is one setting for <em>both</em> devices.
            </p>
          </div>
          <div className="card-body">
            <Segmented<'natural' | 'standard'>
              value={natural}
              onChange={setNatural}
              options={[
                { value: 'natural', label: 'Natural (macOS default)' },
                { value: 'standard', label: 'Reversed' },
              ]}
            />
            <p className="small muted" style={{ marginTop: 8 }}>
              When MacKit changes this, macOS applies it after you log out and back in. For an instant change use “Reverse scrolling” above, or the switch in System Settings.
            </p>
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button className="btn" disabled={busy || !naturalChanged} onClick={() => run(() => setNaturalScrolling(natural === 'natural'))}>
                Save as macOS default
              </button>
              <button className="btn" onClick={() => void openSystemSettings('mouse')}>
                <Icon name="external" /> Mouse Settings
              </button>
              <button className="btn" onClick={() => void openSystemSettings('trackpad')}>
                <Icon name="external" /> Trackpad Settings
              </button>
            </div>
          </div>
        </div>

        {/* ---- Status ---- */}
        <div className="card">
          <div className="card-header">
            <h2>Current configuration</h2>
            <p>Read directly from macOS{status.macosVersion ? ` ${status.macosVersion}` : ''}.</p>
          </div>
          <div className="card-body">
            <dl className="kv">
              <dt>macOS default</dt>
              <dd>
                {dirName(status.storedNatural)}
                {!status.explicitlySet && <span className="muted"> (factory default)</span>}
                {status.pendingRelogin && <span className="badge warning" style={{ marginLeft: 6 }}>Changes after next login</span>}
              </dd>
              <dt>In effect now</dt>
              <dd>{dirName(status.effectiveNatural)}</dd>
              <dt>Reverse scrolling</dt>
              <dd>{status.overrideActive ? <span className="badge success">Active</span> : <span className="badge">Off</span>}</dd>
              <dt>Accessibility</dt>
              <dd>
                {status.accessibilityTrusted ? <span className="badge success">Granted</span> : <span className="badge">Not granted</span>}
                <span className="muted small"> · checked for {status.permissionApp}</span>
              </dd>
            </dl>
          </div>
        </div>

        <div className="card">
          <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>Restore default</div>
              <div className="small muted">Natural scrolling on (the macOS default) and reverse scrolling off.</div>
            </div>
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                const ok = await confirm({ title: 'Restore default scrolling?', message: 'Natural scrolling will be turned on and MacKit’s reverse scrolling turned off.', confirmLabel: 'Restore' });
                if (ok) await run(restoreScrollDefaults);
              }}
            >
              Restore Default
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
