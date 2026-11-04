import { call } from '../ipc';
import type { DeviceDirection, ScrollOpResult, ScrollStatus } from '../../types/settings';

export const getScrollStatus = () => call<ScrollStatus>('scroll_status');
export const setNaturalScrolling = (natural: boolean) => call<ScrollOpResult>('scroll_set_natural', { natural });
export const applyDeviceDirections = (mouse: DeviceDirection, trackpad: DeviceDirection) =>
  call<ScrollOpResult>('scroll_apply_devices', { mouse, trackpad });
export const requestAccessibility = () => call<ScrollOpResult>('scroll_request_access');
export const restoreScrollDefaults = () => call<ScrollOpResult>('scroll_restore_defaults');
export const openSystemSettings = (pane: 'mouse' | 'trackpad' | 'accessibility') =>
  call<void>('open_system_settings', { pane });
