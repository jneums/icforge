import { useSearchParams } from 'react-router-dom';

/**
 * Tab state synced to a `?tab=` URL param so tabs survive refresh,
 * work with the back button, and can be deep-linked.
 */
export function useTabParam(defaultTab: string, validTabs: string[]) {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('tab');
  const tab = raw && validTabs.includes(raw) ? raw : defaultTab;

  function setTab(next: string) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === defaultTab) {
          params.delete('tab');
        } else {
          params.set('tab', next);
        }
        return params;
      },
      { replace: false }
    );
  }

  return [tab, setTab] as const;
}
