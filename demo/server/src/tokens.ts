import {
  createPublicClient,
  createTestClient,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  keccak256,
  pad,
  parseEther,
  publicActions,
  toHex,
  walletActions,
  type Address,
  type Hex,
  type WalletClient,
} from "viem";
import { foundry } from "viem/chains";
import { ANVIL_RPC } from "./accounts.js";
import { USDT, WETH } from "./constants.js";
import { sendContractTx } from "./tx.js";

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

const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
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

export function createAnvilTestClient() {
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

/** USDT proxy `balances` mapping slot on mainnet fork. */
const USDT_BALANCES_SLOT = 2n;
/** WETH9 `balanceOf` mapping slot. */
const WETH_BALANCES_SLOT = 3n;
const USDT_ALLOWANCE_SLOT = 3n;
const WETH_ALLOWANCE_SLOT = 4n;

function erc20BalanceStorageSlot(holder: Address, mappingSlot: bigint): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [holder, mappingSlot],
    ),
  );
}

function erc20AllowanceStorageSlot(owner: Address, spender: Address, mappingSlot: bigint): Hex {
  const inner = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [owner, mappingSlot],
    ),
  );
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "bytes32" }],
      [spender, inner],
    ),
  );
}

async function readErc20StorageBalance(token: Address, holder: Address, mappingSlot: bigint): Promise<bigint> {
  const publicClient = createAnvilPublicClient();
  const slot = erc20BalanceStorageSlot(holder, mappingSlot);
  const raw = await publicClient.getStorageAt({ address: token, slot });
  return raw ? BigInt(raw) : 0n;
}

async function writeErc20StorageBalance(
  token: Address,
  holder: Address,
  mappingSlot: bigint,
  next: bigint,
): Promise<void> {
  const testClient = createAnvilTestClient();
  await testClient.setStorageAt({
    address: token,
    index: erc20BalanceStorageSlot(holder, mappingSlot),
    value: pad(toHex(next)),
  });
}

/** Credit WETH via storage write — no on-chain tx (safe for quotes with automine off). */
export async function fundWethDirect(recipient: Address, amount: bigint): Promise<void> {
  const current = await readErc20StorageBalance(WETH, recipient, WETH_BALANCES_SLOT);
  await writeErc20StorageBalance(WETH, recipient, WETH_BALANCES_SLOT, current + amount);
}

/**
 * On-chain approve (required for USDT — proxy allowance slot ≠ our storage hack).
 * Returns tx hashes to include in the same mined block as executeWithIntent.
 */
export async function ensureErc20Allowance(
  walletClient: WalletClient,
  token: Address,
  spender: Address,
  amount: bigint,
): Promise<Hex[]> {
  const account = walletClient.account;
  if (!account) throw new Error("ensureErc20Allowance: walletClient has no account");

  const publicClient = createAnvilPublicClient();
  const current = await publicClient.readContract({
    address: token,
    abi: ERC20_APPROVE_ABI,
    functionName: "allowance",
    args: [account.address, spender],
  });

  if (current >= amount) {
    console.log("[seed] allowance OK", {
      token,
      owner: account.address,
      spender,
      allowance: current.toString(),
    });
    return [];
  }

  const hashes: Hex[] = [];

  // Mainnet USDT: must reset to 0 before changing a non-zero allowance.
  if (token.toLowerCase() === USDT.toLowerCase() && current > 0n) {
    const zeroHash = await sendContractTx(walletClient, {
      address: token,
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [spender, 0n],
    });
    hashes.push(zeroHash);
    console.log("[seed] usdt approve(0)", { txHash: zeroHash });
  }

  const approveHash = await sendContractTx(walletClient, {
    address: token,
    abi: ERC20_APPROVE_ABI,
    functionName: "approve",
    args: [spender, amount],
  });
  hashes.push(approveHash);
  console.log("[seed] approve", {
    token,
    spender,
    amount: amount.toString(),
    txHash: approveHash,
  });

  return hashes;
}

/** Set ERC20 allowance via storage — WETH only; USDT proxy slot is unreliable. */
export async function setAllowanceDirect(
  token: Address,
  owner: Address,
  spender: Address,
  amount: bigint,
): Promise<void> {
  if (token.toLowerCase() === USDT.toLowerCase()) {
    throw new Error("setAllowanceDirect: use ensureErc20Allowance for USDT");
  }
  const mappingSlot = WETH_ALLOWANCE_SLOT;
  const testClient = createAnvilTestClient();
  await testClient.setStorageAt({
    address: token,
    index: erc20AllowanceStorageSlot(owner, spender, mappingSlot),
    value: pad(toHex(amount)),
  });
}

function usdtBalanceStorageSlot(holder: Address): Hex {
  return erc20BalanceStorageSlot(holder, USDT_BALANCES_SLOT);
}

const BALANCE_OF_ABI = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;

/** Credit USDT via storage write — no on-chain tx, safe for single-block batch seed. */
export async function fundUsdtDirect(recipient: Address, amount: bigint): Promise<void> {
  const publicClient = createAnvilPublicClient();
  const testClient = createAnvilTestClient();

  const current = await publicClient.readContract({
    address: USDT,
    abi: BALANCE_OF_ABI,
    functionName: "balanceOf",
    args: [recipient],
  });
  const next = current + amount;

  await testClient.setStorageAt({
    address: USDT,
    index: usdtBalanceStorageSlot(recipient),
    value: pad(toHex(next)),
  });

  console.log("[seed] fundUsdtDirect", {
    recipient,
    added: amount.toString(),
    balance: next.toString(),
  });
}

/** Wrap native ETH (Anvil account balance) into WETH. */
export async function fundWeth(
  walletClient: WalletClient,
  amount: bigint,
  waitReceipt = true,
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

  const hash = waitReceipt
    ? await walletClient.writeContract({
        address: WETH,
        abi: WETH_DEPOSIT_ABI,
        functionName: "deposit",
        value: amount,
        chain: foundry,
      })
    : await sendContractTx(walletClient, {
        address: WETH,
        abi: WETH_DEPOSIT_ABI,
        functionName: "deposit",
        value: amount,
      });
  if (waitReceipt) {
    await publicClient.waitForTransactionReceipt({ hash });
  }

  const [ethAfter, wethBal] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    publicClient.readContract({
      address: WETH,
      abi: BALANCE_OF_ABI,
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
export async function fundUsdt(recipient: Address, amount: bigint, waitReceipt = true): Promise<Hex> {
  const testClient = createAnvilTestClient();
  const publicClient = createAnvilPublicClient();

  console.log("[seed] fundUsdt: transfer start", {
    recipient,
    amount: amount.toString(),
    whale: USDT_WHALE,
  });

  await testClient.impersonateAccount({ address: USDT_WHALE });
  await testClient.setBalance({ address: USDT_WHALE, value: parseEther("10") });

  const hash = waitReceipt
    ? await testClient.writeContract({
        account: USDT_WHALE,
        address: USDT,
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: [recipient, amount],
      })
    : await testClient.sendTransaction({
        account: USDT_WHALE,
        to: USDT,
        data: encodeFunctionData({
          abi: ERC20_TRANSFER_ABI,
          functionName: "transfer",
          args: [recipient, amount],
        }),
        gas: 15_000_000n,
      });
  if (waitReceipt) {
    await publicClient.waitForTransactionReceipt({ hash });
    await testClient.stopImpersonatingAccount({ address: USDT_WHALE });
  }

  const usdtBal = await publicClient.readContract({
    address: USDT,
    abi: BALANCE_OF_ABI,
    functionName: "balanceOf",
    args: [recipient],
  });
  console.log("[seed] fundUsdt: transfer done", {
    txHash: hash,
    recipientUsdtBalance: usdtBal.toString(),
  });
  return hash;
}

export async function stopUsdtWhaleImpersonation(): Promise<void> {
  const testClient = createAnvilTestClient();
  await testClient.stopImpersonatingAccount({ address: USDT_WHALE });
}
