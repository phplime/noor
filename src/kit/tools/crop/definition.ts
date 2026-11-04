import { lazy } from 'react';
import type { ToolDefinition } from '../../navigation/types';

export const cropTool: ToolDefinition = {
  id: 'crop',
  name: 'Crop Image',
  description: 'Remove part of an image using preset or custom aspect ratios',
  icon: 'crop',
  category: 'image',
  version: '1.0.0',
  component: lazy(() => import('./CropTool')),
  status: 'available',
  shortcut: '3',
  keepAlive: true,
};
