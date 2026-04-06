# 01 — Design System

**Scope:** CSS variables, typography, spacing tokens, reusable component classes
**Priority:** P0 — everything else depends on this
**Estimated effort:** Small

---

## 1. Problem

Styling is split between CSS custom properties in `index.css` and per-component inline style objects (`Record<string, React.CSSProperties>`). This makes it impossible to maintain visual consistency — every component reinvents spacing, border-radius, font sizes, and colors.

## 2. Approach

Keep the existing CSS custom properties approach (no Tailwind migration). Expand the design tokens and add reusable utility classes. Move inline styles to CSS classes.

### 2.1 Color Tokens (expand existing)

Current tokens are good. Add semantic aliases:

```css
:root {
  /* Existing — keep as-is */
  --bg-primary:    #0a0a0a;
  --bg-secondary:  #111111;
  --bg-tertiary:   #1a1a1a;
  --border-color:  #2a2a2a;
  --text-primary:  #e5e5e5;
  --text-secondary:#999999;
  --text-muted:    #666666;
  --accent:        #3b82f6;
  --accent-hover:  #2563eb;
  --success:       #22c55e;
  --warning:       #eab308;
  --error:         #ef4444;

  /* New — semantic surface colors (Vercel-style materials) */
  --surface-card:       #111111;
  --surface-card-hover: #161616;
  --surface-inset:      #0d0d0d;  /* for code blocks, log viewers */
  --surface-overlay:    #1a1a1a;  /* for modals, dropdowns */

  /* New — border variants */
  --border-subtle:  #1f1f1f;
  --border-default: #2a2a2a;
  --border-strong:  #3a3a3a;
}
```

### 2.2 Typography Scale

Match Vercel's hierarchy. Use CSS classes instead of inline fontSize:

```css
/* Headings */
.text-h1 { font-size: 1.5rem; font-weight: 600; line-height: 1.3; letter-spacing: -0.02em; }
.text-h2 { font-size: 1.25rem; font-weight: 600; line-height: 1.3; letter-spacing: -0.01em; }
.text-h3 { font-size: 1rem; font-weight: 600; line-height: 1.4; }

/* Body */
.text-body { font-size: 0.875rem; line-height: 1.5; color: var(--text-primary); }
.text-small { font-size: 0.8125rem; line-height: 1.5; color: var(--text-secondary); }
.text-xs { font-size: 0.75rem; line-height: 1.4; color: var(--text-muted); }

/* Labels */
.text-label { font-size: 0.75rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }

/* Mono */
.text-mono { font-family: var(--font-mono); font-size: 0.8125rem; }
```

### 2.3 Spacing Scale

```css
:root {
  --space-1: 0.25rem;   /* 4px */
  --space-2: 0.5rem;    /* 8px */
  --space-3: 0.75rem;   /* 12px */
  --space-4: 1rem;      /* 16px */
  --space-5: 1.5rem;    /* 24px */
  --space-6: 2rem;      /* 32px */
  --space-8: 3rem;      /* 48px */
}
```

### 2.4 Component Primitives

Add reusable classes for common patterns:

```css
/* Card (Vercel material-base equivalent) */
.card {
  background: var(--surface-card);
  border: 1px solid var(--border-default);
  border-radius: 8px;
  padding: var(--space-5);
}

/* Status dot (Vercel StatusDot) */
.status-dot {
  display: inline-block;
  width: 8px; height: 8px;
  border-radius: 50%;
}
.status-dot--success { background: var(--success); }
.status-dot--warning { background: var(--warning); }
.status-dot--error { background: var(--error); }
.status-dot--neutral { background: var(--text-muted); }
.status-dot--pulse { animation: pulse 2s ease-in-out infinite; }

/* Badge (existing, clean up) */
.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
}

/* Button variants */
.btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  border: 1px solid transparent;
}

/* Skeleton loading */
.skeleton {
  background: linear-gradient(90deg, var(--bg-tertiary) 25%, var(--border-color) 50%, var(--bg-tertiary) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 4px;
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

### 2.5 Layout Tokens

```css
:root {
  --sidebar-width: 240px;
  --sidebar-collapsed: 48px;
  --header-height: 0px;  /* remove top header once sidebar is in */
  --content-max-width: 1200px;  /* up from 960px */
  --content-padding: var(--space-5);
}
```

## 3. Migration Plan

1. Add all new tokens and classes to `index.css`
2. Migrate one component at a time from inline styles → CSS classes
3. Delete the inline style objects from each file as you go
4. The old tokens are preserved — no breaking changes

## 4. Checklist

- [ ] Expand CSS custom properties in `index.css` (surfaces, borders, spacing)
- [ ] Add typography classes (h1-h3, body, small, xs, label, mono)
- [ ] Add component primitives (card, status-dot, badge, btn, skeleton)
- [ ] Add layout tokens (sidebar-width, content-max-width)
- [ ] Migrate Header.tsx from inline styles → CSS classes
- [ ] Migrate Landing.tsx from inline styles → CSS classes
- [ ] Migrate Login.tsx from inline styles → CSS classes
- [ ] Migrate Projects.tsx from inline styles → CSS classes
- [ ] Migrate ProjectDetail.tsx from inline styles → CSS classes
- [ ] Migrate DeployDetail.tsx from inline styles → CSS classes
- [ ] Migrate Settings.tsx from inline styles → CSS classes
- [ ] Delete all inline `styles: Record<string, React.CSSProperties>` objects
