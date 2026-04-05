import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Landing() {
  const { user } = useAuth();
  const ctaLink = user ? '/projects' : '/login';

  return (
    <div style={styles.wrapper}>
      <div style={styles.hero}>
        <p style={styles.badge}>Open Source CI/CD for the Internet Computer</p>
        <h1 style={styles.headline}>
          Deploy to the Internet Computer in 60 seconds
        </h1>
        <p style={styles.description}>
          Push to GitHub. Build automatically. Deploy to the Internet Computer.
          <br />
          ICForge is the open-source deployment pipeline for IC canisters.
        </p>
        <div style={styles.actions}>
          <Link to={ctaLink}>
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

      {/* Workflow Code Snippet */}
      <div style={styles.snippetSection}>
        <h2 style={styles.snippetTitle}>Ship canisters in three commands</h2>
        <div style={styles.codeBlock}>
          <pre style={styles.pre}>
            <code>
              <span style={styles.comment}># Install the CLI</span>{'\n'}
              <span style={styles.command}>npm</span>{' '}i -g @icforge/cli{'\n\n'}
              <span style={styles.comment}># Initialize your project</span>{'\n'}
              <span style={styles.command}>icforge</span>{' '}init{'\n\n'}
              <span style={styles.comment}># Deploy to the IC</span>{'\n'}
              <span style={styles.command}>icforge</span>{' '}deploy{'\n\n'}
              <span style={styles.output}>✓ Built in 12s</span>{'\n'}
              <span style={styles.output}>✓ Deployed to canister ryjl3-tyaaa-aaaaa-aaaba-cai</span>{'\n'}
              <span style={styles.output}>✓ Live at myapp.icforge.dev</span>
            </code>
          </pre>
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

      {/* CTA */}
      <div style={styles.cta}>
        <h2 style={styles.ctaTitle}>Ready to deploy?</h2>
        <p style={styles.ctaDesc}>
          Get started for free. No credit card required.
        </p>
        <Link to={ctaLink}>
          <button className="btn-primary" style={{ padding: '0.7rem 2rem', fontSize: '1rem' }}>
            Get Started →
          </button>
        </Link>
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
  snippetSection: {
    textAlign: 'center',
    marginBottom: '3rem',
  },
  snippetTitle: {
    fontSize: '1.25rem',
    fontWeight: 700,
    marginBottom: '1.25rem',
  },
  codeBlock: {
    background: '#0d1117',
    border: '1px solid var(--border-color)',
    borderRadius: 10,
    padding: '1.5rem 2rem',
    textAlign: 'left',
    maxWidth: 560,
    margin: '0 auto',
    overflow: 'auto',
  },
  pre: {
    margin: 0,
    fontFamily: 'ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, monospace',
    fontSize: '0.85rem',
    lineHeight: 1.7,
    color: '#e6edf3',
  },
  comment: {
    color: '#6b7280',
  },
  command: {
    color: '#7dd3fc',
    fontWeight: 600,
  },
  output: {
    color: '#4ade80',
  },
  features: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '1.5rem',
    paddingBottom: '3rem',
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
  cta: {
    textAlign: 'center',
    padding: '3rem 0 4rem',
    borderTop: '1px solid var(--border-color)',
  },
  ctaTitle: {
    fontSize: '1.5rem',
    fontWeight: 700,
    marginBottom: '0.5rem',
  },
  ctaDesc: {
    color: 'var(--text-secondary)',
    marginBottom: '1.5rem',
  },
};
