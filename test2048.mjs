// Headless regression test for the 2048 logic embedded in index.html.
// Extracts the pure game-state section and fuzzes it with invariants.
import { readFileSync } from "fs";
import { runInNewContext } from "vm";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const pure = script.slice(0, script.indexOf("/* ---- DOM layer ---- */"));

const test = `
function setGrid(rows){idSeq=1000;score=0;over=false;
  grid=rows.map(r=>r.map(v=>v?{v,id:++idSeq}:null));}
function vals(){return grid.map(r=>r.map(c=>c?c.v:0));}
function sumG(){let s=0;for(const r of grid)for(const c of r)if(c)s+=c.v;return s;}
function countG(){let n=0;for(const r of grid)for(const c of r)if(c)n++;return n;}
function okGrid(){const seen=new Set();
  for(const r of grid)for(const c of r){if(!c)continue;
    if(seen.has(c.id))return "duplicate tile id";seen.add(c.id);
    if(c.v<2||c.v&(c.v-1))return "non power-of-two value "+c.v;}
  if(grid.length!==N||grid.some(r=>r.length!==N))return "grid size != N";
  return null;}
const fails=[];
function eq(name,a,b){const A=JSON.stringify(a),B=JSON.stringify(b);
  if(A!==B)fails.push(name+": expected "+B+" got "+A);}

// --- directed cases (0=up 1=right 2=down 3=left) ---
setGrid([[2,2,4,4],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);
move(3); eq("left merge",vals()[0],[4,8,0,0]);
setGrid([[0,2,0,2],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);
move(3); eq("left slide+merge",vals()[0],[4,0,0,0]);
setGrid([[2,2,2,2],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);
move(3); eq("left quad",vals()[0],[4,4,0,0]);
setGrid([[2,0,0,0],[2,0,0,0],[0,0,0,0],[0,0,0,0]]);
move(0); eq("up merge",[vals()[0][0],vals()[1][0]],[4,0]);
setGrid([[2,0,0,0],[2,0,0,0],[0,0,0,0],[0,0,0,0]]);
move(2); eq("down merge",[vals()[3][0],vals()[2][0]],[4,0]);
setGrid([[2,4,2,4],[2,4,2,4],[2,4,2,4],[2,4,2,4]]);
if(move(3)!==false)fails.push("left on locked board should be no-op");

// --- 5x5 board works ---
N=5;
setGrid([[2,2,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0]]);
move(3); eq("5x5 left merge",vals()[0],[4,0,0,0,0]);

// --- spawn-4 probability curve: 10% at start, 35% from max tile 2048 on ---
N=4;
function setMax(v){idSeq=1000;score=0;over=false;
  grid=Array.from({length:N},()=>Array(N).fill(null));grid[0][0]={v,id:++idSeq};}
setMax(2);    eq("prob max=2",spawnProb(),0.10);
setMax(64);   eq("prob max=64",spawnProb(),0.10);
setMax(128);  {const p=spawnProb();if(!(p>0.10&&p<0.35))fails.push("prob at 128 should be between: "+p);}
setMax(2048); eq("prob max=2048",spawnProb(),0.35);
setMax(4096); eq("prob clamped at 4096",spawnProb(),0.35);

// --- regression for the old crash bug: gap in front, tiles behind ---
N=4;
setGrid([[0,2,4,8],[0,2,4,8],[0,4,8,16],[0,0,0,0]]);
for(let d=0;d<4;d++){try{const r=move(d);addRandom();const e=okGrid();
  if(e)fails.push("regression dir"+d+": "+e);}
  catch(err){fails.push("regression dir"+d+" threw: "+err.message);}}

// --- fuzz at 4x4 and 5x5 ---
function fuzz(games,label){
  for(let iter=0;iter<games;iter++){
    newGame();
    for(let m=0;m<300;m++){
      const before=sumG();
      const r=move(m%4);
      if(!r)continue;
      const added=addRandom();
      const err=okGrid();
      if(err){fails.push(label+" fuzz"+iter+" m"+m+": "+err);break;}
      if(sumG()!==before+(added?added.v:0)){
        fails.push(label+" fuzz"+iter+" m"+m+": sum changed by non-tile amount");break;}
      if(!emptyCells().length&&checkOver()){over=true;break;}
      if(over)break;
    }
  }
}
N=4; fuzz(15000,"4x4");
N=5; fuzz(8000,"5x5");
N=6; fuzz(3000,"6x6");
globalThis.__fails=fails;
`;

const ctx = { localStorage: { getItem: () => null, setItem: () => {} } };
try {
  runInNewContext(pure + "\n" + test, ctx, { timeout: 120000 });
} catch (e) {
  console.log("FATAL: game logic threw during run:", e.message);
  process.exit(1);
}
const fails = ctx.__fails || [];
if (fails.length) {
  console.log("FAILED: " + fails.length + " problem(s)");
  for (const f of fails.slice(0, 10)) console.log(" - " + f);
  process.exit(1);
}
console.log("PASS: directed cases, 5x5 cases, spawn options, crash regression, fuzz 4x4/5x5/6x6");
