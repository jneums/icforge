# ICForge — Team/Org Accounts

**Status:** Draft v0.1
**Parent:** 001-architecture.md
**Milestone:** v0.4
**Depends on:** 007 (Stripe billing for team plans)

---

## 1. Goal

Support team and organization accounts where multiple GitHub users collaborate on shared projects with role-based access control.

## 2. Why Teams Matter

IC dapps are typically built by teams, not individuals. A team needs:
- Shared project ownership (any member can deploy)
- Shared cycles pool (team pays, members deploy)
- Role-based permissions (owner vs. member vs. viewer)
- GitHub org integration (import team from GitHub org)

## 3. Data Model

### New tables

```sql
CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL REFERENCES users(id),
  stripe_customer_id TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  cycles_pool_allocation BIGINT NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE org_members (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'member',  -- owner, admin, member, viewer
  invited_by TEXT REFERENCES users(id),
  joined_at TEXT NOT NULL,
  UNIQUE(org_id, user_id)
);
```

### Projects table change

```sql
ALTER TABLE projects ADD COLUMN org_id TEXT REFERENCES organizations(id);
```

Projects can belong to either a user (personal) or an organization. If `org_id` is set, permissions are checked against org membership instead of `user_id`.

## 4. Roles & Permissions

| Permission | Owner | Admin | Member | Viewer |
|-----------|-------|-------|--------|--------|
| View projects | ✓ | ✓ | ✓ | ✓ |
| Deploy | ✓ | ✓ | ✓ | ✗ |
| Create projects | ✓ | ✓ | ✓ | ✗ |
| Delete projects | ✓ | ✓ | ✗ | ✗ |
| Manage members | ✓ | ✓ | ✗ | ✗ |
| Billing | ✓ | ✗ | ✗ | ✗ |
| Delete org | ✓ | ✗ | ✗ | ✗ |

## 5. GitHub Org Integration

When creating an ICForge org, users can optionally link it to a GitHub org:

```bash
icforge org create --github-org my-company
```

This enables:
- Auto-import members from GitHub org
- Sync team membership (optional, via GitHub webhook)
- Org-level API tokens scoped to the org's projects

The GitHub org link is informational — it doesn't affect auth. Users still authenticate individually via GitHub OAuth.

## 6. API Endpoints

```
POST /api/v1/orgs
  Body: { name: "My Company", slug: "my-company", github_org: "my-company" }
  Creates org, sets creator as owner

GET /api/v1/orgs
  Lists orgs the authenticated user belongs to

GET /api/v1/orgs/:slug
  Org details + member list

POST /api/v1/orgs/:slug/members
  Body: { github_username: "alice", role: "member" }
  Invite a user (creates account if needed on next login)

PUT /api/v1/orgs/:slug/members/:user_id
  Body: { role: "admin" }
  Update member role

DELETE /api/v1/orgs/:slug/members/:user_id
  Remove member

GET /api/v1/orgs/:slug/projects
  List org projects

POST /api/v1/projects (updated)
  Body: { name: "...", org_id: "..." }  -- optional org_id
  Create project under org
```

## 7. Auth Changes

The `AuthUser` extractor currently resolves a single user. For org-scoped endpoints, add an org permission check middleware:

```rust
async fn require_org_role(
    auth_user: &AuthUser,
    db: &DbPool,
    org_slug: &str,
    min_role: OrgRole,
) -> Result<OrgMember, AppError> {
    // Look up membership, check role >= min_role
}
```

For deploy endpoints, check:
1. If project has `org_id` → verify user is org member with deploy permission
2. If project has no `org_id` → verify user is project owner (existing behavior)

## 8. Billing Integration

Orgs have their own Stripe subscription (separate from individual user plans). The org owner manages billing. Cycles pool is shared across all org projects.

Org plans use the Team tier pricing from spec 007 ($50/mo for 100 canisters, 50T cycles).

## 9. Implementation Checklist

### Backend
- [ ] `organizations` table + migration
- [ ] `org_members` table + migration
- [ ] Add `org_id` to projects table + migration
- [ ] Org CRUD endpoints
- [ ] Member management endpoints
- [ ] Org permission middleware
- [ ] Update project/deploy auth to check org membership
- [ ] Org-level Stripe billing

### CLI
- [ ] `icforge org create` command
- [ ] `icforge org list` command
- [ ] `icforge org members` command
- [ ] `icforge org invite <github-username>` command
- [ ] Support `--org <slug>` on `icforge init` to create project under org

### Dashboard
- [ ] Org switcher in header (personal ↔ org context)
- [ ] Org settings page (members, billing)
- [ ] Invite member flow
- [ ] Org projects list

## 10. Open Questions

1. **Canister controller:** When a project belongs to an org, whose IC identity controls the canisters? Options: (a) org-level identity (new keypair per org), (b) creator's identity, (c) platform identity. Recommend (a) — each org gets its own IC identity, org admins can export it.
2. **Migration:** How do users move personal projects into an org? Need a "transfer project" feature.
