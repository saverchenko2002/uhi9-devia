import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  fetchActors,
  fetchLiquidityDefaults,
  fetchState,
  initDemo,
  priceScaledToUsdtPerEth,
  seedLiquidity,
  setOraclePrice,
  usdtPerEthToScaled,
  type ActorId,
  type ActorOption,
  type DemoState,
  type PoolTarget,
} from "./api";
import { Badge, Button, Card, Field, Input, Metric, PlaceholderAction, Select } from "./components/ui";
import { formatTokenAmount, formatUsdtPrice, formatUsdtTvl, shortenAddress } from "./lib/format";
import type { PoolSnapshot } from "./api";

const PIPELINE = [
  { step: "01", label: "Fork & deploy", detail: "Mainnet @ fixed block" },
  { step: "02", label: "Seed liquidity", detail: "LP on hooked + plain" },
  { step: "03", label: "Public swaps", detail: "Fee split to actors" },
  { step: "04", label: "Keeper sync", detail: "executeWithIntent" },
  { step: "05", label: "Plain arb", detail: "Stale price → oracle" },
];

export default function App() {
  const [state, setState] = useState<DemoState | null>(null);
  const [actors, setActors] = useState<ActorOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState("3000");
  const [showTech, setShowTech] = useState(false);

  const [actorId, setActorId] = useState<ActorId>("lp");
  const [poolTarget, setPoolTarget] = useState<PoolTarget>("both");
  const [wethAmount, setWethAmount] = useState("100");
  const [usdtAmount, setUsdtAmount] = useState("300000");

  const refresh = useCallback(async () => {
    try {
      const [next, actorList] = await Promise.all([fetchState(), fetchActors()]);
      setActors(actorList);
      if (next) {
        setState(next);
        setPriceInput(String(priceScaledToUsdtPerEth(next.oraclePriceScaled)));
        setError(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    fetchLiquidityDefaults()
      .then((d) => {
        setWethAmount(d.wethAmount);
        setUsdtAmount(d.usdtAmount);
      })
      .catch(() => undefined);
  }, [refresh]);

  async function handleInit() {
    setLoading(true);
    setError(null);
    try {
      const next = await initDemo();
      setState(next);
      setPriceInput(String(priceScaledToUsdtPerEth(next.oraclePriceScaled)));
      const defaults = await fetchLiquidityDefaults();
      setWethAmount(defaults.wethAmount);
      setUsdtAmount(defaults.usdtAmount);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handlePriceApply() {
    setError(null);
    try {
      const scaled = usdtPerEthToScaled(Number(priceInput));
      const next = await setOraclePrice(scaled);
      setState(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleSeedLiquidity() {
    if (!state) return;
    setSeeding(true);
    setError(null);
    try {
      const next = await seedLiquidity({
        actorId,
        pool: poolTarget,
        wethAmount,
        usdtAmount,
      });
      setState(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSeeding(false);
    }
  }

  const ready = state?.anvilReady === true;
  const oracleDisplay = ready ? `$${formatUsdtPrice(state.oraclePriceScaled)}` : "—";
  const selectedActor = actors.find((a) => a.id === actorId);

  function poolHasLiquidity(pool?: PoolSnapshot): boolean {
    return !!pool && BigInt(pool.liquidity) > 0n;
  }

  function pipelineDone(stepIndex: number): boolean {
    if (!ready) return false;
    if (stepIndex === 0) return true;
    if (stepIndex === 1) return state.liquiditySeeded.hooked && state.liquiditySeeded.plain;
    return false;
  }

  function poolPriceDisplay(pool?: PoolSnapshot): string {
    if (!pool) return "—";
    if (!poolHasLiquidity(pool)) return "$0";
    return `$${formatUsdtPrice(pool.priceScaled)}`;
  }

  function PoolAssetsCard({
    title,
    badge,
    accent,
    pool,
  }: {
    title: string;
    badge: ReactNode;
    accent: "hooked" | "plain";
    pool?: PoolSnapshot;
  }) {
    return (
      <Card title={title} subtitle="On-chain slot0 + active liquidity" badge={badge} accent={accent}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Metric label="Pool price" value={poolPriceDisplay(pool)} hint="USDT per 1 WETH (0 until LP seeded)" />
          <Metric label="TVL" value={pool ? formatUsdtTvl(poolHasLiquidity(pool) ? pool.tvlUsdt : 0) : "—"} hint="WETH×price + USDT" />
          <Metric
            label="WETH in pool"
            value={pool ? formatTokenAmount(poolHasLiquidity(pool) ? pool.weth : 0) : "—"}
          />
          <Metric
            label="USDT in pool"
            value={pool ? formatTokenAmount(poolHasLiquidity(pool) ? pool.usdt : 0, 0) : "—"}
          />
        </div>
      </Card>
    );
  }

  return (
    <div className="relative mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge tone={ready ? "live" : "neutral"}>{ready ? "Environment live" : "Offline"}</Badge>
            <Badge tone="hooked">Hooked pool</Badge>
            <Badge tone="plain">Plain v4 pool</Badge>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            UHI9 Keeper Simulation
          </h1>
          <p className="mt-3 text-base leading-relaxed text-zinc-400">
            Interactive replay of the integration scenario: two pools on a mainnet fork, scripted
            actors, fee routing to LPs and keepers — no wallet extension required.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-3">
          <Button variant="secondary" onClick={refresh} disabled={loading || seeding}>
            Refresh state
          </Button>
          <Button variant="primary" onClick={handleInit} disabled={loading || seeding}>
            {loading && <span className="spinner" />}
            {loading ? "Bootstrapping…" : ready ? "Reset simulation" : "Launch simulation"}
          </Button>
        </div>
      </header>

      {error && (
        <div className="mb-6 rounded-xl border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      )}

      {!ready && !loading && (
        <div className="mb-8 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-8 text-center backdrop-blur-sm">
          <p className="text-lg font-medium text-zinc-200">Simulation not running</p>
          <p className="mx-auto mt-2 max-w-lg text-sm text-zinc-500">
            Launch spins up Anvil (mainnet fork), deploys the full keeper stack and both WETH/USDT
            pools. Takes ~30–60s depending on hook mining.
          </p>
          <div className="mt-6">
            <Button variant="primary" onClick={handleInit}>
              Launch simulation
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <Card title="Scenario pipeline" subtitle="Same flow as the comparison test">
            <ol className="space-y-3">
              {PIPELINE.map((item, i) => (
                <li key={item.step} className="flex gap-3">
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-xs font-semibold ${
                      pipelineDone(i)
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                        : "border-zinc-800 bg-zinc-950 text-zinc-500"
                    }`}
                  >
                    {item.step}
                  </span>
                  <div>
                    <div className="text-sm font-medium text-zinc-200">{item.label}</div>
                    <div className="text-xs text-zinc-600">{item.detail}</div>
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          <Card title="Reference price" subtitle="Oracle & USDT valuation">
            <Field label="ETH price (USDT)">
              <Input
                type="number"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                disabled={!ready}
              />
            </Field>
            <Button
              variant="secondary"
              className="mt-4 w-full"
              onClick={handlePriceApply}
              disabled={!ready}
            >
              Sync oracle via feed keeper
            </Button>
            <p className="mt-3 text-xs leading-relaxed text-zinc-600">
              Calls KeeperExecutor.executeFeedOnly as feed keeper (#5). Each update mines +1 block.
            </p>
          </Card>
        </aside>

        <main className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <Metric label="Fork block" value={ready ? String(state.blocks?.forkBlock ?? state.deployment.forkBlock) : "—"} />
            <Metric label="Current block" value={ready ? String(state.blocks?.currentBlock ?? "—") : "—"} />
            <Metric
              label="Feed sync block"
              value={ready && state.blocks?.feedSyncBlock != null ? String(state.blocks.feedSyncBlock) : "—"}
            />
            <Metric
              label="Pool sync block"
              value={ready && state.blocks?.poolSyncBlock != null ? String(state.blocks.poolSyncBlock) : "—"}
            />
            <Metric label="Reference ETH" value={oracleDisplay} hint="USDT per 1 WETH (on-chain Pyth)" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Metric
              label="Hooked pool"
              value={ready ? shortenAddress(state.deployment.addresses.dynamicFeeHook) : "—"}
              hint={ready && state.liquiditySeeded.hooked ? "Liquidity seeded" : "DynamicFee hook"}
            />
            <Metric
              label="Plain pool"
              value={ready ? shortenAddress(state.deployment.addresses.poolManager) : "—"}
              hint={ready && state.liquiditySeeded.plain ? "Liquidity seeded" : "v4 PoolManager"}
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <PoolAssetsCard
              title="Hooked pool"
              badge={<Badge tone="hooked">WETH / USDT</Badge>}
              accent="hooked"
              pool={state?.pools?.hooked}
            />
            <PoolAssetsCard
              title="Plain pool"
              badge={<Badge tone="plain">WETH / USDT</Badge>}
              accent="plain"
              pool={state?.pools?.plain}
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card
              title="Liquidity providers"
              subtitle="Full-range positions via PoolLiquidityRouter"
              badge={<Badge tone="lp">Step 02</Badge>}
              accent="lp"
            >
              <Field label="Signer (Anvil account)">
                <Select
                  value={actorId}
                  onChange={(e) => setActorId(e.target.value as ActorId)}
                  disabled={!ready || seeding}
                >
                  {actors.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label} — {shortenAddress(a.address)}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Target pool">
                <Select
                  value={poolTarget}
                  onChange={(e) => setPoolTarget(e.target.value as PoolTarget)}
                  disabled={!ready || seeding}
                  className="mt-2"
                >
                  <option value="hooked">Hooked pool (DynamicFee)</option>
                  <option value="plain">Plain pool (static fee)</option>
                  <option value="both">Both pools</option>
                </Select>
              </Field>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Field label="WETH amount">
                  <Input
                    type="number"
                    value={wethAmount}
                    onChange={(e) => setWethAmount(e.target.value)}
                    disabled={!ready || seeding}
                  />
                </Field>
                <Field label="USDT amount">
                  <Input
                    type="number"
                    value={usdtAmount}
                    onChange={(e) => setUsdtAmount(e.target.value)}
                    disabled={!ready || seeding}
                  />
                </Field>
              </div>

              <Button
                variant="primary"
                className="mt-4 w-full"
                onClick={handleSeedLiquidity}
                disabled={!ready || seeding}
              >
                {seeding && <span className="spinner" />}
                {seeding ? "Seeding liquidity…" : "Seed liquidity"}
              </Button>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Metric
                  label="Hooked LP"
                  value={ready && state.liquiditySeeded.hooked ? "Seeded" : "Empty"}
                />
                <Metric
                  label="Plain LP"
                  value={ready && state.liquiditySeeded.plain ? "Seeded" : "Empty"}
                />
              </div>

              {ready && selectedActor && (
                <p className="mt-3 text-xs text-zinc-600">
                  First seed mines +1 block and runs feed keeper (executeFeedOnly) before LP deposit.
                  Tokens go to {shortenAddress(selectedActor.address)} via Anvil, then full-range add.
                </p>
              )}
            </Card>

            <Card
              title="Public swappers"
              subtitle="Exact-in swaps; fees split LP / sync / feed treasury"
              badge={<Badge tone="swap">Actor 2</Badge>}
              accent="swap"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Amount in">
                  <Input placeholder="0.1 WETH or 300 USDT" disabled />
                </Field>
                <Field label="Direction">
                  <Input placeholder="zeroForOne" disabled />
                </Field>
              </div>
              <Button variant="secondary" disabled className="mt-4 w-full">
                Execute swap
              </Button>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Metric label="LP share" value="—" />
                <Metric label="Sync keeper" value="—" />
                <Metric label="Feed keeper" value="—" />
              </div>
            </Card>

            <Card
              title="Sync keeper"
              subtitle="executeWithIntent — pool donation + keeper payout"
              badge={<Badge tone="keeper">Actor 3</Badge>}
              accent="keeper"
            >
              <PlaceholderAction label="Perform upkeep when pool price lags oracle" />
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Metric label="Pool price after" value="—" />
                <Metric label="Donation" value="—" />
                <Metric label="Keeper payout" value="—" />
              </div>
            </Card>

            <Card
              title="Plain arbitrageur"
              subtitle="Manual sync on static-fee pool at reference price"
              badge={<Badge tone="plain">Actor 4</Badge>}
              accent="plain"
            >
              <PlaceholderAction label="Arbitrage stale plain pool → reference price" />
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Metric label="Arb profit" value="—" hint="USDT net of capital" />
                <Metric
                  label="Plain pool price"
                  value={poolPriceDisplay(state?.pools?.plain)}
                />
              </div>
            </Card>
          </div>

          {ready && (
            <Card title="Technical details" subtitle="Deployment manifest (for debugging)">
              <button
                type="button"
                onClick={() => setShowTech((v) => !v)}
                className="mb-3 text-sm text-cyan-400 hover:text-cyan-300"
              >
                {showTech ? "Hide addresses" : "Show addresses"}
              </button>
              {showTech && (
                <pre className="max-h-80 overflow-auto rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 font-mono text-xs leading-relaxed text-zinc-400">
                  {JSON.stringify(
                    {
                      deployment: state.deployment,
                      liquiditySeeded: state.liquiditySeeded,
                      lastLiquiditySeed: state.lastLiquiditySeed,
                    },
                    null,
                    2,
                  )}
                </pre>
              )}
            </Card>
          )}
        </main>
      </div>
    </div>
  );
}
