import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { fundUsdt, fundWeth } from "../src/tokens.js";
import {
  DYNAMIC_FEE_FLAG,
  fullRangeTickLower,
  fullRangeTickUpper,
  TICK_SPACING,
  USDT,
  WETH,
} from "../src/constants.js";
import { ANVIL_RPC, getActor } from "../src/accounts.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const deployment = JSON.parse(readFileSync(resolve(root, "deployments.json"), "utf8"));

const ERC20_ABI = [
  { type: "function", name: "balanceOf", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "allowance", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "approve", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
];

const LIQ_ROUTER_ABI = [
  {
    type: "function",
    name: "addLiquidityFromAmounts",
    inputs: [
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      { name: "tickLower", type: "int24" },
      { name: "tickUpper", type: "int24" },
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
      { name: "payer", type: "address" },
    ],
    outputs: [{ name: "delta", type: "int256" }],
    stateMutability: "payable",
  },
];

const actor = getActor("lp");
const account = privateKeyToAccount(actor.privateKey);
const wethWei = parseEther("100");
const usdtRaw = 300_000_000_000n;
const liqRouter = deployment.addresses.liqRouter;
const hook = deployment.addresses.dynamicFeeHook;

const publicClient = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
const walletClient = createWalletClient({ account, chain: foundry, transport: http(ANVIL_RPC) });

console.log("Funding...");
await fundWeth(walletClient, wethWei);
await fundUsdt(actor.address, usdtRaw);

async function approve(token, amount) {
  const allowance = await publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [actor.address, liqRouter],
  });
  if (allowance >= amount) return;
  if (token.toLowerCase() === USDT.toLowerCase()) {
    const h0 = await walletClient.writeContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [liqRouter, 0n],
      chain: foundry,
    });
    await publicClient.waitForTransactionReceipt({ hash: h0 });
    const h1 = await walletClient.writeContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [liqRouter, amount],
      chain: foundry,
    });
    await publicClient.waitForTransactionReceipt({ hash: h1 });
    return;
  }
  const h = await walletClient.writeContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [liqRouter, amount],
    chain: foundry,
  });
  await publicClient.waitForTransactionReceipt({ hash: h });
}

await approve(WETH, wethWei);
await approve(USDT, usdtRaw);

const [wethBal, usdtBal, wethAllow, usdtAllow] = await Promise.all([
  publicClient.readContract({ address: WETH, abi: ERC20_ABI, functionName: "balanceOf", args: [actor.address] }),
  publicClient.readContract({ address: USDT, abi: ERC20_ABI, functionName: "balanceOf", args: [actor.address] }),
  publicClient.readContract({ address: WETH, abi: ERC20_ABI, functionName: "allowance", args: [actor.address, liqRouter] }),
  publicClient.readContract({ address: USDT, abi: ERC20_ABI, functionName: "allowance", args: [actor.address, liqRouter] }),
]);

console.log({ wethBal: wethBal.toString(), usdtBal: usdtBal.toString(), wethAllow: wethAllow.toString(), usdtAllow: usdtAllow.toString() });

const key = {
  currency0: WETH,
  currency1: USDT,
  fee: DYNAMIC_FEE_FLAG,
  tickSpacing: TICK_SPACING,
  hooks: hook,
};

const sqrtPriceX96 = 4339505179874779489431521n;

try {
  const result = await publicClient.simulateContract({
    account: actor.address,
    address: liqRouter,
    abi: LIQ_ROUTER_ABI,
    functionName: "addLiquidityFromAmounts",
    args: [key, fullRangeTickLower(), fullRangeTickUpper(), sqrtPriceX96, wethWei, usdtRaw, actor.address],
  });
  console.log("simulate ok", result.result);
} catch (e) {
  console.error("simulate failed");
  console.error(e.shortMessage ?? e.message);
  if (e.cause) console.error("cause:", e.cause.shortMessage ?? e.cause.message);
  if (e.cause?.data) console.error("data:", e.cause.data);
}
