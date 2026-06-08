import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { foundry } from "viem/chains";
import { getActorAccount } from "./accounts.js";
import { ANVIL_RPC } from "./accounts.js";
import {
  PLAIN_POOL_FEE,
  USDT,
  WETH,
  usdtRawForWethWei,
  wethRawForUsdtRaw,
} from "./constants.js";
import type { Deployment } from "./deploy.js";
import { buildPoolKey } from "./poolKeys.js";
import { planPlainSwapToTarget } from "./poolSyncPlan.js";
import { plainArbProfitBreakdown, type ProfitBreakdownUsdt } from "./arbProfitBreakdown.js";
import { logJson } from "./revertDecode.js";
import { estimateSwapAmountOut, quoteSwapExactIn } from "./quoteSwap.js";
import { ensureErc20Allowance, fundUsdtDirect, fundWethDirect } from "./tokens.js";
import { sendContractTx } from "./tx.js";

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

const MOCK_ROUTER_ABI = [
  {
    type: "function",
    name: "simulateArb",
    inputs: [
      { name: "inputToken", type: "address" },
      { name: "inputAmount", type: "uint256" },
      { name: "profitToken", type: "address" },
      { name: "profitAmount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;

export type ArbToken = "WETH" | "USDT";

export type ArbLegPreview = {
  amountInRaw: string;
  amountOutRaw: string;
  tokenIn: ArbToken;
  tokenOut: ArbToken;
};

export type PlainPoolSwapFeePreview = {
  token: ArbToken;
  amountRaw: string;
  feePips: number;
};

export type PlainArbDirection = "poolBelowOracle" | "poolAboveOracle";

export type PlainArbPreview = {
  poolDeviationBps: number;
  targetPriceScaled: string;
  direction: PlainArbDirection;
  capitalToken: ArbToken;
  poolSwap: ArbLegPreview;
  outerArb: ArbLegPreview;
  poolSwapFee: PlainPoolSwapFeePreview;
  arbProfitUsdt: number;
  arbProfitRaw: string;
  profitBreakdownUsdt: ProfitBreakdownUsdt;
  canExecute: boolean;
  reason?: string;
};

export type PlainArbResult = {
  txHash: Hex;
  poolSwapTxHash: Hex;
  outerArbTxHash: Hex;
  actualProfit: string;
  profitToken: ArbToken;
  profitBreakdownUsdt: ProfitBreakdownUsdt;
};

type ArbPlan = {
  zeroForOne: boolean;
  capitalToken: Address;
  capitalAmount: bigint;
  capitalSymbol: ArbToken;
  direction: PlainArbDirection;
  poolSwap: ArbLegPreview;
  outerArb: ArbLegPreview;
  poolOutputRaw: bigint;
  outerInputToken: Address;
  outerSettlementToken: Address;
  outerSettlementRaw: bigint;
  expectedProfitRaw: bigint;
  expectedProfitUsdt: number;
  poolSwapFee: PlainPoolSwapFeePreview;
};

function swapFeeOnInput(amountIn: bigint, feePips: number): bigint {
  return (amountIn * BigInt(feePips)) / 1_000_000n;
}

async function buildPlainArbPlan(
  deployment: Deployment,
  targetPriceScaled: bigint,
): Promise<ArbPlan> {
  const quote = await planPlainSwapToTarget(deployment, targetPriceScaled, PLAIN_POOL_FEE);
  const capitalAmount = quote.swapAmountIn;
  const zeroForOne = quote.zeroForOne;
  const capitalSymbol: ArbToken = zeroForOne ? "WETH" : "USDT";
  const poolOutSymbol: ArbToken = zeroForOne ? "USDT" : "WETH";
  const direction: PlainArbDirection =
    capitalSymbol === "USDT" ? "poolBelowOracle" : "poolAboveOracle";

  let poolOutputRaw =
    (await quoteSwapExactIn(deployment, "plain", zeroForOne, capitalAmount, "plainArb")) ??
    (await estimateSwapAmountOut(
      deployment,
      "plain",
      zeroForOne,
      capitalAmount,
      PLAIN_POOL_FEE,
    )) ??
    0n;

  const poolSwap: ArbLegPreview = {
    amountInRaw: capitalAmount.toString(),
    amountOutRaw: poolOutputRaw.toString(),
    tokenIn: capitalSymbol,
    tokenOut: poolOutSymbol,
  };

  let outerArb: ArbLegPreview;
  let outerSettlementRaw: bigint;
  let outerSettlementToken: Address;
  let expectedProfitRaw: bigint;
  let expectedProfitUsdt: number;

  if (poolOutSymbol === "WETH") {
    const routerUsdtOut = usdtRawForWethWei(poolOutputRaw, targetPriceScaled);
    outerArb = {
      amountInRaw: poolOutputRaw.toString(),
      amountOutRaw: routerUsdtOut.toString(),
      tokenIn: "WETH",
      tokenOut: "USDT",
    };
    outerSettlementRaw = routerUsdtOut;
    outerSettlementToken = USDT as Address;
    expectedProfitRaw = routerUsdtOut > capitalAmount ? routerUsdtOut - capitalAmount : 0n;
    expectedProfitUsdt = Number(expectedProfitRaw) / 1e6;
  } else {
    const routerWethOut = wethRawForUsdtRaw(poolOutputRaw, targetPriceScaled);
    outerArb = {
      amountInRaw: poolOutputRaw.toString(),
      amountOutRaw: routerWethOut.toString(),
      tokenIn: "USDT",
      tokenOut: "WETH",
    };
    outerSettlementRaw = routerWethOut;
    outerSettlementToken = WETH as Address;
    expectedProfitRaw =
      routerWethOut > capitalAmount ? routerWethOut - capitalAmount : 0n;
    expectedProfitUsdt = Number(usdtRawForWethWei(expectedProfitRaw, targetPriceScaled)) / 1e6;
  }

  return {
    zeroForOne,
    capitalToken: capitalSymbol === "WETH" ? (WETH as Address) : (USDT as Address),
    capitalAmount,
    capitalSymbol,
    direction,
    poolSwap,
    outerArb,
    poolOutputRaw,
    outerInputToken: poolOutSymbol === "WETH" ? (WETH as Address) : (USDT as Address),
    outerSettlementToken,
    outerSettlementRaw,
    expectedProfitRaw,
    expectedProfitUsdt,
    poolSwapFee: {
      token: capitalSymbol,
      amountRaw: swapFeeOnInput(capitalAmount, PLAIN_POOL_FEE).toString(),
      feePips: PLAIN_POOL_FEE,
    },
  };
}

export async function previewPlainArb(
  deployment: Deployment,
  targetPriceScaled: bigint,
): Promise<PlainArbPreview> {
  const plan = await buildPlainArbPlan(deployment, targetPriceScaled);
  const quote = await planPlainSwapToTarget(deployment, targetPriceScaled, PLAIN_POOL_FEE);

  let canExecute = quote.poolDeviationBps > 0 && plan.expectedProfitRaw > 0n;
  let reason: string | undefined;
  if (quote.poolDeviationBps === 0) {
    canExecute = false;
    reason = "Plain pool price already matches oracle";
  } else if (plan.expectedProfitRaw <= 0n) {
    canExecute = false;
    reason = "Arb profit would not cover pool fee";
  }

  return {
    poolDeviationBps: quote.poolDeviationBps,
    targetPriceScaled: targetPriceScaled.toString(),
    direction: plan.direction,
    capitalToken: plan.capitalSymbol,
    poolSwap: plan.poolSwap,
    outerArb: plan.outerArb,
    poolSwapFee: plan.poolSwapFee,
    arbProfitUsdt: plan.expectedProfitUsdt,
    arbProfitRaw: plan.expectedProfitRaw.toString(),
    profitBreakdownUsdt: plainArbProfitBreakdown(plan.expectedProfitUsdt),
    canExecute,
    reason,
  };
}

export async function executePlainArb(
  deployment: Deployment,
  targetPriceScaled: bigint,
): Promise<{ result: PlainArbResult; txHashes: Hex[] }> {
  const preview = await previewPlainArb(deployment, targetPriceScaled);
  if (!preview.canExecute) {
    throw new Error(preview.reason ?? "Plain pool arb not available");
  }

  const client = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
  const actor = getActorAccount("plainArb");
  const walletClient = createWalletClient({
    account: actor,
    chain: foundry,
    transport: http(ANVIL_RPC),
  });

  const swapRouter = deployment.addresses.swapRouter as Address;
  const mockRouter = deployment.addresses.mockRouter as Address;
  const poolKey = buildPoolKey(deployment, "plain");
  const plan = await buildPlainArbPlan(deployment, targetPriceScaled);

  const txHashes: Hex[] = [];
  const { capitalToken, capitalAmount } = plan;

  if (capitalToken.toLowerCase() === WETH.toLowerCase()) {
    const bal = await client.readContract({
      address: WETH,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [actor.address],
    });
    if (bal < capitalAmount) await fundWethDirect(actor.address, capitalAmount - bal);
  } else {
    const bal = await client.readContract({
      address: USDT,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [actor.address],
    });
    if (bal < capitalAmount) await fundUsdtDirect(actor.address, capitalAmount - bal);
  }

  const routerBal = await client.readContract({
    address: plan.outerSettlementToken,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [mockRouter],
  });
  if (routerBal < plan.outerSettlementRaw) {
    const delta = plan.outerSettlementRaw - routerBal;
    if (plan.outerSettlementToken.toLowerCase() === WETH.toLowerCase()) {
      await fundWethDirect(mockRouter, delta);
    } else {
      await fundUsdtDirect(mockRouter, delta);
    }
  }

  const approveHashes = await ensureErc20Allowance(
    walletClient,
    capitalToken,
    swapRouter,
    capitalAmount,
  );
  txHashes.push(...approveHashes);

  logJson("[plainArb] execute", {
    arb: actor.address,
    direction: plan.direction,
    capitalAmount: capitalAmount.toString(),
    poolOutput: plan.poolOutputRaw.toString(),
    outerSettlement: plan.outerSettlementRaw.toString(),
    expectedProfit: plan.expectedProfitRaw.toString(),
  });

  const poolSwapHash = await sendContractTx(walletClient, {
    address: swapRouter,
    abi: SWAP_ROUTER_ABI,
    functionName: "swapExactIn",
    args: [poolKey, plan.zeroForOne, capitalAmount, "0x", actor.address],
  });
  txHashes.push(poolSwapHash);

  const outerApproveHashes = await ensureErc20Allowance(
    walletClient,
    plan.outerInputToken,
    mockRouter,
    plan.poolOutputRaw,
  );
  txHashes.push(...outerApproveHashes);

  const outerArbHash = await sendContractTx(walletClient, {
    address: mockRouter,
    abi: MOCK_ROUTER_ABI,
    functionName: "simulateArb",
    args: [
      plan.outerInputToken,
      plan.poolOutputRaw,
      plan.outerSettlementToken,
      plan.outerSettlementRaw,
    ],
  });
  txHashes.push(outerArbHash);

  const profitToken: ArbToken = plan.capitalSymbol === "USDT" ? "USDT" : "WETH";

  return {
    txHashes,
    result: {
      txHash: outerArbHash,
      poolSwapTxHash: poolSwapHash,
      outerArbTxHash: outerArbHash,
      actualProfit: plan.expectedProfitRaw.toString(),
      profitToken,
      profitBreakdownUsdt: plainArbProfitBreakdown(plan.expectedProfitUsdt),
    },
  };
}

export async function finalizePlainArbResult(result: PlainArbResult): Promise<PlainArbResult> {
  const client = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });

  for (const hash of [result.poolSwapTxHash, result.outerArbTxHash]) {
    const receipt = await client.getTransactionReceipt({ hash });
    if (receipt?.status === "reverted") {
      const { explainRevertedTx } = await import("./revertDecode.js");
      throw new Error(await explainRevertedTx(hash, "plain arb"));
    }
  }

  return result;
}
