import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { fetchCyclesBalance } from '../api';

export default function Settings() {
  const { user, loading: authLoading } = useAuth();
  const [cyclesBalance, setCyclesBalance] = useState<number | null>(null);

  useEffect(() => {
    if (authLoading || !user) return;
    fetchCyclesBalance()
      .then((data) => setCyclesBalance(data.balance_e8s))
      .catch(() => { /* ignore */ });
  }, [user, authLoading]);

  if (authLoading) {
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
        <p style={{ color: 'var(--text-secondary)', padding: '3rem 0', textAlign: 'center' }}>
          Please sign in to view settings.
        </p>
      </div>
    );
  }

  const formatCycles = (e8s: number) => {
    const tc = e8s / 1e12;
    return `${tc.toFixed(4)} TC`;
  };

  return (
    <div className="container">
      <h1 style={styles.pageTitle}>Settings</h1>

      {/* Profile Section */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Profile</h2>
        <div style={styles.card}>
          <div style={styles.profileRow}>
            {user.avatar_url ? (
              <img
                src={user.avatar_url}
                alt="avatar"
                style={styles.avatar}
              />
            ) : (
              <div style={styles.avatarPlaceholder}>
                {(user.name ?? user.email ?? 'U').charAt(0).toUpperCase()}
              </div>
            )}
            <div style={{ flex: 1 }}>
              <div style={styles.profileName}>{user.name ?? '—'}</div>
              <div style={styles.profileEmail}>{user.email ?? 'No email set'}</div>
            </div>
          </div>

          <div style={styles.fieldGrid}>
            <div style={styles.field}>
              <div style={styles.fieldLabel}>User ID</div>
              <div style={styles.fieldValue}><code>{user.id}</code></div>
            </div>
            <div style={styles.field}>
              <div style={styles.fieldLabel}>GitHub ID</div>
              <div style={styles.fieldValue}><code>{user.github_id}</code></div>
            </div>
            <div style={styles.field}>
              <div style={styles.fieldLabel}>IC Principal</div>
              <div style={styles.fieldValue}>
                {user.ic_principal ? (
                  <code>{user.ic_principal}</code>
                ) : (
                  <span style={{ color: 'var(--text-muted)' }}>Not linked</span>
                )}
              </div>
            </div>
            <div style={styles.field}>
              <div style={styles.fieldLabel}>Member Since</div>
              <div style={styles.fieldValue}>
                {new Date(user.created_at + 'Z').toLocaleDateString()}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Plan Section */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Plan</h2>
        <div style={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '1.1rem', textTransform: 'capitalize' }}>
                {user.plan} Plan
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                {user.plan === 'free'
                  ? 'Up to 3 projects, shared compute'
                  : 'Unlimited projects, priority builds'}
              </div>
            </div>
            <span className={`badge ${user.plan === 'free' ? 'badge-warning' : 'badge-success'}`}>
              {user.plan}
            </span>
          </div>
          {cyclesBalance !== null && (
            <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
              <div style={styles.fieldLabel}>Cycles Balance</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 600, marginTop: '0.25rem' }}>
                {formatCycles(cyclesBalance)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* API Tokens Section */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>API Tokens</h2>
        <div style={{ ...styles.card, ...styles.comingSoon }}>
          <div style={styles.comingSoonIcon}>🔑</div>
          <div style={{ fontWeight: 500 }}>API Tokens</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            Create and manage API tokens for CI/CD integration. Coming soon.
          </div>
        </div>
      </div>

      {/* Identity Export Section */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Identity Export</h2>
        <div style={{ ...styles.card, ...styles.comingSoon }}>
          <div style={styles.comingSoonIcon}>📤</div>
          <div style={{ fontWeight: 500 }}>Identity Export</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            Export your IC identity for use with dfx. Coming in v0.3.
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  pageTitle: {
    fontSize: '1.5rem',
    fontWeight: 700,
    marginBottom: '2rem',
  },
  section: {
    marginBottom: '2rem',
  },
  sectionTitle: {
    fontSize: '1rem',
    fontWeight: 600,
    marginBottom: '0.75rem',
  },
  card: {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: 8,
    padding: '1.5rem',
  },
  profileRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '1.25rem',
    marginBottom: '1.5rem',
    paddingBottom: '1.5rem',
    borderBottom: '1px solid var(--border-color)',
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: '50%',
    objectFit: 'cover' as const,
  },
  avatarPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: '50%',
    background: 'var(--accent)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.5rem',
    fontWeight: 700,
  },
  profileName: {
    fontSize: '1.15rem',
    fontWeight: 600,
    marginBottom: '0.15rem',
  },
  profileEmail: {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
  },
  fieldGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '1rem',
  },
  field: {},
  fieldLabel: {
    fontSize: '0.7rem',
    color: 'var(--text-muted)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: '0.25rem',
  },
  fieldValue: {
    fontSize: '0.9rem',
    fontWeight: 500,
    wordBreak: 'break-all' as const,
  },
  comingSoon: {
    textAlign: 'center' as const,
    padding: '2rem',
    opacity: 0.7,
  },
  comingSoonIcon: {
    fontSize: '2rem',
    marginBottom: '0.5rem',
  },
};
