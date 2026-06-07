import {
  createPublicClient,
  createWalletClient,
  http,
  parseEventLogs,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { foundry } from "viem/chains";
import { ANVIL_RPC, getActorAccount, type ActorId } from "./accounts.js";
import { USDT, WETH } from "./constants.js";
import type { Deployment } from "./deploy.js";
import type { FeeSplitPreview } from "./feePreview.js";
import { previewSwapFees } from "./feePreview.js";
import type { PoolTarget } from "./liquidity.js";
import { buildPoolKey } from "./poolKeys.js";
import { fundUsdtDirect, fundWeth } from "./tokens.js";
import { sendContractTx } from "./tx.js";

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
] as const;

const SWAP_ROUTER_ABI = [
  {
    type: "function",
    name: "swapExactIn",
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
      { name: "zeroForOne", type: "bool" },
      { name: "amountIn", type: "uint256" },
      { name: "hookData", type: "bytes" },
      { name: "payer", type: "address" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
    stateMutability: "nonpayable",
  },
] as const;

const FEE_ACCRUED_ABI = [
  {
    type: "event",
    name: "FeeAccrued",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "token", type: "address", indexed: false },
      { name: "totalFee", type: "uint256", indexed: false },
      { name: "lpAmount", type: "uint256", indexed: false },
      { name: "syncAmount", type: "uint256", indexed: false },
      { name: "feedAmount", type: "uint256", indexed: false },
      { name: "syncKeeper", type: "address", indexed: true },
      { name: "feedKeeper", type: "address", indexed: true },
    ],
  },
] as const;

export type SwapRequest = {
  actorId: ActorId;
  pool: PoolTarget;
  zeroForOne: boolean;
  amountIn: string;
};

export type SwapResult = {
  pool: "hooked" | "plain";
  txHash: Hex;
  amountIn: string;
  zeroForOne: boolean;
  fees: FeeSplitPreview;
};

export function parseSwapAmountIn(zeroForOne: boolean, amountHuman: string): bigint {
  if (zeroForOne) return parseEther(amountHuman);
  return BigInt(Math.round(Number(amountHuman) * 1e6));
}

function rawToUsdt(raw: bigint, feeToken: "WETH" | "USDT", priceScaled: bigint): number {
  if (feeToken === "USDT") return Number(raw) / 1e6;
  return Number((raw * priceScaled) / 10n ** 20n) / 1e6;
}

function feeTokenFromAddress(addr: string | undefined): "WETH" | "USDT" {
  if (!addr) return "USDT";
  return addr.toLowerCase() === WETH.toLowerCase() ? "WETH" : "USDT";
}

async function approveIfNeeded(
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  token: Address,
  owner: Address,
  spender: Address,
  amount: bigint,
): Promise<Hex[]> {
  const allowance = await publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, spender],
  });
  if (allowance >= amount) return [];

  const hashes: Hex[] = [];
  if (token.toLowerCase() === USDT.toLowerCase()) {
    hashes.push(
      await sendContractTx(walletClient, {
        address: token,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [spender, 0n],
      }),
    );
    hashes.push(
      await sendContractTx(walletClient, {
        address: token,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [spender, amount],
      }),
    );
    return hashes;
  }

  hashes.push(
    await sendContractTx(walletClient, {
      address: token,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spender, amount],
    }),
  );
  return hashes;
}

function feesFromReceipt(
  receipt: Awaited<ReturnType<ReturnType<typeof createPublicClient>["waitForTransactionReceipt"]>>,
  poolId: Hex,
  preview: FeeSplitPreview,
  priceScaled: bigint,
): FeeSplitPreview {
  if (preview.pool === "plain") return preview;

  const logs = parseEventLogs({ abi: FEE_ACCRUED_ABI, logs: receipt.logs });
  const poolLogs = logs.filter((l) => l.args.poolId?.toLowerCase() === poolId.toLowerCase());
  if (poolLogs.length === 0) return preview;

  let totalUsdt = 0;
  let lpUsdt = 0;
  let syncUsdt = 0;
  let feedUsdt = 0;

  for (const log of poolLogs) {
    const token = feeTokenFromAddress(log.args.token);
    totalUsdt += rawToUsdt(log.args.totalFee ?? 0n, token, priceScaled);
    lpUsdt += rawToUsdt(log.args.lpAmount ?? 0n, token, priceScaled);
    syncUsdt += rawToUsdt(log.args.syncAmount ?? 0n, token, priceScaled);
    feedUsdt += rawToUsdt(log.args.feedAmount ?? 0n, token, priceScaled);
  }

  return {
    ...preview,
    totalFeeUsdt: totalUsdt,
    lpShareUsdt: lpUsdt,
    syncShareUsdt: syncUsdt,
    feedShareUsdt: feedUsdt,
  };
}

export async function executeSwapsWithHashes(
  deployment: Deployment,
  req: SwapRequest,
  oraclePriceScaled: bigint,
): Promise<{ results: SwapResult[]; txHashes: Hex[]; preview: Awaited<ReturnType<typeof previewSwapFees>> }> {
  const amountInRaw = parseSwapAmountIn(req.zeroForOne, req.amountIn);
  if (amountInRaw <= 0n) throw new Error("amountIn must be positive");

  const targets: Array<"hooked" | "plain"> =
    req.pool === "both" ? ["hooked", "plain"] : [req.pool];

  const preview = await previewSwapFees(
    deployment,
    req.pool,
    req.zeroForOne,
    amountInRaw,
    req.amountIn,
    oraclePriceScaled,
  );

  const actor = getActorAccount(req.actorId);
  const signer = actor.address;
  const publicClient = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
  const walletClient = createWalletClient({
    account: actor,
    chain: foundry,
    transport: http(ANVIL_RPC),
  });
  const swapRouter = deployment.addresses.swapRouter as Address;

  const poolCount = BigInt(targets.length);
  const totalIn = amountInRaw * poolCount;
  const tokenIn = (req.zeroForOne ? WETH : USDT) as Address;
  const txHashes: Hex[] = [];

  if (req.zeroForOne) {
    txHashes.push(await fundWeth(walletClient, totalIn, false));
  } else {
    await fundUsdtDirect(signer, totalIn);
  }

  txHashes.push(...(await approveIfNeeded(walletClient, publicClient, tokenIn, signer, swapRouter, totalIn)));

  const results: SwapResult[] = [];
  for (const pool of targets) {
    const key = buildPoolKey(deployment, pool);
    const hash = await sendContractTx(walletClient, {
      address: swapRouter,
      abi: SWAP_ROUTER_ABI,
      functionName: "swapExactIn",
      args: [key, req.zeroForOne, amountInRaw, "0x", signer],
    });
    txHashes.push(hash);
    results.push({
      pool,
      txHash: hash,
      amountIn: amountInRaw.toString(),
      zeroForOne: req.zeroForOne,
      fees: pool === "hooked" ? preview.hooked! : preview.plain!,
    });
  }

  return { results, txHashes, preview };
}

export async function finalizeSwapResults(
  deployment: Deployment,
  results: SwapResult[],
  oraclePriceScaled: bigint,
): Promise<SwapResult[]> {
  const publicClient = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
  const finalized: SwapResult[] = [];

  for (const r of results) {
    const receipt = await publicClient.waitForTransactionReceipt({ hash: r.txHash });
    const poolId = (
      r.pool === "hooked" ? deployment.addresses.hookedPoolId : deployment.addresses.plainPoolId
    ) as Hex;
    finalized.push({
      ...r,
      fees: feesFromReceipt(receipt, poolId, r.fees, oraclePriceScaled),
    });
  }

  return finalized;
}
