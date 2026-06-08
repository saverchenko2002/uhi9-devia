import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Address } from "viem";

/** Anvil default private keys (same order as `anvil` dev accounts). */
export const ANVIL_PRIVATE_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3aa350cf5c4cdb3609ac4caba2d5140e3f178fee3326590799930398156c00",
] as const;

/** Derived from keys — must match the account that signs txs for each key. */
export const ANVIL_ACCOUNTS = ANVIL_PRIVATE_KEYS.map(
  (key) => privateKeyToAccount(key).address,
) as readonly [Address, Address, Address, Address, Address, Address];

export const FORK_BLOCK = 25272364;
export const ANVIL_RPC = "http://127.0.0.1:8545";

export const OWNER = ANVIL_ACCOUNTS[0];
export const LP = ANVIL_ACCOUNTS[1];
export const SWAPPER = ANVIL_ACCOUNTS[2];
export const SYNC_KEEPER = ANVIL_ACCOUNTS[3];
export const PLAIN_ARB = ANVIL_ACCOUNTS[4];
export const FEED_KEEPER = ANVIL_ACCOUNTS[5];

export const ACTOR_IDS = ["owner", "lp", "swapper", "syncKeeper", "plainArb", "feedKeeper"] as const;
export type ActorId = (typeof ACTOR_IDS)[number];

export type Actor = {
  id: ActorId;
  label: string;
  address: Address;
  privateKey: (typeof ANVIL_PRIVATE_KEYS)[number];
};

export const ACTORS: Actor[] = [
  { id: "owner", label: "Owner (#0)", address: ANVIL_ACCOUNTS[0], privateKey: ANVIL_PRIVATE_KEYS[0] },
  { id: "lp", label: "LP (#1)", address: ANVIL_ACCOUNTS[1], privateKey: ANVIL_PRIVATE_KEYS[1] },
  { id: "swapper", label: "Swapper (#2)", address: ANVIL_ACCOUNTS[2], privateKey: ANVIL_PRIVATE_KEYS[2] },
  {
    id: "syncKeeper",
    label: "Sync keeper (#3)",
    address: ANVIL_ACCOUNTS[3],
    privateKey: ANVIL_PRIVATE_KEYS[3],
  },
  {
    id: "plainArb",
    label: "Plain arb (#4)",
    address: ANVIL_ACCOUNTS[4],
    privateKey: ANVIL_PRIVATE_KEYS[4],
  },
  {
    id: "feedKeeper",
    label: "Feed keeper (#5)",
    address: ANVIL_ACCOUNTS[5],
    privateKey: ANVIL_PRIVATE_KEYS[5],
  },
];

export function getActor(id: ActorId): Actor {
  const actor = ACTORS.find((a) => a.id === id);
  if (!actor) throw new Error(`Unknown actor: ${id}`);
  return actor;
}

/** Signer account for an actor — address always matches the private key. */
export function getActorAccount(id: ActorId): PrivateKeyAccount {
  const actor = getActor(id);
  const account = privateKeyToAccount(actor.privateKey);
  if (account.address.toLowerCase() !== actor.address.toLowerCase()) {
    throw new Error(`Actor ${id}: address/key mismatch`);
  }
  return account;
}
