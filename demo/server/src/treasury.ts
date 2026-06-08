import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { foundry } from "viem/chains";
import { ANVIL_RPC, getActorAccount, type ActorId } from "./accounts.js";
import { USDT, WETH } from "./constants.js";
import type { Deployment } from "./deploy.js";
import { sendContractTx } from "./tx.js";

const TREASURY_ABI = [
  {
    type: "function",
    name: "claimable",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "claim",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "nonpayable",
  },
] as const;

export type TreasuryClaimResult = {
  usdtClaimed: bigint;
  wethClaimed: bigint;
  txHashes: Hex[];
};

export async function readTreasuryClaimable(
  deployment: Deployment,
  keeperId: ActorId,
): Promise<{ usdt: bigint; weth: bigint }> {
  const client = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
  const treasury = deployment.addresses.keepersTreasury as Address;
  const keeper = getActorAccount(keeperId).address;

  const [usdt, weth] = await Promise.all([
    client.readContract({
      address: treasury,
      abi: TREASURY_ABI,
      functionName: "claimable",
      args: [keeper, USDT],
    }),
    client.readContract({
      address: treasury,
      abi: TREASURY_ABI,
      functionName: "claimable",
      args: [keeper, WETH],
    }),
  ]);

  return { usdt, weth };
}

export async function claimKeeperTreasury(
  deployment: Deployment,
  keeperId: ActorId,
  waitReceipt = false,
): Promise<TreasuryClaimResult> {
  const actor = getActorAccount(keeperId);
  const treasury = deployment.addresses.keepersTreasury as Address;
  const publicClient = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
  const walletClient = createWalletClient({
    account: actor,
    chain: foundry,
    transport: http(ANVIL_RPC),
  });

  const before = await readTreasuryClaimable(deployment, keeperId);
  const txHashes: Hex[] = [];

  for (const token of [USDT, WETH] as const) {
    const amount =
      token === USDT ? before.usdt : before.weth;
    if (amount === 0n) continue;

    const hash = waitReceipt
      ? await walletClient.writeContract({
          address: treasury,
          abi: TREASURY_ABI,
          functionName: "claim",
          args: [token, actor.address],
          chain: foundry,
        })
      : await sendContractTx(walletClient, {
          address: treasury,
          abi: TREASURY_ABI,
          functionName: "claim",
          args: [token, actor.address],
        });
    txHashes.push(hash);
    if (waitReceipt) await publicClient.waitForTransactionReceipt({ hash });
  }

  return {
    usdtClaimed: before.usdt,
    wethClaimed: before.weth,
    txHashes,
  };
}
