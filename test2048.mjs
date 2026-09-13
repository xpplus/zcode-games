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
  return null;}
const fails=[];
function eq(name,a,b){const A=JSON.stringify(a),B=JSON.stringify(b);
  if(A!==B)fails.push(name+": expected "+B+" got "+A);}

// --- directed cases (0=up 1=right 2=down 3=left) ---
setGrid([[2,2,4,4],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);
move(3); eq("left merge",vals()[0],[4,8,0,0]);
setGrid([[0,2,0,2],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);
move(3); eq("left slide+merge",vals()[0],[4,0,0,0]);
setGrid([[2,0,2,2],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);
move(3); eq("left triple",vals()[0][0]===4&&countG()===2,true);
setGrid([[2,2,2,2],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);
move(3); eq("left quad",vals()[0],[4,4,0,0]);
setGrid([[0,0,2,2],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);
move(1); eq("right merge",vals()[0],[0,0,0,4]);
setGrid([[2,0,0,0],[2,0,0,0],[0,0,0,0],[0,0,0,0]]);
move(0); eq("up merge",[vals()[0][0],vals()[1][0]],[4,0]);
setGrid([[2,0,0,0],[2,0,0,0],[0,0,0,0],[0,0,0,0]]);
move(2); eq("down merge",[vals()[3][0],vals()[2][0]],[4,0]);
setGrid([[2,4,2,4],[2,4,2,4],[2,4,2,4],[2,4,2,4]]);
if(move(3)!==false)fails.push("left on locked board should be no-op");
setGrid([[2,2,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]]);
if(move(1)===false)fails.push("right on [2,2] should move (slide away)");

// --- regression for the crash bug: gap in front, tiles behind ---
setGrid([[0,2,4,8],[0,2,4,8],[0,4,8,16],[0,0,0,0]]);
for(let d=0;d<4;d++){try{const r=move(d);addRandom();const e=okGrid();
  if(e)fails.push("regression dir"+d+": "+e);}
  catch(err){fails.push("regression dir"+d+" threw: "+err.message);}}

// --- fuzz: 20000 random games, invariants after every real move ---
for(let iter=0;iter<20000;iter++){
  newGame();
  for(let m=0;m<300;m++){
    const before=sumG();
    const r=move(m%4);
    if(!r)continue;
    const added=addRandom();
    const err=okGrid();
    if(err){fails.push("fuzz"+iter+" m"+m+": "+err);break;}
    if(sumG()!==before+(added?added.v:0)){
      fails.push("fuzz"+iter+" m"+m+": sum changed by non-tile amount");break;}
    if(over)break;
    if(!emptyCells().length&&checkOver()){over=true;break;}
  }
}
globalThis.__fails=fails;
`;

const ctx = { localStorage: { getItem: () => null, setItem: () => {} } };
try {
  runInNewContext(pure + "\n" + test, ctx, { timeout: 60000 });
} catch (e) {
  console.log("FATAL: game logic threw during run:", e.message);
  process.exit(1);
}
const fails = globalThis.__fails || ctx.__fails || [];
if (fails.length) {
  console.log("FAILED: " + fails.length + " problem(s)");
  for (const f of fails.slice(0, 10)) console.log(" - " + f);
  process.exit(1);
}
console.log("PASS: all directed cases + 20000 random games, invariants held");
