import { createPublicClient, createTestClient, createWalletClient, http, parseEther, publicActions, walletActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { fundUsdt } from "../src/tokens.js";
import { USDT } from "../src/constants.js";
import { ANVIL_RPC, getActor } from "../src/accounts.js";

const actor = getActor("lp");
const account = privateKeyToAccount(actor.privateKey);
const router = "0xf5c1078628a8da58feb58e750c77912619a3a014";
const pc = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
const wc = createWalletClient({ account, chain: foundry, transport: http(ANVIL_RPC) });

const USDT_ABI = [
  { type: "function", name: "balanceOf", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "allowance", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "approve", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
  { type: "function", name: "getBlackListStatus", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "bool" }], stateMutability: "view" },
];

await fundUsdt(actor.address, 300_000_000_000n);
const [bal, allow, black] = await Promise.all([
  pc.readContract({ address: USDT, abi: USDT_ABI, functionName: "balanceOf", args: [actor.address] }),
  pc.readContract({ address: USDT, abi: USDT_ABI, functionName: "allowance", args: [actor.address, router] }),
  pc.readContract({ address: USDT, abi: USDT_ABI, functionName: "getBlackListStatus", args: [actor.address] }).catch(() => null),
]);
console.log({ bal: bal.toString(), allow: allow.toString(), blacklisted: black });

try {
  const h = await wc.writeContract({ address: USDT, abi: USDT_ABI, functionName: "approve", args: [router, 0n], chain: foundry });
  await pc.waitForTransactionReceipt({ hash: h });
  console.log("approve(0) ok");
} catch (e) {
  console.log("approve(0) fail", e.shortMessage);
}

try {
  const h = await wc.writeContract({ address: USDT, abi: USDT_ABI, functionName: "approve", args: [router, 300_000_000_000n], chain: foundry });
  await pc.waitForTransactionReceipt({ hash: h });
  console.log("approve(amount) ok");
} catch (e) {
  console.log("approve(amount) fail", e.shortMessage);
}

const testClient = createTestClient({ chain: foundry, mode: "anvil", transport: http(ANVIL_RPC) }).extend(publicActions).extend(walletActions);
await testClient.setBalance({ address: actor.address, value: parseEther("10") });
try {
  const h = await testClient.writeContract({
    account: actor.address,
    address: USDT,
    abi: USDT_ABI,
    functionName: "approve",
    args: [router, 300_000_000_000n],
  });
  await pc.waitForTransactionReceipt({ hash: h });
  console.log("testClient approve ok");
} catch (e) {
  console.log("testClient approve fail", e.shortMessage);
}
