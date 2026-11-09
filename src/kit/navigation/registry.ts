/**
 * Central tool registry. To add a tool:
 *   1. create `src/tools/<id>/` with a component and a `definition.ts`
 *   2. add the definition to `TOOLS` below.
 * Navigation, shortcuts and the About page are generated from this list.
 */
import type { ToolCategory, ToolDefinition } from './types';
import { isMobile } from '../utils/platform';
import { mouseScrollingTool } from '../tools/mouse-scrolling/definition';
import { watermarkTool } from '../tools/watermark/definition';
import { cropTool } from '../tools/crop/definition';
import { resizeCanvasTool } from '../tools/resize-canvas/definition';
import { batchProcessingTool } from '../tools/batch-processing/definition';
import { compressionTool } from '../tools/compression/definition';
import { formatConverterTool } from '../tools/format-converter/definition';
import { adjustTool } from '../tools/adjust/definition';
import { backgroundTool } from '../tools/background/definition';
import { notesTool } from '../tools/notes/definition';
import { collageTool } from '../tools/collage/definition';
import { idScanTool } from '../tools/id-scan/definition';
import { facebookPostTool } from '../tools/facebook-post/definition';
import { settingsPage, aboutPage, futureToolsPage } from '../tools/app-pages/definition';

export const TOOLS: ToolDefinition[] = [
  mouseScrollingTool,
  watermarkTool,
  cropTool,
  resizeCanvasTool,
  batchProcessingTool,
  compressionTool,
  formatConverterTool,
  adjustTool,
  backgroundTool,
  collageTool,
  idScanTool,
  facebookPostTool,
  notesTool,
  settingsPage,
  aboutPage,
  futureToolsPage,
];

export const CATEGORY_ORDER: ToolCategory[] = ['system', 'image', 'create', 'application'];

export function navigableTools(): ToolDefinition[] {
  const platform = isMobile() ? 'ios' : 'macos';
  return TOOLS.filter((t) => t.status !== 'planned' && (!t.platforms || t.platforms.includes(platform)));
}

export function toolsByCategory(): { category: ToolCategory; tools: ToolDefinition[] }[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    tools: navigableTools().filter((t) => t.category === category),
  })).filter((g) => g.tools.length > 0);
}

export function findTool(id: string): ToolDefinition | undefined {
  return TOOLS.find((t) => t.id === id);
}

export function validateRegistry(tools: ToolDefinition[] = TOOLS): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const t of tools) {
    if (!/^[a-z0-9-]+$/.test(t.id)) problems.push(`invalid id "${t.id}"`);
    if (ids.has(t.id)) problems.push(`duplicate id "${t.id}"`);
    ids.add(t.id);
    if (t.shortcut) {
      if (keys.has(t.shortcut)) problems.push(`duplicate shortcut ⌘${t.shortcut}`);
      keys.add(t.shortcut);
    }
    if (!t.name.trim() || !t.description.trim()) problems.push(`tool "${t.id}" needs a name and description`);
  }
  return problems;
}
