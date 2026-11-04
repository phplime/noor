import { useEffect, useRef } from 'react';
import type { RoutineTab } from '../context';
import { NIcon, type NoorIconName } from '../icons';
import { Screen } from '../ui';
import { RemindersView } from './routine/Reminders';
import { WaterView } from './routine/Water';
import { TimerView } from './routine/Timer';
import { TodoView } from './routine/Todo';
import { ClocksView } from './routine/Clocks';
import { PlacesView } from './routine/Places';
import { CycleView } from './routine/Cycle';
import { FitnessView } from './routine/Fitness';

const ITEMS: { id: RoutineTab; label: string; icon: NoorIconName }[] = [
  { id: 'reminders', label: 'Reminders', icon: 'bell' },
  { id: 'fitness', label: 'Fitness', icon: 'heart' },
  { id: 'cycle', label: 'Cycle', icon: 'calendarStar' },
  { id: 'water', label: 'Water', icon: 'drop' },
  { id: 'timer', label: 'Timer', icon: 'timer' },
  { id: 'todo', label: 'To-do', icon: 'list' },
  { id: 'clocks', label: 'Clocks', icon: 'globe' },
  { id: 'places', label: 'Places', icon: 'pin' },
];

export function RoutineScreen({ tab, onTab }: { tab: RoutineTab; onTab: (t: RoutineTab) => void }) {
  const bar = useRef<HTMLDivElement>(null);

  // Keep the selected chip in view (e.g. when a notification opens Places).
  useEffect(() => {
    const el = bar.current?.querySelector<HTMLElement>('.is-on');
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [tab]);

  return (
    <Screen title="Daily Life" eyebrow="Your day, made easy · দৈনন্দিন">
      <div className="n-chipbar" role="tablist" ref={bar}>
        {ITEMS.map((i) => (
          <button key={i.id} role="tab" aria-selected={tab === i.id} className={`n-chipbar__item ${tab === i.id ? 'is-on' : ''}`} onClick={() => onTab(i.id)}>
            <NIcon name={i.icon} size={17} stroke={tab === i.id ? 2.2 : 1.9} />
            <span>{i.label}</span>
          </button>
        ))}
      </div>
      <div className="n-routine-body" key={tab}>
        {tab === 'reminders' && <RemindersView />}
        {tab === 'fitness' && <FitnessView />}
        {tab === 'cycle' && <CycleView />}
        {tab === 'water' && <WaterView />}
        {tab === 'timer' && <TimerView />}
        {tab === 'todo' && <TodoView />}
        {tab === 'clocks' && <ClocksView />}
        {tab === 'places' && <PlacesView />}
      </div>
    </Screen>
  );
}
