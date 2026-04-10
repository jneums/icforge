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
  installation_id: number | null;
  trigger: string | null;
  pr_number: number | null;
  claimed_at: string | null;
  retry_count: number;
  build_duration_ms: number | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
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

// Billing

export interface UsageBreakdown {
  total_cents: number;
  cycles_cents: number;
  provision_cents: number;
}

export interface BillingBalance {
  compute_balance_cents: number;
  auto_topup_enabled: boolean;
  auto_topup_threshold_cents: number | null;
  auto_topup_amount_cents: number | null;
  credits_expire_at: string | null;
  usage_this_month: UsageBreakdown;
}

export interface ComputeTransaction {
  id: string;
  user_id: string;
  type: 'credit' | 'debit';
  amount_cents: number;
  category: string | null;
  source: string | null;
  stripe_payment_id: string | null;
  description: string | null;
  created_at: string;
}

export interface AutoTopupSettings {
  enabled: boolean;
  threshold_cents?: number;
  amount_cents?: number;
}

// Canister compute / health

export interface ComputeHistoryPoint {
  compute_value_cents: number;
  memory_size: number;
  status: string;
  recorded_at: string;
}

export interface ComputeTopupRecord {
  id: string;
  cost_cents: number;
  source: 'auto' | 'manual';
  created_at: string;
}

export interface CanisterComputeInfo {
  canister_id: string;
  canister_name: string;
  health: 'healthy' | 'warning' | 'critical' | 'frozen' | 'unknown';
  compute_value_cents: number;
  burn_rate_cents_per_day: number | null;
  runway_days: number | null;
  history: ComputeHistoryPoint[];
  topups: ComputeTopupRecord[];
}

export interface CanisterHealthEntry {
  name: string;
  canister_id: string | null;
  health: 'healthy' | 'warning' | 'critical' | 'frozen' | 'unknown';
}

export interface ProjectHealth {
  project_id: string;
  overall_health: 'healthy' | 'warning' | 'critical' | 'frozen' | 'unknown';
  canisters: CanisterHealthEntry[];
  topup_blocked: boolean;
}
