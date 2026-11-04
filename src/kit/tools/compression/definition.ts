import { lazy } from 'react';
import type { ToolDefinition } from '../../navigation/types';

export const compressionTool: ToolDefinition = {
  id: 'compression',
  name: 'Image Compression',
  description: 'Reduce file sizes with adjustable quality and optional resizing',
  icon: 'compress',
  category: 'image',
  version: '1.0.0',
  component: lazy(() => import('./CompressionTool')),
  status: 'available',
  shortcut: '6',
  keepAlive: true,
};
