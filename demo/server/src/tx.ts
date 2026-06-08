import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  type Abi,
  type Address,
  type Hex,
  type WalletClient,
} from "viem";
import { foundry } from "viem/chains";
import { ANVIL_RPC } from "./accounts.js";
import { explainRevertedTx } from "./revertDecode.js";
import { stopUsdtWhaleImpersonation } from "./tokens.js";

const ANVIL_GAS = 15_000_000n;

export async function sendContractTx(
  walletClient: WalletClient,
  params: {
    address: Address;
    abi: Abi | readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
    value?: bigint;
  },
): Promise<Hex> {
  const account = walletClient.account;
  if (!account) throw new Error("sendContractTx: walletClient has no account");

  const data = encodeFunctionData({
    abi: params.abi,
    functionName: params.functionName,
    args: params.args,
  });

  return walletClient.sendTransaction({
    account,
    chain: foundry,
    to: params.address,
    data,
    value: params.value ?? 0n,
    gas: ANVIL_GAS,
  });
}

const RECEIPT_TIMEOUT_MS = 45_000;

export async function waitForAllReceipts(hashes: Hex[]): Promise<void> {
  if (hashes.length === 0) return;
  const client = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
  const failureDetails: string[] = [];

  for (const hash of hashes) {
    let receipt;
    try {
      receipt = await client.waitForTransactionReceipt({
        hash,
        timeout: RECEIPT_TIMEOUT_MS,
        pollingInterval: 500,
      });
    } catch {
      throw new Error(
        `Transaction not mined within ${RECEIPT_TIMEOUT_MS / 1000}s: ${hash} (is automine off and block not mined?)`,
      );
    }
    if (receipt.status === "reverted") {
      const detail = await explainRevertedTx(hash);
      console.error("[tx] reverted:", detail);
      failureDetails.push(detail);
    }
  }

  await stopUsdtWhaleImpersonation();

  if (failureDetails.length > 0) {
    throw new Error(failureDetails.join(" | "));
  }
}
