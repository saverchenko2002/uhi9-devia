import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  executeKeeperSync,
  executeSwap,
  fetchActors,
  fetchLiquidityDefaults,
  fetchState,
  initDemo,
  previewKeeperSync,
  previewSwapFees,
  priceScaledToUsdtPerEth,
  seedLiquidity,
  setOraclePrice,
  usdtPerEthToScaled,
  type ActorId,
  type ActorOption,
  type DemoState,
  type PoolTarget,
  type FeeSplitPreview,
  type SwapFeePreview,
  type SyncDirection,
  type SyncKeeperPreview,
  type SyncLegPreview,
} from "./api";
import { Badge, Button, Card, Field, Input, Metric, PlaceholderAction, Select } from "./components/ui";
import { formatFeeToken, formatFeeUsdt, formatTokenAmount, formatUsdtPrice, formatUsdtTvl, feePipsToPercent, shortenAddress } from "./lib/format";
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
  const [swapping, setSwapping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState("3000");
  const [showTech, setShowTech] = useState(false);

  const [actorId, setActorId] = useState<ActorId>("lp");
  const [poolTarget, setPoolTarget] = useState<PoolTarget>("both");
  const [wethAmount, setWethAmount] = useState("100");
  const [usdtAmount, setUsdtAmount] = useState("300000");

  const [swapActorId] = useState<ActorId>("swapper");
  const [swapPoolTarget, setSwapPoolTarget] = useState<PoolTarget>("both");
  const [swapZeroForOne, setSwapZeroForOne] = useState(true);
  const [swapAmount, setSwapAmount] = useState("0.1");
  const [swapPreview, setSwapPreview] = useState<SwapFeePreview | null>(null);
  const [syncPreview, setSyncPreview] = useState<SyncKeeperPreview | null>(null);
  const [syncing, setSyncing] = useState(false);
  const swapPreviewRequestId = useRef(0);
  const syncPreviewRequestId = useRef(0);

  const ready = state?.anvilReady === true;

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

  useEffect(() => {
    setSwapPreview(null);
  }, [swapZeroForOne, swapPoolTarget]);

  useEffect(() => {
    if (!ready || !state?.liquiditySeeded.hooked) {
      setSyncPreview(null);
      return;
    }

    const requestId = ++syncPreviewRequestId.current;
    const timer = setTimeout(() => {
      previewKeeperSync()
        .then((preview) => {
          if (requestId === syncPreviewRequestId.current) setSyncPreview(preview);
        })
        .catch(() => {
          if (requestId === syncPreviewRequestId.current) setSyncPreview(null);
        });
    }, 300);

    return () => clearTimeout(timer);
  }, [
    ready,
    state?.liquiditySeeded.hooked,
    state?.oraclePriceScaled,
    state?.pools?.hooked?.priceScaled,
    state?.lastSwap,
    state?.lastPoolSync,
  ]);

  useEffect(() => {
    if (!ready || !state) {
      setSwapPreview(null);
      return;
    }
    const seeded =
      (swapPoolTarget === "plain" && state.liquiditySeeded.plain) ||
      (swapPoolTarget === "hooked" && state.liquiditySeeded.hooked) ||
      (swapPoolTarget === "both" && state.liquiditySeeded.hooked && state.liquiditySeeded.plain);

    const trimmed = swapAmount.trim();
    const parsed = trimmed && !trimmed.endsWith(".") ? Number(trimmed) : NaN;
    if (!seeded || !Number.isFinite(parsed) || parsed <= 0) {
      setSwapPreview(null);
      return;
    }

    const requestId = ++swapPreviewRequestId.current;
    const timer = setTimeout(() => {
      previewSwapFees({ pool: swapPoolTarget, zeroForOne: swapZeroForOne, amountIn: trimmed })
        .then((preview) => {
          if (requestId === swapPreviewRequestId.current) setSwapPreview(preview);
        })
        .catch(() => {
          if (requestId === swapPreviewRequestId.current) setSwapPreview(null);
        });
    }, 350);

    return () => clearTimeout(timer);
  }, [
    ready,
    state,
    swapPoolTarget,
    swapZeroForOne,
    swapAmount,
    state?.blocks?.poolSyncBlock,
    state?.blocks?.currentBlock,
    state?.lastPoolSync,
    state?.syncKeeperStatus?.isActive,
    state?.syncKeeperStatus?.blocksUntilExpiry,
  ]);

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

  async function handleExecuteKeeperSync() {
    if (!state) return;
    setSyncing(true);
    setError(null);
    try {
      const next = await executeKeeperSync();
      setState(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }

  async function handleExecuteSwap() {
    if (!state) return;
    setSwapping(true);
    setError(null);
    try {
      const next = await executeSwap({
        actorId: swapActorId,
        pool: swapPoolTarget,
        zeroForOne: swapZeroForOne,
        amountIn: swapAmount,
      });
      setState(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSwapping(false);
    }
  }

  const oracleDisplay = ready ? `$${formatUsdtPrice(state.oraclePriceScaled)}` : "—";
  const selectedActor = actors.find((a) => a.id === actorId);

  function poolHasLiquidity(pool?: PoolSnapshot): boolean {
    return !!pool && BigInt(pool.liquidity) > 0n;
  }

  function pipelineDone(stepIndex: number): boolean {
    if (!ready) return false;
    if (stepIndex === 0) return true;
    if (stepIndex === 1) return state.liquiditySeeded.hooked && state.liquiditySeeded.plain;
    if (stepIndex === 2) return (state.lastSwap?.length ?? 0) > 0;
    if (stepIndex === 3) return state.lastPoolSync != null;
    return false;
  }

  function rawToHuman(raw: string, token: "WETH" | "USDT"): number {
    return token === "WETH" ? Number(raw) / 1e18 : Number(raw) / 1e6;
  }

  function formatSyncLeg(leg: SyncLegPreview | undefined): string {
    if (!leg) return "—";
    const amountIn = formatTokenAmount(rawToHuman(leg.amountInRaw, leg.tokenIn));
    const amountOut = formatTokenAmount(rawToHuman(leg.amountOutRaw, leg.tokenOut));
    return `${amountIn} ${leg.tokenIn} → ${amountOut} ${leg.tokenOut}`;
  }

  function formatSyncToken(raw: string | undefined, token: "WETH" | "USDT"): string {
    if (!raw) return "—";
    return formatFeeToken(raw, token);
  }

  function formatSyncUsdt(raw: string | undefined): string {
    return formatSyncToken(raw, "USDT");
  }

  function formatKeeperFeePips(feePips: number): string {
    return `${((feePips / 1_000_000) * 100).toFixed(3)}%`;
  }

  function syncLegHint(direction: SyncDirection | undefined, leg: "pool" | "outer"): string {
    if (!direction) return "";
    if (leg === "pool") {
      return direction === "poolBelowOracle"
        ? "Pool cheaper than oracle — buy WETH in pool (on-chain leg 1)"
        : "Pool richer than oracle — sell WETH in pool (on-chain leg 1)";
    }
    return direction === "poolBelowOracle"
      ? "Sell WETH @ oracle price (on-chain leg 2)"
      : "Buy WETH @ oracle with pool USDT (on-chain leg 2)";
  }

  function previewMatchesInput(preview: SwapFeePreview | null): preview is SwapFeePreview {
    if (!preview) return false;
    return preview.zeroForOne === swapZeroForOne && preview.amountIn === swapAmount.trim();
  }

  function formatAmountOut(
    preview: SwapFeePreview | null,
    pool: "plain" | "hooked",
  ): string {
    if (!previewMatchesInput(preview)) return "—";
    const out = pool === "plain" ? preview.plainAmountOut : preview.hookedAmountOut;
    if (!out) return "—";
    const outputToken = swapZeroForOne ? "USDT" : "WETH";
    return `${formatTokenAmount(out.amountOut, outputToken === "WETH" ? 6 : 2)} ${outputToken}`;
  }

  const swapOutputToken = swapZeroForOne ? "USDT" : "WETH";

  function formatSwapFeeLine(
    preview: SwapFeePreview | null,
    fee: FeeSplitPreview | null | undefined,
  ): string {
    if (!previewMatchesInput(preview) || !fee) return "—";
    return `${formatFeeToken(fee.totalFeeRaw, fee.feeToken)} (${formatFeeUsdt(fee.totalFeeUsdt)})`;
  }

  function formatHookedDecomposition(
    preview: SwapFeePreview | null,
    fee: FeeSplitPreview | null | undefined,
  ): string {
    if (!previewMatchesInput(preview) || !fee) return "—";
    const token = fee.feeToken;
    const syncPart = fee.syncKeeperActive
      ? `${formatFeeToken(fee.syncShareRaw, token)} sync`
      : "0 sync";
    return `${formatFeeToken(fee.lpShareRaw, token)} LP · ${syncPart} · ${formatFeeToken(fee.feedShareRaw, token)} feed`;
  }

  function formatSyncWindowHint(
    fee: FeeSplitPreview | undefined,
    _currentBlock: number | undefined,
  ): string {
    if (!fee) return "";
    const feed = fee.feedKeeperActive ? "feed active" : "feed → LP";
    const pct = `${fee.syncShareBps / 100}%`;

    if (fee.syncKeeperActive) {
      const left = fee.syncBlocksUntilExpiry;
      const end = fee.syncWindowEndBlock;
      const leftNote =
        left === 0
          ? " (last block in window)"
          : left != null && left > 0
            ? ` (${left} block${left === 1 ? "" : "s"} left after this swap)`
            : "";
      return `sync keeper earns ${pct} · window through block ${end}${leftNote} · ${feed}`;
    }

    if (fee.syncKeeperRegistered) {
      const last = fee.lastSyncBlock;
      const end = fee.syncWindowEndBlock;
      return `sync window expired for this swap (sync block ${last ?? "?"}, ended ${end ?? "?"}) · ${pct} → LP · ${feed}`;
    }

    return `no keeper sync yet · ${pct} sync share → LP · ${feed}`;
  }

  const accumulated = state?.accumulatedFees ?? {
    plain: { totalFeeUsdt: 0, lpShareUsdt: 0, syncShareUsdt: 0, feedShareUsdt: 0, swapCount: 0 },
    hooked: { totalFeeUsdt: 0, lpShareUsdt: 0, syncShareUsdt: 0, feedShareUsdt: 0, swapCount: 0 },
  };

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
            Devia IL Simulation
          </h1>
          <p className="mt-3 text-base leading-relaxed text-zinc-400">
            Compare hooked vs plain WETH/USDT pools on a mainnet fork — dynamic fees and keeper
            sync pull price toward the oracle and reduce LP impermanent loss.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-3">
          <Button variant="secondary" onClick={refresh} disabled={loading || seeding || swapping}>
            Refresh state
          </Button>
          <Button variant="primary" onClick={handleInit} disabled={loading || seeding || swapping}>
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
              badge={<Badge tone="swap">Step 03</Badge>}
              accent="swap"
            >
              <Field label="Target pool">
                <Select
                  value={swapPoolTarget}
                  onChange={(e) => setSwapPoolTarget(e.target.value as PoolTarget)}
                  disabled={!ready || swapping}
                >
                  <option value="hooked">Hooked pool (DynamicFee)</option>
                  <option value="plain">Plain pool (static fee)</option>
                  <option value="both">Both pools</option>
                </Select>
              </Field>

              <Field label="Direction (zeroForOne)">
                <Select
                  value={swapZeroForOne ? "true" : "false"}
                  onChange={(e) => {
                    const z = e.target.value === "true";
                    setSwapZeroForOne(z);
                    setSwapAmount(z ? "0.1" : "300");
                  }}
                  disabled={!ready || swapping}
                >
                  <option value="true">WETH → USDT (true)</option>
                  <option value="false">USDT → WETH (false)</option>
                </Select>
              </Field>

              <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-stretch">
                <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 px-4 py-3">
                  <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
                    Amount in
                  </div>
                  <div className="mt-2 flex items-end gap-2">
                    <Input
                      type="number"
                      value={swapAmount}
                      onChange={(e) => setSwapAmount(e.target.value)}
                      disabled={!ready || swapping}
                      placeholder={swapZeroForOne ? "0.1" : "300"}
                      className="border-0 bg-transparent px-0 py-0 text-2xl font-mono text-zinc-50 shadow-none focus:ring-0"
                    />
                    <span className="pb-1 text-sm font-medium text-zinc-500">
                      {swapZeroForOne ? "WETH" : "USDT"}
                    </span>
                  </div>
                </div>

                <div className="hidden items-center justify-center text-xl text-zinc-600 lg:flex">→</div>

                <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-3">
                  <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-cyan-600/80">
                    Amount out · estimate ({swapOutputToken})
                  </div>
                  <div className="mt-2 space-y-2">
                    {(swapPoolTarget === "plain" || swapPoolTarget === "both") && (
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-xs text-zinc-500">Plain</span>
                        <span className="font-mono text-lg text-zinc-100">
                          {formatAmountOut(swapPreview, "plain")}
                        </span>
                      </div>
                    )}
                    {(swapPoolTarget === "hooked" || swapPoolTarget === "both") && (
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-xs text-zinc-500">Hooked</span>
                        <span className="font-mono text-lg text-zinc-100">
                          {formatAmountOut(swapPreview, "hooked")}
                        </span>
                      </div>
                    )}
                    {swapPoolTarget !== "both" && !previewMatchesInput(swapPreview) && (
                      <div className="font-mono text-lg text-zinc-600">—</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-4">
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  This swap — fees in input token
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(swapPoolTarget === "plain" || swapPoolTarget === "both") && (
                    <Metric
                      label="Swap fee · plain"
                      value={formatSwapFeeLine(swapPreview, swapPreview?.plain)}
                      hint={
                        previewMatchesInput(swapPreview)
                          ? `${feePipsToPercent(swapPreview.plain?.feeBps ?? 10_066)} static · 100% LP`
                          : undefined
                      }
                    />
                  )}
                  {(swapPoolTarget === "hooked" || swapPoolTarget === "both") && (
                    <>
                      <Metric
                        label="Swap fee · hooked"
                        value={formatSwapFeeLine(swapPreview, swapPreview?.hooked)}
                        hint={
                          previewMatchesInput(swapPreview)
                            ? `${feePipsToPercent(swapPreview.hooked?.feeBps ?? 10_066)} dynamic (base ~1%, min ~0.5%, max ~3%)`
                            : undefined
                        }
                      />
                      <div className="sm:col-span-2">
                        <Metric
                          label="Hooked fee split"
                          value={formatHookedDecomposition(swapPreview, swapPreview?.hooked)}
                          hint={
                            previewMatchesInput(swapPreview) && swapPreview.hooked
                              ? formatSyncWindowHint(
                                  swapPreview.hooked,
                                  state?.blocks?.currentBlock,
                                )
                              : undefined
                          }
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-4">
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Accumulated fees (all swaps)
                </p>
                <Metric
                  label="Comparison"
                  value={`Plain ${formatFeeUsdt(accumulated.plain.totalFeeUsdt)} · Hooked ${formatFeeUsdt(accumulated.hooked.totalFeeUsdt)}`}
                  hint={`Plain ${accumulated.plain.swapCount} swap(s) · Hooked ${accumulated.hooked.swapCount} swap(s) · USDT equiv.`}
                />
              </div>

              <Button
                variant="primary"
                className="mt-4 w-full"
                onClick={handleExecuteSwap}
                disabled={!ready || swapping || !previewMatchesInput(swapPreview)}
              >
                {swapping && <span className="spinner" />}
                {swapping ? "Executing swap…" : "Execute swap (+1 block)"}
              </Button>

              {ready && (state.lastSwap?.length ?? 0) > 0 && (
                <p className="mt-3 text-xs text-zinc-600">
                  Last swap: {state.lastSwap!.length} pool(s) · signer swapper (#2). Pool prices update above.
                </p>
              )}
            </Card>

            <Card
              title="Sync keeper"
              subtitle="executeWithIntent — sync hooked pool to oracle"
              badge={<Badge tone="keeper">Step 04</Badge>}
              accent="keeper"
            >
              <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-4">
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Leg 1 · pool swap (hooked pool → target)
                </p>
                <Metric
                  label="Amount in → out"
                  value={formatSyncLeg(syncPreview?.poolSwap)}
                  hint={
                    syncPreview
                      ? `${syncLegHint(syncPreview.direction, "pool")} · deviation ${(syncPreview.poolDeviationBps / 100).toFixed(2)}% · target $${formatUsdtPrice(syncPreview.targetPriceScaled)}`
                      : "Seed hooked LP and set oracle away from pool price"
                  }
                />
                {syncPreview?.keeperSwapFee && (
                  <div className="mt-3">
                    <Metric
                      label="Keeper sync fee (min fee on leg 1 input)"
                      value={formatSyncToken(
                        syncPreview.keeperSwapFee.amountRaw,
                        syncPreview.keeperSwapFee.token,
                      )}
                      hint={`${formatKeeperFeePips(syncPreview.keeperSwapFee.feePips)} of ${syncPreview.keeperSwapFee.token} in`}
                    />
                  </div>
                )}
              </div>

              <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-amber-600/80">
                  Leg 2 · outer arb (@ oracle)
                </p>
                <Metric
                  label="Amount in → out"
                  value={formatSyncLeg(syncPreview?.outerArb)}
                  hint={
                    syncPreview
                      ? `${syncLegHint(syncPreview.direction, "outer")} · uses leg 1 output (after fee)`
                      : undefined
                  }
                />
              </div>

              <div className="mt-4 rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-4">
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Distribution (estimate)
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Metric
                    label="Capital returned to keeper"
                    value={formatSyncToken(
                      syncPreview?.distribution.capitalReturnedRaw,
                      syncPreview?.capitalToken ?? "USDT",
                    )}
                    hint={
                      syncPreview
                        ? `${syncPreview.capitalToken} committed in leg 1`
                        : undefined
                    }
                  />
                  <Metric
                    label="Keeper profit"
                    value={formatSyncUsdt(syncPreview?.distribution.keeperProfitRaw)}
                    hint={
                      syncPreview
                        ? `≈ ${(syncPreview.distribution.minDonateBps / 100).toFixed(0)}% of arb profit to keeper · ${formatSyncUsdt(syncPreview.distribution.expectedProfitRaw)} gross`
                        : undefined
                    }
                  />
                  <div className="sm:col-span-2">
                    <Metric
                      label="Donation to pool"
                      value={formatSyncUsdt(syncPreview?.distribution.donationRaw)}
                      hint={
                        syncPreview
                          ? `Min ${(syncPreview.distribution.minDonateBps / 100).toFixed(0)}% of arb profit — equals keeper share at 50%`
                          : "Min donate bps of arb profit"
                      }
                    />
                  </div>
                </div>
              </div>

              {syncPreview && !syncPreview.canExecute && syncPreview.reason && (
                <p className="mt-3 text-xs text-amber-400/90">{syncPreview.reason}</p>
              )}

              <Button
                variant="primary"
                className="mt-4 w-full"
                onClick={handleExecuteKeeperSync}
                disabled={!ready || syncing || !syncPreview?.canExecute}
              >
                {syncing && <span className="spinner" />}
                {syncing ? "Executing sync…" : "Execute keeper sync (+1 block)"}
              </Button>

              {ready && state.lastPoolSync && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Metric
                    label="Last sync · donation"
                    value={formatSyncUsdt(state.lastPoolSync.donationAmount)}
                  />
                  <Metric
                    label="Last sync · keeper payout"
                    value={formatSyncUsdt(state.lastPoolSync.keeperPayout)}
                  />
                  {state.syncKeeperStatus?.registered && (
                    <div className="sm:col-span-2">
                      <Metric
                        label="Sync keeper fee window"
                        value={
                          state.syncKeeperStatus.isActive
                            ? `Active · ${state.syncKeeperStatus.blocksUntilExpiry ?? "?"} block(s) left`
                            : `Expired (sync block ${state.syncKeeperStatus.lastSyncBlock})`
                        }
                        hint={
                          state.syncKeeperStatus.isActive
                            ? `Hooked swaps in the next ${state.syncKeeperStatus.blocksUntilExpiry ?? 5} block(s) pay 15% of fees to sync keeper`
                            : "15% sync fee share now goes to LP — swap within 5 blocks after sync to earn it"
                        }
                      />
                    </div>
                  )}
                </div>
              )}
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
