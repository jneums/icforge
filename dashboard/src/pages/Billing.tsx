import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import {
  useBillingBalance,
  useTransactions,
  useCostsByCanister,
  useCheckout,
  useBillingPortal,
  useAutoTopup,
} from "@/hooks/use-billing";
import type { TransactionFilters } from "@/api";
import type { ComputeTransaction } from "@/api";

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

/** For UTC period boundaries (e.g. "since Jul 1") — local formatting would show the prior day. */
function formatDateUTC(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

/** ISO string without milliseconds — matches the backend's created_at format. */
function isoNoMillis(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function BalanceCard() {
  const { data: balance, isLoading } = useBillingBalance();
  const checkout = useCheckout();
  const portal = useBillingPortal();
  const [amount, setAmount] = useState(10);

  if (isLoading) return <Skeleton className="h-48 w-full rounded-lg" />;
  if (!balance) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Compute Balance</CardTitle>
        <CardDescription>Pre-paid credits for builds, hosting, and bandwidth</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold">{formatCents(balance.compute_balance_cents)}</span>
          {balance.credits_expire_at && (
            <span className="text-xs text-muted-foreground">
              expires {formatDate(balance.credits_expire_at)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground">Add credits:</span>
          {[5, 10, 25, 50].map((v) => (
            <Button
              key={v}
              variant={amount === v ? "default" : "outline"}
              size="sm"
              onClick={() => setAmount(v)}
            >
              ${v}
            </Button>
          ))}
          <Input
            type="number"
            min={5}
            className="w-20 h-8"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
          <Button
            size="sm"
            onClick={() => checkout.mutate(amount)}
            disabled={checkout.isPending || amount < 5}
          >
            {checkout.isPending ? "Redirecting…" : "Buy"}
          </Button>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => portal.mutate()} disabled={portal.isPending}>
            {portal.isPending ? "Redirecting…" : "Manage Payment Methods"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function UsageCard() {
  const { data: balance, isLoading } = useBillingBalance();

  if (isLoading) return <Skeleton className="h-36 w-full rounded-lg" />;
  if (!balance) return null;

  // Backend sums debits since the 1st of the current calendar month (UTC)
  const periodStart = balance.usage_period_start
    ? new Date(balance.usage_period_start)
    : new Date();
  const monthLabel = periodStart.toLocaleDateString("en-US", {
    month: "long", year: "numeric", timeZone: "UTC",
  });

  const { usage_this_month: u } = balance;
  const rows = [
    { label: "Compute", cents: u.cycles_cents },
    { label: "Provisioning", cents: u.provision_cents },
    { label: "Builds", cents: u.builds_cents },
    { label: "Logging", cents: u.logging_cents },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage — {monthLabel}</CardTitle>
        <CardDescription>
          Calendar month to date, since {formatDateUTC(periodStart.toISOString())} (UTC)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.label} className="flex justify-between text-sm">
              <span className="text-muted-foreground">{r.label}</span>
              <span>{formatCents(r.cents)}</span>
            </div>
          ))}
          <Separator />
          <div className="flex justify-between text-sm font-semibold">
            <span>Total</span>
            <span>{formatCents(u.total_cents)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AutoTopupCard() {
  const { data: balance } = useBillingBalance();
  const autoTopup = useAutoTopup();

  if (!balance) return null;

  const enabled = balance.auto_topup_enabled;
  const threshold = balance.auto_topup_threshold_cents ?? 1000;
  const topupAmount = balance.auto_topup_amount_cents ?? 1000;

  const thresholdOptions = [500, 1000, 2000, 5000]; // $5, $10, $20, $50
  const amountOptions = [1000, 2500, 5000, 10000]; // $10, $25, $50, $100

  return (
    <Card>
      <CardHeader>
        <CardTitle>Auto Top-Up</CardTitle>
        <CardDescription>
          Automatically add credits when your balance drops below a threshold
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-sm">
            {enabled ? (
              <span>
                Active — adds <strong>{formatCents(topupAmount)}</strong> when balance drops below{" "}
                <strong>{formatCents(threshold)}</strong>
              </span>
            ) : (
              <span className="text-muted-foreground">Disabled</span>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              autoTopup.mutate({
                enabled: !enabled,
                threshold_cents: threshold,
                amount_cents: topupAmount,
              })
            }
            disabled={autoTopup.isPending}
          >
            {enabled ? "Disable" : "Enable"}
          </Button>
        </div>

        {enabled && (
          <div className="space-y-4">
            <div className="space-y-2">
              <span className="text-sm text-muted-foreground">When balance drops below</span>
              <div className="flex gap-2 flex-wrap">
                {thresholdOptions.map((cents) => (
                  <Button
                    key={cents}
                    variant={threshold === cents ? "default" : "outline"}
                    size="sm"
                    onClick={() =>
                      autoTopup.mutate({
                        enabled: true,
                        threshold_cents: cents,
                        amount_cents: topupAmount,
                      })
                    }
                    disabled={autoTopup.isPending}
                  >
                    {formatCents(cents)}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <span className="text-sm text-muted-foreground">Top-up amount</span>
              <div className="flex gap-2 flex-wrap">
                {amountOptions.map((cents) => (
                  <Button
                    key={cents}
                    variant={topupAmount === cents ? "default" : "outline"}
                    size="sm"
                    onClick={() =>
                      autoTopup.mutate({
                        enabled: true,
                        threshold_cents: threshold,
                        amount_cents: cents,
                      })
                    }
                    disabled={autoTopup.isPending}
                  >
                    {formatCents(cents)}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Compute Costs by Canister ───────────────────────────────── */

type CostRange = "month" | "7d" | "30d" | "90d";

const COST_RANGES: { label: string; value: CostRange }[] = [
  { label: "This month", value: "month" },
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
  { label: "90d", value: "90d" },
];

function rangeToFrom(range: CostRange): string {
  const now = new Date();
  if (range === "month") {
    return isoNoMillis(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  }
  const days = { "7d": 7, "30d": 30, "90d": 90 }[range];
  return isoNoMillis(new Date(now.getTime() - days * 86400_000));
}

function CanisterCostsCard() {
  const [range, setRange] = useState<CostRange>("month");
  const from = useMemo(() => rangeToFrom(range), [range]);
  const { data, isLoading } = useCostsByCanister({ from });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Compute Costs by Canister</CardTitle>
        <CardDescription>
          Top-up spend per canister since {range === "month" ? formatDateUTC(from) : formatDate(from)}
        </CardDescription>
        <div className="flex gap-1 pt-1">
          {COST_RANGES.map((r) => (
            <Button
              key={r.value}
              variant={range === r.value ? "secondary" : "ghost"}
              size="sm"
              className="text-xs h-7"
              onClick={() => setRange(r.value)}
            >
              {r.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : !data || data.canisters.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No compute top-ups in this period.
          </p>
        ) : (
          <div className="space-y-2">
            {data.canisters.map((c) => (
              <div key={c.ic_canister_id} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground truncate">
                  {c.project_name && c.canister_name
                    ? `${c.project_name} / ${c.canister_name}`
                    : c.ic_canister_id}
                </span>
                <span className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-muted-foreground/60">
                    {c.topup_count} top-up{c.topup_count !== 1 && "s"}
                  </span>
                  <span>{formatCents(c.total_cents)}</span>
                </span>
              </div>
            ))}
            <Separator />
            <div className="flex justify-between text-sm font-semibold">
              <span>Total</span>
              <span>{formatCents(data.total_cents)}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Transaction History ─────────────────────────────────────── */

function transactionDescription(tx: ComputeTransaction): string {
  const text = tx.description ?? tx.source ?? tx.category ?? "—";
  const hiddenLegacyCreditSource = ["signup", "bonus"].join("_");
  const hiddenLegacyCreditPrefix = ["welcome", "bonus"].join(" ");
  if (tx.source === hiddenLegacyCreditSource || text.toLowerCase().startsWith(hiddenLegacyCreditPrefix)) {
    return "Account credit";
  }
  return text;
}

const TYPE_FILTERS: { label: string; value?: "credit" | "debit" }[] = [
  { label: "All", value: undefined },
  { label: "Credits", value: "credit" },
  { label: "Debits", value: "debit" },
];

const CATEGORY_FILTERS: { label: string; value?: string }[] = [
  { label: "All categories", value: undefined },
  { label: "Compute", value: "execution" },
  { label: "Provisioning", value: "provision" },
  { label: "Builds", value: "builds" },
  { label: "Logging", value: "logging" },
];

function TransactionsCard() {
  const [filters, setFilters] = useState<TransactionFilters>({});
  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useTransactions(filters);

  const transactions = data?.pages.flatMap((p) => p.transactions) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Transaction History</CardTitle>
        <div className="flex items-center gap-3 flex-wrap pt-1">
          <div className="flex gap-1">
            {TYPE_FILTERS.map((f) => (
              <Button
                key={f.label}
                variant={filters.type === f.value ? "secondary" : "ghost"}
                size="sm"
                className="text-xs h-7"
                onClick={() =>
                  setFilters((prev) => ({
                    type: f.value,
                    // category only applies to debits
                    category: f.value === "debit" ? prev.category : undefined,
                  }))
                }
              >
                {f.label}
              </Button>
            ))}
          </div>
          {filters.type === "debit" && (
            <>
              <Separator orientation="vertical" className="h-4" />
              <div className="flex gap-1 flex-wrap">
                {CATEGORY_FILTERS.map((f) => (
                  <Button
                    key={f.label}
                    variant={filters.category === f.value ? "secondary" : "ghost"}
                    size="sm"
                    className="text-xs h-7"
                    onClick={() =>
                      setFilters((prev) => ({ ...prev, category: f.value }))
                    }
                  >
                    {f.label}
                  </Button>
                ))}
              </div>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-2/3" />
          </div>
        ) : transactions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No transactions{filters.type || filters.category ? " match these filters" : " yet"}.
          </p>
        ) : (
          <div className="space-y-2">
            {transactions.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant={tx.type === "credit" ? "default" : "outline"} className="text-xs shrink-0">
                    {tx.type}
                  </Badge>
                  <span className="text-muted-foreground truncate">{transactionDescription(tx)}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={tx.type === "credit" ? "text-green-600" : "text-red-500"}>
                    {tx.type === "credit" ? "+" : "−"}{formatCents(tx.amount_cents)}
                  </span>
                  <span
                    className="text-xs text-muted-foreground w-24 text-right"
                    title={formatDateTime(tx.created_at)}
                  >
                    {formatDate(tx.created_at)}
                  </span>
                </div>
              </div>
            ))}

            {hasNextPage && (
              <div className="pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                >
                  {isFetchingNextPage && (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  )}
                  Load more
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Billing() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>

      <div className="grid gap-6 md:grid-cols-2">
        <BalanceCard />
        <UsageCard />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <CanisterCostsCard />
        <AutoTopupCard />
      </div>

      <TransactionsCard />
    </div>
  );
}
