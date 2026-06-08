import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  collectReport,
  executeKeeperSync,
  executePlainArb,
  executeSwap,
  fetchActors,
  fetchLiquidityDefaults,
  fetchState,
  initDemo,
  previewKeeperSync,
  previewPlainArb,
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
  type ComparisonReport,
  type DistributionFlow,
  type LpComparisonSummary,
  type PlainArbPreview,
  type ProfitBreakdownUsdt,
  type SwapFeePreview,
  type SyncDirection,
  type SyncKeeperPreview,
  type SyncLegPreview,
} from "./api";
import { Badge, Button, Card, Field, Input, Metric, Select } from "./components/ui";
import { formatFeeToken, formatFeeUsdt, formatTokenAmount, formatUsdtPrice, formatUsdtTvl, feePipsToPercent, shortenAddress } from "./lib/format";
import type { PoolSnapshot } from "./api";

const PIPELINE = [
  { step: "01", label: "Fork & deploy", detail: "Mainnet @ fixed block" },
  { step: "02", label: "Seed liquidity", detail: "LP on hooked + plain" },
  { step: "03", label: "Public swaps", detail: "Fee split to actors" },
  { step: "04", label: "Keeper sync", detail: "executeWithIntent" },
  { step: "05", label: "Plain arb", detail: "Stale price → oracle" },
  { step: "06", label: "Collect report", detail: "IL & distribution" },
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
  const [plainArbPreview, setPlainArbPreview] = useState<PlainArbPreview | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [plainArbing, setPlainArbing] = useState(false);
  const [collectingReport, setCollectingReport] = useState(false);
  const swapPreviewRequestId = useRef(0);
  const syncPreviewRequestId = useRef(0);
  const plainArbPreviewRequestId = useRef(0);

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
    if (!ready || !state?.liquiditySeeded.plain) {
      setPlainArbPreview(null);
      return;
    }

    const requestId = ++plainArbPreviewRequestId.current;
    const timer = setTimeout(() => {
      previewPlainArb()
        .then((preview) => {
          if (requestId === plainArbPreviewRequestId.current) setPlainArbPreview(preview);
        })
        .catch(() => {
          if (requestId === plainArbPreviewRequestId.current) setPlainArbPreview(null);
        });
    }, 300);

    return () => clearTimeout(timer);
  }, [
    ready,
    state?.liquiditySeeded.plain,
    state?.oraclePriceScaled,
    state?.pools?.plain?.priceScaled,
    state?.lastSwap,
    state?.lastPoolSync,
    state?.lastPlainArb,
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

  async function handleExecutePlainArb() {
    if (!state) return;
    setPlainArbing(true);
    setError(null);
    try {
      const next = await executePlainArb();
      setState(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlainArbing(false);
    }
  }

  async function handleCollectReport() {
    if (!state) return;
    setCollectingReport(true);
    setError(null);
    try {
      const next = await collectReport();
      setState(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCollectingReport(false);
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
    if (stepIndex === 4) return state.lastPlainArb != null;
    if (stepIndex === 5) return state?.lastReport != null;
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

  function formatIlUsdt(value: number): string {
    if (!Number.isFinite(value)) return "—";
    const prefix = value > 0 ? "+" : "";
    if (Math.abs(value) >= 1000) {
      return `${prefix}${formatUsdtTvl(value)}`;
    }
    return `${prefix}${formatFeeUsdt(value)}`;
  }

  function flowToneClass(tone: DistributionFlow["tone"]): string {
    switch (tone) {
      case "lp":
        return "bg-cyan-500/80";
      case "pool":
        return "bg-emerald-500/80";
      case "sync":
        return "bg-violet-500/80";
      case "feed":
        return "bg-amber-500/80";
      case "arb":
        return "bg-orange-500/80";
      default:
        return "bg-zinc-500/80";
    }
  }

  function DistributionFlowChart({
    title,
    subtitle,
    flows,
  }: {
    title: string;
    subtitle: string;
    flows: DistributionFlow[];
  }) {
    const total = flows.reduce((sum, f) => sum + f.amountUsdt, 0);
    if (total <= 0) return null;

    return (
      <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{title}</p>
        <p className="mb-4 mt-1 text-sm text-zinc-400">{subtitle}</p>
        <div className="mb-4 flex h-3 overflow-hidden rounded-full bg-zinc-900">
          {flows.map((flow) => (
            <div
              key={flow.label}
              className={`${flowToneClass(flow.tone)} h-full transition-all`}
              style={{ width: `${(flow.amountUsdt / total) * 100}%` }}
              title={`${flow.label}: ${formatFeeUsdt(flow.amountUsdt)}`}
            />
          ))}
        </div>
        <div className="space-y-2">
          {flows.map((flow) => (
            <div key={flow.label} className="flex items-center justify-between gap-3 text-sm">
              <div className="flex min-w-0 items-center gap-2">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${flowToneClass(flow.tone)}`} />
                <span className="truncate text-zinc-400">{flow.label}</span>
              </div>
              <span className="shrink-0 font-mono text-zinc-200">{formatFeeUsdt(flow.amountUsdt)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function lpComparison(report: ComparisonReport): LpComparisonSummary {
    if (report.lpComparison) return report.lpComparison;
    return {
      depositUsdt: report.plain.initialLp.valueUsdt,
      plainExtractedUsdt: report.plain.extractedLp.valueUsdt,
      hookedExtractedUsdt: report.hooked.extractedLp.valueUsdt,
      plainNetUsdt: report.plain.ilUsdt,
      hookedNetUsdt: report.hooked.ilUsdt,
      hookedAdvantageUsdt: report.hooked.ilUsdt - report.plain.ilUsdt,
    };
  }

  function IlComparisonCharts({ report }: { report: ComparisonReport }) {
    const cmp = lpComparison(report);
    const deposit = cmp.depositUsdt;
    const chartMax = Math.max(
      deposit,
      cmp.plainExtractedUsdt,
      cmp.hookedExtractedUsdt,
      1,
    );
    const barHeight = (value: number) =>
      `${Math.max(2, (value / chartMax) * 100)}%`;

    const netMax = Math.max(
      Math.abs(cmp.plainNetUsdt),
      Math.abs(cmp.hookedNetUsdt),
      1,
    );
    const netBarWidth = (value: number) =>
      `${Math.max(2, (Math.abs(value) / netMax) * 100)}%`;

    const hookedBetter = cmp.hookedAdvantageUsdt > 0.001;
    const sameOutcome = Math.abs(cmp.hookedAdvantageUsdt) <= 0.001;

    return (
      <div className="space-y-5 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-cyan-400/90">
            LP outcome comparison
          </p>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            Deposit per pool:{" "}
            <span className="font-mono text-zinc-200">{formatFeeUsdt(deposit)}</span>
            {" "}({formatTokenAmount(report.plain.initialLp.weth)} WETH +{" "}
            {formatTokenAmount(report.plain.initialLp.usdt)} USDT @ oracle).{" "}
            <strong className="font-normal text-zinc-300">LP net</strong> = liquidity
            extracted − deposit — not classical IL alone; it includes swap fees, sync
            donation (hooked), and value taken by arbers.
          </p>
        </div>

        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            hookedBetter
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
              : sameOutcome
                ? "border-zinc-700 bg-zinc-900/60 text-zinc-300"
                : "border-amber-500/30 bg-amber-500/10 text-amber-100"
          }`}
        >
          {sameOutcome ? (
            <span>Plain and hooked LPs ended with the same net outcome.</span>
          ) : hookedBetter ? (
            <span>
              Hooked LPs retained{" "}
              <span className="font-mono font-semibold">
                {formatFeeUsdt(cmp.hookedAdvantageUsdt)}
              </span>{" "}
              more than plain — mainly from sync donation (
              {formatFeeUsdt(report.actors.poolDonationUsdt)}) returning arb profit to
              the pool.
            </span>
          ) : (
            <span>
              Plain LPs did better by{" "}
              <span className="font-mono font-semibold">
                {formatFeeUsdt(-cmp.hookedAdvantageUsdt)}
              </span>{" "}
              in this run (unusual — check pool sizing / deviation).
            </span>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <p className="mb-4 text-xs font-medium uppercase tracking-wide text-zinc-500">
              Deposit vs liquidity extracted
            </p>
            <div className="flex items-end justify-center gap-8 px-2" style={{ height: 180 }}>
              <div className="flex flex-col items-center gap-2">
                <div className="flex h-40 w-20 items-end justify-center gap-1">
                  <div
                    className="w-8 rounded-t bg-amber-500/40"
                    style={{ height: barHeight(deposit) }}
                    title={`Deposit ${formatFeeUsdt(deposit)}`}
                  />
                  <div
                    className="w-8 rounded-t bg-amber-400"
                    style={{ height: barHeight(cmp.plainExtractedUsdt) }}
                    title={`Extracted ${formatFeeUsdt(cmp.plainExtractedUsdt)}`}
                  />
                </div>
                <span className="text-xs text-amber-400/90">Plain</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <div className="flex h-40 w-20 items-end justify-center gap-1">
                  <div
                    className="w-8 rounded-t bg-violet-500/40"
                    style={{ height: barHeight(deposit) }}
                    title={`Deposit ${formatFeeUsdt(deposit)}`}
                  />
                  <div
                    className="w-8 rounded-t bg-violet-400"
                    style={{ height: barHeight(cmp.hookedExtractedUsdt) }}
                    title={`Extracted ${formatFeeUsdt(cmp.hookedExtractedUsdt)}`}
                  />
                </div>
                <span className="text-xs text-violet-400">Hooked</span>
              </div>
            </div>
            <div className="mt-3 flex justify-center gap-6 text-xs text-zinc-500">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-zinc-500/40" /> deposit
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-cyan-400" /> extracted
              </span>
            </div>
          </div>

          <div>
            <p className="mb-4 text-xs font-medium uppercase tracking-wide text-zinc-500">
              LP net outcome (extracted − deposit)
            </p>
            <div className="space-y-4 pt-4">
              <div>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-amber-400/90">Plain</span>
                  <span className="font-mono text-zinc-300">{formatIlUsdt(cmp.plainNetUsdt)}</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-zinc-900">
                  <div
                    className="h-full rounded-full bg-amber-500/80"
                    style={{ width: netBarWidth(cmp.plainNetUsdt) }}
                  />
                </div>
              </div>
              <div>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-violet-400">Hooked</span>
                  <span className="font-mono text-zinc-300">{formatIlUsdt(cmp.hookedNetUsdt)}</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-zinc-900">
                  <div
                    className="h-full rounded-full bg-violet-500/80"
                    style={{ width: netBarWidth(cmp.hookedNetUsdt) }}
                  />
                </div>
              </div>
              <div className="border-t border-zinc-800 pt-3 text-xs leading-relaxed text-zinc-500">
                <p className="mb-2 font-medium text-zinc-400">What moves hooked vs plain LP net?</p>
                <ul className="list-inside list-disc space-y-1">
                  <li>
                    <span className="text-emerald-400/90">minDonateBps</span> — share of sync
                    arb donated back to hooked pool
                  </li>
                  <li>Arb size vs pool TVL (deviation before sync / plain arb)</li>
                  <li>Swap fee split — plain 100% LP; hooked shares with sync &amp; feed keepers</li>
                  <li>Plain arb takes 100% of mispricing; hooked splits with pool via donation</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function ReportComparisonPanel({ report }: { report: ComparisonReport }) {
    return (
      <div className="space-y-6">
        <IlComparisonCharts report={report} />

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-amber-600/90">
              Plain pool
            </p>
            <Metric
              label="Swap fees → LP"
              value={formatFeeUsdt(report.plain.swapFees.lpShareUsdt)}
              hint={`${report.plain.swapFees.swapCount} swap(s) · 100% to LPs (in reserves)`}
            />
            <div className="mt-3 border-t border-amber-500/10 pt-3">
              <Metric
                label="Liquidity extracted"
                value={formatFeeUsdt(report.plain.extractedLp.valueUsdt)}
                hint={`${formatTokenAmount(report.plain.extractedLp.weth)} WETH + ${formatTokenAmount(report.plain.extractedLp.usdt)} USDT @ oracle`}
              />
            </div>
          </div>

          <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-violet-400">
              Hooked pool
            </p>
            <Metric
              label="Swap fees → LP"
              value={formatFeeUsdt(report.hooked.swapFees.lpShareUsdt)}
              hint={`${report.hooked.swapFees.swapCount} swap(s) · LP share from public swaps`}
            />
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg bg-zinc-950/60 px-3 py-2">
                <p className="text-xs text-zinc-500">→ Sync keeper</p>
                <p className="font-mono text-zinc-200">{formatFeeUsdt(report.hooked.swapFees.syncShareUsdt)}</p>
              </div>
              <div className="rounded-lg bg-zinc-950/60 px-3 py-2">
                <p className="text-xs text-zinc-500">→ Feed keeper</p>
                <p className="font-mono text-zinc-200">{formatFeeUsdt(report.hooked.swapFees.feedShareUsdt)}</p>
              </div>
            </div>
            <div className="mt-3 border-t border-violet-500/10 pt-3">
              <Metric
                label="Liquidity extracted"
                value={formatFeeUsdt(report.hooked.extractedLp.valueUsdt)}
                hint={`${formatTokenAmount(report.hooked.extractedLp.weth)} WETH + ${formatTokenAmount(report.hooked.extractedLp.usdt)} USDT · incl. sync donation`}
              />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-4">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Actor profits (USDT @ oracle)
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 px-3 py-3">
              <p className="text-xs text-orange-400/90">Plain arbitrageur</p>
              <p className="mt-1 font-mono text-lg text-zinc-100">
                {formatFeeUsdt(report.actors.plainArbUsdt)}
              </p>
              <p className="mt-1 text-xs text-zinc-500">100% of plain-pool arb</p>
            </div>
            <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-3">
              <p className="text-xs text-violet-400">Sync keeper</p>
              <p className="mt-1 font-mono text-lg text-zinc-100">
                {formatFeeUsdt(report.actors.syncKeeperTotalUsdt)}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Arb {formatFeeUsdt(report.actors.syncKeeperArbUsdt)} + fees{" "}
                {formatFeeUsdt(report.actors.syncKeeperSwapFeesUsdt)}
              </p>
            </div>
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-3">
              <p className="text-xs text-amber-400/90">Feed keeper</p>
              <p className="mt-1 font-mono text-lg text-zinc-100">
                {formatFeeUsdt(report.actors.feedKeeperSwapFeesUsdt)}
              </p>
              <p className="mt-1 text-xs text-zinc-500">Public swap fee share</p>
            </div>
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-3">
              <p className="text-xs text-emerald-400/90">Pool donation</p>
              <p className="mt-1 font-mono text-lg text-zinc-100">
                {formatFeeUsdt(report.actors.poolDonationUsdt)}
              </p>
              <p className="mt-1 text-xs text-zinc-500">Hooked sync arb → LP</p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <DistributionFlowChart
            title="Plain pool · value flow"
            subtitle="MEV arb captures mispricing; LPs keep fees inside withdrawn liquidity"
            flows={report.plainFlow}
          />
          <DistributionFlowChart
            title="Hooked pool · value flow"
            subtitle="Sync splits arb with pool donation; keepers earn swap-fee shares"
            flows={report.hookedFlow}
          />
        </div>
      </div>
    );
  }

  function ProfitBreakdownPanel({
    breakdown,
    title,
    estimate,
  }: {
    breakdown: ProfitBreakdownUsdt | undefined;
    title: string;
    estimate?: boolean;
  }) {
    if (!breakdown) return null;
    const split = breakdown.split;
    const donatePct =
      split && split.minDonateBps > 0
        ? `${(split.minDonateBps / 100).toFixed(0)}% min donate (each profit token)`
        : null;

    return (
      <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-emerald-600/90">
          {title}
          {estimate ? " · estimate" : ""}
        </p>
        <Metric
          label="Total arb profit (USDT)"
          value={formatFeeUsdt(breakdown.grossUsdt)}
          hint="Full two-leg cycle, converted to USDT @ oracle"
        />
        {donatePct && (
          <p className="mt-2 text-xs text-zinc-500">Pool config · {donatePct}</p>
        )}
        <div className="mt-3 space-y-2 border-t border-emerald-500/10 pt-3 font-mono text-sm">
          {breakdown.syncKeeperUsdt > 0 && (
            <div className="flex justify-between gap-3 text-zinc-200">
              <span className="text-zinc-500">→ Sync keeper</span>
              <span>{formatFeeUsdt(breakdown.syncKeeperUsdt)}</span>
            </div>
          )}
          {breakdown.poolDonationUsdt > 0 && (
            <div className="flex justify-between gap-3 text-zinc-200">
              <span className="text-zinc-500">→ Pool (donation)</span>
              <span>{formatFeeUsdt(breakdown.poolDonationUsdt)}</span>
            </div>
          )}
          {breakdown.plainArbUsdt > 0 && (
            <div className="flex justify-between gap-3 text-zinc-200">
              <span className="text-zinc-500">→ Plain arbitrageur</span>
              <span>{formatFeeUsdt(breakdown.plainArbUsdt)}</span>
            </div>
          )}
        </div>
      </div>
    );
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

              <ProfitBreakdownPanel
                breakdown={syncPreview?.distribution.profitBreakdownUsdt}
                title="Who gets the profit"
                estimate
              />

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
                <div className="mt-4 space-y-3">
                  <ProfitBreakdownPanel
                    breakdown={state.lastPoolSync.profitBreakdownUsdt}
                    title="Last sync — who got the profit"
                  />
                  {state.syncKeeperStatus?.registered && (
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
                          : "15% sync fee share now goes to LP"
                      }
                    />
                  )}
                </div>
              )}
            </Card>

            <Card
              title="Plain arbitrageur"
              subtitle="Swap plain pool to oracle, sell output @ reference — 100% profit to arb, no pool donation"
              badge={<Badge tone="plain">Step 05</Badge>}
              accent="plain"
            >
              <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-4">
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Leg 1 · plain pool (align price → oracle)
                </p>
                <Metric
                  label="Amount in → out"
                  value={formatSyncLeg(plainArbPreview?.poolSwap)}
                  hint={
                    plainArbPreview
                      ? `${syncLegHint(plainArbPreview.direction, "pool")} · deviation ${(plainArbPreview.poolDeviationBps / 100).toFixed(2)}% · target $${formatUsdtPrice(plainArbPreview.targetPriceScaled)}`
                      : "Seed plain LP, then swap on plain pool (step 03) to skew price away from oracle"
                  }
                />
                {plainArbPreview?.poolSwapFee && (
                  <div className="mt-3">
                    <Metric
                      label="Plain pool fee (leg 1)"
                      value={formatSyncToken(
                        plainArbPreview.poolSwapFee.amountRaw,
                        plainArbPreview.poolSwapFee.token,
                      )}
                      hint={`${formatKeeperFeePips(plainArbPreview.poolSwapFee.feePips)} static · 100% LP`}
                    />
                  </div>
                )}
              </div>

              <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-amber-600/80">
                  Leg 2 · sell @ oracle (mock router)
                </p>
                <Metric
                  label="Amount in → out"
                  value={formatSyncLeg(plainArbPreview?.outerArb)}
                  hint={
                    plainArbPreview
                      ? `${syncLegHint(plainArbPreview.direction, "outer")} · fair price @ oracle`
                      : undefined
                  }
                />
              </div>

              <ProfitBreakdownPanel
                breakdown={plainArbPreview?.profitBreakdownUsdt}
                title="Who gets the profit"
                estimate
              />

              {plainArbPreview && !plainArbPreview.canExecute && plainArbPreview.reason && (
                <p className="mt-3 text-xs text-amber-400/90">{plainArbPreview.reason}</p>
              )}

              <Button
                variant="primary"
                className="mt-4 w-full"
                onClick={handleExecutePlainArb}
                disabled={!ready || plainArbing || !plainArbPreview?.canExecute}
              >
                {plainArbing && <span className="spinner" />}
                {plainArbing ? "Executing arb…" : "Execute plain arb (+1 block)"}
              </Button>

              {ready && state.lastPlainArb && (
                <div className="mt-4">
                  <ProfitBreakdownPanel
                    breakdown={state.lastPlainArb.profitBreakdownUsdt}
                    title="Last arb — who got the profit"
                  />
                </div>
              )}
            </Card>

            <Card
              title="IL comparison report"
              subtitle="Claim keeper fees, burn LP on both pools, compare who captured value"
              badge={<Badge tone="hooked">Step 06</Badge>}
              accent="hooked"
              className="lg:col-span-2"
            >
              <p className="text-sm text-zinc-400">
                Claims sync &amp; feed keeper treasury, burns LP on plain then hooked pool (3 blocks),
                then compares fees, liquidity extracted, and who captured arb value.
              </p>

              <Button
                variant="primary"
                className="mt-4 w-full"
                onClick={handleCollectReport}
                disabled={
                  !ready ||
                  collectingReport ||
                  !state?.lastPlainArb ||
                  !!state?.lastReport
                }
              >
                {collectingReport && <span className="spinner" />}
                {collectingReport
                  ? "Collecting report…"
                  : state?.lastReport
                    ? "Report collected"
                    : "Collect IL report (3 blocks)"}
              </Button>

              {!state?.lastPlainArb && (
                <p className="mt-3 text-xs text-zinc-500">Complete step 05 (plain arb) first.</p>
              )}

              {state?.lastReport && <ReportComparisonPanel report={state.lastReport} />}
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
