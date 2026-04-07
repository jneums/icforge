import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useInstallations, useGitHubRepos, useRepoConfig } from "@/hooks/use-github";
import { createProject, linkRepo } from "@/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  GitBranch,
  Search,
  ExternalLink,
  Loader2,
  Check,
  AlertCircle,
  Settings,
} from "lucide-react";
import type { GitHubRepo, RepoConfig } from "@/api/types";

type Step = "repo" | "configure" | "creating";

export default function NewProject() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("repo");
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [projectName, setProjectName] = useState("");
  const [search, setSearch] = useState("");

  const { data: installations, isLoading: installLoading } = useInstallations();
  const { data: repos, isLoading: reposLoading } = useGitHubRepos();
  const { data: repoConfig, isLoading: configLoading, isFetching: configFetching, refetch: recheckConfig } = useRepoConfig(
    selectedRepo?.id ?? null
  );

  const hasInstallations = !!installations?.length;
  const isLoading = installLoading || reposLoading;

  const filteredRepos = repos?.filter((r) =>
    r.full_name.toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  function handleSelectRepo(repo: GitHubRepo) {
    setSelectedRepo(repo);
    setProjectName(repo.full_name.split("/").pop() ?? repo.full_name);
    setStep("configure");
  }

  async function handleCreate() {
    if (!selectedRepo || !projectName.trim()) return;

    setStep("creating");

    try {
      // Extract canisters from icp.yaml config if available
      const canisters = extractCanisters(repoConfig?.config, repoConfig?.canisters as Record<string, unknown>[] | undefined);

      const { project } = await createProject({
        name: projectName.trim(),
        canisters: canisters.length > 0 ? canisters : [{ name: "default" }],
      });

      // Link the GitHub repo to the project
      await linkRepo({
        project_id: project.id,
        github_repo_id: selectedRepo.id,
        production_branch: selectedRepo.default_branch,
      });

      toast.success("Project created and repo linked!");
      navigate(`/projects/${project.id}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create project";
      toast.error(msg);
      setStep("configure");
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            if (step === "configure") setStep("repo");
            else navigate("/projects");
          }}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">New Project</h1>
      </div>

      {/* Steps indicator */}
      <StepIndicator current={step} />

      {step === "repo" && (
        <RepoStep
          isLoading={isLoading}
          hasInstallations={hasInstallations}
          repos={filteredRepos}
          search={search}
          onSearchChange={setSearch}
          onSelect={handleSelectRepo}
        />
      )}

      {step === "configure" && selectedRepo && (
        <ConfigureStep
          repo={selectedRepo}
          projectName={projectName}
          onProjectNameChange={setProjectName}
          config={repoConfig}
          configLoading={configLoading || configFetching}
          onBack={() => setStep("repo")}
          onCreate={handleCreate}
          onRecheck={() => recheckConfig()}
        />
      )}

      {step === "creating" && <CreatingStep />}
    </div>
  );
}

/* ── helpers ── */

function extractCanisters(
  config: Record<string, unknown> | null | undefined,
  enriched?: Record<string, unknown>[],
): { name: string; recipe?: string }[] {
  // Prefer enriched canisters from the API (includes canister.yaml data)
  if (enriched && enriched.length > 0) {
    return enriched.map((obj) => {
      const name = (obj.name as string) ?? "unnamed";
      const recipeObj = obj.recipe as Record<string, unknown> | undefined;
      const recipe = recipeObj?.type as string | undefined;
      return { name, recipe };
    });
  }
  // Fallback: parse from icp.yaml config directly
  if (!config) return [];
  const canisters = config.canisters;
  if (!canisters || !Array.isArray(canisters)) return [];
  return canisters.map((item) => {
    if (typeof item === "string") {
      return { name: item };
    }
    if (typeof item === "object" && item !== null) {
      const obj = item as Record<string, unknown>;
      const name = (obj.name as string) ?? "unnamed";
      const recipeObj = obj.recipe as Record<string, unknown> | undefined;
      const recipe = recipeObj?.type as string | undefined;
      return { name, recipe };
    }
    return { name: "unknown" };
  });
}

/* ── sub-components ── */

function StepIndicator({ current }: { current: Step }) {
  const steps = [
    { key: "repo", label: "Select Repository" },
    { key: "configure", label: "Configure" },
    { key: "creating", label: "Create" },
  ] as const;

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      {steps.map((s, i) => (
        <span key={s.key} className="flex items-center gap-2">
          {i > 0 && <span className="text-border">—</span>}
          <span
            className={
              s.key === current
                ? "text-foreground font-medium"
                : current === "creating" && s.key !== "creating"
                ? "text-muted-foreground/50"
                : ""
            }
          >
            {s.label}
          </span>
        </span>
      ))}
    </div>
  );
}

function RepoStep({
  isLoading,
  hasInstallations,
  repos,
  search,
  onSearchChange,
  onSelect,
}: {
  isLoading: boolean;
  hasInstallations: boolean;
  repos: GitHubRepo[];
  search: string;
  onSearchChange: (v: string) => void;
  onSelect: (repo: GitHubRepo) => void;
}) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="px-4 py-3 border-border/50">
            <Skeleton className="h-5 w-48" />
          </Card>
        ))}
      </div>
    );
  }

  if (!hasInstallations) {
    return (
      <Card className="flex flex-col items-center py-12 px-6 text-center border-border/50">
        <AlertCircle className="h-10 w-10 text-muted-foreground mb-4" />
        <h2 className="text-lg font-semibold mb-2">Install the ICForge GitHub App</h2>
        <p className="text-sm text-muted-foreground mb-6 max-w-sm">
          To import a repository, first install the ICForge GitHub App on your
          GitHub account or organization.
        </p>
        <Button asChild>
          <a
            href="https://github.com/apps/icforge/installations/new"
            target="_blank"
            rel="noopener noreferrer"
          >
            Install GitHub App
            <ExternalLink className="ml-2 h-3.5 w-3.5" />
          </a>
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search repositories..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9"
        />
      </div>

      {repos.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          {search ? "No matching repositories found." : "No repositories found. Check your GitHub App installation permissions."}
        </p>
      ) : (
        <div className="space-y-2">
          {repos.map((repo) => (
            <Card
              key={repo.id}
              className={`flex flex-row items-center gap-3 px-4 py-3 border-border/50 transition-all ${
                repo.linked_project_id
                  ? "opacity-50 cursor-not-allowed"
                  : "hover:border-border hover:bg-card/80 cursor-pointer"
              }`}
              onClick={() => !repo.linked_project_id && onSelect(repo)}
            >
              <GitBranch className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="font-mono text-sm truncate flex-1 min-w-0">
                {repo.full_name}
                {repo.linked_project_id && (
                  <span className="text-xs text-muted-foreground/60 ml-2 font-sans">
                    → {repo.linked_project_name}
                  </span>
                )}
              </span>
              {repo.linked_project_id ? (
                <Check className="h-4 w-4 text-muted-foreground/40 shrink-0" />
              ) : (
                <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
            </Card>
          ))}
        </div>
      )}

      <div className="flex items-center justify-center gap-2 pt-1">
        <a
          href="https://github.com/apps/icforge/installations/select_target"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Settings className="h-3 w-3" />
          Add repositories or organizations
        </a>
      </div>
    </div>
  );
}

function ConfigureStep({
  repo,
  projectName,
  onProjectNameChange,
  config,
  configLoading,
  onBack,
  onCreate,
  onRecheck,
}: {
  repo: GitHubRepo;
  projectName: string;
  onProjectNameChange: (v: string) => void;
  config: RepoConfig | undefined;
  configLoading: boolean;
  onBack: () => void;
  onCreate: () => void;
  onRecheck: () => void;
}) {
  const canisters = extractCanisters(config?.config, config?.canisters);
  const hasConfig = !!config?.found && canisters.length > 0;
  const missingConfig = config && !config.found;

  return (
    <div className="space-y-5">
      <Card className="px-5 py-4 border-border/50 space-y-4">
        <div>
          <label className="text-sm font-medium mb-1.5 block">Repository</label>
          <div className="flex items-center gap-2 text-sm text-muted-foreground font-mono">
            <GitBranch className="h-4 w-4 shrink-0" />
            {repo.full_name}
            <span className="text-muted-foreground/50">({repo.default_branch})</span>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium mb-1.5 block">Project Name</label>
          <Input
            value={projectName}
            onChange={(e) => onProjectNameChange(e.target.value)}
            placeholder="my-project"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Your project will be available at <span className="font-mono">{slugify(projectName)}.icforge.dev</span>
          </p>
        </div>
      </Card>

      <Card className="px-5 py-4 border-border/50">
        <label className="text-sm font-medium mb-3 block">Canisters</label>
        {configLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-52" />
          </div>
        ) : hasConfig ? (
          <div className="space-y-2">
            {canisters.map((c) => (
              <div key={c.name} className="flex items-center gap-2 text-sm">
                <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />
                <span className="font-mono">{c.name}</span>
                {c.recipe && (
                  <span className="text-muted-foreground/60 text-xs">({c.recipe})</span>
                )}
              </div>
            ))}
            <p className="text-xs text-muted-foreground mt-2">
              Detected from <span className="font-mono">icp.yaml</span>
            </p>
          </div>
        ) : missingConfig ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 text-sm">
              <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-foreground">No icp.yaml found</p>
                <p className="text-muted-foreground mt-1">
                  ICForge requires an <span className="font-mono">icp.yaml</span> in your repository root to know what to build.
                </p>
              </div>
            </div>
            <Card className="bg-popover border-border/50 p-4 font-mono text-xs text-left space-y-1">
              <div className="text-muted-foreground/60"># icp.yaml — minimal example</div>
              <div>canisters:</div>
              <div className="pl-2">- name: backend</div>
              <div className="pl-4">recipe: rust</div>
              <div className="pl-2">- name: frontend</div>
              <div className="pl-4">recipe: asset-canister</div>
            </Card>
            <p className="text-xs text-muted-foreground">
              Add this file to the <span className="font-mono">{repo.default_branch}</span> branch, then recheck.
            </p>
            <Button variant="outline" size="sm" onClick={onRecheck} disabled={configLoading}>
              {configLoading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
              Recheck
            </Button>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            <p>Checking for icp.yaml...</p>
          </div>
        )}
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button onClick={onCreate} disabled={!projectName.trim() || !hasConfig || configLoading}>
          Create Project
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function CreatingStep() {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
      <p className="text-sm text-muted-foreground">Creating project and linking repository...</p>
    </div>
  );
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
