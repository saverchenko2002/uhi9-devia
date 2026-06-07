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
import { fundUsdtDirect, fundWeth } from "./tokens.js";
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
import { sendContractTx } from "./tx.js";

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
  waitReceipt = true,
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
    return [];
  }

  const hashes: Hex[] = [];

  if (token.toLowerCase() === USDT.toLowerCase()) {
    logSeed("approve USDT: step 1/2 approve(0)");
    const resetHash = waitReceipt
      ? await walletClient.writeContract({
          address: token,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [spender, 0n],
          chain: foundry,
        })
      : await sendContractTx(walletClient, {
          address: token,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [spender, 0n],
        });
    hashes.push(resetHash);
    if (waitReceipt) await publicClient.waitForTransactionReceipt({ hash: resetHash });

    logSeed("approve USDT: step 2/2 approve(amount)", { amount: amount.toString() });
    const hash = waitReceipt
      ? await walletClient.writeContract({
          address: token,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [spender, amount],
          chain: foundry,
        })
      : await sendContractTx(walletClient, {
          address: token,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [spender, amount],
        });
    hashes.push(hash);
    if (waitReceipt) await publicClient.waitForTransactionReceipt({ hash });
    return hashes;
  }

  logSeed("approve WETH: approve(amount)", { amount: amount.toString() });
  const hash = waitReceipt
    ? await walletClient.writeContract({
        address: token,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [spender, amount],
        chain: foundry,
      })
    : await sendContractTx(walletClient, {
        address: token,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [spender, amount],
      });
  hashes.push(hash);
  if (waitReceipt) await publicClient.waitForTransactionReceipt({ hash });
  return hashes;
}

type SeedOptions = { waitReceipt?: boolean };

async function sendAddLiquidityTx(
  walletClient: ReturnType<typeof createWalletClient>,
  liqRouter: Address,
  deployment: Deployment,
  pool: "hooked" | "plain",
  signer: Address,
  wethWei: bigint,
  usdtRaw: bigint,
  waitReceipt: boolean,
): Promise<Hex> {
  const publicClient = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
  const poolId = (
    pool === "hooked" ? deployment.addresses.hookedPoolId : deployment.addresses.plainPoolId
  ) as Hex;
  const sqrtPriceX96 = await readSqrtPriceX96(publicClient, poolId);
  const key = buildPoolKey(deployment, pool);

  logSeed("addLiquidityFromAmounts", {
    pool,
    poolId,
    sqrtPriceX96: sqrtPriceX96.toString(),
    wethWei: wethWei.toString(),
    usdtRaw: usdtRaw.toString(),
    payer: signer,
  });

  if (waitReceipt) {
    return walletClient.writeContract({
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
  }

  return sendContractTx(walletClient, {
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
  });
}

export async function seedLiquidity(
  deployment: Deployment,
  req: SeedLiquidityRequest,
  options: SeedOptions = {},
): Promise<SeedLiquidityResult[]> {
  logSeed("seedLiquidity called", {
    actorId: req.actorId,
    pool: req.pool,
    wethAmount: req.wethAmount,
    usdtAmount: req.usdtAmount,
  });
  const { results } = await seedLiquidityWithHashes(deployment, req, options);
  logSeed("seedLiquidity finished OK", { pools: results.map((r) => r.pool) });
  return results;
}

export async function seedLiquidityWithHashes(
  deployment: Deployment,
  req: SeedLiquidityRequest,
  options: SeedOptions = {},
): Promise<{ results: SeedLiquidityResult[]; txHashes: Hex[] }> {
  const wethWei = parseEther(req.wethAmount);
  const usdtRaw = BigInt(Math.round(Number(req.usdtAmount) * 1e6));

  logSeed("seedLiquidityWithHashes", {
    actorId: req.actorId,
    pool: req.pool,
    wethWei: wethWei.toString(),
    usdtRaw: usdtRaw.toString(),
    waitReceipt: options.waitReceipt !== false,
  });

  if (wethWei <= 0n || usdtRaw <= 0n) {
    throw new Error("WETH and USDT amounts must be positive");
  }

  if (!deployment.addresses.dynamicFeeHook && req.pool !== "plain") {
    throw new Error("dynamicFeeHook missing from deployment manifest");
  }

  const targets: Array<"hooked" | "plain"> =
    req.pool === "both" ? ["hooked", "plain"] : [req.pool];

  const waitReceipt = options.waitReceipt !== false;
  const poolCount = BigInt(targets.length);
  const totalWethWei = wethWei * poolCount;
  const totalUsdtRaw = usdtRaw * poolCount;

  const actor = getActorAccount(req.actorId);
  const signer = actor.address;
  const publicClient = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
  const walletClient = createWalletClient({
    account: actor,
    chain: foundry,
    transport: http(ANVIL_RPC),
  });
  const liqRouter = deployment.addresses.liqRouter as Address;

  logSeed("seedLiquidityWithHashes: batched funding", {
    targets,
    totalWethWei: totalWethWei.toString(),
    totalUsdtRaw: totalUsdtRaw.toString(),
    perPoolWethWei: wethWei.toString(),
    perPoolUsdtRaw: usdtRaw.toString(),
  });

  const txHashes: Hex[] = [];

  // No whale tx — USDT credited via storage so all remaining txs are from LP (correct order in one block).
  logSeed("fund USDT via storage (total)");
  await fundUsdtDirect(signer, totalUsdtRaw);

  logSeed("fund WETH via deposit() (total)");
  txHashes.push(await fundWeth(walletClient, totalWethWei, waitReceipt));
  await logActorBalances("after funding", publicClient, signer, liqRouter);

  logSeed("approve tokens for liqRouter (total)");
  txHashes.push(
    ...(await approveToken(walletClient, publicClient, WETH, signer, liqRouter, totalWethWei, waitReceipt)),
  );
  txHashes.push(
    ...(await approveToken(walletClient, publicClient, USDT, signer, liqRouter, totalUsdtRaw, waitReceipt)),
  );
  await logActorBalances("after approve", publicClient, signer, liqRouter);

  const results: SeedLiquidityResult[] = [];
  for (const pool of targets) {
    const hash = await sendAddLiquidityTx(
      walletClient,
      liqRouter,
      deployment,
      pool,
      signer,
      wethWei,
      usdtRaw,
      waitReceipt,
    );
    txHashes.push(hash);
    if (waitReceipt) {
      await publicClient.waitForTransactionReceipt({ hash });
    }
    logSeed(`addLiquidityFromAmounts tx sent pool=${pool}`, { txHash: hash });
    results.push({
      pool,
      txHash: hash,
      weth: wethWei.toString(),
      usdt: usdtRaw.toString(),
    });
  }

  return { results, txHashes };
}
