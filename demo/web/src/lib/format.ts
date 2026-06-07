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
