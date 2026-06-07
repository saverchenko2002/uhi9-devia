import { createPublicClient, http } from "viem";
import { foundry } from "viem/chains";
import { ANVIL_RPC, FORK_BLOCK } from "./accounts.js";

export type BlockState = {
  forkBlock: number;
  currentBlock: number;
  feedSyncBlock: number | null;
  poolSyncBlock: number | null;
};

let blockState: BlockState = {
  forkBlock: FORK_BLOCK,
  currentBlock: FORK_BLOCK,
  feedSyncBlock: null,
  poolSyncBlock: null,
};

export function resetBlockState(forkBlock: number = FORK_BLOCK): BlockState {
  blockState = {
    forkBlock,
    currentBlock: forkBlock,
    feedSyncBlock: null,
    poolSyncBlock: null,
  };
  return getBlockState();
}

export function getBlockState(): BlockState {
  return { ...blockState };
}

export function markFeedSync(blockNumber: number): void {
  blockState.feedSyncBlock = blockNumber;
}

export function markPoolSync(blockNumber: number): void {
  blockState.poolSyncBlock = blockNumber;
}

function publicClient() {
  return createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
}

export async function syncCurrentBlockFromChain(): Promise<number> {
  const n = Number(await publicClient().getBlockNumber());
  blockState.currentBlock = n;
  return n;
}

/** Disable auto-mine so each demo operation advances exactly one block. */
export async function configureDemoMining(enabled = false): Promise<void> {
  await publicClient().request({ method: "evm_setAutomine", params: [enabled] });
}

export async function mineBlocks(count = 1): Promise<number> {
  const client = publicClient();
  for (let i = 0; i < count; i++) {
    await client.request({ method: "evm_mine", params: [] });
  }
  const n = Number(await client.getBlockNumber());
  blockState.currentBlock = n;
  return n;
}

/** Queue txs via `run`, then mine once (+1 block). */
export async function runBlockOperation(run: () => Promise<void>): Promise<number> {
  await configureDemoMining();
  await run();
  return mineBlocks(1);
}
