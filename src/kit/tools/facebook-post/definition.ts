import { lazy } from 'react';
import type { ToolDefinition } from '../../navigation/types';

export const facebookPostTool: ToolDefinition = {
  id: 'facebook-post',
  name: 'Facebook Post',
  description: 'Compose a post with text, emoji and photos, preview it as a Facebook card and prepare it for posting',
  icon: 'share',
  category: 'create',
  version: '1.0.0',
  component: lazy(() => import('./FacebookPostTool')),
  status: 'available',
  keepAlive: true,
};
