import { useState, useEffect, useMemo } from "react";
import { useSetCanisterControllers } from "@/hooks/use-canister-controllers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Loader2, Shield } from "lucide-react";

export function ControllersEditor({
  canisterId,
  controllers,
  platformPrincipal,
}: {
  canisterId: string;
  controllers: string[];
  platformPrincipal: string;
}) {
  // Filter out the platform principal — users manage their own principals only
  const userControllers = controllers.filter(c => c !== platformPrincipal);
  const [rows, setRows] = useState<{ key: string; value: string }[]>(
    () => userControllers.map((c, i) => ({ key: `existing-${i}`, value: c }))
  );
  const [nextKey, setNextKey] = useState(0);
  const mutation = useSetCanisterControllers(canisterId);

  // Sync when remote data changes
  useEffect(() => {
    if (!mutation.isPending) {
      const filtered = controllers.filter(c => c !== platformPrincipal);
      setRows(filtered.map((c, i) => ({ key: `existing-${i}`, value: c })));
    }
  }, [controllers, platformPrincipal, mutation.isPending]);

  // isDirty check: compare current rows to userControllers
  const isDirty = useMemo(() => {
    const current = rows.map(r => r.value.trim()).filter(v => v !== "");
    if (current.length !== userControllers.length) return true;
    return current.some((v, i) => v !== userControllers[i]);
  }, [rows, userControllers]);

  function addRow() {
    setRows(prev => [...prev, { key: `new-${nextKey}`, value: "" }]);
    setNextKey(k => k + 1);
  }

  function removeRow(key: string) {
    setRows(prev => prev.filter(r => r.key !== key));
  }

  function updateRow(key: string, value: string) {
    setRows(prev => prev.map(r => r.key === key ? { ...r, value } : r));
  }

  function handleSave() {
    // Send only non-empty user principals — backend will prepend the platform principal
    const toSave = rows.map(r => r.value.trim()).filter(v => v !== "");
    mutation.mutate(toSave);
  }

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No additional controllers. Only ICForge manages this canister.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map(row => (
            <div key={row.key} className="flex items-center gap-2">
              <Input
                className="font-mono text-sm flex-1"
                placeholder="e.g. rrkah-fqaaa-aaaaa-aaaaq-cai"
                value={row.value}
                onChange={e => updateRow(row.key, e.target.value)}
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
          Add Controller
        </Button>
        {isDirty && (
          <Button size="sm" onClick={handleSave} disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
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
        <p className="text-sm text-success">Controllers updated.</p>
      )}

      <p className="text-xs text-muted-foreground pt-2">
        <Shield className="h-3 w-3 inline mr-1" />
        Controllers have full admin access to this canister. Add your own principal to use dfx or icp-cli directly.
      </p>
    </div>
  );
}
