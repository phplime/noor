import { lazy } from 'react';
import type { ToolDefinition } from '../../navigation/types';

export const notesTool: ToolDefinition = {
  id: 'notes',
  name: 'Notes',
  description: 'Quick notes with basic formatting, checklists, colors and emoji — saved on this device',
  icon: 'note',
  category: 'create',
  version: '1.0.0',
  component: lazy(() => import('./NotesTool')),
  status: 'available',
  shortcut: '0',
  keepAlive: true,
};
