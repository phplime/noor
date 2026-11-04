import { lazy } from 'react';
import type { ToolDefinition } from '../../navigation/types';

export const watermarkTool: ToolDefinition = {
  id: 'watermark',
  name: 'Add Logo / Watermark',
  description: 'Add a logo or text watermark to one image, many images or a folder',
  icon: 'watermark',
  category: 'image',
  version: '1.0.0',
  component: lazy(() => import('./WatermarkTool')),
  status: 'available',
  shortcut: '2',
  keepAlive: true,
};
