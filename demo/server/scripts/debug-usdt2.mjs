import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { USDT } from "../src/constants.js";
import { ANVIL_RPC, getActor } from "../src/accounts.js";

const actor = getActor("lp");
const account = privateKeyToAccount(actor.privateKey);
const router = "0xf5c1078628a8da58feb58e750c77912619a3a014";
const pc = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
const wc = createWalletClient({ account, chain: foundry, transport: http(ANVIL_RPC) });
const abi = [
  { type: "function", name: "allowance", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "approve", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
];

const allow = await pc.readContract({ address: USDT, abi, functionName: "allowance", args: [actor.address, router] });
console.log("allowance before", allow.toString());

try {
  const h = await wc.writeContract({ address: USDT, abi, functionName: "approve", args: [router, 300_000_000_000n], chain: foundry });
  await pc.waitForTransactionReceipt({ hash: h });
  console.log("direct approve ok");
} catch (e) {
  console.log("direct approve fail", e.shortMessage);
}
