import { lazy } from 'react';
import type { ToolDefinition } from '../../navigation/types';

export const collageTool: ToolDefinition = {
  id: 'collage',
  name: 'Photo Collage',
  description: 'Combine 2–9 photos with layouts, spacing, rounded corners and drag-to-reframe',
  icon: 'grid',
  category: 'create',
  version: '1.0.0',
  component: lazy(() => import('./CollageTool')),
  status: 'available',
  shortcut: '9',
  keepAlive: true,
};
