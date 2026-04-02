// ============================================================
// API Types — shared between CLI, backend, and dashboard
// ============================================================

export interface User {
  id: string;
  email: string;
  name?: string;
  /** IC principal derived from custodial identity */
  principal?: string;
  plan: Plan;
  createdAt: string;
}

export type Plan = "free" | "dev" | "pro" | "enterprise";

export interface Project {
  id: string;
  userId: string;
  name: string;
  slug: string;
  /** Custom subdomain: <slug>.atlascloud.dev */
  customDomain?: string;
  canisters: Canister[];
  createdAt: string;
  updatedAt: string;
}

export interface Canister {
  id: string;
  projectId: string;
  name: string;
  type: "frontend" | "backend";
  /** IC canister ID once deployed */
  canisterId?: string;
  /** IC subnet the canister lives on */
  subnetId?: string;
  status: CanisterStatus;
  cyclesBalance?: bigint;
}

export type CanisterStatus = "pending" | "creating" | "running" | "stopped" | "error";

export interface Deployment {
  id: string;
  projectId: string;
  canisterName: string;
  status: DeploymentStatus;
  commitSha?: string;
  commitMessage?: string;
  branch?: string;
  logs: DeployLog[];
  startedAt: string;
  completedAt?: string;
  url?: string;
}

export type DeploymentStatus =
  | "queued"
  | "building"
  | "uploading"
  | "installing"
  | "syncing"
  | "live"
  | "failed"
  | "cancelled";

export interface DeployLog {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
}

// ============================================================
// API Request/Response types
// ============================================================

export interface CreateProjectRequest {
  name: string;
  /** Canisters parsed from the developer's icp.yaml */
  canisters: {
    name: string;
    type: "frontend" | "backend";
    /** Recipe type from icp.yaml (e.g., "@dfinity/rust@v3.0.0") */
    recipe?: string;
  }[];
}

export interface DeployRequest {
  projectId: string;
  canisterName: string;
  /** Base64 encoded wasm module */
  wasm?: string;
  /** For asset canisters: map of path -> base64 content */
  assets?: Record<string, string>;
  /** Candid interface definition */
  candidInterface?: string;
}

export interface DeployResponse {
  deploymentId: string;
  status: DeploymentStatus;
  statusUrl: string;
  canisterUrl?: string;
}
