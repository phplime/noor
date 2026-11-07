import { useEffect, useState } from 'react';

/**
 * Owner-only features. The email is only a local switch on this phone (no sign-in, no server):
 * it hides tools from other people who install Noor, it is not a security check.
 */
const KEY = 'noor.email.v1';
const OWNERS = ['mdnazmul.nm@gmail.com'];

export function getEmail(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function setEmail(v: string) {
  try {
    localStorage.setItem(KEY, v.trim());
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event('noor:email'));
}

export const isOwnerEmail = (e: string) => OWNERS.includes(e.trim().toLowerCase());

export function useOwner(): boolean {
  const [on, set] = useState(() => isOwnerEmail(getEmail()));
  useEffect(() => {
    const f = () => set(isOwnerEmail(getEmail()));
    window.addEventListener('noor:email', f);
    return () => window.removeEventListener('noor:email', f);
  }, []);
  return on;
}
