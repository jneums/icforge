import { useState, useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetchRaw } from '@/api/client';
import { fetchDeployStatus } from '@/api/deploys';
import type { LogEntry } from '@/api/types';

const IN_PROGRESS_STATUSES = ['queued', 'building', 'deploying', 'created'];

interface UseDeployStreamResult {
  logs: LogEntry[];
  streaming: boolean;
}

/**
 * SSE streaming hook for deploy logs.
 * Connects when the deploy is in progress, accumulates log entries,
 * and refetches final status on "done" event.
 */
export function useDeployStream(
  deployId: string | undefined,
  status: string | undefined,
  enabled: boolean
): UseDeployStreamResult {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();

  const connectSSE = useCallback(
    async (signal: AbortSignal) => {
      if (!deployId) return;

      try {
        const response = await apiFetchRaw(
          `/api/v1/deploy/${deployId}/logs/stream`,
          { signal }
        );

        if (!response.ok || !response.body) return;

        setStreaming(true);
        setLogs([]); // SSE replays all logs — clear to avoid duplicates
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentEvent = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.startsWith('event:')) {
              currentEvent = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              const data = line.slice(5).trim();
              if (currentEvent === 'log') {
                try {
                  const entry: LogEntry = JSON.parse(data);
                  setLogs((prev) => [...prev, entry]);
                } catch {
                  // skip malformed
                }
              } else if (currentEvent === 'status') {
                // Invalidate status query so it refetches
                queryClient.setQueryData(
                  ['deploy-status', deployId],
                  (old: any) => old ? { ...old, status: data } : old
                );
              } else if (currentEvent === 'done') {
                setStreaming(false);
                try {
                  const finalStatus = await fetchDeployStatus(deployId);
                  queryClient.setQueryData(
                    ['deploy-status', deployId],
                    finalStatus
                  );
                } catch {
                  // ignore — the query will refetch on its own
                }
                return;
              }
            }
          }
        }
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
      } finally {
        setStreaming(false);
      }
    },
    [deployId, queryClient]
  );

  useEffect(() => {
    if (!enabled || !deployId || !status) return;
    if (!IN_PROGRESS_STATUSES.includes(status)) return;

    const controller = new AbortController();
    abortRef.current = controller;
    connectSSE(controller.signal);

    return () => {
      controller.abort();
      abortRef.current = null;
    };
  }, [enabled, deployId, status, connectSSE]);

  return { logs, streaming };
}
