export function shortenAddress(addr: string | undefined, chars = 4): string {
  if (!addr || addr.length < 10) return addr ?? "—";
  return `${addr.slice(0, 2 + chars)}…${addr.slice(-chars)}`;
}

export function formatUsdtPrice(scaled: string): string {
  const n = Number(scaled) / 1e8;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function formatTokenAmount(value: number, maxFractionDigits = 4): string {
  if (!Number.isFinite(value) || value === 0) return "0";
  return value.toLocaleString("en-US", { maximumFractionDigits: maxFractionDigits });
}

export function formatUsdtTvl(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "$0";
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/** Small fee amounts — keep sub-cent precision instead of rounding to $0. */
export function formatFeeUsdt(value: number | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(6)}`;
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 4, minimumFractionDigits: 2 })}`;
}

export function formatFeeToken(raw: string | undefined, token: "WETH" | "USDT"): string {
  if (!raw) return "—";
  const n = token === "WETH" ? Number(raw) / 1e18 : Number(raw) / 1e6;
  if (!Number.isFinite(n) || n === 0) return "0";
  const digits = token === "WETH" ? 8 : 4;
  return `${n.toLocaleString("en-US", { maximumFractionDigits: digits })} ${token}`;
}

/** v4 fee pips → percent string (10_000 pips = 1%). */
export function feePipsToPercent(pips: number): string {
  return `${(pips / 10_000).toFixed(2)}%`;
}
