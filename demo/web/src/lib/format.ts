export function shortenAddress(addr: string | undefined, chars = 4): string {
  if (!addr || addr.length < 10) return addr ?? "—";
  return `${addr.slice(0, 2 + chars)}…${addr.slice(-chars)}`;
}

export function formatUsdtPrice(scaled: string): string {
  const n = Number(scaled) / 1e8;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
