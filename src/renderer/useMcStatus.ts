import { useEffect, useState } from 'react';
import type { McProgress, McStatus } from '../shared/minecraft';

export function useMcStatus() {
  const [status, setStatus] = useState<McStatus>({ state: 'idle', versionId: null });
  const [progress, setProgress] = useState<McProgress | null>(null);
  useEffect(() => {
    window.nexa.getMcStatus().then(setStatus).catch(() => undefined);
    const offStatus = window.nexa.onMcStatus((s) => { setStatus(s); if (s.state === 'idle') setProgress(null); });
    const offProgress = window.nexa.onMcProgress(setProgress);
    return () => { offStatus(); offProgress(); };
  }, []);
  return { status, progress };
}
