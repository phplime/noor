import { lazy } from 'react';
import type { PlannedTool, ToolDefinition } from '../../navigation/types';

export const settingsPage: ToolDefinition = {
  id: 'settings',
  name: 'Settings',
  description: 'Appearance, export defaults and limits',
  icon: 'settings',
  category: 'application',
  version: '1.0.0',
  component: lazy(() => import('./SettingsPage')),
  status: 'available',
};

export const aboutPage: ToolDefinition = {
  id: 'about',
  name: 'About',
  description: 'Version, privacy and terminology',
  icon: 'info',
  category: 'application',
  version: '1.0.0',
  component: lazy(() => import('./AboutPage')),
  status: 'available',
};

export const futureToolsPage: ToolDefinition = {
  id: 'future-tools',
  name: 'Future Tools',
  description: 'Planned tools — not available yet',
  icon: 'sparkles',
  category: 'application',
  version: '1.0.0',
  component: lazy(() => import('./FutureToolsPage')),
  status: 'available',
};

/** Ideas the architecture is prepared for. Listed honestly as "planned"; not navigable. */
export const PLANNED_TOOLS: PlannedTool[] = [
  { id: 'bulk-rename', name: 'Bulk Image Renaming', description: 'Rename many files with patterns and counters.', icon: 'text', category: 'image' },
  { id: 'border-generator', name: 'Border & Padding Generator', description: 'Add frames and uniform borders around images.', icon: 'fit', category: 'image' },
  { id: 'metadata', name: 'Metadata Viewer & Remover', description: 'Inspect and strip EXIF / GPS data.', icon: 'shield', category: 'image' },
  { id: 'annotate', name: 'Screenshot Annotation', description: 'Arrows, highlights and blur on screenshots.', icon: 'image', category: 'image' },
  { id: 'color-picker', name: 'Color Picker', description: 'Pick colors from anywhere on screen.', icon: 'watermark', category: 'system' },
  { id: 'pdf', name: 'PDF Utilities', description: 'Merge, split and compress PDFs.', icon: 'layers', category: 'application' },
  { id: 'files', name: 'File & Folder Utilities', description: 'Find duplicates, flatten and organise folders.', icon: 'folder', category: 'system' },
  { id: 'clipboard', name: 'Clipboard History', description: 'Recall recently copied text and images.', icon: 'undo', category: 'system' },
  { id: 'system-settings', name: 'More macOS Settings', description: 'Additional system preferences in one place.', icon: 'settings', category: 'system' },
];
