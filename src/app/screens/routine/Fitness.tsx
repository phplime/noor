import { useEffect, useMemo, useState } from 'react';
import { errorText } from '../../../island/lib/ipc';
import { useNoor } from '../../context';
import { ACTIVITY_INFO, BMI_INFO, cmToFtIn, fit, ftInToCm, recentWalks, stepKcal, takeWalkStart, stepKm, useFitness, useLiveWalk, type WalkRecord, type FitnessOverview, type FitnessProfile, type FitnessReport } from '../../fitness';
import { NIcon } from '../../icons';
import { isIOS } from '../../../kit/utils/platform';
import { Card, SectionTitle, Segmented, Sheet, Switch } from '../../ui';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtN = (n: number) => n.toLocaleString('en-US');

/** Daily Life › Fitness: steps, weight, BMI. */
export function FitnessView() {
  const { flash } = useNoor();
  const { data, setData } = useFitness(true);
  const liveOK = isIOS() || !!import.meta.env.VITE_MOCK;
  const { walk, reading, elapsedS, begin, end } = useLiveWalk(liveOK);
  const [walks, setWalks] = useState<WalkRecord[]>(() => recentWalks());
  const [ending, setEnding] = useState(false);
  // Home › "Start live walk" shortcut: start as soon as today's count is known.
  useEffect(() => {
    if (data && liveOK && takeWalkStart() && !walk) begin(data.summary.stepsToday);
  }, [data, liveOK, walk, begin]);
  const [weighOpen, setWeighOpen] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [range, setRange] = useState<'30' | '90' | '365'>('90');

  if (!data) return <p className="n-hint">Loading…</p>;
  const s = data.summary;
  const p = data.data.profile;
  const needsSetup = !p.heightCm || s.weight == null;
  // During a live walk: today = steps when it started + the walk's steps (until the next sync).
  const stepsNow = Math.max(s.stepsToday, walk && reading ? walk.baseSteps + reading.steps : 0);
  const kmToday = stepKm(stepsNow, p.heightCm);
  const kcalToday = stepKcal(stepsNow, s.weight);
  const wSteps = reading?.steps ?? 0;
  const wKm = reading?.distanceM != null && reading.distanceM > 0 ? reading.distanceM / 1000 : stepKm(wSteps, p.heightCm);
  const wKcal = stepKcal(wSteps, s.weight);
  const kmh = reading ? reading.speedMps * 3.6 : 0;
  const moving = kmh >= 0.5;
  const avgKmh = elapsedS >= 30 ? wKm / (elapsedS / 3600) : 0;
  const endWalk = async () => {
    setEnding(true);
    const fresh = await end({ steps: wSteps, km: Math.round(wKm * 100) / 100, kcal: wKcal, avgKmh: Math.round(avgKmh * 10) / 10 });
    if (fresh) setData(fresh);
    setWalks(recentWalks());
    setEnding(false);
    if (wSteps > 0) flash(`Walk saved · ${fmtN(wSteps)} steps added to today`);
  };
  const pct = Math.min(1, stepsNow / Math.max(1, s.stepGoal));
  const todaySource = data.data.steps.find((x) => x.date === s.today)?.source;

  return (
    <div className="n-fit">
      {needsSetup && (
        <button className="n-fit__setup" onClick={() => (p.heightCm ? setWeighOpen(true) : setProfileOpen(true))}>
          <NIcon name="sparkle" size={18} />
          <span>
            <b>{p.heightCm ? 'Log your weight' : 'Add your height & weight'}</b>
            <small>To see your BMI, healthy weight range and trend.</small>
          </span>
          <NIcon name="chevronRight" size={16} />
        </button>
      )}

      {/* Steps */}
      <section className="n-fit__steps">
        <StepRing pct={pct} />
        <div className="n-fit__stepsinfo">
          <small>Steps today · আজকের পদক্ষেপ</small>
          <b className="n-mono">{fmtN(stepsNow)}</b>
          <span>
            of {fmtN(s.stepGoal)} · {Math.round(pct * 100)}%
          </span>
          <div className="n-fit__chips">
            <span>
              <NIcon name="pin" size={13} /> {kmToday.toFixed(1)} km
            </span>
            <span>
              <NIcon name="flame" size={13} /> {fmtN(kcalToday)} kcal
            </span>
            {s.stepStreak > 0 && (
              <span>
                🔥 {s.stepStreak} day{s.stepStreak > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
        <button className="n-fit__edit" onClick={() => setStepsOpen(true)} aria-label="Edit today's steps">
          <NIcon name="edit" size={15} />
        </button>
        {liveOK &&
          (walk ? (
            <div className="n-fit__live is-on">
              <div className="n-fit__livehead">
                <span className={`n-fit__livebadge${moving ? ' is-moving' : ''}`}>
                  <i /> {moving ? 'Walking' : 'Live walk'}
                </span>
                <b className="n-mono">{fmtDur(elapsedS)}</b>
                <button className="n-fit__livebtn is-end" onClick={() => void endWalk()} disabled={ending}>
                  ■ End
                </button>
              </div>
              <div className="n-fit__livegrid n-fit__livegrid--4">
                <div>
                  <small>Steps</small>
                  <b className="n-mono">{fmtN(wSteps)}</b>
                  <em>{moving && reading && reading.cadence > 0 ? `${Math.round(reading.cadence)}/min` : 'this walk'}</em>
                </div>
                <div>
                  <small>Speed</small>
                  <b className="n-mono">{kmh.toFixed(1)}</b>
                  <em>{avgKmh > 0 ? `avg ${avgKmh.toFixed(1)}` : 'km/h'}</em>
                </div>
                <div>
                  <small>Distance</small>
                  <b className="n-mono">{wKm.toFixed(2)}</b>
                  <em>km</em>
                </div>
                <div>
                  <small>Burned</small>
                  <b className="n-mono">{fmtN(wKcal)}</b>
                  <em>kcal</em>
                </div>
              </div>
            </div>
          ) : (
            <button className="n-fit__livebtn is-start" onClick={() => begin(s.stepsToday)}>
              <span>▶</span> Start live walk
              <small>Counts steps, speed and distance from 0 · added to today when you end</small>
            </button>
          ))}
        <p className="n-fit__src">
          {walk
            ? 'Keep Noor open on this screen for live speed — steps are still counted if you lock the phone'
            : todaySource === 'motion'
            ? 'Counted by your iPhone · updates when you open Noor'
            : isIOS()
              ? 'Allow Motion & Fitness for Noor to count steps automatically'
              : 'Tap ✎ to enter today’s steps'}
        </p>
      </section>

      <WeekSteps data={data} />

      {walks.length > 0 && <RecentWalks walks={walks} />}

      <HealthReport data={data} onSetup={() => setProfileOpen(true)} />

      {/* Weight */}
      <div className="n-sectionrow">
        <SectionTitle>Weight · ওজন</SectionTitle>
        <button className="n-link" onClick={() => setWeighOpen(true)}>
          + Log weight
        </button>
      </div>
      <Card>
        <div className="n-fit__weight">
          <div>
            <b>{s.weight != null ? `${s.weight}` : '—'}</b>
            <small> kg</small>
            {s.weightDate && <em>{s.weightDate === s.today ? 'today' : new Date(`${s.weightDate}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</em>}
          </div>
          <Change label="7 days" v={s.change7d} goal={p.goalKg} weight={s.weight} />
          <Change label="30 days" v={s.change30d} goal={p.goalKg} weight={s.weight} />
        </div>
        <WeightChart data={data} days={Number(range)} />
        <div className="n-fit__range">
          <Segmented
            value={range}
            onChange={setRange}
            options={[
              { id: '30', label: '1 month' },
              { id: '90', label: '3 months' },
              { id: '365', label: '1 year' },
            ]}
          />
        </div>
        {p.goalKg > 0 && s.toGoalKg != null && (
          <p className="n-fit__goal">
            Goal {p.goalKg} kg ·{' '}
            {Math.abs(s.toGoalKg) < 0.2 ? 'reached — MashaAllah 🎉' : s.toGoalKg > 0 ? `${s.toGoalKg} kg to lose` : `${Math.abs(s.toGoalKg)} kg to gain`}
          </p>
        )}
      </Card>

      {/* BMI */}
      <SectionTitle>BMI</SectionTitle>
      <Card>
        {s.bmi != null && s.bmiBand ? (
          <BmiScale bmi={s.bmi} band={s.bmiBand} asian={p.asianBmi} />
        ) : (
          <p className="n-hint n-hint--flush">Add your height and a weight to see your BMI.</p>
        )}
        {s.healthyMinKg != null && (
          <p className="n-fit__healthy">
            Healthy weight for {p.heightCm} cm: <b>
              {s.healthyMinKg}–{s.healthyMaxKg} kg
            </b>
          </p>
        )}
        <p className="n-hint n-hint--flush">
          {p.asianBmi
            ? 'Using the BMI bands advised for South Asian adults (healthy 18.5–22.9). '
            : 'Using the standard WHO bands (healthy 18.5–24.9). '}
          BMI is a rough guide — it doesn’t see muscle, age or body shape.
        </p>
      </Card>

      <SectionTitle>Settings</SectionTitle>
      <Card onClick={() => setProfileOpen(true)}>
        <div className="n-fit__prof">
          <span>
            Height <b>{p.heightCm ? `${p.heightCm} cm (${cmToFtIn(p.heightCm).ft}′${cmToFtIn(p.heightCm).inch}″)` : 'not set'}</b>
          </span>
          <span>
            Goal <b>{p.goalKg ? `${p.goalKg} kg` : '—'}</b>
          </span>
          <span>
            Steps goal <b>{fmtN(p.stepGoal)}</b>
          </span>
          <span>
            Weigh-in reminder <b>{p.weighReminder ? `${DAYS[p.weighDay - 1]} ${p.weighTime}` : 'off'}</b>
          </span>
        </div>
      </Card>

      {weighOpen && (
        <WeightSheet
          last={s.weight}
          onClose={() => setWeighOpen(false)}
          onSave={async (date, kg) => {
            try {
              setData(await fit.logWeight(date, kg));
              flash(kg == null ? 'Weight removed' : `Saved ${kg} kg`);
              setWeighOpen(false);
            } catch (e) {
              flash(errorText(e));
            }
          }}
        />
      )}
      {stepsOpen && (
        <StepsSheet
          value={s.stepsToday}
          onClose={() => setStepsOpen(false)}
          onSave={async (n) => {
            try {
              setData(await fit.setSteps(s.today, n));
              setStepsOpen(false);
            } catch (e) {
              flash(errorText(e));
            }
          }}
        />
      )}
      {profileOpen && (
        <ProfileSheet
          profile={p}
          onClose={() => setProfileOpen(false)}
          onSave={async (np, firstKg) => {
            try {
              let r = await fit.saveProfile(np);
              if (firstKg) r = await fit.logWeight(ymd(new Date()), firstKg);
              setData(r);
              setProfileOpen(false);
              flash('Saved');
            } catch (e) {
              flash(errorText(e));
            }
          }}
          needsWeight={s.weight == null}
        />
      )}
    </div>
  );
}

function fmtDur(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  const p2 = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${p2(m)}:${p2(ss)}` : `${p2(m)}:${p2(ss)}`;
}

function RecentWalks({ walks }: { walks: WalkRecord[] }) {
  return (
    <>
      <SectionTitle>Recent walks · হাঁটা</SectionTitle>
      <Card>
        <ul className="n-fit__walks">
          {walks.slice(0, 5).map((w) => {
            const d = new Date(w.start);
            return (
              <li key={w.start}>
                <span>
                  <b>{d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</b>
                  <small>
                    {d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · {fmtDur(Math.round((w.end - w.start) / 1000))}
                  </small>
                </span>
                <span>
                  <b className="n-mono">{fmtN(w.steps)}</b>
                  <small>steps</small>
                </span>
                <span>
                  <b className="n-mono">{w.km.toFixed(2)}</b>
                  <small>km</small>
                </span>
                <span>
                  <b className="n-mono">{w.kcal}</b>
                  <small>kcal</small>
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}

function StepRing({ pct }: { pct: number }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  return (
    <svg className="n-fit__ring" viewBox="0 0 110 110" aria-hidden="true">
      <circle cx="55" cy="55" r={r} className="n-fit__ringbg" />
      <circle cx="55" cy="55" r={r} className="n-fit__ringfg" strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 55 55)" />
      <g transform="translate(43 41)" className="n-fit__feet">
        <path d="M6 2c3 0 4 4 4 8s-1 6-4 6-4-3-4-6 1-8 4-8Zm-2 16h5l-.5 4h-4L4 18Z" />
        <path d="M18 8c3 0 4 4 4 8s-1 6-4 6-4-3-4-6 1-8 4-8Zm-2 16h5l-.5 4h-4l-.5-4Z" />
      </g>
    </svg>
  );
}

function WeekSteps({ data }: { data: FitnessOverview }) {
  const s = data.summary;
  const days = useMemo(() => {
    const t = new Date(`${s.today}T12:00:00`);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(t);
      d.setDate(t.getDate() - 6 + i);
      const key = ymd(d);
      return { key, label: d.toLocaleDateString('en-GB', { weekday: 'narrow' }), steps: data.data.steps.find((x) => x.date === key)?.steps ?? 0 };
    });
  }, [data, s.today]);
  const max = Math.max(s.stepGoal, ...days.map((d) => d.steps)) * 1.08;
  return (
    <Card>
      <div className="n-fit__weekhead">
        <b>This week</b>
        <span>avg {fmtN(s.stepsWeekAvg)} a day</span>
      </div>
      <div className="n-fit__bars">
        <i className="n-fit__goalline" style={{ bottom: `${(s.stepGoal / max) * 100}%` }} />
        {days.map((d) => (
          <div key={d.key} className={`n-fit__bar ${d.steps >= s.stepGoal ? 'is-hit' : ''} ${d.key === s.today ? 'is-today' : ''}`}>
            <span style={{ height: `${Math.max(2, (d.steps / max) * 100)}%` }} title={`${fmtN(d.steps)} steps`} />
            <small>{d.label}</small>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Change({ label, v, goal, weight }: { label: string; v: number | null; goal: number; weight: number | null }) {
  if (v == null) return null;
  // Green when moving toward the goal (or down when no goal is set).
  const towardGoal = goal > 0 && weight != null ? Math.sign(goal - weight) === Math.sign(v) || v === 0 : v <= 0;
  return (
    <span className={`n-fit__chg ${v === 0 ? '' : towardGoal ? 'is-good' : 'is-off'}`}>
      {v > 0 ? '▲' : v < 0 ? '▼' : '•'} {Math.abs(v)} kg
      <small>{label}</small>
    </span>
  );
}

function WeightChart({ data, days }: { data: FitnessOverview; days: number }) {
  const W = 320;
  const H = 120;
  const today = new Date(`${data.summary.today}T12:00:00`).getTime();
  const from = today - days * 86_400_000;
  const pts = data.data.weights.map((w) => ({ t: new Date(`${w.date}T12:00:00`).getTime(), kg: w.kg })).filter((p) => p.t >= from);
  if (pts.length < 2) return <p className="n-hint n-fit__chartempty">Log your weight a few times to see your trend line.</p>;
  const goal = data.data.profile.goalKg;
  const vals = pts.map((p) => p.kg).concat(goal > 0 ? [goal] : []);
  const lo = Math.floor(Math.min(...vals) - 1);
  const hi = Math.ceil(Math.max(...vals) + 1);
  const x = (t: number) => ((t - from) / (today - from)) * (W - 30) + 4;
  const y = (kg: number) => H - 14 - ((kg - lo) / Math.max(1, hi - lo)) * (H - 26);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.kg).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts[pts.length - 1].t).toFixed(1)} ${H - 14} L${x(pts[0].t).toFixed(1)} ${H - 14} Z`;
  return (
    <svg className="n-fit__chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Weight trend">
      <defs>
        <linearGradient id="fit-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--n-accent)" stopOpacity="0.28" />
          <stop offset="1" stopColor="var(--n-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[lo, (lo + hi) / 2, hi].map((v) => (
        <g key={v}>
          <line x1="4" x2={W - 26} y1={y(v)} y2={y(v)} className="n-fit__grid" />
          <text x={W - 2} y={y(v) + 4} textAnchor="end" className="n-fit__axis">
            {Math.round(v)}
          </text>
        </g>
      ))}
      {goal > 0 && <line x1="4" x2={W - 26} y1={y(goal)} y2={y(goal)} className="n-fit__goalpath" />}
      <path d={area} fill="url(#fit-area)" />
      <path d={line} className="n-fit__line" />
      {pts.map((p, i) => (
        <circle key={i} cx={x(p.t)} cy={y(p.kg)} r={i === pts.length - 1 ? 4 : 2.2} className={i === pts.length - 1 ? 'n-fit__dot is-last' : 'n-fit__dot'} />
      ))}
    </svg>
  );
}

function BmiScale({ bmi, band, asian }: { bmi: number; band: keyof typeof BMI_INFO; asian: boolean }) {
  const [u, h, o] = asian ? [18.5, 23, 27.5] : [18.5, 25, 30];
  const lo = 15;
  const hi = 35;
  const at = (v: number) => `${((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * 100}%`;
  const info = BMI_INFO[band];
  return (
    <div className="n-bmi">
      <div className="n-bmi__head">
        <b style={{ color: info.color }}>{bmi}</b>
        <span>
          {info.en} · <span lang="bn">{info.bn}</span>
        </span>
      </div>
      <div className="n-bmi__scale">
        <i style={{ left: 0, width: at(u), background: BMI_INFO.under.color }} />
        <i style={{ left: at(u), width: `calc(${at(h)} - ${at(u)})`, background: BMI_INFO.healthy.color }} />
        <i style={{ left: at(h), width: `calc(${at(o)} - ${at(h)})`, background: BMI_INFO.over.color }} />
        <i style={{ left: at(o), right: 0, background: BMI_INFO.obese.color }} />
        <em style={{ left: at(bmi) }} />
      </div>
      <div className="n-bmi__ticks">
        {[u, h, o].map((v) => (
          <span key={v} style={{ left: at(v) }}>
            {v}
          </span>
        ))}
      </div>
    </div>
  );
}

function WeightSheet({ last, onSave, onClose }: { last: number | null; onSave: (date: string, kg: number | null) => void; onClose: () => void }) {
  const [kg, setKg] = useState(last ? String(last) : '');
  const [date, setDate] = useState(ymd(new Date()));
  const n = Number(kg.replace(',', '.'));
  const ok = n >= 20 && n <= 300;
  return (
    <Sheet
      open
      onClose={onClose}
      title="Log weight"
      actions={
        <button className="n-link n-link--strong" disabled={!ok} onClick={() => onSave(date, Math.round(n * 10) / 10)}>
          Save
        </button>
      }
    >
      <div className="n-form">
        <label className="n-field">
          <span>Weight (kg)</span>
          <input className="n-input n-input--big" inputMode="decimal" placeholder="e.g. 68.5" value={kg} onChange={(e) => setKg(e.target.value)} autoFocus />
        </label>
        <div className="n-fit__nudge">
          {[-1, -0.5, -0.1, 0.1, 0.5, 1].map((d) => (
            <button key={d} className="n-chip" onClick={() => setKg(String(Math.round(((Number(kg) || last || 60) + d) * 10) / 10))}>
              {d > 0 ? '+' : ''}
              {d}
            </button>
          ))}
        </div>
        <label className="n-field">
          <span>Date</span>
          <input className="n-input" type="date" value={date} max={ymd(new Date())} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <p className="n-hint n-hint--flush">For a steady trend, weigh at the same time — in the morning before eating works best.</p>
      </div>
    </Sheet>
  );
}

function StepsSheet({ value, onSave, onClose }: { value: number; onSave: (n: number) => void; onClose: () => void }) {
  const [v, setV] = useState(String(value || ''));
  const n = Math.round(Number(v));
  return (
    <Sheet
      open
      onClose={onClose}
      title="Today’s steps"
      actions={
        <button className="n-link n-link--strong" disabled={!(n >= 0 && n <= 150000)} onClick={() => onSave(n)}>
          Save
        </button>
      }
    >
      <div className="n-form">
        <label className="n-field">
          <span>Steps</span>
          <input className="n-input n-input--big" inputMode="numeric" value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ''))} autoFocus />
        </label>
        <p className="n-hint n-hint--flush">If your iPhone counts more later, the bigger number is kept.</p>
      </div>
    </Sheet>
  );
}

function ProfileSheet({ profile, needsWeight, onSave, onClose }: { profile: FitnessProfile; needsWeight: boolean; onSave: (p: FitnessProfile, firstKg: number | null) => void; onClose: () => void }) {
  const [p, setP] = useState(profile);
  const [unit, setUnit] = useState<'ftin' | 'cm'>('ftin');
  const fi = cmToFtIn(p.heightCm || 165);
  const [ft, setFt] = useState(String(profile.heightCm ? fi.ft : ''));
  const [inch, setInch] = useState(String(profile.heightCm ? fi.inch : ''));
  const [cm, setCm] = useState(profile.heightCm ? String(profile.heightCm) : '');
  const [kg, setKg] = useState('');
  useEffect(() => {
    if (unit === 'ftin' && ft) setP((x) => ({ ...x, heightCm: ftInToCm(Number(ft) || 0, Number(inch) || 0) }));
  }, [ft, inch, unit]);
  useEffect(() => {
    if (unit === 'cm' && cm) setP((x) => ({ ...x, heightCm: Number(cm) || 0 }));
  }, [cm, unit]);
  return (
    <Sheet
      open
      onClose={onClose}
      title="Fitness settings"
      actions={
        <button className="n-link n-link--strong" onClick={() => onSave(p, needsWeight && Number(kg) >= 20 ? Math.round(Number(kg) * 10) / 10 : null)}>
          Save
        </button>
      }
    >
      <div className="n-form">
        <div className="n-field">
          <span>Height · উচ্চতা</span>
          <Segmented
            value={unit}
            onChange={(u) => {
              setUnit(u);
              if (u === 'cm' && p.heightCm) setCm(String(p.heightCm));
              if (u === 'ftin' && p.heightCm) {
                const x = cmToFtIn(p.heightCm);
                setFt(String(x.ft));
                setInch(String(x.inch));
              }
            }}
            options={[
              { id: 'ftin', label: 'Feet & inches' },
              { id: 'cm', label: 'cm' },
            ]}
          />
          {unit === 'ftin' ? (
            <div className="n-fit__hrow">
              <input className="n-input" inputMode="numeric" placeholder="5" value={ft} onChange={(e) => setFt(e.target.value.replace(/\D/g, ''))} />
              <small>ft</small>
              <input className="n-input" inputMode="numeric" placeholder="6" value={inch} onChange={(e) => setInch(e.target.value.replace(/\D/g, ''))} />
              <small>in</small>
              <em>{p.heightCm ? `${p.heightCm} cm` : ''}</em>
            </div>
          ) : (
            <input className="n-input" inputMode="decimal" placeholder="168" value={cm} onChange={(e) => setCm(e.target.value)} />
          )}
        </div>
        <div className="n-field">
          <span>Sex · লিঙ্গ (for calorie estimates)</span>
          <Segmented
            value={p.sex || 'none'}
            onChange={(v) => setP({ ...p, sex: v === 'none' ? '' : (v as 'male' | 'female') })}
            options={[
              { id: 'male', label: 'Male' },
              { id: 'female', label: 'Female' },
              { id: 'none', label: 'Skip' },
            ]}
          />
        </div>
        <label className="n-field">
          <span>Birth year (for calorie estimates)</span>
          <input
            className="n-input"
            inputMode="numeric"
            placeholder="e.g. 1992"
            value={p.birthYear || ''}
            onChange={(e) => setP({ ...p, birthYear: Number(e.target.value.replace(/\D/g, '').slice(0, 4)) || 0 })}
          />
        </label>
        {needsWeight && (
          <label className="n-field">
            <span>Current weight (kg)</span>
            <input className="n-input" inputMode="decimal" placeholder="e.g. 68.5" value={kg} onChange={(e) => setKg(e.target.value)} />
          </label>
        )}
        <label className="n-field">
          <span>Goal weight (kg, optional)</span>
          <input className="n-input" inputMode="decimal" placeholder="—" value={p.goalKg || ''} onChange={(e) => setP({ ...p, goalKg: Number(e.target.value) || 0 })} />
        </label>
        <label className="n-field">
          <span>Daily steps goal</span>
          <input className="n-input" inputMode="numeric" value={p.stepGoal} onChange={(e) => setP({ ...p, stepGoal: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
        </label>
        <div className="n-field n-field--row">
          <span>South Asian BMI bands</span>
          <Switch checked={p.asianBmi} onChange={(v) => setP({ ...p, asianBmi: v })} />
        </div>
        <div className="n-field n-field--row">
          <span>Weekly weigh-in reminder</span>
          <Switch checked={p.weighReminder} onChange={(v) => setP({ ...p, weighReminder: v })} />
        </div>
        {p.weighReminder && (
          <div className="n-fit__hrow">
            <select className="n-input" value={p.weighDay} onChange={(e) => setP({ ...p, weighDay: Number(e.target.value) })}>
              {DAYS.map((d, i) => (
                <option key={d} value={i + 1}>
                  {d}
                </option>
              ))}
            </select>
            <input className="n-input n-input--time" type="time" value={p.weighTime} onChange={(e) => e.target.value && setP({ ...p, weighTime: e.target.value })} />
          </div>
        )}
      </div>
    </Sheet>
  );
}

const LEVEL_ICON = { good: '✓', ok: '~', warn: '!', info: 'i' } as const;

/** Health check, calories and a week / month report. */
function HealthReport({ data, onSetup }: { data: FitnessOverview; onSetup: () => void }) {
  const [days, setDays] = useState<'7' | '30'>('7');
  const [r, setR] = useState<FitnessReport | null>(null);
  useEffect(() => {
    fit.report(Number(days)).then(setR, () => undefined);
  }, [days, data]);
  if (!r) return null;
  const s = data.summary;
  const p = data.data.profile;
  const needsBody = !p.birthYear || !p.sex;
  const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return (
    <>
      <div className="n-sectionrow">
        <SectionTitle>Health check · স্বাস্থ্য</SectionTitle>
        {r.scoreOf > 0 && (
          <span className="n-fit__score">
            {r.score}/{r.scoreOf} good
          </span>
        )}
      </div>
      <Card>
        <div className="n-hc">
          {r.checks.map((c) => (
            <div key={c.key} className={`n-hc__row is-${c.level}`}>
              <span className="n-hc__icon">{LEVEL_ICON[c.level]}</span>
              <span>
                <b>{c.title}</b>
                <small>{c.detail}</small>
              </span>
            </div>
          ))}
        </div>
      </Card>

      <SectionTitle>Calories · ক্যালরি</SectionTitle>
      <div className="n-kcal">
        <div className="n-kcal__tile is-burn">
          <NIcon name="flame" size={18} />
          <b>{s.kcalToday}</b>
          <small>burned walking today</small>
        </div>
        <div className="n-kcal__tile">
          <b>{r.bmr ?? '—'}</b>
          <small>resting (BMR) a day</small>
        </div>
        <div className="n-kcal__tile">
          <b>{r.tdee ?? '—'}</b>
          <small>you burn a day ({ACTIVITY_INFO[r.activity].en.toLowerCase()})</small>
        </div>
        <div className="n-kcal__tile is-target">
          <b>{r.targetKcal ?? '—'}</b>
          <small>{p.goalKg && s.toGoalKg != null && Math.abs(s.toGoalKg) > 0.5 ? (s.toGoalKg > 0 ? 'to eat a day to lose ~0.5 kg/week' : 'to eat a day to gain slowly') : 'to eat a day to stay the same'}</small>
        </div>
      </div>
      {needsBody ? (
        <button className="n-fit__setup" onClick={onSetup}>
          <NIcon name="user" size={18} />
          <span>
            <b>Add your age and sex</b>
            <small>Needed for your daily calorie numbers.</small>
          </span>
          <NIcon name="chevronRight" size={16} />
        </button>
      ) : (
        r.weeksToGoal != null && <p className="n-fit__goal">At a steady pace, your goal is about {r.weeksToGoal} weeks away.</p>
      )}

      <div className="n-sectionrow">
        <SectionTitle>Report · রিপোর্ট</SectionTitle>
      </div>
      <Card>
        <Segmented
          value={days}
          onChange={setDays}
          options={[
            { id: '7', label: 'This week' },
            { id: '30', label: 'Last 30 days' },
          ]}
        />
        <div className="n-rep">
          <div>
            <b>{fmtN(r.totalSteps)}</b>
            <small>steps</small>
          </div>
          <div>
            <b>{fmtN(r.avgSteps)}</b>
            <small>a day on average</small>
          </div>
          <div>
            <b>{r.km} km</b>
            <small>walked</small>
          </div>
          <div>
            <b>{fmtN(r.walkKcal)}</b>
            <small>kcal burned walking</small>
          </div>
          <div>
            <b>
              {r.goalDays}/{r.days}
            </b>
            <small>days at step goal</small>
          </div>
          <div>
            <b>{r.weightChange == null ? '—' : `${r.weightChange > 0 ? '+' : ''}${r.weightChange} kg`}</b>
            <small>weight change</small>
          </div>
        </div>
        <p className="n-rep__line">
          Activity: <b>{ACTIVITY_INFO[r.activity].en}</b> · <span lang="bn">{ACTIVITY_INFO[r.activity].bn}</span>
          {r.best && (
            <>
              <br />
              Best day: <b>{fmtN(r.best.steps)} steps</b> on {fmt(r.best.date)}
            </>
          )}
        </p>
      </Card>
      <p className="n-hint">Estimates from standard formulas (Mifflin–St Jeor, step counts) — a guide, not medical advice.</p>
    </>
  );
}
