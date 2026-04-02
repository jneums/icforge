import { Link } from 'react-router-dom';

export default function Landing() {
  return (
    <div style={styles.wrapper}>
      <div style={styles.hero}>
        <p style={styles.badge}>Open Source CI/CD for the Internet Computer</p>
        <h1 style={styles.headline}>
          Deploy to IC
        </h1>
        <p style={styles.description}>
          Push to GitHub. Build automatically. Deploy to the Internet Computer.
          <br />
          ICForge is the open-source deployment pipeline for IC canisters.
        </p>
        <div style={styles.actions}>
          <Link to="/login">
            <button className="btn-primary" style={{ padding: '0.65rem 1.5rem', fontSize: '0.95rem' }}>
              Get Started
            </button>
          </Link>
          <a href="https://github.com/icforge" target="_blank" rel="noopener noreferrer">
            <button className="btn-secondary" style={{ padding: '0.65rem 1.5rem', fontSize: '0.95rem' }}>
              View on GitHub
            </button>
          </a>
        </div>
      </div>

      <div style={styles.features}>
        {[
          { title: 'Git-Driven Deploys', desc: 'Connect your GitHub repo. Every push to main triggers a canister deployment.' },
          { title: 'Reproducible Builds', desc: 'Docker-based builds ensure your canisters compile identically every time.' },
          { title: 'Canister Management', desc: 'Monitor deploy status, rollback versions, and manage cycles from one dashboard.' },
        ].map((f) => (
          <div key={f.title} style={styles.featureCard}>
            <h3 style={styles.featureTitle}>{f.title}</h3>
            <p style={styles.featureDesc}>{f.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    maxWidth: 960,
    margin: '0 auto',
    padding: '0 1.5rem',
  },
  hero: {
    textAlign: 'center',
    padding: '5rem 0 3rem',
  },
  badge: {
    display: 'inline-block',
    fontSize: '0.8rem',
    color: 'var(--accent)',
    border: '1px solid var(--accent)',
    borderRadius: 9999,
    padding: '0.25rem 0.75rem',
    marginBottom: '1.5rem',
  },
  headline: {
    fontSize: '3rem',
    fontWeight: 800,
    letterSpacing: '-0.03em',
    lineHeight: 1.1,
    marginBottom: '1rem',
  },
  description: {
    fontSize: '1.1rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.7,
    maxWidth: 540,
    margin: '0 auto 2rem',
  },
  actions: {
    display: 'flex',
    gap: '0.75rem',
    justifyContent: 'center',
  },
  features: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '1.5rem',
    paddingBottom: '4rem',
  },
  featureCard: {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: 8,
    padding: '1.5rem',
  },
  featureTitle: {
    fontSize: '0.95rem',
    fontWeight: 600,
    marginBottom: '0.5rem',
  },
  featureDesc: {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.6,
  },
};
