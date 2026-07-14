import { useState, useEffect } from "react";
import { useSetCanisterEnv } from "@/hooks/use-canister-env";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Loader2 } from "lucide-react";
import type { EnvironmentVariable } from "@/api/types";

interface EnvVarRow {
  key: string;
  name: string;
  value: string;
}

function envVarsToRows(vars: EnvironmentVariable[]): EnvVarRow[] {
  return vars.map((v, i) => ({
    key: `existing-${i}-${v.name}`,
    name: v.name,
    value: v.value,
  }));
}

function rowsEqual(
  rows: EnvVarRow[],
  original: EnvironmentVariable[]
): boolean {
  const filtered = rows.filter((r) => r.name.trim() !== "");
  if (filtered.length !== original.length) return false;
  return filtered.every(
    (r, i) => r.name === original[i].name && r.value === original[i].value
  );
}

export function EnvVarEditor({
  canisterId,
  envVars,
}: {
  canisterId: string;
  envVars: EnvironmentVariable[];
}) {
  const [rows, setRows] = useState<EnvVarRow[]>(() => envVarsToRows(envVars));
  const [nextKey, setNextKey] = useState(0);
  const mutation = useSetCanisterEnv(canisterId);

  // Sync rows when remote data changes (after save or refetch)
  useEffect(() => {
    if (!mutation.isPending) {
      setRows(envVarsToRows(envVars));
    }
  }, [envVars, mutation.isPending]);

  const isDirty = !rowsEqual(rows, envVars);

  function addRow() {
    setRows((prev) => [
      ...prev,
      { key: `new-${nextKey}`, name: "", value: "" },
    ]);
    setNextKey((k) => k + 1);
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  function updateRow(key: string, field: "name" | "value", val: string) {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, [field]: val } : r))
    );
  }

  function handleSave() {
    // Filter out empty-name rows before saving
    const toSave: EnvironmentVariable[] = rows
      .filter((r) => r.name.trim() !== "")
      .map((r) => ({ name: r.name.trim(), value: r.value }));
    mutation.mutate(toSave);
  }

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No environment variables set.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.key} className="flex items-center gap-2">
              <Input
                className="font-mono text-sm flex-1"
                placeholder="NAME"
                value={row.name}
                onChange={(e) => updateRow(row.key, "name", e.target.value)}
              />
              <span className="text-muted-foreground text-sm">=</span>
              <Input
                className="font-mono text-sm flex-[2]"
                placeholder="value"
                value={row.value}
                onChange={(e) => updateRow(row.key, "value", e.target.value)}
              />
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => removeRow(row.key)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={addRow}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add Variable
        </Button>
        {isDirty && (
          <Button
            size="sm"
            onClick={handleSave}
            disabled={mutation.isPending}
          >
            {mutation.isPending && (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            )}
            Save Changes
          </Button>
        )}
      </div>

      {mutation.isError && (
        <p className="text-sm text-destructive">
          Failed to save: {mutation.error?.message ?? "Unknown error"}
        </p>
      )}
      {mutation.isSuccess && !isDirty && (
        <p className="text-sm text-success">Environment variables saved.</p>
      )}
    </div>
  );
}
