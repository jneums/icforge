import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchProject, type Project, type Deployment } from '../api';
import { useAuth } from '../contexts/AuthContext';

const statusBadge: Record<string, string> = {
  live: 'badge-success',
  deployed: 'badge-success',
  running: 'badge-success',
  building: 'badge-warning',
  deploying: 'badge-warning',
  pending: 'badge-warning',
  created: 'badge-warning',
  failed: 'badge-error',
};

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr + 'Z');
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}

export default function ProjectDetail() {
  const { id } = useParams();
  const { user, loading: authLoading } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !user || !id) return;
    fetchProject(id)
      .then((data) => {
        setProject(data.project);
        setDeployments(data.deployments ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id, user, authLoading]);

  if (authLoading || loading) {
    return (
      <div className="container">
        <p style={{ color: 'var(--text-secondary)', padding: '3rem 0', textAlign: 'center' }}>
          Loading...
        </p>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="container">
        <p style={{ color: 'var(--error)', padding: '3rem 0', textAlign: 'center' }}>
          {error ?? 'Project not found'}
        </p>
        <Link to="/projects" style={{ display: 'block', textAlign: 'center' }}>
          ← Back to Projects
        </Link>
      </div>
    );
  }

  const latestStatus = deployments[0]?.status ?? project.canisters?.[0]?.status ?? 'pending';
  const primaryCanister = project.canisters?.[0];

  return (
    <div className="container">
      <div style={styles.breadcrumb}>
        <Link to="/projects">Projects</Link>
        <span style={{ color: 'var(--text-muted)', margin: '0 0.5rem' }}>/</span>
        <span>{project.name}</span>
      </div>

      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>{project.name}</h1>
          <p style={styles.meta}>
            <code>{project.slug}</code>
            {primaryCanister?.canister_id && (
              <>
                <span style={styles.separator}>•</span>
                Canister: <code>{primaryCanister.canister_id}</code>
              </>
            )}
          </p>
        </div>
      </div>

      <div style={styles.statsRow}>
        {[
          { label: 'Status', value: latestStatus, color: latestStatus === 'live' || latestStatus === 'running' ? 'var(--success)' : 'var(--text-primary)' },
          { label: 'Deploys', value: String(deployments.length), color: 'var(--text-primary)' },
          { label: 'Canisters', value: String(project.canisters?.length ?? 0), color: 'var(--text-primary)' },
          { label: 'Created', value: new Date(project.created_at + 'Z').toLocaleDateString(), color: 'var(--text-primary)' },
        ].map((s) => (
          <div key={s.label} style={styles.statCard}>
            <div style={styles.statLabel}>{s.label}</div>
            <div style={{ ...styles.statValue, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Canisters */}
      {project.canisters?.length > 0 && (
        <>
          <h2 style={styles.sectionTitle}>Canisters</h2>
          <div style={{ ...styles.tableWrapper, marginBottom: '2rem' }}>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Canister ID</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {project.canisters.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 500 }}>{c.name}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{c.type}</td>
                    <td>
                      {c.canister_id ? (
                        <code>{c.canister_id}</code>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${statusBadge[c.status] ?? 'badge-warning'}`}>
                        {c.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Deploy History */}
      <h2 style={styles.sectionTitle}>Deploy History</h2>
      {deployments.length === 0 ? (
        <div style={styles.emptyDeploys}>
          <p style={{ color: 'var(--text-secondary)' }}>No deployments yet</p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.5rem' }}>
            Run <code>icforge deploy</code> to create your first deployment.
          </p>
        </div>
      ) : (
        <div style={styles.tableWrapper}>
          <table>
            <thead>
              <tr>
                <th>Commit</th>
                <th>Message</th>
                <th>Canister</th>
                <th>Status</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {deployments.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.commit_sha ? (
                      <code>{d.commit_sha.slice(0, 7)}</code>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>—</span>
                    )}
                  </td>
                  <td>{d.commit_message ?? '—'}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{d.canister_name}</td>
                  <td>
                    <span className={`badge ${statusBadge[d.status] ?? 'badge-warning'}`}>
                      {d.status}
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>{timeAgo(d.started_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
    marginBottom: '2rem',
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: 700,
    marginBottom: '0.35rem',
  },
  meta: {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
  },
  separator: {
    margin: '0 0.5rem',
  },
  statsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '1rem',
    marginBottom: '2.5rem',
  },
  statCard: {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: 8,
    padding: '1rem 1.25rem',
  },
  statLabel: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '0.25rem',
  },
  statValue: {
    fontSize: '1.25rem',
    fontWeight: 600,
  },
  sectionTitle: {
    fontSize: '1rem',
    fontWeight: 600,
    marginBottom: '1rem',
  },
  tableWrapper: {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  emptyDeploys: {
    textAlign: 'center' as const,
    padding: '2rem',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: 8,
  },
};
