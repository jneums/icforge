import { useParams, Link } from 'react-router-dom';

const mockDeploys = [
  { id: 'd-1', commit: 'a3f82c1', message: 'feat: add token transfer', status: 'deployed', time: '2 min ago' },
  { id: 'd-2', commit: 'e91b4d2', message: 'fix: balance overflow', status: 'deployed', time: '3 hours ago' },
  { id: 'd-3', commit: 'c7a10f8', message: 'chore: update dependencies', status: 'failed', time: '1 day ago' },
  { id: 'd-4', commit: '5d2e9a3', message: 'feat: initial canister setup', status: 'deployed', time: '3 days ago' },
];

const statusBadge: Record<string, string> = {
  deployed: 'badge-success',
  building: 'badge-warning',
  failed: 'badge-error',
};

export default function ProjectDetail() {
  const { id } = useParams();

  return (
    <div className="container">
      <div style={styles.breadcrumb}>
        <Link to="/projects">Projects</Link>
        <span style={{ color: 'var(--text-muted)', margin: '0 0.5rem' }}>/</span>
        <span>{id}</span>
      </div>

      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>my-defi-app</h1>
          <p style={styles.meta}>
            <code>user/my-defi-app</code>
            <span style={styles.separator}>•</span>
            Canister: <code>rrkah-fqaaa-aaaaa-aaaaq-cai</code>
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-secondary">Settings</button>
          <button className="btn-primary">Deploy Now</button>
        </div>
      </div>

      <div style={styles.statsRow}>
        {[
          { label: 'Status', value: 'Deployed', color: 'var(--success)' },
          { label: 'Deploys', value: '47', color: 'var(--text-primary)' },
          { label: 'Branch', value: 'main', color: 'var(--text-primary)' },
          { label: 'Cycles', value: '4.2T', color: 'var(--text-primary)' },
        ].map((s) => (
          <div key={s.label} style={styles.statCard}>
            <div style={styles.statLabel}>{s.label}</div>
            <div style={{ ...styles.statValue, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <h2 style={styles.sectionTitle}>Deploy History</h2>
      <div style={styles.tableWrapper}>
        <table>
          <thead>
            <tr>
              <th>Commit</th>
              <th>Message</th>
              <th>Status</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {mockDeploys.map((d) => (
              <tr key={d.id}>
                <td><code>{d.commit}</code></td>
                <td>{d.message}</td>
                <td>
                  <span className={`badge ${statusBadge[d.status]}`}>
                    {d.status}
                  </span>
                </td>
                <td style={{ color: 'var(--text-secondary)' }}>{d.time}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
};
