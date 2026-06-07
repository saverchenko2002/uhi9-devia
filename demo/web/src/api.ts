const API = "http://localhost:8787";

export type ActorId = "owner" | "lp" | "swapper" | "syncKeeper" | "plainArb";

export type ActorOption = {
  id: ActorId;
  label: string;
  address: string;
};

export type PoolTarget = "hooked" | "plain" | "both";

export type Deployment = {
  forkBlock: number;
  oraclePriceScaled: string;
  weth: string;
  usdt: string;
  actors: Record<string, string>;
  addresses: Record<string, string>;
};

export type LiquiditySeedResult = {
  pool: "hooked" | "plain";
  txHash: string;
  weth: string;
  usdt: string;
};

export type PoolSnapshot = {
  pool: "hooked" | "plain";
  initialized: boolean;
  priceScaled: string;
  priceUsdtPerEth: number;
  wethWei: string;
  weth: number;
  usdtRaw: string;
  usdt: number;
  tvlUsdt: number;
  liquidity: string;
};

export type DemoState = {
  deployment: Deployment;
  anvilReady?: boolean;
  oraclePriceScaled: string;
  liquiditySeeded: { hooked: boolean; plain: boolean };
  lastLiquiditySeed: LiquiditySeedResult[];
  pools?: { hooked: PoolSnapshot; plain: PoolSnapshot };
};

export type LiquidityDefaults = {
  wethAmount: string;
  usdtAmount: string;
};

export async function initDemo(): Promise<DemoState> {
  const res = await fetch(`${API}/api/init`, { method: "POST" });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "init failed");
  return normalizeState(json);
}

export async function fetchState(): Promise<DemoState | null> {
  const res = await fetch(`${API}/api/state`);
  if (res.status === 503) return null;
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "state failed");
  return normalizeState(json);
}

export async function fetchActors(): Promise<ActorOption[]> {
  const res = await fetch(`${API}/api/actors`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "actors failed");
  return json.actors as ActorOption[];
}

export async function fetchLiquidityDefaults(): Promise<LiquidityDefaults> {
  const res = await fetch(`${API}/api/liquidity/defaults`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "defaults failed");
  return { wethAmount: json.wethAmount, usdtAmount: json.usdtAmount };
}

export async function seedLiquidity(body: {
  actorId: ActorId;
  pool: PoolTarget;
  wethAmount: string;
  usdtAmount: string;
}): Promise<{
  results: LiquiditySeedResult[];
  liquiditySeeded: DemoState["liquiditySeeded"];
  pools?: DemoState["pools"];
}> {
  const res = await fetch(`${API}/api/liquidity/seed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "seed failed");
  return { results: json.results, liquiditySeeded: json.liquiditySeeded, pools: json.pools };
}

export async function setOraclePrice(priceScaled: string): Promise<string> {
  const res = await fetch(`${API}/api/oracle/price`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ priceScaled }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "oracle update failed");
  return json.oraclePriceScaled;
}

export function priceScaledToUsdtPerEth(scaled: string): number {
  return Number(scaled) / 1e8;
}

export function usdtPerEthToScaled(price: number): string {
  return String(Math.round(price * 1e8));
}

function normalizeState(json: Record<string, unknown>): DemoState {
  return {
    deployment: json.deployment as Deployment,
    anvilReady: json.anvilReady as boolean | undefined,
    oraclePriceScaled: json.oraclePriceScaled as string,
    liquiditySeeded: (json.liquiditySeeded as DemoState["liquiditySeeded"]) ?? {
      hooked: false,
      plain: false,
    },
    lastLiquiditySeed: (json.lastLiquiditySeed as LiquiditySeedResult[]) ?? [],
    pools: json.pools as DemoState["pools"],
  };
}
