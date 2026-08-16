// Social gate: does LunarCrush carry this ticker with interactions that actually vary?
// Separate from the onchain screen because it hits a different provider - running them
// concurrently costs nothing and halves the wall time.
import { fetchSocialHistory } from "../src/sources/lunarcrush.js";
const CANDS = ["BSW","QUID","SOL","SOSO","FUN","DRV","DOGINME","CTR","AVNT","CHIP","RECALL","KTA","OVPP","PLAY","SURPLUS","BRETT","FLOWER","POD","VCNT","ZEN","REI","TIG","TSG"];
const mean=(v:number[])=>v.reduce((s,x)=>s+x,0)/v.length;
const rows: Record<string,unknown>[] = [];
for (const sym of CANDS) {
  try {
    const s = await fetchSocialHistory(sym, "1m", "hour");
    const inter = s.map(p=>p.social.socialVolume).filter((v):v is number=>v!=null && Number.isFinite(v));
    const cov = s.length ? inter.length/s.length : 0;
    const m = inter.length ? mean(inter) : 0;
    const cv = inter.length>1 && m>0 ? Math.sqrt(inter.reduce((a,x)=>a+(x-m)**2,0)/inter.length)/m : 0;
    const sorted=[...inter].sort((a,b)=>a-b);
    const med = sorted.length ? sorted[Math.floor(sorted.length/2)] : 0;
    let verdict = "GOOD";
    if (s.length === 0) verdict = "NO DATA";
    else if (cov < 0.8) verdict = "SPARSE";
    else if (cv < 0.15) verdict = "TOO FLAT";
    else if (med < 100) verdict = "LOW VOLUME";
    rows.push({ symbol: sym, points: s.length, coverage: `${(cov*100).toFixed(0)}%`, cv: cv.toFixed(2), medianInteractions: Math.round(med), verdict });
    console.log(`  ${sym.padEnd(9)} ${String(s.length).padStart(4)} pts  med ${String(Math.round(med)).padStart(6)}  cv ${cv.toFixed(2)}  ${verdict}`);
  } catch (e) {
    rows.push({ symbol: sym, verdict: `ERROR: ${(e as Error).message.slice(0,40)}` });
    console.log(`  ${sym.padEnd(9)} ERROR ${(e as Error).message.slice(0,50)}`);
  }
}
console.log("");
console.table(rows);
console.log("\nSocial-gate passes: " + rows.filter(r=>r.verdict==="GOOD").map(r=>r.symbol).join(" "));
