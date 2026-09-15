import { useSyncExternalStore } from 'react';

const STANDALONE_QUERY = '(display-mode: standalone)';

function subscribe(onStoreChange: () => void): () => void {
  const displayMode = window.matchMedia?.(STANDALONE_QUERY);
  displayMode?.addEventListener('change', onStoreChange);
  window.addEventListener('appinstalled', onStoreChange);
  window.addEventListener('pageshow', onStoreChange);

  return () => {
    displayMode?.removeEventListener('change', onStoreChange);
    window.removeEventListener('appinstalled', onStoreChange);
    window.removeEventListener('pageshow', onStoreChange);
  };
}

function getSnapshot(): boolean {
  const iosNavigator = navigator as Navigator & { standalone?: boolean };
  return iosNavigator.standalone === true || window.matchMedia?.(STANDALONE_QUERY).matches === true;
}

export function useStandaloneMode(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
