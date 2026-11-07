import { useEffect, useRef, useState } from 'react';
import { errorText } from '../../island/lib/ipc';
import { useNoor } from '../context';
import { NIcon } from '../icons';
import { LANG_LABEL, setLang, type Lang } from '../lang';
import { Card, List, ListRow, Page, SectionTitle, Segmented, Switch } from '../ui';
import { renderSample, speakNow, voice, type VoiceEvent, type VoiceInfo, type VoiceSettings } from '../voice';

/** Settings › Language & voice: app language, spoken alerts, and the wording of every alert. */
export function VoicePage({ onBack }: { onBack: () => void }) {
  const { flash } = useNoor();
  const [info, setInfo] = useState<VoiceInfo | null>(null);
  const [s, setS] = useState<VoiceSettings | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    voice
      .get()
      .then((i) => {
        setInfo(i);
        setS(i.settings);
      })
      .catch((e) => flash(errorText(e)));
  }, [flash]);

  /** Save shortly after the last change (typing in the text boxes). */
  const update = (next: VoiceSettings, now = false) => {
    setS(next);
    window.clearTimeout(timer.current);
    const go = () => void voice.save(next).catch((e) => flash(errorText(e)));
    if (now) go();
    else timer.current = window.setTimeout(go, 700);
  };

  if (!info || !s) {
    return (
      <Page title="Language & voice" onBack={onBack}>
        <p className="n-hint">Loading…</p>
      </Page>
    );
  }

  const voiceLang: 'bn' | 'en' = s.lang === 'en' ? 'en' : 'bn';
  const hasVoice = voiceLang === 'en' ? info.hasEn : info.hasBn;
  const spoken = (id: string) => s.speak && (s.speakEvents.length === 0 || s.speakEvents.includes(id));
  const toggleSpoken = (id: string, on: boolean) => {
    const all = info.events.map((e) => e.id);
    const cur = new Set(s.speakEvents.length ? s.speakEvents : all);
    if (on) cur.add(id);
    else cur.delete(id);
    const list = all.filter((x) => cur.has(x));
    update({ ...s, speakEvents: list.length === all.length ? [] : list }, true);
  };

  return (
    <Page title="Language & voice" onBack={onBack}>
      <div className="n-stack n-voice">
        <SectionTitle>App language</SectionTitle>
        <Segmented<Lang>
          value={s.lang}
          onChange={(l) => {
            setLang(l);
            update({ ...s, lang: l }, true);
          }}
          options={(['bn', 'en', 'mix'] as Lang[]).map((l) => ({ id: l, label: LANG_LABEL[l] }))}
        />
        <p className="n-hint">
          {s.lang === 'bn'
            ? 'Notifications, prayer names, Quran meaning and duas in Bangla.'
            : s.lang === 'en'
              ? 'Notifications, prayer names, Quran meaning (Saheeh International), pronunciation and duas in English.'
              : 'English menus with Bangla text alongside, as before. Spoken alerts are in Bangla.'}{' '}
          Menus and buttons will follow in a later update.
        </p>

        <SectionTitle>Spoken alerts</SectionTitle>
        <List>
          <ListRow
            icon="bell"
            title="Speak notifications"
            detail={`Say the alert out loud in ${voiceLang === 'en' ? 'English' : 'Bangla'} instead of a ring`}
            right={<Switch checked={s.speak} onChange={(v) => update({ ...s, speak: v }, true)} />}
          />
        </List>
        {info.ios && s.speak && !hasVoice && (
          <Card className="n-voice__warn">
            <b>No {voiceLang === 'en' ? 'English' : 'Bangla'} voice on this iPhone yet.</b>
            <p>
              Download one in <b>Settings › Accessibility › Spoken Content › Voices › {voiceLang === 'en' ? 'English' : 'Bangla'}</b>, then open Noor
              again. Until then alerts use the normal ring.
            </p>
          </Card>
        )}
        {!info.ios && <p className="n-hint">Spoken alerts work on iPhone. Elsewhere the text shows with the normal sound.</p>}

        <SectionTitle>Notification texts</SectionTitle>
        <p className="n-hint">
          Tap one to change its words. <code>{'{prayer}'}</code> = এশা / Isha, <code>{'{prayer_of}'}</code> = এশার, <code>{'{min}'}</code> = minutes.
        </p>
        <div className="n-voice__list">
          {info.events.map((e) => (
            <EventRow
              key={e.id}
              e={e}
              s={s}
              open={open === e.id}
              onOpen={() => setOpen(open === e.id ? null : e.id)}
              spoken={spoken(e.id)}
              onSpoken={(v) => toggleSpoken(e.id, v)}
              onChange={(t) => update({ ...s, texts: { ...s.texts, [e.id]: t } })}
              onReset={() => {
                const texts = { ...s.texts };
                delete texts[e.id];
                update({ ...s, texts }, true);
              }}
              voiceLang={voiceLang}
              ios={info.ios}
            />
          ))}
        </div>
      </div>
    </Page>
  );
}

function EventRow({
  e,
  s,
  open,
  onOpen,
  spoken,
  onSpoken,
  onChange,
  onReset,
  voiceLang,
  ios,
}: {
  e: VoiceEvent;
  s: VoiceSettings;
  open: boolean;
  onOpen: () => void;
  spoken: boolean;
  onSpoken: (v: boolean) => void;
  onChange: (t: { bn: string; en: string }) => void;
  onReset: () => void;
  voiceLang: 'bn' | 'en';
  ios: boolean;
}) {
  const { flash } = useNoor();
  const custom = s.texts[e.id];
  const bn = custom?.bn || e.bn;
  const en = custom?.en || e.en;
  const shown = s.lang === 'en' ? renderSample(en, 'en') : renderSample(bn, 'bn');
  const sample = voiceLang === 'en' ? renderSample(en, 'en') : renderSample(bn, 'bn');

  const test = async () => {
    try {
      const ok = await voice.test(sample, voiceLang);
      flash(ok ? 'Lock your phone — the alert speaks in 5 seconds' : 'Test sent in 5 seconds (no voice installed, normal sound)');
    } catch (err) {
      flash(errorText(err));
    }
  };

  return (
    <div className={`n-voice__item ${open ? 'is-open' : ''}`}>
      <button className="n-voice__head" onClick={onOpen}>
        <span className={`n-voice__dot ${spoken ? 'is-on' : ''}`}>
          <NIcon name={spoken ? 'bell' : 'bellOff'} size={14} />
        </span>
        <span className="n-voice__txt">
          <small>
            {e.label}
            {custom && <i> · edited</i>}
          </small>
          <b lang={s.lang === 'en' ? 'en' : 'bn'}>{shown}</b>
        </span>
        <NIcon name="chevronRight" size={18} className={`n-voice__chev ${open ? 'is-open' : ''}`} />
      </button>
      {open && (
        <div className="n-voice__edit">
          <label className="n-field">
            <span>বাংলা</span>
            <textarea className="n-input" lang="bn" rows={2} value={custom?.bn ?? ''} placeholder={e.bn} onChange={(x) => onChange({ bn: x.target.value, en: custom?.en ?? '' })} />
          </label>
          <label className="n-field">
            <span>English</span>
            <textarea className="n-input" rows={2} value={custom?.en ?? ''} placeholder={e.en} onChange={(x) => onChange({ bn: custom?.bn ?? '', en: x.target.value })} />
          </label>
          <div className="n-voice__row">
            <label className="n-voice__check">
              <Switch checked={spoken} onChange={onSpoken} /> Speak this one
            </label>
          </div>
          <div className="n-voice__actions">
            <button className="n-chip" onClick={() => speakNow(sample, voiceLang) || flash('This device has no speech voice')}>
              <NIcon name="play" size={13} /> Listen
            </button>
            {ios && (
              <button className="n-chip" onClick={() => void test()}>
                <NIcon name="bell" size={13} /> Test alert
              </button>
            )}
            {custom && (
              <button className="n-chip" onClick={onReset}>
                <NIcon name="reset" size={13} /> Default
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
