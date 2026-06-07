import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  http,
  parseAbiParameters,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { foundry } from "viem/chains";
import { ANVIL_RPC, getActorAccount } from "./accounts.js";
import type { Deployment } from "./deploy.js";
import { sendContractTx } from "./tx.js";

export const ETH_USD_FEED_ID =
  "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace" as const;

const MOCK_PYTH_ABI = [
  {
    type: "function",
    name: "getUpdateFee",
    inputs: [{ name: "updateData", type: "bytes[]" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;

const KEEPER_EXECUTOR_ABI = [
  {
    type: "function",
    name: "executeFeedOnly",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "feedPayload", type: "bytes" },
    ],
    outputs: [
      { name: "publishTime", type: "uint64" },
      { name: "qualityBps", type: "uint32" },
    ],
    stateMutability: "payable",
  },
] as const;

const FEED_KEEPERS_ABI = [
  {
    type: "function",
    name: "getLastPublishTime",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [{ type: "uint64" }],
    stateMutability: "view",
  },
] as const;

export type FeedSyncResult = {
  txHash: Hex;
  publishTime: bigint;
  priceScaled: string;
};

function buildSingleUpdate(priceScaled: bigint, publishTime: bigint): Hex {
  const price = priceScaled;
  return encodeAbiParameters(
    parseAbiParameters(
      "(bytes32 id, (int64 price, uint64 conf, int32 expo, uint64 publishTime) price, (int64 price, uint64 conf, int32 expo, uint64 publishTime) emaPrice)",
    ),
    [
      {
        id: ETH_USD_FEED_ID,
        price: { price, conf: 0n, expo: -8n, publishTime },
        emaPrice: { price, conf: 0n, expo: -8n, publishTime },
      },
    ],
  );
}

export function buildFeedPayload(priceScaled: bigint, publishTime: bigint): Hex {
  const singleUpdate = buildSingleUpdate(priceScaled, publishTime);
  return encodeAbiParameters(parseAbiParameters("bytes[]"), [[singleUpdate]]);
}

async function nextPublishTime(
  client: ReturnType<typeof createPublicClient>,
  deployment: Deployment,
): Promise<bigint> {
  const block = await client.getBlock();
  let publishTime = block.timestamp;

  const poolId = deployment.addresses.hookedPoolId as Hex;
  const feedKeepers = deployment.addresses.feedKeepers as Address;
  if (feedKeepers) {
    try {
      const last = await client.readContract({
        address: feedKeepers,
        abi: FEED_KEEPERS_ABI,
        functionName: "getLastPublishTime",
        args: [poolId],
      });
      if (publishTime <= last) publishTime = last + 1n;
    } catch {
      /* first feed update */
    }
  }

  return publishTime;
}

async function fundFeedKeeper(client: ReturnType<typeof createPublicClient>, address: Address) {
  await client.request({
    method: "anvil_setBalance",
    params: [address, `0x${parseEther("1").toString(16)}`],
  });
}

export async function sendExecuteFeedOnly(
  deployment: Deployment,
  priceScaled: bigint,
): Promise<FeedSyncResult> {
  const account = getActorAccount("feedKeeper");
  const client = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
  const walletClient = createWalletClient({
    account,
    chain: foundry,
    transport: http(ANVIL_RPC),
  });

  await fundFeedKeeper(client, account.address);

  const publishTime = await nextPublishTime(client, deployment);
  const singleUpdate = buildSingleUpdate(priceScaled, publishTime);
  const feedPayload = buildFeedPayload(priceScaled, publishTime);

  const mockPyth = deployment.addresses.mockPyth as Address;
  const fee = await client.readContract({
    address: mockPyth,
    abi: MOCK_PYTH_ABI,
    functionName: "getUpdateFee",
    args: [[singleUpdate]],
  });

  const hash = await sendContractTx(walletClient, {
    address: deployment.addresses.executor as Address,
    abi: KEEPER_EXECUTOR_ABI,
    functionName: "executeFeedOnly",
    args: [deployment.addresses.hookedPoolId as Hex, feedPayload],
    value: fee,
  });

  console.log("[feed] executeFeedOnly sent", {
    keeper: account.address,
    priceScaled: priceScaled.toString(),
    publishTime: publishTime.toString(),
    txHash: hash,
  });

  return { txHash: hash, publishTime, priceScaled: priceScaled.toString() };
}

export async function waitForFeedTx(hash: Hex): Promise<void> {
  const client = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
  await client.waitForTransactionReceipt({ hash });
}
