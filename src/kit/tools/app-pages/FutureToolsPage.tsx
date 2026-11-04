import { Icon } from '../../components/Icon';
import { CATEGORY_LABEL } from '../../navigation/types';
import { PLANNED_TOOLS } from './definition';

export default function FutureToolsPage() {
  return (
    <div className="page">
      <div className="page-narrow" style={{ maxWidth: 900 }}>
        <p className="muted" style={{ marginBottom: 16 }}>
          These tools are <strong>planned and not available yet</strong>. MacKit's tool registry and shared image services are designed so they can be added without changing the existing tools.
        </p>
        <div className="tool-cards">
          {PLANNED_TOOLS.map((t) => (
            <div key={t.id} className="card tool-card" style={{ margin: 0 }} aria-disabled="true">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="tc-icon">
                  <Icon name={t.icon} size={16} />
                </span>
                <span className="badge">Planned</span>
              </div>
              <div style={{ fontWeight: 600 }}>{t.name}</div>
              <div className="small muted">{t.description}</div>
              <div className="small subtle">{CATEGORY_LABEL[t.category]}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
