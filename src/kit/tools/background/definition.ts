import { lazy } from 'react';
import type { ToolDefinition } from '../../navigation/types';

export const backgroundTool: ToolDefinition = {
  id: 'background',
  name: 'Remove Background',
  description: 'Remove, recolor or DSLR-blur the background — automatic subject detection, click to pick subjects, brush to refine',
  icon: 'scissors',
  category: 'image',
  version: '1.0.0',
  component: lazy(() => import('./BackgroundTool')),
  status: 'available',
  keepAlive: true,
};
