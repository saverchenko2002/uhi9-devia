import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FEED_KEEPER,
  FORK_BLOCK,
  LP,
  OWNER,
  PLAIN_ARB,
  SWAPPER,
  SYNC_KEEPER,
  ANVIL_RPC,
} from "./accounts.js";
import { DEPLOYMENTS_FILE, DEMO_ROOT, PROJECT_ROOT } from "./paths.js";

const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as const;
const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7" as const;
const POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90" as const;
const ORACLE_PRICE_SCALED = "300000000000";

export type Deployment = {
  forkBlock: number;
  oraclePriceScaled: string;
  weth: `0x${string}`;
  usdt: `0x${string}`;
  actors: {
    owner: `0x${string}`;
    lp: `0x${string}`;
    swapper: `0x${string}`;
    syncKeeper: `0x${string}`;
    plainArb: `0x${string}`;
    feedKeeper: `0x${string}`;
  };
  addresses: Record<string, `0x${string}` | string>;
};

type BroadcastTx = {
  contractName?: string;
  contractAddress?: string;
  additionalContracts?: Array<{
    contractName?: string;
    address?: string;
  }>;
};

type BroadcastRun = {
  transactions?: BroadcastTx[];
};

const CONTRACT_KEYS: Record<string, string> = {
  MockPyth: "mockPyth",
  PoolConfigRegistry: "registry",
  FeedKeepers: "feedKeepers",
  SyncKeepers: "syncKeepers",
  KeepersTreasury: "keepersTreasury",
  KeeperExecutor: "executor",
  DynamicFeeHook: "dynamicFeeHook",
  PoolLiquidityRouter: "liqRouter",
  PoolSwapRouter: "swapRouter",
  MockRouter: "mockRouter",
};

function readPoolId(filename: string): string {
  return readFileSync(resolve(DEMO_ROOT, filename), "utf8").trim();
}

function buildAndWriteDeployment(): Deployment {
  const broadcastPath = resolve(
    PROJECT_ROOT,
    "broadcast/DemoEnvironment.s.sol/31337/run-latest.json",
  );
  const broadcast = JSON.parse(readFileSync(broadcastPath, "utf8")) as BroadcastRun;

  const addresses: Record<string, string> = {
    poolManager: POOL_MANAGER,
    hookedCurrency0: WETH,
    hookedCurrency1: USDT,
    hookedPoolId: readPoolId("hooked_pool_id.txt"),
    plainPoolId: readPoolId("plain_pool_id.txt"),
  };

  for (const tx of broadcast.transactions ?? []) {
    if (tx.contractName && tx.contractAddress) {
      const key = CONTRACT_KEYS[tx.contractName];
      if (key) addresses[key] = tx.contractAddress;
    }
    for (const extra of tx.additionalContracts ?? []) {
      if (!extra.contractName || !extra.address) continue;
      const key = CONTRACT_KEYS[extra.contractName];
      if (key) addresses[key] = extra.address;
    }
  }

  const deployment: Deployment = {
    forkBlock: FORK_BLOCK,
    oraclePriceScaled: ORACLE_PRICE_SCALED,
    weth: WETH,
    usdt: USDT,
    actors: {
      owner: OWNER,
      lp: LP,
      swapper: SWAPPER,
      syncKeeper: SYNC_KEEPER,
      plainArb: PLAIN_ARB,
      feedKeeper: FEED_KEEPER,
    },
    addresses,
  };

  writeFileSync(DEPLOYMENTS_FILE, `${JSON.stringify(deployment, null, 2)}\n`);
  return deployment;
}

export function runDemoDeploy(): Deployment {
  execFileSync(
    "forge",
    [
      "script",
      "script/demo/DemoEnvironment.s.sol:DemoEnvironment",
      "--rpc-url",
      ANVIL_RPC,
      "--broadcast",
      "--force",
      "--unlocked",
      "--sender",
      OWNER,
      "-vv",
    ],
    { cwd: PROJECT_ROOT, stdio: "inherit", env: process.env },
  );

  return buildAndWriteDeployment();
}

export function loadDeployment(): Deployment {
  const raw = readFileSync(DEPLOYMENTS_FILE, "utf8");
  return JSON.parse(raw) as Deployment;
}

export { DEMO_ROOT, PROJECT_ROOT, DEPLOYMENTS_FILE };
