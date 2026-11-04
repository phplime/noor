import { lazy } from 'react';
import type { ToolDefinition } from '../../navigation/types';

export const adjustTool: ToolDefinition = {
  id: 'adjust',
  name: 'Adjust & Enhance',
  description: 'Rotate, brightness, contrast, tone curve, color and sharpness',
  icon: 'sliders',
  category: 'image',
  version: '1.0.0',
  component: lazy(() => import('./AdjustTool')),
  status: 'available',
  shortcut: '8',
  keepAlive: true,
};
