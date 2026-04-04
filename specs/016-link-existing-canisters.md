# ICForge — Link Existing Canisters

**Status:** Draft v0.1
**Parent:** 001-architecture.md
**Milestone:** v0.4

---

## 1. Goal

Let users import existing IC canisters (created outside ICForge) into their ICForge project for management, monitoring, and redeployment.

## 2. Why This Matters

Many developers already have canisters deployed via `dfx` or raw ic-agent. They shouldn't need to recreate everything to use ICForge. "Bring your own canister" is essential for adoption.

## 3. How It Works

### 3.1 Linking flow

```bash
icforge link <canister-id> --name my-backend --type rust
```

This:
1. Verifies the canister exists on IC (calls `canister_status`)
2. Checks if the ICForge platform identity is a controller (or can be added as one)
3. Creates a canister record in the DB pointing to the existing canister ID
4. Registers it in the project for future deploys

### 3.2 Controller requirement

ICForge needs to be a **controller** of the canister to deploy to it. The user must add ICForge's platform principal as a controller:

```bash
# User runs this with their own dfx identity (which is currently a controller)
dfx canister update-settings <canister-id> --add-controller <icforge-principal>

# Or with ic-agent / icp CLI
icp canister update-settings <canister-id> --add-controller <icforge-principal>
```

ICForge can display its platform principal so the user knows what to add:

```
$ icforge link ryjl3-tyaaa-aaaaa-aaaba-cai --name my-backend --type rust

  To manage this canister, ICForge needs controller access.
  
  ICForge principal: 2vxsx-fae-aaaaa-aaaaa-aaaaa-aaaaa-aaaaa-aaaaa-aaaaa-q
  
  Add it as a controller:
    dfx canister update-settings ryjl3-tyaaa-aaaaa-aaaba-cai \
      --add-controller 2vxsx-fae-aaaaa-aaaaa-aaaaa-aaaaa-aaaaa-aaaaa-aaaaa-q
  
  Then run: icforge link ryjl3-tyaaa-aaaaa-aaaba-cai --name my-backend --type rust --verify
```

### 3.3 Verification

`icforge link --verify` calls `canister_status` and checks the controller list includes the ICForge principal. If not, it errors with instructions.

### 3.4 Read-only linking

For monitoring-only (no deploys), ICForge doesn't need controller access. A "linked (read-only)" status lets users track cycles and status without granting deploy permissions.

```bash
icforge link <canister-id> --name my-backend --type rust --read-only
```

Read-only linked canisters:
- ✓ Appear in `icforge status`
- ✓ Cycles monitoring (spec 010)
- ✗ Cannot be deployed to
- ✗ Cannot be upgraded

## 4. API Endpoints

```
POST /api/v1/projects/:id/canisters/link
  Body: {
    canister_id: "ryjl3-tyaaa-aaaaa-aaaba-cai",
    name: "my-backend",
    canister_type: "rust",
    read_only: false
  }
  Action:
    1. Validate canister_id format
    2. Call canister_status on IC to verify it exists
    3. If !read_only: verify ICForge is a controller
    4. Create canister record with existing canister_id
  Returns: { canister: { id, name, canister_id, status: "linked" } }

DELETE /api/v1/projects/:id/canisters/:canister_id/unlink
  Action: Remove canister record (does NOT delete the canister on IC)
  Returns: { success: true }
```

## 5. Database Changes

The existing `canisters` table works. Linked canisters are distinguished by:
- `canister_id` is set at creation (normally it's NULL until first deploy)
- New column: `linked BOOLEAN DEFAULT false`
- New column: `read_only BOOLEAN DEFAULT false`

```sql
ALTER TABLE canisters ADD COLUMN linked BOOLEAN DEFAULT false;
ALTER TABLE canisters ADD COLUMN read_only BOOLEAN DEFAULT false;
```

## 6. Deploy behavior for linked canisters

When deploying to a linked canister:
1. Skip canister creation (it already exists)
2. Call `install_code` with mode `upgrade` (always upgrade, never fresh install — we don't know the current state)
3. Warn if installing for the first time: "This will upgrade existing code. Make sure the wasm is compatible."

## 7. Implementation Checklist

### CLI
- [ ] `icforge link <canister-id>` command
- [ ] `--name`, `--type`, `--read-only` flags
- [ ] `--verify` flag to check controller access
- [ ] Display ICForge platform principal for controller setup
- [ ] `icforge unlink <canister-name>` command
- [ ] Show linked status in `icforge status`

### Backend
- [ ] `POST /api/v1/projects/:id/canisters/link` endpoint
- [ ] `DELETE /api/v1/projects/:id/canisters/:id/unlink` endpoint
- [ ] Canister existence verification (call canister_status)
- [ ] Controller verification
- [ ] Migration: add `linked`, `read_only` columns to canisters
- [ ] Deploy pipeline: skip creation for linked canisters, always upgrade

### Dashboard
- [ ] "Link Existing Canister" button on ProjectDetail
- [ ] Form: canister ID, name, type, read-only toggle
- [ ] Controller setup instructions display
- [ ] Visual indicator for linked vs. ICForge-created canisters

## 8. Security Considerations

- **Squatting:** A user could link a canister they don't control (read-only) to track its cycles. This is fine — canister_status is a public query on IC. No sensitive data is exposed.
- **Unlinking:** Unlinking only removes the record from ICForge. It does NOT remove ICForge as a controller. Users should be warned to manually remove the controller if they no longer want ICForge access.
- **Canister hijacking:** If a user links a canister and adds ICForge as controller, then another ICForge user links the same canister — who has deploy access? Answer: the canister is scoped to a project, and projects are scoped to users/orgs. Only the user who linked it can deploy through ICForge.
