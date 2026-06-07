const body = {
  actorId: "lp",
  pool: "hooked",
  wethAmount: "100",
  usdtAmount: "300000",
};

const res = await fetch("http://127.0.0.1:8787/api/liquidity/seed", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const json = await res.json();
console.log(JSON.stringify(json, null, 2));
