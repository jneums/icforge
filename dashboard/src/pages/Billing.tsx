import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useBillingBalance, useTransactions, useCheckout, useBillingPortal, useAutoTopup } from "@/hooks/use-billing";
import type { ComputeTransaction } from "@/api";

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
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

        <div className="flex items-center gap-2">
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

  const { usage_this_month: u } = balance;
  const rows = [
    { label: "Cycles", cents: u.cycles_cents },
    { label: "Provisioning", cents: u.provision_cents },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage This Month</CardTitle>
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
  const threshold = balance.auto_topup_threshold_cents ?? 200;
  const topupAmount = balance.auto_topup_amount_cents ?? 1000;

  const amountOptions = [1000, 2500, 5000, 10000]; // $10, $25, $50, $100

  return (
    <Card>
      <CardHeader>
        <CardTitle>Auto Top-Up</CardTitle>
        <CardDescription>
          Automatically add credits when your balance drops below {formatCents(threshold)}
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
          <div className="space-y-2">
            <span className="text-sm text-muted-foreground">Top-up amount</span>
            <div className="flex gap-2">
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
        )}
      </CardContent>
    </Card>
  );
}

function CanisterCostsCard() {
  const { data: transactions, isLoading } = useTransactions();

  if (isLoading) return <Skeleton className="h-36 w-full rounded-lg" />;
  if (!transactions || transactions.length === 0) return null;

  // Extract canister costs from debit transactions that have "top-up" or "cycles" in description
  const canisterCosts = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.type !== "debit") continue;
    const desc = tx.description ?? "";
    // Match "Manual top-up <name> (<canister_id>)" or "Auto top-up <name> (<canister_id>)"
    const match = desc.match(/top-up\s+(\S+)\s+\(/i);
    if (match) {
      const name = match[1];
      canisterCosts.set(name, (canisterCosts.get(name) ?? 0) + tx.amount_cents);
    }
  }

  if (canisterCosts.size === 0) return null;

  const entries = Array.from(canisterCosts.entries()).sort((a, b) => b[1] - a[1]);
  const totalCanisterCents = entries.reduce((sum, [, c]) => sum + c, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Compute Costs by Canister</CardTitle>
        <CardDescription>Compute costs per canister</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {entries.map(([name, cents]) => (
            <div key={name} className="flex justify-between text-sm">
              <span className="font-mono text-muted-foreground">{name}</span>
              <span>{formatCents(cents)}</span>
            </div>
          ))}
          <Separator />
          <div className="flex justify-between text-sm font-semibold">
            <span>Total Compute</span>
            <span>{formatCents(totalCanisterCents)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TransactionsCard() {
  const { data: transactions, isLoading } = useTransactions();

  if (isLoading) return <Skeleton className="h-48 w-full rounded-lg" />;
  if (!transactions || transactions.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Transaction History</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No transactions yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle>Transaction History</CardTitle></CardHeader>
      <CardContent>
        <div className="space-y-2">
          {transactions.slice(0, 20).map((tx: ComputeTransaction) => (
            <div key={tx.id} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Badge variant={tx.type === "credit" ? "default" : "outline"} className="text-xs">
                  {tx.type}
                </Badge>
                <span className="text-muted-foreground">{tx.description ?? tx.source ?? tx.category ?? "—"}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className={tx.type === "credit" ? "text-green-600" : "text-red-500"}>
                  {tx.type === "credit" ? "+" : "−"}{formatCents(tx.amount_cents)}
                </span>
                <span className="text-xs text-muted-foreground w-24 text-right">
                  {formatDate(tx.created_at)}
                </span>
              </div>
            </div>
          ))}
        </div>
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

      <AutoTopupCard />
      <CanisterCostsCard />
      <TransactionsCard />
    </div>
  );
}
