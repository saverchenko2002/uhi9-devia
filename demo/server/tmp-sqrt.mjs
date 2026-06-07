const priceScaled = 300000000000n;
const amount1 = priceScaled * 10n ** 6n;
const amount0 = 10n ** 26n;
const ratio = (amount1 * 2n ** 192n) / amount0;
function isqrt(n) {
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}
const sqrt = isqrt(ratio);
console.log("sqrtPriceX96", sqrt.toString());
console.log("from error", "4339505179874779489431521");
console.log("match", sqrt.toString() === "4339505179874779489431521");
