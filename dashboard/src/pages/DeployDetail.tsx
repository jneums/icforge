import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  fetchDeployLogs,
  fetchDeployStatus,
  getAuthHeaders,
  API_URL,
} from '../api';
import type { LogEntry } from '../api';
import { useAuth } from '../contexts/AuthContext';

const IN_PROGRESS_STATUSES = ['pending', 'building', 'deploying', 'created'];

const levelColor: Record<string, string> = {
  error: '#ef4444',
  warn: '#f59e0b',
  warning: '#f59e0b',
  info: '#9ca3af',
  debug: '#6b7280',
};

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts.endsWith('Z') ? ts : ts + 'Z');
    return d.toLocaleTimeString(undefined, { hour12: false, fractionalSecondDigits: 3 });
  } catch {
    return ts;
  }
}

const statusColors: Record<string, string> = {
  live: 'var(--success, #22c55e)',
  deployed: 'var(--success, #22c55e)',
  running: 'var(--success, #22c55e)',
  failed: 'var(--error, #ef4444)',
  building: '#f59e0b',
  deploying: '#f59e0b',
  pending: '#f59e0b',
  created: '#f59e0b',
};

export default function DeployDetail() {
  const { id: projectId, deployId } = useParams();
  const { user, loading: authLoading } = useAuth();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<string>('pending');
  const [deployMeta, setDeployMeta] = useState<{
    canister_id?: string;
    url?: string;
    error?: string;
  }>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll to bottom when logs change
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Fetch initial status and logs
  useEffect(() => {
    if (authLoading || !user || !deployId) return;

    let cancelled = false;

    async function load() {
      try {
        const [statusData, logData] = await Promise.all([
          fetchDeployStatus(deployId!),
          fetchDeployLogs(deployId!),
        ]);
        if (cancelled) return;
        setStatus(statusData.status);
        setDeployMeta({
          canister_id: statusData.canister_id,
          url: statusData.url,
          error: statusData.error,
        });
        setLogs(logData);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [deployId, user, authLoading]);

  // SSE streaming for in-progress deploys
  const connectSSE = useCallback(async (signal: AbortSignal) => {
    if (!deployId) return;

    const headers = getAuthHeaders();
    try {
      const response = await fetch(`${API_URL}/api/v1/deploy/${deployId}/logs/stream`, {
        headers,
        signal,
      });

      if (!response.ok || !response.body) {
        return;
      }

      setStreaming(true);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let currentEvent = '';
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
              setStatus(data);
            } else if (currentEvent === 'done') {
              setStreaming(false);
              // Refresh final status
              try {
                const finalStatus = await fetchDeployStatus(deployId);
                setStatus(finalStatus.status);
                setDeployMeta({
                  canister_id: finalStatus.canister_id,
                  url: finalStatus.url,
                  error: finalStatus.error,
                });
              } catch {
                // ignore
              }
              return;
            }
          }
        }
      }
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      // Connection lost - not critical
    } finally {
      setStreaming(false);
    }
  }, [deployId]);

  useEffect(() => {
    if (authLoading || !user || loading) return;
    if (!IN_PROGRESS_STATUSES.includes(status)) return;

    const controller = new AbortController();
    abortRef.current = controller;
    connectSSE(controller.signal);

    return () => {
      controller.abort();
      abortRef.current = null;
    };
  }, [status, loading, authLoading, user, connectSSE]);

  if (authLoading || loading) {
    return (
      <div className="container">
        <p style={{ color: 'var(--text-secondary)', padding: '3rem 0', textAlign: 'center' }}>
          Loading deploy details...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <p style={{ color: 'var(--error)', padding: '3rem 0', textAlign: 'center' }}>{error}</p>
        <Link to={`/projects/${projectId}`} style={{ display: 'block', textAlign: 'center' }}>
          ← Back to Project
        </Link>
      </div>
    );
  }

  return (
    <div className="container">
      {/* Breadcrumb */}
      <div style={styles.breadcrumb}>
        <Link to="/projects">Projects</Link>
        <span style={{ color: 'var(--text-muted)', margin: '0 0.5rem' }}>/</span>
        <Link to={`/projects/${projectId}`}>Project</Link>
        <span style={{ color: 'var(--text-muted)', margin: '0 0.5rem' }}>/</span>
        <span>Deploy {deployId?.slice(0, 8)}</span>
      </div>

      {/* Deploy Metadata Header */}
      <div style={styles.header}>
        <div style={{ flex: 1 }}>
          <h1 style={styles.title}>
            Deploy {deployId?.slice(0, 8)}
            {streaming && (
              <span style={styles.streamingBadge}>
                <span style={styles.streamingDot} /> Streaming
              </span>
            )}
          </h1>
        </div>
      </div>

      <div style={styles.metaGrid}>
        <div style={styles.metaItem}>
          <div style={styles.metaLabel}>Status</div>
          <div style={{ ...styles.metaValue, color: statusColors[status] ?? 'var(--text-primary)' }}>
            {status}
          </div>
        </div>
        <div style={styles.metaItem}>
          <div style={styles.metaLabel}>Deploy ID</div>
          <div style={styles.metaValue}>
            <code style={{ fontSize: '0.85rem' }}>{deployId}</code>
          </div>
        </div>
        {deployMeta.canister_id && (
          <div style={styles.metaItem}>
            <div style={styles.metaLabel}>Canister</div>
            <div style={styles.metaValue}>
              <a
                href={`https://${deployMeta.canister_id}.icp0.io`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent)' }}
              >
                <code>{deployMeta.canister_id}</code>
              </a>
            </div>
          </div>
        )}
        {deployMeta.url && (
          <div style={styles.metaItem}>
            <div style={styles.metaLabel}>URL</div>
            <div style={styles.metaValue}>
              <a
                href={deployMeta.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent)' }}
              >
                {deployMeta.url}
              </a>
            </div>
          </div>
        )}
        {deployMeta.error && (
          <div style={styles.metaItem}>
            <div style={styles.metaLabel}>Error</div>
            <div style={{ ...styles.metaValue, color: 'var(--error, #ef4444)' }}>
              {deployMeta.error}
            </div>
          </div>
        )}
      </div>

      {/* Log Output */}
      <h2 style={styles.sectionTitle}>Logs</h2>
      <div style={styles.logContainer}>
        {logs.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            {streaming ? 'Waiting for logs...' : 'No logs available'}
          </div>
        ) : (
          <div style={styles.logScroll}>
            {logs.map((entry, i) => (
              <div key={i} style={styles.logLine}>
                <span style={styles.logTimestamp}>{formatTimestamp(entry.timestamp)}</span>
                <span
                  style={{
                    ...styles.logLevel,
                    color: levelColor[entry.level] ?? '#9ca3af',
                  }}
                >
                  [{entry.level.toUpperCase().padEnd(5)}]
                </span>
                <span style={styles.logMessage}>{entry.message}</span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
        {streaming && (
          <div style={styles.streamingFooter}>
            <span style={styles.streamingDot} />
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Live streaming...
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  breadcrumb: {
    fontSize: '0.85rem',
    marginBottom: '1.5rem',
    color: 'var(--text-secondary)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '1.5rem',
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
  },
  streamingBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4rem',
    fontSize: '0.75rem',
    fontWeight: 500,
    color: '#22c55e',
    background: 'rgba(34,197,94,0.1)',
    borderRadius: 9999,
    padding: '0.2rem 0.6rem',
  },
  streamingDot: {
    display: 'inline-block',
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#22c55e',
    animation: 'pulse 1.5s infinite',
  },
  metaGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '1rem',
    marginBottom: '2rem',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: 8,
    padding: '1.25rem',
  },
  metaItem: {},
  metaLabel: {
    fontSize: '0.7rem',
    color: 'var(--text-muted)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: '0.25rem',
  },
  metaValue: {
    fontSize: '0.9rem',
    fontWeight: 500,
  },
  sectionTitle: {
    fontSize: '1rem',
    fontWeight: 600,
    marginBottom: '0.75rem',
  },
  logContainer: {
    background: '#0d1117',
    border: '1px solid var(--border-color)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  logScroll: {
    maxHeight: 500,
    overflowY: 'auto' as const,
    padding: '1rem',
    fontFamily: 'ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, monospace',
    fontSize: '0.8rem',
    lineHeight: 1.6,
  },
  logLine: {
    display: 'flex',
    gap: '0.75rem',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-all' as const,
  },
  logTimestamp: {
    color: '#4b5563',
    flexShrink: 0,
  },
  logLevel: {
    flexShrink: 0,
    fontWeight: 600,
  },
  logMessage: {
    color: '#d1d5db',
  },
  streamingFooter: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.5rem 1rem',
    borderTop: '1px solid var(--border-color)',
    background: 'rgba(34,197,94,0.05)',
  },
};
