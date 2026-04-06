# 03 — Project List

**Scope:** Redesign the `/projects` page
**Priority:** P1
**Depends on:** 01-design-system, 02-navigation
**Estimated effort:** Medium

---

## 1. Problem

The current Projects page is a basic HTML table (Project | Canisters | Status | Created). It's functional but doesn't match the information density or visual quality of Vercel/Render.

Issues:
- Table layout wastes space — columns are rigid, rows are dense
- No preview of latest deployment (commit, time, branch)
- No project URL shown (the `.icforge.dev` vanity URL)
- No visual distinction between projects with recent activity vs stale ones
- Empty state just says "run icforge init" — no visual, no CTA button

## 2. Target Layout

Switch from table to **vertical list of project cards** (Vercel-style):

```
┌─────────────────────────────────────────────────────────┐
│  Projects                                    ┌────────┐ │
│                                              │ + New  │ │
│                                              └────────┘ │
│                                                         │
│  ┌─────────────────────────────────────────────────────┐│
│  │ ● my-dapp                      my-dapp.icforge.dev  ││
│  │   Updated canister controllers    3m ago on main     ││
│  └─────────────────────────────────────────────────────┘│
│                                                         │
│  ┌─────────────────────────────────────────────────────┐│
│  │ ● portfolio-site              portfolio.icforge.dev  ││
│  │   Initial deploy                   2d ago on main    ││
│  └─────────────────────────────────────────────────────┘│
│                                                         │
│  ┌─────────────────────────────────────────────────────┐│
│  │ ○ experiment                                         ││
│  │   No deployments yet                                 ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

### Each Project Row Shows:

| Element | Position | Source |
|---------|----------|--------|
| Status dot | Left of name | Aggregate canister status (green/yellow/red/gray) |
| Project name | Primary text, bold | `project.name` |
| Vanity URL | Right-aligned | `{project.name}.icforge.dev` |
| Latest commit message | Secondary line, left | `deployments[0].commit_message` |
| Relative time + branch | Secondary line, right | `deployments[0].created_at` + branch |

### Information Hierarchy:
1. Project name (largest, 0.875rem semibold)
2. Status dot (immediate visual scan)
3. Vanity URL (monospace, muted)
4. Latest deploy info (small, secondary color)

## 3. States

### Loading State
Show 3-4 skeleton rows (shimmer animation matching the card shape).

### Empty State (no projects)
Centered illustration area with:
- Simple icon or graphic (hexagon/rocket, keep it minimal)
- "No projects yet"
- "Create your first project from the CLI"
- Code snippet: `npx icforge init && npx icforge deploy`
- Or: "Connect a GitHub repo" button (if GitHub App install flow exists)

### Error State
- "Failed to load projects"
- Retry button
- Show error detail in muted text

## 4. Sorting

Default: most recently deployed first (not created date). Projects with no deploys go to the bottom.

## 5. Component Structure

```tsx
function Projects() {
  return (
    <div className="projects-page">
      <div className="page-header">
        <h1 className="text-h1">Projects</h1>
      </div>
      <div className="project-list">
        {projects.map(p => <ProjectRow key={p.id} project={p} />)}
      </div>
    </div>
  );
}

function ProjectRow({ project }) {
  const latestDeploy = project.deployments?.[0];
  const status = getProjectStatus(project);

  return (
    <Link to={`/projects/${project.id}`} className="project-row">
      <div className="project-row-main">
        <span className={`status-dot status-dot--${status}`} />
        <span className="project-name">{project.name}</span>
        <span className="project-url text-mono">{project.name}.icforge.dev</span>
      </div>
      <div className="project-row-meta">
        <span className="commit-message">{latestDeploy?.commit_message || 'No deployments yet'}</span>
        <span className="deploy-time">
          {latestDeploy ? `${timeAgo(latestDeploy.created_at)} on ${latestDeploy.branch || 'main'}` : ''}
        </span>
      </div>
    </Link>
  );
}
```

## 6. CSS

```css
.project-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.project-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-5);
  background: var(--surface-card);
  border: 1px solid var(--border-default);
  border-radius: 8px;
  text-decoration: none;
  transition: border-color 0.15s;
}

.project-row:hover {
  border-color: var(--border-strong);
  background: var(--surface-card-hover);
}

.project-row-main {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.project-name {
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--text-primary);
}

.project-url {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 0.8125rem;
}

.project-row-meta {
  display: flex;
  justify-content: space-between;
  padding-left: calc(8px + var(--space-3));  /* align with name, past the dot */
}

.commit-message {
  color: var(--text-secondary);
  font-size: 0.8125rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 60%;
}

.deploy-time {
  color: var(--text-muted);
  font-size: 0.8125rem;
  white-space: nowrap;
}
```

## 7. Checklist

- [ ] Rewrite `Projects.tsx` from table to card list layout
- [ ] Extract `<ProjectRow>` component
- [ ] Add loading skeleton state (3-4 shimmer rows)
- [ ] Add empty state with CLI snippet
- [ ] Add error state with retry
- [ ] Show vanity URL per project
- [ ] Show latest deploy info (commit message, time ago, branch)
- [ ] Sort by most recent deploy (not created date)
- [ ] Verify click-through to ProjectDetail works
