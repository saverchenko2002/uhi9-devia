import { createPublicClient, createWalletClient, formatEther, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { fundWeth } from "../src/tokens.js";
import { WETH } from "../src/constants.js";
import { ANVIL_RPC, getActor } from "../src/accounts.js";

const actor = getActor("lp");
const account = privateKeyToAccount(actor.privateKey);
const pc = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
const wc = createWalletClient({ account, chain: foundry, transport: http(ANVIL_RPC) });
const ethBefore = await pc.getBalance({ address: actor.address });
console.log("eth before", formatEther(ethBefore));
const hash = await fundWeth(wc, parseEther("100"));
console.log("deposit tx", hash);
const [ethAfter, wethBal] = await Promise.all([
  pc.getBalance({ address: actor.address }),
  pc.readContract({
    address: WETH,
    abi: [{ type: "function", name: "balanceOf", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" }],
    functionName: "balanceOf",
    args: [actor.address],
  }),
]);
console.log("eth after", formatEther(ethAfter));
console.log("weth", wethBal.toString());
