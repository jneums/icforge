export default function Login() {
  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <div style={styles.logoIcon}>⬡</div>
        <h1 style={styles.title}>Sign in to ICForge</h1>
        <p style={styles.subtitle}>
          Connect your GitHub account to start deploying canisters.
        </p>
        <button
          className="btn-secondary"
          style={styles.githubBtn}
          onClick={() => alert('GitHub OAuth not yet implemented')}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: 8 }}>
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
          </svg>
          Login with GitHub
        </button>
        <p style={styles.footnote}>
          By signing in, you agree to our Terms of Service.
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 'calc(100vh - 56px)',
    padding: '2rem',
  },
  card: {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: 12,
    padding: '3rem 2.5rem',
    textAlign: 'center',
    maxWidth: 400,
    width: '100%',
  },
  logoIcon: {
    fontSize: '2.5rem',
    color: 'var(--accent)',
    marginBottom: '1rem',
  },
  title: {
    fontSize: '1.35rem',
    fontWeight: 700,
    marginBottom: '0.5rem',
  },
  subtitle: {
    fontSize: '0.875rem',
    color: 'var(--text-secondary)',
    marginBottom: '2rem',
    lineHeight: 1.5,
  },
  githubBtn: {
    width: '100%',
    padding: '0.7rem 1rem',
    fontSize: '0.95rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footnote: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    marginTop: '1.5rem',
  },
};
