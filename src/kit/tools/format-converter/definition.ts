import { lazy } from 'react';
import type { ToolDefinition } from '../../navigation/types';

export const formatConverterTool: ToolDefinition = {
  id: 'format-converter',
  name: 'Format Converter',
  description: 'Convert between PNG, JPEG, WebP, TIFF and BMP',
  icon: 'convert',
  category: 'image',
  version: '1.0.0',
  component: lazy(() => import('./FormatConverterTool')),
  status: 'available',
  shortcut: '7',
  keepAlive: true,
};
