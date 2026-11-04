import { lazy } from 'react';
import type { ToolDefinition } from '../../navigation/types';

export const batchProcessingTool: ToolDefinition = {
  id: 'batch-processing',
  name: 'Batch Image Processing',
  description: 'Resize or pad many images and folders with one set of settings',
  icon: 'layers',
  category: 'image',
  version: '1.0.0',
  component: lazy(() => import('./BatchProcessingTool')),
  status: 'available',
  shortcut: '5',
  keepAlive: true,
};
