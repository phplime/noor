import type { ComponentType, LazyExoticComponent } from 'react';
import type { IconName } from '../components/Icon';

export type ToolCategory = 'system' | 'image' | 'create' | 'application';

/** `planned` tools are never navigable; they only appear on the Future Tools page. */
export type ToolStatus = 'available' | 'beta' | 'planned';

export interface ToolProps {
  /** True while this tool is the visible one (tools stay mounted to keep state). */
  active: boolean;
}

export interface ToolDefinition {
  /** Unique, stable id (also used for remembered settings). */
  id: string;
  name: string;
  description: string;
  icon: IconName;
  category: ToolCategory;
  version: string;
  component: LazyExoticComponent<ComponentType<ToolProps>>;
  status: ToolStatus;
  /** macOS permissions the tool may request, shown on the About page. */
  permissions?: string[];
  /** Digit used with ⌘ to open the tool. */
  shortcut?: string;
  /** Kept mounted when switching away (preserves queues and settings). */
  keepAlive?: boolean;
  /** Platforms the tool works on (default: all). */
  platforms?: ('macos' | 'ios')[];
}

export interface PlannedTool {
  id: string;
  name: string;
  description: string;
  icon: IconName;
  category: ToolCategory;
}

export const CATEGORY_LABEL: Record<ToolCategory, string> = {
  system: 'System Tools',
  image: 'Image Tools',
  create: 'Create',
  application: 'Application',
};
