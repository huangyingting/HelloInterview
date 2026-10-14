'use client';

import { App } from '../src/App';
import { StudioProvider } from '../src/store';

export function StudioShell() {
  return <StudioProvider><App /></StudioProvider>;
}
