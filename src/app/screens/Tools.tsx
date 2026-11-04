import { Icon } from '../../kit/components/Icon';
import { navigableTools } from '../../kit/navigation/registry';
import type { ToolDefinition } from '../../kit/navigation/types';
import { useNoor } from '../context';
import { Screen, SectionTitle } from '../ui';

function Tile({ t, onOpen }: { t: ToolDefinition; onOpen: () => void }) {
  return (
    <button className="n-tool" onClick={onOpen}>
      <span className="n-tool__icon">
        <Icon name={t.icon} size={20} />
      </span>
      <span className="n-tool__text">
        <span className="n-tool__name">{t.name}</span>
        <span className="n-tool__desc">{t.description}</span>
      </span>
    </button>
  );
}

export function ToolsScreen() {
  const { push } = useNoor();
  const tools = navigableTools();
  const image = tools.filter((t) => t.category === 'image');
  const create = tools.filter((t) => t.category === 'create');
  const open = (id: string) => push({ kind: 'tool', id });

  return (
    <Screen title="Studio">
      <p className="n-hint">Private photo tools — everything runs on your iPhone. Results are saved to Files › On My iPhone › Noor.</p>

      <SectionTitle>Photo tools</SectionTitle>
      <div className="n-tools">
        {image.map((t) => (
          <Tile key={t.id} t={t} onOpen={() => open(t.id)} />
        ))}
      </div>

      <SectionTitle>Create</SectionTitle>
      <div className="n-tools">
        {create.map((t) => (
          <Tile key={t.id} t={t} onOpen={() => open(t.id)} />
        ))}
      </div>
    </Screen>
  );
}
