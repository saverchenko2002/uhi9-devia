import {
  createPublicClient,
  createTestClient,
  http,
  parseEther,
  publicActions,
  walletActions,
  type Address,
  type Hex,
  type WalletClient,
} from "viem";
import { foundry } from "viem/chains";
import { ANVIL_RPC } from "./accounts.js";
import { USDT, WETH } from "./constants.js";

/** Binance hot wallet — large USDT balance on mainnet fork. */
const USDT_WHALE = "0xF977814e90dA44bFA03b6295A0616a897441aceC" as Address;

const WETH_DEPOSIT_ABI = [
  {
    type: "function",
    name: "deposit",
    inputs: [],
    outputs: [],
    stateMutability: "payable",
  },
] as const;

const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

function createAnvilTestClient() {
  return createTestClient({
    chain: foundry,
    mode: "anvil",
    transport: http(ANVIL_RPC),
  })
    .extend(publicActions)
    .extend(walletActions);
}

function createAnvilPublicClient() {
  return createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
}

/** Wrap native ETH (Anvil account balance) into WETH. */
export async function fundWeth(
  walletClient: WalletClient,
  amount: bigint,
): Promise<Hex> {
  const account = walletClient.account;
  if (!account) throw new Error("fundWeth: walletClient has no account");
  const publicClient = createAnvilPublicClient();
  const ethBefore = await publicClient.getBalance({ address: account.address });
  console.log("[seed] fundWeth: deposit start", {
    account: account.address,
    amountWei: amount.toString(),
    ethBefore: ethBefore.toString(),
  });

  const hash = await walletClient.writeContract({
    address: WETH,
    abi: WETH_DEPOSIT_ABI,
    functionName: "deposit",
    value: amount,
    chain: foundry,
  });
  await publicClient.waitForTransactionReceipt({ hash });

  const [ethAfter, wethBal] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    publicClient.readContract({
      address: WETH,
      abi: [{ type: "function", name: "balanceOf", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" }],
      functionName: "balanceOf",
      args: [account.address],
    }),
  ]);
  console.log("[seed] fundWeth: deposit done", {
    txHash: hash,
    ethAfter: ethAfter.toString(),
    wethBalance: wethBal.toString(),
  });
  return hash;
}

/** Transfer USDT from an impersonated mainnet whale. */
export async function fundUsdt(recipient: Address, amount: bigint): Promise<Hex> {
  const testClient = createAnvilTestClient();
  const publicClient = createAnvilPublicClient();

  console.log("[seed] fundUsdt: transfer start", {
    recipient,
    amount: amount.toString(),
    whale: USDT_WHALE,
  });

  await testClient.impersonateAccount({ address: USDT_WHALE });
  await testClient.setBalance({ address: USDT_WHALE, value: parseEther("10") });

  const hash = await testClient.writeContract({
    account: USDT_WHALE,
    address: USDT,
    abi: ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args: [recipient, amount],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  await testClient.stopImpersonatingAccount({ address: USDT_WHALE });

  const usdtBal = await publicClient.readContract({
    address: USDT,
    abi: [{ type: "function", name: "balanceOf", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" }],
    functionName: "balanceOf",
    args: [recipient],
  });
  console.log("[seed] fundUsdt: transfer done", {
    txHash: hash,
    recipientUsdtBalance: usdtBal.toString(),
  });
  return hash;
}
