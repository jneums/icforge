import { useState, useEffect, useRef, useCallback } from 'react';
import { streamCanisterLogs } from '@/api/canister-logs';
import type { LogEntry } from '@/api/types';

interface UseCanisterLogStreamResult {
  logs: LogEntry[];
  streaming: boolean;
  replayDone: boolean;
}

/**
 * SSE streaming hook for canister runtime logs.
 * Replays recent logs from DB, then live-tails new logs from IC.
 */
export function useCanisterLogStream(
  canisterId: string | null,
  enabled: boolean
): UseCanisterLogStreamResult {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [replayDone, setReplayDone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const connectSSE = useCallback(
    async (signal: AbortSignal) => {
      if (!canisterId) return;

      try {
        const response = await streamCanisterLogs(canisterId, signal);
        if (!response.ok || !response.body) return;

        setStreaming(true);
        setLogs([]);
        setReplayDone(false);

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
              } else if (currentEvent === 'replay_done') {
                setReplayDone(true);
              } else if (currentEvent === 'error') {
                // IC identity issues, etc.
                console.warn('Canister log stream error:', data);
              } else if (currentEvent === 'timeout') {
                // Stream ended due to inactivity — not an error
                setStreaming(false);
                return;
              }
            }
          }
        }
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        console.warn('Canister log stream connection error:', e);
      } finally {
        setStreaming(false);
      }
    },
    [canisterId]
  );

  useEffect(() => {
    if (!enabled || !canisterId) return;

    const controller = new AbortController();
    abortRef.current = controller;
    connectSSE(controller.signal);

    return () => {
      controller.abort();
      abortRef.current = null;
    };
  }, [enabled, canisterId, connectSSE]);

  return { logs, streaming, replayDone };
}
