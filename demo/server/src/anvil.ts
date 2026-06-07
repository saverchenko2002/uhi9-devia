import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createPublicClient, http } from "viem";
import { foundry } from "viem/chains";
import { ANVIL_RPC, FORK_BLOCK } from "./accounts.js";

const ANVIL_PORT = 8545;

let proc: ChildProcess | null = null;

function killPort(port: number): void {
  try {
    execFileSync("fuser", ["-k", `${port}/tcp`], { stdio: "ignore" });
  } catch {
    /* nothing listening */
  }
}

export async function startAnvil(rpcMainnet: string): Promise<void> {
  await stopAnvil();
  killPort(ANVIL_PORT);
  await sleep(400);

  proc = spawn(
    "anvil",
    [
      "--fork-url",
      rpcMainnet,
      "--fork-block-number",
      String(FORK_BLOCK),
      "--port",
      String(ANVIL_PORT),
      "--chain-id",
      "31337",
      "--code-size-limit",
      "50000",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  proc.on("exit", () => {
    proc = null;
  });

  proc.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  proc.stdout?.on("data", (chunk) => process.stderr.write(chunk));

  const client = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
  for (let i = 0; i < 60; i++) {
    try {
      await client.getChainId();
      return;
    } catch {
      await sleep(500);
    }
  }

  throw new Error("Anvil did not become ready in time");
}

export async function stopAnvil(): Promise<void> {
  if (proc) {
    proc.kill("SIGTERM");
    proc = null;
  }
  killPort(ANVIL_PORT);
  await sleep(400);
}

export async function isAnvilReachable(): Promise<boolean> {
  try {
    const client = createPublicClient({ chain: foundry, transport: http(ANVIL_RPC) });
    await client.getChainId();
    return true;
  } catch {
    return false;
  }
}
