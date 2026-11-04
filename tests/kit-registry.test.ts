import { describe, expect, it, vi } from 'vitest';

// Tool components are lazy-loaded; stub React.lazy so the registry can be inspected in Node.
vi.mock('react', async (orig) => {
  const actual = await orig<typeof import('react')>();
  return { ...actual, lazy: () => (() => null) as unknown as ReturnType<typeof actual.lazy> };
});

const { TOOLS, toolsByCategory, validateRegistry, navigableTools, findTool } = await import('../src/kit/navigation/registry');
const { PLANNED_TOOLS } = await import('../src/kit/tools/app-pages/definition');

describe('tool registry', () => {
  it('is valid (unique ids and shortcuts, names, descriptions)', () => {
    expect(validateRegistry()).toEqual([]);
  });

  it('contains every required tool in the right category', () => {
    const ids = TOOLS.map((t) => t.id);
    for (const id of ['mouse-scrolling', 'watermark', 'crop', 'resize-canvas', 'batch-processing', 'compression', 'format-converter', 'adjust', 'background', 'collage', 'facebook-post', 'notes', 'settings', 'about', 'future-tools']) {
      expect(ids).toContain(id);
    }
    expect(findTool('mouse-scrolling')?.category).toBe('system');
    expect(findTool('crop')?.category).toBe('image');
    expect(findTool('notes')?.category).toBe('create');
    expect(toolsByCategory().map((g) => g.category)).toEqual(['system', 'image', 'create', 'application']);
  });

  it('never exposes planned tools as navigable features', () => {
    const nav = navigableTools().map((t) => t.id);
    for (const p of PLANNED_TOOLS) expect(nav).not.toContain(p.id);
  });

  it('detects problems', () => {
    const t = TOOLS[0];
    expect(validateRegistry([t, { ...t }]).length).toBeGreaterThan(0);
    expect(validateRegistry([{ ...t, id: 'Bad Id' }]).length).toBeGreaterThan(0);
  });
});
