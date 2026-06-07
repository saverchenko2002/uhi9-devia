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

export async function waitForAllReceipts(hashes: Hex[]): Promise<void> {
  if (hashes.length === 0) return;
  const client = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
  const failures: string[] = [];

  for (const hash of hashes) {
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") {
      failures.push(hash);
    }
  }

  await stopUsdtWhaleImpersonation();

  if (failures.length > 0) {
    throw new Error(`Transaction(s) reverted: ${failures.join(", ")}`);
  }
}
