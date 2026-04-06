# 04 — Project Detail

**Scope:** Redesign the `/projects/:id` page
**Priority:** P1
**Depends on:** 00-setup, 01-design-system, 02-navigation
**Estimated effort:** Large (most complex page)

---

## 1. Problem

The current ProjectDetail page is the most complex (~438 lines) and has several issues:
- Stats row (Status / Deploys / Canisters / Created) is a 4-column grid that's redundant
- Deploy history is a flat table
- Canister table with expandable env vars is visually flat
- No "Visit" button to open the deployed site
- Information hierarchy is unclear — everything looks equally important

## 2. Target Layout

**Production deploy card at top, tabbed content below** using shadcn `<Card>` and `<Tabs>`:

```
┌─────────────────────────────────────────────────────────────┐
│  my-dapp                                                    │
│  my-dapp.icforge.dev ↗          ● Deployed         Visit ↗ │
│                                                             │
│  ┌─ Production Deployment ─────────────────────────────────┐│
│  │  "Updated canister controllers"                         ││
│  │  abc1234 on main · 3 minutes ago · Built in 45s         ││
│  └─────────────────────────────────────────────────────────┘│
│                                                             │
│  ┌─ Deployments ──┬─ Canisters ──┬─ Settings ─────────────┐│
│  │  (tab content)                                          ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## 3. Page Header

```tsx
function ProjectHeader({ project, status }) {
  const vanityUrl = `https://${project.name}.icforge.dev`;

  return (
    <div className="flex items-start justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
        <a
          href={vanityUrl}
          target="_blank"
          className="text-sm font-mono text-muted-foreground hover:text-primary inline-flex items-center gap-1"
        >
          {project.name}.icforge.dev
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <div className="flex items-center gap-3">
        <StatusBadge status={status} />
        <Button asChild>
          <a href={vanityUrl} target="_blank">
            Visit <ExternalLink className="h-4 w-4 ml-1" />
          </a>
        </Button>
      </div>
    </div>
  );
}
```

## 4. Production Deployment Card

```tsx
function ProductionDeployCard({ deploy, projectId }) {
  if (!deploy) return null;

  const isBuilding = IN_PROGRESS_STATUSES.includes(deploy.status);

  return (
    <Link to={`/projects/${projectId}/deploys/${deploy.id}`}>
      <Card className="p-4 mt-6 hover:border-border/80 transition-colors cursor-pointer">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
          <span className="font-semibold text-foreground">Production Deployment</span>
          {isBuilding && <Spinner className="h-3 w-3" />}
        </div>
        <p className="text-sm font-medium truncate">
          {deploy.commit_message || 'No commit message'}
        </p>
        <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
          <GitCommit className="h-3 w-3" />
          <span className="font-mono">{deploy.commit_sha?.slice(0, 7)}</span>
          <span>on</span>
          <span>{deploy.branch || 'main'}</span>
          <span>·</span>
          <Clock className="h-3 w-3" />
          <span>{timeAgo(deploy.created_at)}</span>
          {deploy.duration && (
            <>
              <span>·</span>
              <span>Built in {formatDuration(deploy.duration)}</span>
            </>
          )}
        </div>
      </Card>
    </Link>
  );
}
```

## 5. Tabbed Content

Using shadcn `<Tabs>`:

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

<Tabs defaultValue="deploys" className="mt-6">
  <TabsList>
    <TabsTrigger value="deploys">
      Deployments ({deploys.length})
    </TabsTrigger>
    <TabsTrigger value="canisters">
      Canisters ({canisters.length})
    </TabsTrigger>
    <TabsTrigger value="settings">
      Settings
    </TabsTrigger>
  </TabsList>

  <TabsContent value="deploys">
    <DeployList deploys={deploys} projectId={project.id} />
  </TabsContent>

  <TabsContent value="canisters">
    <CanisterList canisters={canisters} />
  </TabsContent>

  <TabsContent value="settings">
    <ProjectSettings project={project} />
  </TabsContent>
</Tabs>
```

### Deploy List (Tab)

```tsx
function DeployRow({ deploy, projectId }) {
  return (
    <Link to={`/projects/${projectId}/deploys/${deploy.id}`}>
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-muted/50 transition-colors">
        <StatusDot status={deploy.status} pulse={IN_PROGRESS_STATUSES.includes(deploy.status)} />
        <span className="text-sm truncate flex-1">{deploy.commit_message || 'No message'}</span>
        <span className="font-mono text-xs text-muted-foreground">{deploy.commit_sha?.slice(0, 7)}</span>
        <span className="text-xs text-muted-foreground whitespace-nowrap">{timeAgo(deploy.created_at)}</span>
      </div>
    </Link>
  );
}
```

### Canister Card (Tab)

Using shadcn `<Card>` + `<Collapsible>`:

```tsx
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

function CanisterCard({ canister }) {
  const [open, setOpen] = useState(false);
  const [envVars, setEnvVars] = useState(null);

  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold">{canister.name}</span>
        <Badge variant="outline" className="text-xs">{canister.canister_type}</Badge>
        <StatusDot status={canister.status} />
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {canister.canister_id}
        </span>
        <CopyButton text={canister.canister_id} />
      </div>

      <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="text-xs text-muted-foreground">
            {open ? 'Hide' : 'Show'} Environment Variables
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 rounded-md bg-popover p-3 font-mono text-xs space-y-1">
            {envVars?.map(v => (
              <div key={v.key} className="flex gap-2">
                <span className="font-semibold text-foreground">{v.key}</span>
                <span className="text-muted-foreground">=</span>
                <span className="text-muted-foreground truncate">{v.value}</span>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
```

### Project Settings (Tab)

Placeholder for now — minimal info:

```tsx
function ProjectSettings({ project }) {
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold mb-3">Repository</h3>
      <div className="text-sm text-muted-foreground">
        {project.repo_url ? (
          <a href={project.repo_url} target="_blank" className="hover:text-primary inline-flex items-center gap-1">
            {project.repo_url.replace('https://github.com/', '')}
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          'No repository connected'
        )}
      </div>
    </Card>
  );
}
```

## 6. Checklist

- [ ] Create `<ProjectHeader>` component
- [ ] Create `<ProductionDeployCard>` component
- [ ] Create `<DeployList>` / `<DeployRow>` components
- [ ] Create `<CanisterList>` / `<CanisterCard>` components using shadcn Collapsible
- [ ] Create `<ProjectSettings>` placeholder component
- [ ] Wire up shadcn `<Tabs>` for the three sections
- [ ] Add "Visit" button using shadcn `<Button>`
- [ ] Add `<CopyButton>` for canister IDs
- [ ] Show build duration on production deploy card
- [ ] Show `<Spinner>` when deploy in progress
- [ ] Remove the 4-column stats grid
- [ ] Delete old inline style objects
- [ ] Rewrite `ProjectDetail.tsx` to compose sub-components
- [ ] Verify navigation to deploy detail from deploy rows
