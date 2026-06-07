import { encodePacked, keccak256, type Address, type Hex } from "viem";
import type { Deployment } from "./deploy.js";
import { DYNAMIC_FEE_FLAG, PLAIN_POOL_FEE, TICK_SPACING } from "./constants.js";

const POOLS_SLOT = "0x0000000000000000000000000000000000000000000000000000000000000006" as Hex;

export function buildPoolKey(
  deployment: Deployment,
  pool: "hooked" | "plain",
): {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
} {
  const weth = deployment.weth as Address;
  const usdt = deployment.usdt as Address;
  const [currency0, currency1] =
    weth.toLowerCase() < usdt.toLowerCase() ? [weth, usdt] : [usdt, weth];

  if (pool === "hooked") {
    return {
      currency0,
      currency1,
      fee: DYNAMIC_FEE_FLAG,
      tickSpacing: TICK_SPACING,
      hooks: deployment.addresses.dynamicFeeHook as Address,
    };
  }

  return {
    currency0,
    currency1,
    fee: PLAIN_POOL_FEE,
    tickSpacing: TICK_SPACING,
    hooks: "0x0000000000000000000000000000000000000000",
  };
}

export function poolStateSlot(poolId: Hex): Hex {
  return keccak256(encodePacked(["bytes32", "bytes32"], [poolId, POOLS_SLOT]));
}
