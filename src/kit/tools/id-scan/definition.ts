import { lazy } from 'react';
import type { ToolDefinition } from '../../navigation/types';

export const idScanTool: ToolDefinition = {
  id: 'id-scan',
  name: 'ID / Passport Copy',
  description: 'Scan the front and back of an NID card or passport and place them on one white A4 page, ready to print',
  icon: 'layers',
  category: 'create',
  version: '1.0.0',
  component: lazy(() => import('./IdScanTool')),
  status: 'available',
  keepAlive: true,
};
