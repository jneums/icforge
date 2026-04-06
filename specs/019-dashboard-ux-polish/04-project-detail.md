# 04 — Project Detail

**Scope:** Redesign the `/projects/:id` page
**Priority:** P1
**Depends on:** 01-design-system, 02-navigation
**Estimated effort:** Large (most complex page)

---

## 1. Problem

The current ProjectDetail page is the most complex (~438 lines) and has several issues:
- Stats row (Status / Deploys / Canisters / Created) is a 4-column grid that's redundant with info shown elsewhere
- Deploy history is a table that duplicates info from the project header
- Canister table with expandable env vars is functional but visually flat
- No "Visit" button to open the deployed site
- No quick deploy actions (redeploy, rollback)
- Information hierarchy is unclear — everything looks equally important

## 2. Target Layout

Follow Vercel's project detail pattern: **production deploy card at top, tabbed content below**.

```
┌─────────────────────────────────────────────────────────────┐
│  ← Projects / my-dapp                                       │ breadcrumb
│─────────────────────────────────────────────────────────────│
│                                                             │
│  my-dapp                                                    │
│  my-dapp.icforge.dev  ↗         ● Deployed         Visit ↗ │
│                                                             │
│  ┌─ Production Deployment ─────────────────────────────────┐│
│  │                                                         ││
│  │  "Updated canister controllers"                         ││
│  │  abc1234 on main · 3 minutes ago · Built in 45s         ││
│  │                                                         ││
│  └─────────────────────────────────────────────────────────┘│
│                                                             │
│  ┌─ Deployments ──┬─ Canisters ──┬─ Settings ─────────────┐│
│  │                │              │                         ││
│  │  (tab content)                                          ││
│  │                                                         ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## 3. Sections

### 3.1 Page Header

```
┌────────────────────────────────────────────────────┐
│  my-dapp                                           │  ← project name (h1)
│  my-dapp.icforge.dev  ↗    ● Deployed     Visit ↗  │  ← vanity URL + status + action
└────────────────────────────────────────────────────┘
```

- **Project name**: h1, bold
- **Vanity URL**: monospace, clickable link to `https://my-dapp.icforge.dev`
- **Status badge**: colored dot + text (Deployed / Building / Failed)
- **Visit button**: primary button, opens the deployed site in new tab

### 3.2 Production Deployment Card

A prominent card showing the latest successful deployment:

- Commit message (primary text)
- Commit SHA (monospace, 7-char, linked to GitHub)
- Branch name
- Relative time ("3 minutes ago")
- Build duration ("Built in 45s")
- Clickable — navigates to `/projects/:id/deploys/:deployId`

If currently building: show an animated progress indicator with "Building..." and a link to the live build log.

### 3.3 Tabbed Content

Replace the current stacked tables with tabs:

**Tab: Deployments** (default)
- Vertical list of deploy rows (not a table)
- Each row: status dot + commit message + SHA + time ago
- Clickable → navigates to deploy detail
- Show last 20, with "View all" link if more

**Tab: Canisters**
- Card per canister (not a table row)
- Shows: name, type badge (frontend/backend), canister ID (mono, copyable), status dot
- Expandable: click to reveal environment variables
- Each env var: key (mono bold) = value (mono, masked by default, click to reveal)

**Tab: Settings** (project-level)
- Repository link (GitHub icon + repo name, clickable)
- Connected branch
- Auto-deploy toggle
- Danger zone: delete project (future, placeholder for now)

## 4. Component Structure

```tsx
function ProjectDetail() {
  const [activeTab, setActiveTab] = useState<'deploys' | 'canisters' | 'settings'>('deploys');

  return (
    <div className="project-detail">
      <ProjectHeader project={project} />
      <ProductionDeployCard deploy={latestDeploy} />
      <Tabs active={activeTab} onChange={setActiveTab}>
        <Tab id="deploys" label={`Deployments (${deploys.length})`}>
          <DeployList deploys={deploys} projectId={project.id} />
        </Tab>
        <Tab id="canisters" label={`Canisters (${canisters.length})`}>
          <CanisterList canisters={canisters} />
        </Tab>
        <Tab id="settings" label="Settings">
          <ProjectSettings project={project} />
        </Tab>
      </Tabs>
    </div>
  );
}
```

### Sub-components to extract:
- `<ProjectHeader>` — name, URL, status, visit button
- `<ProductionDeployCard>` — latest deploy summary
- `<Tabs>` / `<Tab>` — reusable tab component
- `<DeployList>` / `<DeployRow>` — deploy history
- `<CanisterList>` / `<CanisterCard>` — canister cards with expandable env vars
- `<ProjectSettings>` — settings tab content

## 5. Deploy Row Design

```
┌──────────────────────────────────────────────────────────────┐
│  ● Updated canister controllers          abc1234  3m ago     │
│    on main                                                   │
└──────────────────────────────────────────────────────────────┘
```

- Status dot (green/yellow/red) on far left
- Commit message (primary text, truncated if long)
- SHA (mono, 7-char) right-aligned
- Time ago right-aligned
- Branch name (secondary line, muted)

## 6. Canister Card Design

```
┌──────────────────────────────────────────────────────────────┐
│  frontend_assets          Asset Canister     ● Running       │
│  rrkah-fqaaa-aaaaa-aaaaq-cai  📋                            │
│                                                              │
│  ▼ Environment Variables (3)                                 │
│  ┌──────────────────────────────────────────────────────────┐│
│  │  PUBLIC_CANISTER_ID_BACKEND  =  ryjl3-tyaaa-aaaa-...    ││
│  │  PUBLIC_CANISTER_ID_FRONTEND =  rrkah-fqaaa-aaaa-...    ││
│  │  PUBLIC_IC_HOST              =  https://ic0.app          ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

- Canister name (bold)
- Type badge (Asset Canister / Rust Backend / Motoko Backend)
- Status dot + label
- Canister ID (monospace, with copy button)
- Expandable env vars section

## 7. Checklist

- [ ] Create `<ProjectHeader>` component
- [ ] Create `<ProductionDeployCard>` component
- [ ] Create reusable `<Tabs>` / `<Tab>` components
- [ ] Create `<DeployList>` / `<DeployRow>` components
- [ ] Create `<CanisterList>` / `<CanisterCard>` components
- [ ] Create `<ProjectSettings>` placeholder component
- [ ] Add "Visit" button that opens vanity URL
- [ ] Add copy-to-clipboard for canister IDs
- [ ] Show build duration on production deploy card
- [ ] Show animated building state when deploy in progress
- [ ] Remove the 4-column stats grid
- [ ] Rewrite `ProjectDetail.tsx` to compose these sub-components
- [ ] Verify navigation to deploy detail from deploy rows
