/**
 * Le tour quotidien de Vigil : cashback aux traders, puis rachat de $VIGIL (FEES.md).
 * Tourne en continu sur TA machine et lance les deux scripts chaque jour à l'heure prévue (brand.config : payoutHourUtc).
 *
 * À blanc (affiche seulement ce qui serait fait) :
 *   npm run daily
 * Pour de vrai (c'est toi qui le lances ; les clés restent dans tes fichiers, hors du projet) :
 *   npm run daily -- --send --cashback-key C:\chemin\cashback.json --buyback-key C:\chemin\buyback.json
 * Ajoute --now pour faire un tour tout de suite (en plus de l'heure prévue).
 *
 * Tant que $VIGIL n'a pas de CA, le rachat dit seulement combien est mis de côté : rien ne part.
 */
import { spawn } from "node:child_process";
import { brand } from "@/brand.config";

const args = process.argv.slice(2);
const send = args.includes("--send");
const get = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const cashKey = get("--cashback-key");
const buyKey = get("--buyback-key");
if (send && (!cashKey || !buyKey)) {
  console.error("--send demande --cashback-key et --buyback-key.");
  process.exit(1);
}

function run(script: string, key?: string) {
  return new Promise<number>((resolve) => {
    const a = ["tsx", "--env-file=.env.local", "--conditions=react-server", `scripts/${script}`, ...(send && key ? ["--send", "--keypair", key] : [])];
    const p = spawn("npx", a, { stdio: "inherit", shell: process.platform === "win32" });
    p.on("exit", (code) => resolve(code ?? 1));
  });
}

async function round() {
  console.log(`\n=== Tour Vigil ${new Date().toISOString()} (${send ? "POUR DE VRAI" : "à blanc"}) ===`);
  const a = await run("payout.mts", cashKey);
  const b = await run("buyback.mts", buyKey);
  console.log(`=== Fin du tour : cashback ${a === 0 ? "ok" : `erreur ${a}`}, rachat ${b === 0 ? "ok" : `erreur ${b}`} ===`);
}

function nextRun() {
  const now = new Date();
  const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), brand.fees.payoutHourUtc, 5));
  if (t.getTime() <= now.getTime()) t.setUTCDate(t.getUTCDate() + 1);
  return t;
}

async function loop() {
  const t = nextRun();
  console.log(`Prochain tour : ${t.toISOString()} (${Math.round((t.getTime() - Date.now()) / 60_000)} min)`);
  setTimeout(async () => {
    await round();
    void loop();
  }, t.getTime() - Date.now());
}

if (args.includes("--now")) await round();
void loop();
