import { createPublicClient, http, type Address, type Hex } from "viem";
import { foundry } from "viem/chains";
import { ANVIL_RPC } from "./accounts.js";
import type { Deployment } from "./deploy.js";

const ZERO = "0x0000000000000000000000000000000000000000";

const SYNC_KEEPERS_ABI = [
  {
    type: "function",
    name: "getActiveSyncKeeper",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "keeper", type: "address" },
      { name: "qualityBps", type: "uint32" },
      { name: "windowEndBlock", type: "uint32" },
      { name: "isActive", type: "bool" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "lastSyncBlock",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;

export type SyncKeeperChainStatus = {
  keeper: Address | null;
  isActive: boolean;
  registered: boolean;
  qualityBps: number;
  lastSyncBlock: number | null;
  windowEndBlock: number | null;
  currentBlock: number;
  blocksUntilExpiry: number | null;
};

export type ReadSyncKeeperStatusOpts = {
  /** Demo swaps mine +1 block after preview; pass 1 to match on-chain execution. */
  blockOffset?: number;
};

export async function readSyncKeeperStatus(
  deployment: Deployment,
  opts: ReadSyncKeeperStatusOpts = {},
): Promise<SyncKeeperChainStatus> {
  const blockOffset = opts.blockOffset ?? 0;
  const client = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
  const poolId = deployment.addresses.hookedPoolId as Hex;
  const syncKeepers = deployment.addresses.syncKeepers as Address;

  const [syncResult, lastSync, currentBlock] = await Promise.all([
    client.readContract({
      address: syncKeepers,
      abi: SYNC_KEEPERS_ABI,
      functionName: "getActiveSyncKeeper",
      args: [poolId],
    }),
    client.readContract({
      address: syncKeepers,
      abi: SYNC_KEEPERS_ABI,
      functionName: "lastSyncBlock",
      args: [poolId],
    }),
    client.getBlockNumber(),
  ]);

  const [keeperAddr, qualityBps, windowEndBlockRaw, isActive] = syncResult;
  const keeper = keeperAddr.toLowerCase() === ZERO ? null : keeperAddr;
  const lastSyncBlock = lastSync > 0n ? Number(lastSync) : null;
  const registered = lastSyncBlock != null;
  const windowEndBlock =
    lastSyncBlock != null && windowEndBlockRaw > 0 ? Number(windowEndBlockRaw) : null;
  const blockNum = Number(currentBlock);
  const executionBlock = blockNum + blockOffset;
  const activeAtExecution =
    keeper != null && windowEndBlock != null && executionBlock <= windowEndBlock;

  let blocksUntilExpiry: number | null = null;
  if (activeAtExecution && windowEndBlock != null) {
    blocksUntilExpiry = Math.max(0, windowEndBlock - executionBlock);
  }

  return {
    keeper,
    isActive: activeAtExecution,
    registered,
    qualityBps,
    lastSyncBlock,
    windowEndBlock,
    currentBlock: blockNum,
    blocksUntilExpiry,
  };
}
