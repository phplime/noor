import { lazy } from 'react';
import type { ToolDefinition } from '../../navigation/types';

export const resizeCanvasTool: ToolDefinition = {
  id: 'resize-canvas',
  name: 'Resize & Canvas',
  description: 'Exact output dimensions without cropping: Fit, Canvas, Stretch or Scale %',
  icon: 'resize',
  category: 'image',
  version: '1.0.0',
  component: lazy(() => import('./ResizeCanvasTool')),
  status: 'available',
  shortcut: '4',
  keepAlive: true,
};
