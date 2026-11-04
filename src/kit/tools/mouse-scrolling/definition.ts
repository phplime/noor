import { lazy } from 'react';
import type { ToolDefinition } from '../../navigation/types';

export const mouseScrollingTool: ToolDefinition = {
  id: 'mouse-scrolling',
  name: 'Mouse Scrolling',
  description: 'Natural or standard scrolling for mouse and trackpad',
  icon: 'mouse',
  category: 'system',
  version: '1.0.0',
  component: lazy(() => import('./MouseScrollingTool')),
  status: 'available',
  // System-wide scrolling is a macOS feature; iOS doesn't allow it.
  platforms: ['macos'],
  permissions: ['Accessibility (only for per-device direction)'],
  shortcut: '1',
};
