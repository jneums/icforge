# 03 — Project List

**Scope:** Redesign the `/projects` page
**Priority:** P1
**Depends on:** 00-setup, 01-design-system, 02-navigation
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

Switch from table to **vertical list of project cards** using shadcn `<Card>`:

```
┌─────────────────────────────────────────────────────────┐
│  Projects                                               │
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
| Status dot | Left of name | `<StatusDot>` from 01 |
| Project name | Primary text, semibold | `project.name` |
| Vanity URL | Right-aligned, mono | `{project.name}.icforge.dev` |
| Latest commit message | Secondary line, left | `deployments[0].commit_message` |
| Relative time + branch | Secondary line, right | `deployments[0].created_at` + branch |

## 3. Component Structure

```tsx
import { Card } from "@/components/ui/card"
import { useProjects } from "@/hooks/use-projects"

function Projects() {
  const { data: projects, isLoading, error, refetch } = useProjects();

  if (isLoading) return <ProjectListSkeleton />;
  if (error) return <ProjectListError error={error.message} onRetry={refetch} />;
  if (!projects?.length) return <ProjectListEmpty />;

  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
      <div className="space-y-2">
        {projects.map(p => <ProjectRow key={p.id} project={p} />)}
      </div>
    </div>
  );
}

function ProjectRow({ project }) {
  const latestDeploy = project.deployments?.[0];
  const status = getProjectStatus(project);

  return (
    <Link to={`/projects/${project.id}`}>
      <Card className="p-4 hover:bg-card/80 hover:border-border/80 transition-colors cursor-pointer">
        <div className="flex items-center gap-3">
          <StatusDot status={status} />
          <span className="text-sm font-semibold">{project.name}</span>
          <span className="ml-auto font-mono text-xs text-muted-foreground">
            {project.name}.icforge.dev
          </span>
        </div>
        <div className="flex justify-between mt-1.5 pl-5">
          <span className="text-sm text-muted-foreground truncate max-w-[60%]">
            {latestDeploy?.commit_message || 'No deployments yet'}
          </span>
          {latestDeploy && (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {timeAgo(latestDeploy.created_at)} on {latestDeploy.branch || 'main'}
            </span>
          )}
        </div>
      </Card>
    </Link>
  );
}
```

## 4. States

### Loading State — shadcn `<Skeleton>`

```tsx
import { Skeleton } from "@/components/ui/skeleton"

function ProjectListSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-8 w-32" /> {/* heading */}
      {[1, 2, 3].map(i => (
        <Card key={i} className="p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-2 w-2 rounded-full" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-40 ml-auto" />
          </div>
          <div className="flex justify-between mt-2 pl-5">
            <Skeleton className="h-3 w-48" />
            <Skeleton className="h-3 w-24" />
          </div>
        </Card>
      ))}
    </div>
  );
}
```

### Empty State

Use shadcn's `<Empty>` component or a custom empty state:

```tsx
function ProjectListEmpty() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <Folder className="h-12 w-12 text-muted-foreground mb-4" />
      <h2 className="text-lg font-semibold mb-1">No projects yet</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Create your first project from the CLI
      </p>
      <Card className="bg-popover p-4 font-mono text-sm text-left">
        <div>$ npx icforge init</div>
        <div>$ git push origin main</div>
      </Card>
    </div>
  );
}
```

### Error State

```tsx
function ProjectListError({ error, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <AlertCircle className="h-12 w-12 text-destructive mb-4" />
      <h2 className="text-lg font-semibold mb-1">Failed to load projects</h2>
      <p className="text-sm text-muted-foreground mb-4">{error}</p>
      <Button onClick={onRetry}>Retry</Button>
    </div>
  );
}
```

## 5. Sorting

Default: most recently deployed first (not created date). Projects with no deploys go to the bottom.

## 6. Checklist

- [ ] Rewrite `Projects.tsx` using shadcn `Card` + Tailwind classes
- [ ] Extract `<ProjectRow>` component
- [ ] Add `<ProjectListSkeleton>` using shadcn `Skeleton`
- [ ] Add `<ProjectListEmpty>` with CLI snippet
- [ ] Add `<ProjectListError>` with retry button
- [ ] Show vanity URL per project
- [ ] Show latest deploy info (commit message, time ago, branch)
- [ ] Sort by most recent deploy (not created date)
- [ ] Delete old inline style objects
- [ ] Verify click-through to ProjectDetail works
