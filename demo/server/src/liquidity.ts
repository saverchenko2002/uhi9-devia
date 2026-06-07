import {
  createPublicClient,
  createWalletClient,
  encodePacked,
  http,
  keccak256,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { foundry } from "viem/chains";
import type { Deployment } from "./deploy.js";
import { fundUsdt, fundWeth } from "./tokens.js";
import {
  DYNAMIC_FEE_FLAG,
  fullRangeTickLower,
  fullRangeTickUpper,
  PLAIN_POOL_FEE,
  POOL_MANAGER,
  TICK_SPACING,
  USDT,
  WETH,
} from "./constants.js";
import { ANVIL_RPC, getActorAccount, type ActorId } from "./accounts.js";

const POOLS_SLOT = "0x0000000000000000000000000000000000000000000000000000000000000006" as Hex;

const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;

const POOL_MANAGER_ABI = [
  {
    type: "function",
    name: "extsload",
    inputs: [{ name: "slot", type: "bytes32" }],
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
  },
] as const;

const LIQ_ROUTER_ABI = [
  {
    type: "function",
    name: "addLiquidityFromAmounts",
    inputs: [
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      { name: "tickLower", type: "int24" },
      { name: "tickUpper", type: "int24" },
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
      { name: "payer", type: "address" },
    ],
    outputs: [{ name: "delta", type: "int256" }],
    stateMutability: "payable",
  },
] as const;

export type PoolTarget = "hooked" | "plain" | "both";

export type SeedLiquidityRequest = {
  actorId: ActorId;
  pool: PoolTarget;
  wethAmount: string;
  usdtAmount: string;
};

export type SeedLiquidityResult = {
  pool: "hooked" | "plain";
  txHash: Hex;
  weth: string;
  usdt: string;
};

function logSeed(step: string, detail?: Record<string, unknown>) {
  if (detail) {
    console.log(`[seed] ${step}`, detail);
  } else {
    console.log(`[seed] ${step}`);
  }
}

async function logActorBalances(
  label: string,
  publicClient: ReturnType<typeof createPublicClient>,
  owner: Address,
  spender: Address,
) {
  const [ethBal, wethBal, usdtBal, wethAllow, usdtAllow] = await Promise.all([
    publicClient.getBalance({ address: owner }),
    publicClient.readContract({
      address: WETH,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [owner],
    }),
    publicClient.readContract({
      address: USDT,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [owner],
    }),
    publicClient.readContract({
      address: WETH,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [owner, spender],
    }),
    publicClient.readContract({
      address: USDT,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [owner, spender],
    }),
  ]);
  logSeed(label, {
    owner,
    spender,
    ethWei: ethBal.toString(),
    wethWei: wethBal.toString(),
    usdtRaw: usdtBal.toString(),
    wethAllowance: wethAllow.toString(),
    usdtAllowance: usdtAllow.toString(),
  });
}

function poolStateSlot(poolId: Hex): Hex {
  return keccak256(encodePacked(["bytes32", "bytes32"], [poolId, POOLS_SLOT]));
}

async function readSqrtPriceX96(
  client: ReturnType<typeof createPublicClient>,
  poolId: Hex,
): Promise<bigint> {
  const data = await client.readContract({
    address: POOL_MANAGER,
    abi: POOL_MANAGER_ABI,
    functionName: "extsload",
    args: [poolStateSlot(poolId)],
  });
  return BigInt(data) & ((1n << 160n) - 1n);
}

function buildPoolKey(
  deployment: Deployment,
  pool: "hooked" | "plain",
): {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
} {
  const weth = deployment.weth as Address;
  const usdt = deployment.usdt as Address;
  const [currency0, currency1] = weth.toLowerCase() < usdt.toLowerCase() ? [weth, usdt] : [usdt, weth];

  if (pool === "hooked") {
    return {
      currency0,
      currency1,
      fee: DYNAMIC_FEE_FLAG,
      tickSpacing: TICK_SPACING,
      hooks: deployment.addresses.dynamicFeeHook as Address,
    };
  }

  return {
    currency0,
    currency1,
    fee: PLAIN_POOL_FEE,
    tickSpacing: TICK_SPACING,
    hooks: "0x0000000000000000000000000000000000000000",
  };
}

async function approveToken(
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  token: Address,
  owner: Address,
  spender: Address,
  amount: bigint,
) {
  const tokenLabel = token.toLowerCase() === USDT.toLowerCase() ? "USDT" : "WETH";
  const allowance = await publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, spender],
  });

  logSeed(`approve ${tokenLabel}: current allowance`, {
    allowance: allowance.toString(),
    needed: amount.toString(),
  });

  if (allowance >= amount) {
    logSeed(`approve ${tokenLabel}: skipped (allowance sufficient)`);
    return;
  }

  if (token.toLowerCase() === USDT.toLowerCase()) {
    logSeed("approve USDT: step 1/2 approve(0)");
    const resetHash = await walletClient.writeContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spender, 0n],
      chain: foundry,
    });
    await publicClient.waitForTransactionReceipt({ hash: resetHash });
    logSeed("approve USDT: step 1/2 done", { txHash: resetHash });

    logSeed("approve USDT: step 2/2 approve(amount)", { amount: amount.toString() });
    const hash = await walletClient.writeContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spender, amount],
      chain: foundry,
    });
    await publicClient.waitForTransactionReceipt({ hash: hash });
    logSeed("approve USDT: step 2/2 done", { txHash: hash });
    return;
  }

  logSeed("approve WETH: approve(amount)", { amount: amount.toString() });
  const hash = await walletClient.writeContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [spender, amount],
    chain: foundry,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  logSeed("approve WETH: done", { txHash: hash });
}

async function seedOnePool(
  deployment: Deployment,
  pool: "hooked" | "plain",
  actorId: ActorId,
  wethWei: bigint,
  usdtRaw: bigint,
): Promise<SeedLiquidityResult> {
  const actor = getActorAccount(actorId);
  const signer = actor.address;
  const publicClient = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
  const walletClient = createWalletClient({
    account: actor,
    chain: foundry,
    transport: http(ANVIL_RPC),
  });
  const liqRouter = deployment.addresses.liqRouter as Address;

  logSeed(`--- seedOnePool start pool=${pool} actor=${actorId} ---`, {
    signer,
    liqRouter,
    wethWei: wethWei.toString(),
    usdtRaw: usdtRaw.toString(),
  });
  await logActorBalances("before funding", publicClient, signer, liqRouter);

  logSeed("fund WETH via deposit()");
  const wethFundTx = await fundWeth(walletClient, wethWei);
  logSeed("fund WETH done", { txHash: wethFundTx });

  logSeed("fund USDT via whale transfer");
  const usdtFundTx = await fundUsdt(signer, usdtRaw);
  logSeed("fund USDT done", { txHash: usdtFundTx });
  await logActorBalances("after funding", publicClient, signer, liqRouter);

  logSeed("approve tokens for liqRouter");
  await approveToken(walletClient, publicClient, WETH, signer, liqRouter, wethWei);
  await approveToken(walletClient, publicClient, USDT, signer, liqRouter, usdtRaw);
  await logActorBalances("after approve", publicClient, signer, liqRouter);

  const poolId = (
    pool === "hooked" ? deployment.addresses.hookedPoolId : deployment.addresses.plainPoolId
  ) as Hex;
  const sqrtPriceX96 = await readSqrtPriceX96(publicClient, poolId);
  const key = buildPoolKey(deployment, pool);

  logSeed("addLiquidityFromAmounts", {
    poolId,
    sqrtPriceX96: sqrtPriceX96.toString(),
    tickLower: fullRangeTickLower(),
    tickUpper: fullRangeTickUpper(),
    key,
    payer: signer,
  });

  const hash = await walletClient.writeContract({
    address: liqRouter,
    abi: LIQ_ROUTER_ABI,
    functionName: "addLiquidityFromAmounts",
    args: [
      key,
      fullRangeTickLower(),
      fullRangeTickUpper(),
      sqrtPriceX96,
      wethWei,
      usdtRaw,
      signer,
    ],
    chain: foundry,
  });
  logSeed("addLiquidityFromAmounts tx sent", { txHash: hash });
  await publicClient.waitForTransactionReceipt({ hash });
  logSeed(`--- seedOnePool done pool=${pool} ---`, { txHash: hash });

  return {
    pool,
    txHash: hash,
    weth: wethWei.toString(),
    usdt: usdtRaw.toString(),
  };
}

export async function seedLiquidity(
  deployment: Deployment,
  req: SeedLiquidityRequest,
): Promise<SeedLiquidityResult[]> {
  const wethWei = parseEther(req.wethAmount);
  const usdtRaw = BigInt(Math.round(Number(req.usdtAmount) * 1e6));

  logSeed("seedLiquidity called", {
    actorId: req.actorId,
    pool: req.pool,
    wethAmount: req.wethAmount,
    usdtAmount: req.usdtAmount,
    wethWei: wethWei.toString(),
    usdtRaw: usdtRaw.toString(),
  });

  if (wethWei <= 0n || usdtRaw <= 0n) {
    throw new Error("WETH and USDT amounts must be positive");
  }

  if (!deployment.addresses.dynamicFeeHook && req.pool !== "plain") {
    throw new Error("dynamicFeeHook missing from deployment manifest");
  }

  const targets: Array<"hooked" | "plain"> =
    req.pool === "both" ? ["hooked", "plain"] : [req.pool];

  const results: SeedLiquidityResult[] = [];
  for (const target of targets) {
    results.push(await seedOnePool(deployment, target, req.actorId, wethWei, usdtRaw));
  }
  logSeed("seedLiquidity finished OK", { pools: results.map((r) => r.pool) });
  return results;
}
