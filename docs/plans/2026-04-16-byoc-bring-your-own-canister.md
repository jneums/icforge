# BYOC (Bring Your Own Canister) Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Allow users who already have IC canisters (with IDs in `.icp/data/mappings/ic.ids.json`) to use them with ICForge instead of ICForge always creating new canisters.

**Architecture:** The CLI reads existing canister IDs from ic.ids.json during `icforge init` and sends them to the backend. The backend stores them immediately and, at deploy time, verifies the icforge platform identity is a controller of the BYOC canister before deploying. If not a controller, the deploy fails with a clear error message telling the user exactly what command to run.

**Tech Stack:** Rust/Axum backend, TypeScript CLI, React dashboard (existing error display sufficient)

---

## Data Flow

```
User has existing project with .icp/data/mappings/ic.ids.json:
  { "backend": "slffn-cqaaa-aaaak-qyqoa-cai" }

CLI `icforge init`:
  1. Reads icp.yaml → canister names + recipes
  2. Reads .icp/data/mappings/ic.ids.json → existing canister IDs
  3. POST /api/v1/projects with canisters: [{ name: "backend", recipe: "...", canister_id: "slffn-..." }]

Backend create_project:
  4. Inserts canister row with canister_id populated, status = 'byoc'

Backend deploy_worker (pre-provision phase):
  5. Sees canister_id is already set → checks if icforge is a controller
  6a. If controller → proceed (skip provisioning, no charge)
  6b. If NOT controller → fail with actionable error:
      "ICForge is not a controller of canister slffn-cqaaa-aaaak-qyqoa-cai.
       Run: icp canister update-settings slffn-cqaaa-aaaak-qyqoa-cai --add-controller <icforge-principal> --network ic"
```

---

### Task 1: Add `canister_id` to `CreateCanisterInput` (Backend)

**Objective:** Accept optional pre-existing canister IDs in the create project request.

**Files:**
- Modify: `backend/src/models.rs:112-117`

**Code change:**

```rust
#[derive(Debug, Deserialize)]
pub struct CreateCanisterInput {
    pub name: String,
    /// Recipe string from icp.yaml (e.g. "rust@v3.1.0", "asset-canister@v2.1.0")
    pub recipe: Option<String>,
    /// Pre-existing canister ID for BYOC (Bring Your Own Canister)
    pub canister_id: Option<String>,
}
```

---

### Task 2: Store BYOC canister IDs at project creation (Backend)

**Objective:** When a canister input includes a `canister_id`, store it in the DB with status `byoc` instead of `pending`.

**Files:**
- Modify: `backend/src/routes.rs:290-327` (the canister insertion loop in `create_project`)

**Code change in the `for canister_input in &req.canisters` loop:**

```rust
    // Insert canisters
    let mut canisters = Vec::new();
    for canister_input in &req.canisters {
        let canister_id = uuid::Uuid::new_v4().to_string();
        let recipe = canister_input.recipe.as_deref()
            .unwrap_or("custom");

        // BYOC: if a pre-existing canister ID is provided, store it directly
        let (ic_canister_id, status) = if let Some(ref cid) = canister_input.canister_id {
            (Some(cid.clone()), "byoc")
        } else {
            (None, "pending")
        };

        sqlx::query(
            "INSERT INTO canisters (id, project_id, name, type, recipe, canister_id, subnet_id, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        )
        .bind(&canister_id)
        .bind(&project_id)
        .bind(&canister_input.name)
        .bind(recipe)
        .bind(recipe)
        .bind(&ic_canister_id)  // NEW: pre-existing canister ID or NULL
        .bind(&req.subnet)
        .bind(status)           // NEW: "byoc" or "pending"
        .bind(&now)
        .bind(&now)
        .execute(&state.db)
        .await
        .map_err(AppError::Database)?;

        canisters.push(CanisterRecord {
            id: canister_id,
            project_id: project_id.clone(),
            name: canister_input.name.clone(),
            recipe: recipe.to_string(),
            canister_id: ic_canister_id,  // NEW
            subnet_id: req.subnet.clone(),
            status: status.into(),        // NEW
            cycles_balance: None,
            candid_interface: None,
            canister_type: Some(recipe.to_string()),
            cycles_alert_threshold: None,
            created_at: now.clone(),
            updated_at: now.clone(),
        });
    }
```

---

### Task 3: Controller verification for BYOC canisters at deploy time (Backend)

**Objective:** In the pre-provision phase, when a canister already has an ID (either BYOC or previously provisioned), verify the icforge identity is a controller. For BYOC canisters (status='byoc'), skip billing but verify controller access. Fail with an actionable error if not a controller.

**Files:**
- Modify: `backend/src/deploy_worker.rs:409-579` (the pre-provision block)

**The existing match block handles three cases. We modify the `Some((_db_id, Some(cid)))` arm:**

Replace the existing `Some((_db_id, Some(cid)))` arm (lines 423-433) with:

```rust
            Some((db_id, Some(cid))) => {
                // Canister ID already exists — verify icforge is a controller
                log_deploy(
                    pool,
                    &job.id,
                    "info",
                    "provision",
                    &format!("Canister '{canister_name}' has ID {cid} — verifying controller access..."),
                    tx,
                )
                .await;

                // Check controller status via canister_status
                let ic_pem_for_check = config
                    .ic_identity_pem
                    .as_deref()
                    .ok_or_else(|| "IC_IDENTITY_PEM not configured".to_string())?;

                let ic_client = crate::ic_client::IcClient::new(ic_pem_for_check, &config.ic_url)
                    .await
                    .map_err(|e| format!("Failed to create IC client: {e}"))?;

                let icforge_principal = ic_client.identity_principal();

                match ic_client.canister_status(&cid).await {
                    Ok(status) => {
                        let controllers = &status.settings.controllers;
                        if !controllers.iter().any(|c| *c == icforge_principal) {
                            let msg = format!(
                                "ICForge is not a controller of canister '{canister_name}' ({cid}).\n\n\
                                 To fix this, run:\n\n\
                                   icp canister update-settings {cid} \\\n\
                                     --add-controller {} \\\n\
                                     --network ic\n\n\
                                 Then re-deploy.",
                                icforge_principal.to_text(),
                            );
                            log_deploy(pool, &job.id, "error", "provision", &msg, tx).await;
                            return Err(msg);
                        }

                        log_deploy(
                            pool,
                            &job.id,
                            "info",
                            "provision",
                            &format!("✅ ICForge is a controller of canister '{canister_name}'"),
                            tx,
                        )
                        .await;
                    }
                    Err(e) => {
                        // canister_status fails if we're not a controller — this IS the error case
                        let msg = format!(
                            "Cannot verify controller access for canister '{canister_name}' ({cid}): {e}\n\n\
                             This usually means ICForge is not a controller. To fix, run:\n\n\
                               icp canister update-settings {cid} \\\n\
                                 --add-controller {} \\\n\
                                 --network ic\n\n\
                             Then re-deploy.",
                            icforge_principal.to_text(),
                        );
                        log_deploy(pool, &job.id, "error", "provision", &msg, tx).await;
                        return Err(msg);
                    }
                }

                // For BYOC canisters that were just linked (status='byoc'),
                // update status to 'created' now that controller is verified
                let canister_status: Option<String> = sqlx::query_scalar(
                    "SELECT status FROM canisters WHERE id = $1",
                )
                .bind(&db_id)
                .fetch_optional(pool)
                .await
                .ok()
                .flatten();

                if canister_status.as_deref() == Some("byoc") {
                    let _ = sqlx::query(
                        "UPDATE canisters SET status = 'created', updated_at = to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS') WHERE id = $1",
                    )
                    .bind(&db_id)
                    .execute(pool)
                    .await;
                }
            }
```

**Note:** `canister_status` management canister call requires the caller to be a controller. So if the call itself fails, that's our signal that icforge is NOT a controller. We handle both cases (success with controller check, and outright failure).

---

### Task 4: CLI reads existing canister IDs from ic.ids.json (CLI)

**Objective:** During `icforge init`, read `.icp/data/mappings/ic.ids.json` and include any existing canister IDs in the create project request.

**Files:**
- Modify: `cli/src/config.ts` — add `readExistingCanisterIds()` function
- Modify: `cli/src/commands/init.ts` — call it and pass IDs to backend

**Add to `config.ts`:**

```typescript
/**
 * Read existing canister IDs from .icp/data/mappings/ic.ids.json (if present).
 * Returns a map of canister_name → canister_id.
 */
export async function readExistingCanisterIds(dir: string = process.cwd()): Promise<Record<string, string>> {
  const idsPath = join(dir, ".icp", "data", "mappings", "ic.ids.json");
  if (!existsSync(idsPath)) return {};
  try {
    const raw = await readFile(idsPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      // Filter to only string values (canister IDs)
      const result: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string" && value.length > 0) {
          result[key] = value;
        }
      }
      return result;
    }
  } catch {
    // Malformed JSON — ignore
  }
  return {};
}
```

**Modify `init.ts`:**

Add import:
```typescript
import {
  extractCanisters,
  loadICForgeConfig,
  saveICForgeConfig,
  isIcProject,
  readExistingCanisterIds,  // NEW
} from "../config.js";
```

After `extractCanisters()` call (around line 35), add:
```typescript
  // 4b. Check for existing canister IDs (BYOC)
  const existingIds = await readExistingCanisterIds();
```

After displaying canisters (around line 48), show BYOC info:
```typescript
  for (const canister of canisters) {
    const recipe = canister.recipe ?? "custom";
    const existingId = existingIds[canister.name];
    if (existingId) {
      console.log(`  📦 ${chalk.bold(canister.name)} (${chalk.dim(recipe)}) → ${chalk.yellow("BYOC")} ${chalk.dim(existingId)}`);
    } else {
      console.log(`  📦 ${chalk.bold(canister.name)} (${chalk.dim(recipe)})`);
    }
  }
```

In the `apiFetch` body (around line 57), include canister IDs:
```typescript
      canisters: canisters.map(c => ({
        name: c.name,
        recipe: c.recipe ?? "custom",
        canister_id: existingIds[c.name] ?? undefined,  // NEW: BYOC
      })),
```

After project creation success, if there are BYOC canisters, show controller reminder:
```typescript
  // Show BYOC controller reminder
  const byocNames = canisters.filter(c => existingIds[c.name]).map(c => c.name);
  if (byocNames.length > 0) {
    console.log();
    console.log(chalk.yellow("⚠️  BYOC canisters detected. ICForge needs controller access to deploy."));
    console.log(chalk.dim("  Ensure the ICForge platform identity is added as a controller:"));
    console.log();
    for (const name of byocNames) {
      const cid = existingIds[name];
      console.log(chalk.dim(`    icp canister update-settings ${cid} \\`));
      console.log(chalk.dim(`      --add-controller <icforge-principal> \\`));
      console.log(chalk.dim(`      --network ic`));
      console.log();
    }
    console.log(chalk.dim("  The exact principal will be shown in deploy logs if missing."));
  }
```

---

### Task 5: Skip billing for BYOC canisters in deploy_worker (Backend)

**Objective:** BYOC canisters should NOT be charged the provisioning fee since ICForge didn't create them. The `Some((db_id, None))` arm (which charges for provisioning) is only hit when there's no canister_id — so BYOC canisters naturally skip it. But we should also make sure the compute poller doesn't auto top-up BYOC canisters by default (they manage their own cycles).

**Files:**
- Modify: `backend/src/compute_poller.rs` — skip auto top-up for BYOC canisters

**In the compute poller, when iterating canisters for auto top-up, skip those with status='byoc':**

Find the canister query in compute_poller.rs and add a status filter. The poller fetches canisters with `canister_id IS NOT NULL`. Add `AND status != 'byoc'` to exclude BYOC canisters from auto top-up.

**Note:** This is a product decision — BYOC users manage their own cycles. ICForge shouldn't charge them for top-ups on canisters ICForge doesn't own the cycles for. If we later want to offer optional managed top-up for BYOC, that's a separate feature.

---

### Task 6: Verify and commit

**Objective:** Build and verify everything compiles, then commit.

**Steps:**
1. `cd ~/icforge/backend && cargo check` — verify Rust compiles
2. `cd ~/icforge/cli && npm run build` — verify CLI compiles
3. Test locally with a project that has existing ic.ids.json
4. Commit all changes

```bash
git add backend/src/models.rs backend/src/routes.rs backend/src/deploy_worker.rs backend/src/compute_poller.rs
git add cli/src/config.ts cli/src/commands/init.ts
git commit -m "feat: BYOC (Bring Your Own Canister) support

- CLI reads existing canister IDs from .icp/data/mappings/ic.ids.json
- Backend accepts optional canister_id in create project request
- Deploy worker verifies ICForge is a controller before deploying BYOC canisters
- Actionable error message with exact icp command if not a controller
- BYOC canisters skip provisioning billing and auto top-up"
```

---

## Edge Cases & Notes

1. **BYOC + idempotent init**: If `icforge init` is run again on an already-initialized project, the existing code returns the project early (line 21-24 in init.ts). The BYOC IDs are only sent on first init.

2. **canister_status requires controller**: The IC management canister's `canister_status` can only be called by a controller. If the call fails, we know icforge is NOT a controller. This is the simplest verification — no need for separate controller-check logic.

3. **BYOC canisters and the compute poller**: BYOC canisters should be excluded from auto top-up since ICForge doesn't manage their cycles. Users who bring their own canisters are responsible for their own cycles management.

4. **No dashboard changes needed**: The deploy error already shows in the red Alert on DeployDetail.tsx. The actionable error message with the `icp canister update-settings` command will display there naturally.

5. **Status progression**: BYOC canisters go `byoc` → `created` (after controller verified) → `running` (after deploy). Platform-provisioned canisters go `pending` → `created` (after IC canister created) → `running`.
