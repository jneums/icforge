import { Link } from 'react-router-dom';

const mockProjects = [
  { id: 'proj-1', name: 'my-defi-app', repo: 'user/my-defi-app', status: 'deployed', lastDeploy: '2 min ago' },
  { id: 'proj-2', name: 'nft-marketplace', repo: 'user/nft-marketplace', status: 'building', lastDeploy: 'In progress' },
  { id: 'proj-3', name: 'dao-governance', repo: 'user/dao-governance', status: 'failed', lastDeploy: '1 hour ago' },
];

const statusBadge: Record<string, string> = {
  deployed: 'badge-success',
  building: 'badge-warning',
  failed: 'badge-error',
};

export default function Projects() {
  return (
    <div className="container">
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Projects</h1>
          <p style={styles.subtitle}>Your canister deployments</p>
        </div>
        <button className="btn-primary">+ New Project</button>
      </div>

      <div style={styles.tableWrapper}>
        <table>
          <thead>
            <tr>
              <th>Project</th>
              <th>Repository</th>
              <th>Status</th>
              <th>Last Deploy</th>
            </tr>
          </thead>
          <tbody>
            {mockProjects.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link to={`/projects/${p.id}`} style={{ fontWeight: 500 }}>
                    {p.name}
                  </Link>
                </td>
                <td style={{ color: 'var(--text-secondary)' }}>
                  <code>{p.repo}</code>
                </td>
                <td>
                  <span className={`badge ${statusBadge[p.status]}`}>
                    {p.status}
                  </span>
                </td>
                <td style={{ color: 'var(--text-secondary)' }}>{p.lastDeploy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
};
