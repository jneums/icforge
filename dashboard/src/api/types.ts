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
  type: string;
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
