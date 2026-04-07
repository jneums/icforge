// Shared TypeScript interfaces for ICForge API

export interface Project {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  custom_domain: string | null;
  subnet_id: string | null;
  created_at: string;
  updated_at: string;
  canisters: Canister[];
  latest_deployment?: Deployment;
}

export interface Canister {
  id: string;
  project_id: string;
  name: string;
  /** icp-cli recipe (e.g. "rust@v3.1.0", "asset-canister@v2.1.0") */
  recipe: string;
  /** Legacy type field — may be absent on newer records */
  type?: string;
  canister_id: string | null;
  subnet_id: string | null;
  status: string;
  cycles_balance: number | null;
  created_at: string;
  updated_at: string;
}

export interface Deployment {
  id: string;
  project_id: string;
  canister_name: string;
  status: string;
  commit_sha: string | null;
  commit_message: string | null;
  branch: string | null;
  repo_full_name: string | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface User {
  id: string;
  github_id: number;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  plan: string;
  created_at: string;
  updated_at: string;
}

export interface LogEntry {
  level: string;
  message: string;
  timestamp: string;
}

export interface EnvironmentVariable {
  name: string;
  value: string;
}

export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
}

// GitHub App types

export interface GitHubInstallation {
  id: string;
  user_id: string;
  installation_id: number;
  account_login: string;
  account_type: string;
  created_at: string;
  updated_at: string;
}

export interface GitHubRepo {
  id: string;
  installation_id: string;
  github_repo_id: number;
  full_name: string;
  default_branch: string;
  /** Set if this repo is already linked to a project */
  linked_project_id?: string;
  linked_project_name?: string;
}

export interface RepoConfig {
  found: boolean;
  config: Record<string, unknown> | null;
  canisters?: Record<string, unknown>[];
  raw: string | null;
}
