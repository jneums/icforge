import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchProjects, type Project } from '../api';
import { useAuth } from '../contexts/AuthContext';

const statusBadge: Record<string, string> = {
  running: 'badge-success',
  deployed: 'badge-success',
  live: 'badge-success',
  building: 'badge-warning',
  pending: 'badge-warning',
  deploying: 'badge-warning',
  created: 'badge-warning',
  failed: 'badge-error',
};

function getProjectStatus(project: Project): string {
  if (!project.canisters?.length) return 'pending';
  // Use the "best" status across canisters
  const statuses = project.canisters.map((c) => c.status);
  if (statuses.includes('running')) return 'running';
  if (statuses.includes('created')) return 'created';
  return statuses[0] ?? 'pending';
}

export default function Projects() {
  const { user, loading: authLoading } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    fetchProjects()
      .then(setProjects)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [user, authLoading]);

  if (authLoading || loading) {
    return (
      <div className="container">
        <p style={{ color: 'var(--text-secondary)', padding: '3rem 0', textAlign: 'center' }}>
          Loading...
        </p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container">
        <div style={{ textAlign: 'center', padding: '3rem 0' }}>
          <h2 style={{ marginBottom: '0.5rem' }}>Sign in to view projects</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
            Connect your GitHub account to manage your IC deployments.
          </p>
          <Link to="/login">
            <button className="btn-primary">Login</button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Projects</h1>
          <p style={styles.subtitle}>Your canister deployments</p>
        </div>
      </div>

      {error && (
        <p style={{ color: 'var(--error)', marginBottom: '1rem' }}>{error}</p>
      )}

      {projects.length === 0 ? (
        <div style={styles.emptyState}>
          <h3 style={{ marginBottom: '0.5rem' }}>No projects yet</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Deploy your first canister with the CLI:
          </p>
          <code style={{ fontSize: '0.9rem' }}>icforge init &amp;&amp; icforge deploy</code>
        </div>
      ) : (
        <div style={styles.tableWrapper}>
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Canisters</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/projects/${p.id}`} style={{ fontWeight: 500 }}>
                      {p.name}
                    </Link>
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>
                    {p.canisters?.length ?? 0}
                  </td>
                  <td>
                    <span className={`badge ${statusBadge[getProjectStatus(p)] ?? 'badge-warning'}`}>
                      {getProjectStatus(p)}
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>
                    {new Date(p.created_at + 'Z').toLocaleDateString()}
                  </td>
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
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '2rem',
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: 700,
    marginBottom: '0.25rem',
  },
  subtitle: {
    fontSize: '0.875rem',
    color: 'var(--text-secondary)',
  },
  tableWrapper: {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  emptyState: {
    textAlign: 'center' as const,
    padding: '3rem',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: 8,
  },
};
