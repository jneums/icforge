import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { devLogin } from '../api';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const navigate = useNavigate();
  const { user, login } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If already logged in, redirect
  if (user) {
    navigate('/projects');
    return null;
  }

  const handleGitHubLogin = () => {
    const apiUrl = import.meta.env.VITE_API_URL ?? '';
    window.location.href = `${apiUrl}/api/v1/auth/login?redirect=${encodeURIComponent(window.location.origin + '/login')}`;
  };

  const handleDevLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await devLogin();
      login(token);
      navigate('/projects');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Check for token in URL (OAuth callback redirect)
  const params = new URLSearchParams(window.location.search);
  const tokenFromUrl = params.get('token');
  if (tokenFromUrl) {
    login(tokenFromUrl);
    navigate('/projects');
    return null;
  }

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <div style={styles.logoIcon}>⬡</div>
        <h1 style={styles.title}>Sign in to ICForge</h1>
        <p style={styles.subtitle}>
          Connect your GitHub account to start deploying canisters.
        </p>

        {error && (
          <p style={{ color: 'var(--error)', fontSize: '0.85rem', marginBottom: '1rem' }}>
            {error}
          </p>
        )}

        <button
          className="btn-secondary"
          style={styles.githubBtn}
          onClick={handleGitHubLogin}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: 8 }}>
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
          </svg>
          Login with GitHub
        </button>

        {import.meta.env.DEV && (
          <>
            <div style={styles.divider}>
              <span style={styles.dividerText}>or</span>
            </div>

            <button
              className="btn-secondary"
              style={{ ...styles.githubBtn, marginTop: 0 }}
              onClick={handleDevLogin}
              disabled={loading}
            >
              {loading ? 'Signing in...' : '🔧 Dev Mode Login'}
            </button>

            <p style={styles.footnote}>
              Dev login creates a test account — no GitHub needed.
            </p>
          </>
        )}
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
  divider: {
    position: 'relative',
    margin: '1.5rem 0',
    borderTop: '1px solid var(--border-color)',
  },
  dividerText: {
    position: 'absolute',
    top: '-0.7rem',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'var(--bg-secondary)',
    padding: '0 0.75rem',
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
  },
  footnote: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    marginTop: '1.5rem',
  },
};
