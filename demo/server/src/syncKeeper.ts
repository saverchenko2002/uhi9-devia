import {
  concat,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  pad,
  type Address,
  type Hex,
} from "viem";
import { foundry } from "viem/chains";
import { getActorAccount } from "./accounts.js";
import { ANVIL_RPC } from "./accounts.js";
import {
  PRICE_DECIMALS,
  USDT,
  WETH,
  usdtRawForWethWei,
  wethRawForUsdtRaw,
} from "./constants.js";
import type { Deployment } from "./deploy.js";
import { formatContractError, logJson } from "./revertDecode.js";
import { ensureErc20Allowance, fundUsdtDirect, fundWethDirect } from "./tokens.js";
import { sendContractTx } from "./tx.js";

const BPS = 10_000n;
/** Uniswap v4 fee pips (matches PoolFeeLib.PIPS_DENOMINATOR). */
const PIPS_DENOMINATOR = 1_000_000n;

/** previewSync quotes ideal AMM output; keeper sync swap charges minFee pips — cap external leg. */
function poolOutputAfterKeeperFee(idealOutput: bigint, feePips: bigint): bigint {
  if (feePips >= PIPS_DENOMINATOR || idealOutput === 0n) return 0n;
  return (idealOutput * (PIPS_DENOMINATOR - feePips)) / PIPS_DENOMINATOR;
}

const EXECUTOR_ABI = [
  {
    type: "function",
    name: "previewSync",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "targetPriceScaled", type: "uint256" },
      { name: "priceDecimals", type: "uint8" },
    ],
    outputs: [
      {
        name: "preview",
        type: "tuple",
        components: [
          { name: "zeroForOne", type: "bool" },
          { name: "poolSwapTokenIn", type: "address" },
          { name: "poolSwapTokenOut", type: "address" },
          { name: "suggestedProfitToken", type: "address" },
          { name: "poolInputToReachTarget", type: "uint256" },
          { name: "poolOutputToReachTarget", type: "uint256" },
          { name: "poolDeviationBps", type: "uint256" },
          { name: "targetPriceScaled", type: "uint256" },
          { name: "keeperSwapFeeBps", type: "uint24" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "executeWithIntent",
    inputs: [
      {
        name: "intent",
        type: "tuple",
        components: [
          { name: "poolId", type: "bytes32" },
          { name: "capitalToken", type: "address" },
          { name: "capitalAmount", type: "uint256" },
          { name: "profitToken", type: "address" },
          { name: "expectedProfit", type: "uint256" },
          { name: "extension", type: "bytes" },
        ],
      },
    ],
    outputs: [
      { name: "actualProfit", type: "uint256" },
      { name: "donationAmount", type: "uint256" },
      { name: "keeperPayout", type: "uint256" },
      { name: "capitalReturned", type: "uint256" },
    ],
    stateMutability: "payable",
  },
] as const;

const REGISTRY_ABI = [
  {
    type: "function",
    name: "getPoolConfig",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      {
        name: "cfg",
        type: "tuple",
        components: [
          { name: "baseFeeBps", type: "uint16" },
          { name: "minFeeBps", type: "uint16" },
          { name: "maxFeeBps", type: "uint16" },
          { name: "stalenessSlopePpmPerSec", type: "uint32" },
          { name: "deviationSlopePpmPerBps", type: "uint32" },
          { name: "maxStalenessSec", type: "uint32" },
          { name: "minDonateBps", type: "uint16" },
          { name: "maxDonateBps", type: "uint16" },
          { name: "minImprovementBps", type: "uint16" },
          { name: "minOverwriteImprovementBps", type: "uint16" },
          { name: "maxSlippageBps", type: "uint16" },
          { name: "lpShareBps", type: "uint16" },
          { name: "syncShareBps", type: "uint16" },
          { name: "feedShareBps", type: "uint16" },
          { name: "priceFeedId", type: "bytes32" },
          { name: "enabled", type: "bool" },
        ],
      },
    ],
    stateMutability: "view",
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
    name: "approve",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;

const INTENT_EXECUTED_ABI = [
  {
    type: "event",
    name: "KeeperIntentExecuted",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "keeper", type: "address", indexed: true },
      { name: "capitalAmount", type: "uint256", indexed: false },
      { name: "capitalReturned", type: "uint256", indexed: false },
      { name: "expectedProfit", type: "uint256", indexed: false },
      { name: "actualProfit", type: "uint256", indexed: false },
      { name: "donationAmount", type: "uint256", indexed: false },
      { name: "keeperPayout", type: "uint256", indexed: false },
    ],
  },
] as const;

const ACTION_SYNC = 2;
const DONATE_MIN_ONLY = 0;
const PAYOUT_WRAPPED = 0;

export type SyncToken = "WETH" | "USDT";

export type SyncLegPreview = {
  amountInRaw: string;
  amountOutRaw: string;
  tokenIn: SyncToken;
  tokenOut: SyncToken;
};

export type SyncDistributionPreview = {
  capitalReturnedRaw: string;
  keeperProfitRaw: string;
  donationRaw: string;
  profitToken: SyncToken;
  expectedProfitRaw: string;
  minDonateBps: number;
};

/** Pool cheaper than oracle → buy WETH in pool (USDT in). Pool richer → sell WETH in pool. */
export type SyncDirection = "poolBelowOracle" | "poolAboveOracle";

export type KeeperSwapFeePreview = {
  token: SyncToken;
  amountRaw: string;
  feePips: number;
};

export type SyncKeeperPreview = {
  poolDeviationBps: number;
  targetPriceScaled: string;
  direction: SyncDirection;
  capitalToken: SyncToken;
  poolSwap: SyncLegPreview;
  outerArb: SyncLegPreview;
  keeperSwapFee: KeeperSwapFeePreview;
  distribution: SyncDistributionPreview;
  canExecute: boolean;
  reason?: string;
};

export type SyncKeeperResult = {
  txHash: Hex;
  actualProfit: string;
  donationAmount: string;
  keeperPayout: string;
  capitalReturned: string;
  profitToken: SyncToken;
};

function tokenSymbol(addr: string): SyncToken {
  return addr.toLowerCase() === WETH.toLowerCase() ? "WETH" : "USDT";
}

type OnChainSyncPreview = {
  poolSwapTokenIn: Address;
  poolSwapTokenOut: Address;
  poolInputToReachTarget: bigint;
  poolOutputToReachTarget: bigint;
  poolDeviationBps: bigint;
  keeperSwapFeeBps: number;
};

type SyncPlan = {
  capitalToken: Address;
  capitalAmount: bigint;
  capitalSymbol: SyncToken;
  profitToken: SyncToken;
  poolSwap: SyncLegPreview;
  outerArb: SyncLegPreview;
  poolOutputAfterFee: bigint;
  outerSettlementRaw: bigint;
  outerSettlementToken: Address;
  expectedProfit: bigint;
  keeperSwapFee: KeeperSwapFeePreview;
  direction: SyncDirection;
};

function keeperFeeOnInput(capitalAmount: bigint, feePips: bigint): bigint {
  return (capitalAmount * feePips) / PIPS_DENOMINATOR;
}

function buildSyncPlan(onChain: OnChainSyncPreview, targetPriceScaled: bigint): SyncPlan {
  const capitalSymbol = tokenSymbol(onChain.poolSwapTokenIn);
  const poolOutSymbol = tokenSymbol(onChain.poolSwapTokenOut);
  const feePips = BigInt(onChain.keeperSwapFeeBps);
  const capitalAmount = onChain.poolInputToReachTarget;
  const poolOutputAfterFee = poolOutputAfterKeeperFee(
    onChain.poolOutputToReachTarget,
    feePips,
  );

  const poolSwap: SyncLegPreview = {
    amountInRaw: capitalAmount.toString(),
    amountOutRaw: onChain.poolOutputToReachTarget.toString(),
    tokenIn: capitalSymbol,
    tokenOut: poolOutSymbol,
  };

  let outerArb: SyncLegPreview;
  let outerSettlementRaw: bigint;
  let outerSettlementToken: Address;
  let expectedProfit: bigint;

  const profitToken: SyncToken = "USDT";
  const direction: SyncDirection =
    capitalSymbol === "USDT" ? "poolBelowOracle" : "poolAboveOracle";

  const idealPoolOut = onChain.poolOutputToReachTarget;

  if (poolOutSymbol === "WETH") {
    const routerUsdtOut = usdtRawForWethWei(poolOutputAfterFee, targetPriceScaled);
    outerArb = {
      amountInRaw: poolOutputAfterFee.toString(),
      amountOutRaw: routerUsdtOut.toString(),
      tokenIn: "WETH",
      tokenOut: "USDT",
    };
    outerSettlementRaw = routerUsdtOut;
    outerSettlementToken = USDT as Address;
    // USDT profit = outer USDT − USDT capital (outer sells discounted WETH output).
    expectedProfit =
      routerUsdtOut > capitalAmount ? routerUsdtOut - capitalAmount : 0n;
  } else {
    const routerWethOut = wethRawForUsdtRaw(poolOutputAfterFee, targetPriceScaled);
    outerArb = {
      amountInRaw: poolOutputAfterFee.toString(),
      amountOutRaw: routerWethOut.toString(),
      tokenIn: "USDT",
      tokenOut: "WETH",
    };
    outerSettlementRaw = routerWethOut;
    outerSettlementToken = WETH as Address;
    // WETH capital / USDT profit: outer spends poolOutputAfterFee USDT; pool pays ~ideal USDT.
    // On-chain actualProfit ≈ idealPoolUsdt − outerUsdtIn (leftover USDT on executor).
    expectedProfit =
      idealPoolOut > poolOutputAfterFee ? idealPoolOut - poolOutputAfterFee : 0n;
  }

  return {
    capitalToken: onChain.poolSwapTokenIn,
    capitalAmount,
    capitalSymbol,
    profitToken,
    poolSwap,
    outerArb,
    poolOutputAfterFee,
    outerSettlementRaw,
    outerSettlementToken,
    expectedProfit,
    keeperSwapFee: {
      token: capitalSymbol,
      amountRaw: keeperFeeOnInput(capitalAmount, feePips).toString(),
      feePips: onChain.keeperSwapFeeBps,
    },
    direction,
  };
}

function encodeSyncExtension(
  targetPriceScaled: bigint,
  externalSwap: Hex,
  minDonateBps: number,
): Hex {
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "version", type: "uint8" },
          { name: "actions", type: "uint8" },
          {
            name: "traits",
            type: "tuple",
            components: [
              { name: "donateMode", type: "uint8" },
              { name: "donateParam", type: "uint16" },
              { name: "payoutType", type: "uint8" },
              { name: "recipient", type: "address" },
            ],
          },
          {
            name: "feed",
            type: "tuple",
            components: [{ name: "payload", type: "bytes" }],
          },
          {
            name: "sync",
            type: "tuple",
            components: [
              { name: "targetPriceScaled", type: "uint256" },
              { name: "priceDecimals", type: "uint8" },
              { name: "externalSwap", type: "bytes" },
            ],
          },
        ],
      },
    ],
    [
      {
        version: 1,
        actions: ACTION_SYNC,
        traits: {
          donateMode: DONATE_MIN_ONLY,
          donateParam: 0,
          payoutType: PAYOUT_WRAPPED,
          recipient: "0x0000000000000000000000000000000000000000" as Address,
        },
        feed: { payload: "0x" },
        sync: {
          targetPriceScaled,
          priceDecimals: PRICE_DECIMALS,
          externalSwap,
        },
      },
    ],
  );
}

function packExternalSwap(
  mockRouter: Address,
  inputToken: Address,
  inputAmount: bigint,
  profitToken: Address,
  profitAmount: bigint,
): Hex {
  const calldata = encodeFunctionData({
    abi: MOCK_ROUTER_ABI,
    functionName: "simulateArb",
    args: [inputToken, inputAmount, profitToken, profitAmount],
  });
  return concat([pad(mockRouter, { size: 20 }), calldata]);
}

function computeDistribution(
  capitalAmount: bigint,
  expectedProfit: bigint,
  minDonateBps: number,
): { donation: bigint; keeperPayout: bigint; capitalReturned: bigint } {
  if (expectedProfit <= 0n) {
    return { donation: 0n, keeperPayout: 0n, capitalReturned: capitalAmount };
  }
  const donation = (expectedProfit * BigInt(minDonateBps)) / BPS;
  const keeperPayout = expectedProfit > donation ? expectedProfit - donation : 0n;
  return { donation, keeperPayout, capitalReturned: capitalAmount };
}

export async function previewKeeperSync(
  deployment: Deployment,
  targetPriceScaled: bigint,
): Promise<SyncKeeperPreview> {
  const client = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
  const poolId = deployment.addresses.hookedPoolId as Hex;
  const executor = deployment.addresses.executor as Address;
  const registry = deployment.addresses.registry as Address;

  const [preview, cfg] = await Promise.all([
    client.readContract({
      address: executor,
      abi: EXECUTOR_ABI,
      functionName: "previewSync",
      args: [poolId, targetPriceScaled, PRICE_DECIMALS],
    }),
    client.readContract({
      address: registry,
      abi: REGISTRY_ABI,
      functionName: "getPoolConfig",
      args: [poolId],
    }),
  ]);

  const plan = buildSyncPlan(
    {
      poolSwapTokenIn: preview.poolSwapTokenIn,
      poolSwapTokenOut: preview.poolSwapTokenOut,
      poolInputToReachTarget: preview.poolInputToReachTarget,
      poolOutputToReachTarget: preview.poolOutputToReachTarget,
      poolDeviationBps: preview.poolDeviationBps,
      keeperSwapFeeBps: preview.keeperSwapFeeBps,
    },
    targetPriceScaled,
  );

  const { donation, keeperPayout, capitalReturned } = computeDistribution(
    plan.capitalAmount,
    plan.expectedProfit,
    cfg.minDonateBps,
  );

  const deviation = Number(preview.poolDeviationBps);
  let canExecute = deviation > 0 && plan.expectedProfit > 0n;
  let reason: string | undefined;
  if (deviation === 0) {
    canExecute = false;
    reason = "Hooked pool price already matches oracle target";
  } else if (plan.expectedProfit <= 0n) {
    canExecute = false;
    reason =
      plan.direction === "poolBelowOracle"
        ? "Arb profit would not be positive (pool below oracle path)"
        : "Arb profit would not be positive (pool above oracle path)";
  }

  return {
    poolDeviationBps: deviation,
    targetPriceScaled: targetPriceScaled.toString(),
    direction: plan.direction,
    capitalToken: plan.capitalSymbol,
    poolSwap: plan.poolSwap,
    outerArb: plan.outerArb,
    keeperSwapFee: plan.keeperSwapFee,
    distribution: {
      capitalReturnedRaw: capitalReturned.toString(),
      keeperProfitRaw: keeperPayout.toString(),
      donationRaw: donation.toString(),
      profitToken: plan.profitToken,
      expectedProfitRaw: plan.expectedProfit.toString(),
      minDonateBps: cfg.minDonateBps,
    },
    canExecute,
    reason,
  };
}

export async function executeKeeperSync(
  deployment: Deployment,
  targetPriceScaled: bigint,
): Promise<{ result: SyncKeeperResult; txHashes: Hex[] }> {
  const preview = await previewKeeperSync(deployment, targetPriceScaled);
  if (!preview.canExecute) {
    throw new Error(preview.reason ?? "Keeper sync not available");
  }

  const client = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
  const actor = getActorAccount("syncKeeper");
  const walletClient = createWalletClient({
    account: actor,
    chain: foundry,
    transport: http(ANVIL_RPC),
  });

  const poolId = deployment.addresses.hookedPoolId as Hex;
  const executor = deployment.addresses.executor as Address;
  const mockRouter = deployment.addresses.mockRouter as Address;

  const onChain = await client.readContract({
    address: executor,
    abi: EXECUTOR_ABI,
    functionName: "previewSync",
    args: [poolId, targetPriceScaled, PRICE_DECIMALS],
  });

  const plan = buildSyncPlan(
    {
      poolSwapTokenIn: onChain.poolSwapTokenIn,
      poolSwapTokenOut: onChain.poolSwapTokenOut,
      poolInputToReachTarget: onChain.poolInputToReachTarget,
      poolOutputToReachTarget: onChain.poolOutputToReachTarget,
      poolDeviationBps: onChain.poolDeviationBps,
      keeperSwapFeeBps: onChain.keeperSwapFeeBps,
    },
    targetPriceScaled,
  );

  const capitalAmount = plan.capitalAmount;
  const capitalToken = plan.capitalToken;
  const expectedProfit = plan.expectedProfit;

  const externalSwap = packExternalSwap(
    mockRouter,
    onChain.poolSwapTokenOut,
    plan.poolOutputAfterFee,
    plan.outerArb.tokenOut === "USDT" ? (USDT as Address) : (WETH as Address),
    plan.outerSettlementRaw,
  );
  const extension = encodeSyncExtension(targetPriceScaled, externalSwap, preview.distribution.minDonateBps);

  const txHashes: Hex[] = [];

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
    executor,
    capitalAmount,
  );
  txHashes.push(...approveHashes);

  const allowanceAbi = [
    {
      type: "function",
      name: "allowance",
      inputs: [{ type: "address" }, { type: "address" }],
      outputs: [{ type: "uint256" }],
      stateMutability: "view",
    },
  ] as const;

  const [keeperBal, keeperAllowance, routerUsdtBal] = await Promise.all([
    client.readContract({
      address: capitalToken,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [actor.address],
    }),
    client.readContract({
      address: capitalToken,
      abi: allowanceAbi,
      functionName: "allowance",
      args: [actor.address, executor],
      blockTag: approveHashes.length > 0 ? "pending" : "latest",
    }),
    client.readContract({
      address: plan.outerSettlementToken,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [mockRouter],
    }),
  ]);

  const intent = {
    poolId,
    capitalToken,
    capitalAmount,
    profitToken: USDT as Address,
    expectedProfit,
    extension,
  };

  logJson("[sync] executeKeeperSync intent", {
    keeper: actor.address,
    executor,
    mockRouter,
    direction: plan.direction,
    targetPriceScaled: targetPriceScaled.toString(),
    preview: {
      poolInput: onChain.poolInputToReachTarget.toString(),
      poolOutputIdeal: onChain.poolOutputToReachTarget.toString(),
      poolOutputAfterFee: plan.poolOutputAfterFee.toString(),
      keeperSwapFeeBps: onChain.keeperSwapFeeBps,
      outerSettlement: plan.outerSettlementRaw.toString(),
      expectedProfit: expectedProfit.toString(),
      deviationBps: onChain.poolDeviationBps.toString(),
    },
    balances: {
      keeperCapital: keeperBal.toString(),
      keeperAllowance: keeperAllowance.toString(),
      mockRouterUsdt: routerUsdtBal.toString(),
    },
    externalSwapLen: externalSwap.length,
  });

  if (approveHashes.length > 0) {
    try {
      await client.simulateContract({
        account: actor.address,
        address: executor,
        abi: EXECUTOR_ABI,
        functionName: "executeWithIntent",
        args: [intent],
        blockTag: "pending",
      });
      console.log("[sync] simulateContract OK (pending block incl. approve)");
    } catch (err) {
      const reason = formatContractError(err);
      console.error("[sync] simulateContract reverted:", reason);
      throw new Error(`Keeper sync would revert: ${reason}`);
    }
  }

  const execHash = await sendContractTx(walletClient, {
    address: executor,
    abi: EXECUTOR_ABI,
    functionName: "executeWithIntent",
    args: [intent],
  });
  txHashes.push(execHash);

  return {
    txHashes,
    result: {
      txHash: execHash,
      actualProfit: preview.distribution.expectedProfitRaw,
      donationAmount: preview.distribution.donationRaw,
      keeperPayout: preview.distribution.keeperProfitRaw,
      capitalReturned: preview.distribution.capitalReturnedRaw,
      profitToken: "USDT",
    },
  };
}

/** Parse KeeperIntentExecuted after block is mined (do not call with automine off). */
export async function finalizeKeeperSyncResult(result: SyncKeeperResult): Promise<SyncKeeperResult> {
  const client = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
  const receipt = await client.getTransactionReceipt({ hash: result.txHash });
  if (!receipt) return result;
  if (receipt.status === "reverted") {
    const { explainRevertedTx } = await import("./revertDecode.js");
    throw new Error(await explainRevertedTx(result.txHash, "executeWithIntent"));
  }

  const { parseEventLogs } = await import("viem");
  const logs = parseEventLogs({ abi: INTENT_EXECUTED_ABI, logs: receipt.logs });
  const match = logs.find((l) => l.eventName === "KeeperIntentExecuted");
  if (!match?.args) return result;

  return {
    ...result,
    actualProfit: (match.args.actualProfit ?? 0n).toString(),
    donationAmount: (match.args.donationAmount ?? 0n).toString(),
    keeperPayout: (match.args.keeperPayout ?? 0n).toString(),
    capitalReturned: (match.args.capitalReturned ?? 0n).toString(),
  };
}
