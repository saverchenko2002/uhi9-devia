import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  decodeErrorResult,
  http,
  type Hex,
} from "viem";
import { foundry } from "viem/chains";
import { ANVIL_RPC } from "./accounts.js";

/** Custom errors from keeper sync pipeline (executor + KeeperSyncLib + related). */
export const KEEPER_SYNC_ERROR_ABI = [
  { type: "error", name: "ExecutionCallFailed", inputs: [] },
  { type: "error", name: "InsufficientUpdateFee", inputs: [{ type: "uint256" }, { type: "uint256" }] },
  { type: "error", name: "SyncActionRequired", inputs: [] },
  { type: "error", name: "CapitalTokenMismatch", inputs: [{ type: "address" }, { type: "address" }] },
  { type: "error", name: "InsufficientCapital", inputs: [{ type: "uint256" }, { type: "uint256" }] },
  { type: "error", name: "NonPositiveArbProfit", inputs: [{ type: "uint256" }] },
  { type: "error", name: "ImprovementTooSmall", inputs: [{ type: "uint256" }, { type: "uint256" }] },
  { type: "error", name: "SyncSlippageTooHigh", inputs: [{ type: "uint256" }, { type: "uint256" }] },
  { type: "error", name: "MinRequiredExceedsSurplus", inputs: [{ type: "uint256" }, { type: "uint256" }] },
  { type: "error", name: "ExternalSettlementRequired", inputs: [] },
  { type: "error", name: "InvalidVersion", inputs: [{ type: "uint8" }] },
  { type: "error", name: "MissingSyncTarget", inputs: [] },
  { type: "error", name: "ExecutionDataTooShort", inputs: [] },
  { type: "error", name: "InvalidDonateParam", inputs: [] },
  { type: "error", name: "Error", inputs: [{ name: "message", type: "string" }] },
  { type: "error", name: "Panic", inputs: [{ type: "uint256" }] },
] as const;

type CallTracerNode = {
  type?: string;
  from?: string;
  to?: string;
  input?: string;
  output?: string;
  error?: string;
  revertReason?: string;
  calls?: CallTracerNode[];
};

function stringifyBigInts(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(stringifyBigInts);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, stringifyBigInts(v)]),
    );
  }
  return value;
}

export function logJson(label: string, value: unknown): void {
  console.log(label, JSON.stringify(stringifyBigInts(value), null, 2));
}

export function decodeKnownRevert(data: Hex | undefined): string | undefined {
  if (!data || data === "0x") return undefined;
  try {
    const decoded = decodeErrorResult({ abi: KEEPER_SYNC_ERROR_ABI, data });
    const args =
      decoded.args && decoded.args.length > 0
        ? `(${decoded.args.map((a) => String(a)).join(", ")})`
        : "";
    return `${decoded.errorName}${args}`;
  } catch {
    return `raw ${data.slice(0, 74)}${data.length > 74 ? "…" : ""}`;
  }
}

export function formatContractError(err: unknown): string {
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const named = decodeKnownRevert(reverted.data);
      if (named) return named;
      if (reverted.reason) return reverted.reason;
      if (reverted.data) return `revert data ${reverted.data}`;
    }
    return err.shortMessage || err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

function deepestTraceError(node: CallTracerNode): string | undefined {
  let best: string | undefined;
  for (const child of node.calls ?? []) {
    const nested = deepestTraceError(child);
    if (nested) best = nested;
  }
  const local = node.revertReason || node.error;
  if (local) return local;
  return best;
}

/** Anvil callTracer — find innermost revert after tx mined. */
export async function traceRevertReason(txHash: Hex): Promise<string | undefined> {
  const client = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
  try {
    const trace = (await client.request({
      method: "debug_traceTransaction",
      params: [txHash, { tracer: "callTracer" }],
    })) as CallTracerNode;
    return deepestTraceError(trace);
  } catch (err) {
    console.warn("[revert] debug_traceTransaction failed:", formatContractError(err));
    return undefined;
  }
}

export async function explainRevertedTx(txHash: Hex, label = "tx"): Promise<string> {
  const traced = await traceRevertReason(txHash);
  if (traced) return `${label} ${txHash}: ${traced}`;
  return `${label} ${txHash}: reverted (no trace message — check Anvil stderr)`;
}
