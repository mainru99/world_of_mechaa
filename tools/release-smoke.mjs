// Production verification without account mutations. GET files/queries and
// credential-free empty POSTs to four routes whose auth guard returns 401
// before parsing/dispatch. No tokens, cookies, guests, migrations or rewards.
import assert from 'node:assert/strict';
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {balanceVersion} from '../server/arena.js';
import {CONST} from '../data/balance.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const base='https://rowar.hun7539.workers.dev';
const tag=process.argv[2]||'20260930-release';
const reportName=process.argv[3]||'release-verification-2026-10-02.json';
assert.match(reportName,/^[a-zA-Z0-9-]+\.json$/,'report filename only');
const normalize=b=>b.toString('utf8').replaceAll('\r\n','\n');
const hash=b=>createHash('sha256').update(b).digest('hex');
const records=[],errors=[];
async function get(path){
 const u=new URL(path,base);u.searchParams.set('release_check',tag);
 return fetch(u,{headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(30000)});
}
async function deniedPost(path){
 const u=new URL(path,base);u.searchParams.set('release_check',tag);
 return fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(30000)});
}
async function walk(dir){
 const out=[];for(const f of await readdir(resolve(root,'dist',dir),{withFileTypes:true})){
  const path=`${dir}/${f.name}`;if(f.isDirectory())out.push(...await walk(path));else if(/\.(js|css)$/.test(f.name))out.push(path);
 }return out;
}
const files=['index.html','style.css','core-circuit-preview.html',...await walk('js'),...await walk('data'),...await walk('themes'),
 'assets/backgrounds/territory-map-v2.png','assets/ignis.png','assets/motions/ignis-idle-10f.webp'];
for(let i=0;i<files.length;i+=6){
 const batch=files.slice(i,i+6);
 const results=await Promise.allSettled(batch.map(async path=>{
  const expected=await readFile(resolve(root,'dist',path)),r=await get('/'+path),actual=Buffer.from(await r.arrayBuffer());
  const text=/\.(html|css|js)$/.test(path),matches=r.status===200&&(text?normalize(actual)===normalize(expected):actual.equals(expected));
  records.push({path,status:r.status,bytes:actual.length,matches,...(!text?{sha256:hash(actual)}:{})});
  assert.ok(matches,`deployed file mismatch: ${path} (${r.status})`);
  if(path==='index.html'){assert.ok(r.headers.get('content-security-policy'));assert.match(normalize(actual),/<body class="ui-v2"/);assert.ok(!normalize(actual).includes('/__performance.js'));}
 }));
 results.forEach((r,j)=>{if(r.status==='rejected')errors.push(`${batch[j]}: ${r.reason.message||r.reason}`);});
}
let health=null;
try{
 const r=await get('/api/health');assert.equal(r.status,200);health=await r.json();
 assert.equal(health.ok,true);assert.equal(health.db,'connected');assert.equal(Number(health.schema_version),25);assert.equal(health.balance_ver,balanceVersion());
 assert.equal(CONST.PART_BIND.on,true);assert.equal(CONST.LINEAGE.gate,true);
}catch(e){errors.push(`health: ${e.message}`);}
for(const path of ['/api/state','/api/salvage','/api/trial','/api/raid']){
 try{const r=await get(path);await r.arrayBuffer();records.push({path,method:'GET',status:r.status,authenticationRequired:r.status===401});assert.equal(r.status,401,path);}catch(e){errors.push(`${path}: ${e.message}`);}
}
for(const path of ['/api/hangar','/api/circuit','/api/refine','/api/battle/start']){
 try{const r=await deniedPost(path);await r.arrayBuffer();records.push({path,method:'POST',status:r.status,authenticationRequired:r.status===401});assert.equal(r.status,401,path);}catch(e){errors.push(`${path}: ${e.message}`);}
}
for(const path of ['/CONTRACT.md','/server/schema.sql','/tools/ui-performance-probe.js']){
 try{const r=await get(path);await r.arrayBuffer();records.push({path,status:r.status,privatePathBlocked:r.status===404});assert.equal(r.status,404,path);}catch(e){errors.push(`${path}: ${e.message}`);}
}
const report={at:new Date().toISOString(),base,tag,mode:'anonymous GET + credential-free empty POST rejected by auth; no production account mutation',ok:errors.length===0,health,flags:{bind:CONST.PART_BIND.on,lineage:CONST.LINEAGE.gate},fileCount:files.length,records,errors};
await mkdir(resolve(root,'docs/ui/previews'),{recursive:true});
await writeFile(resolve(root,'docs/ui/previews',reportName),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ok:report.ok,fileCount:files.length,health,flags:report.flags,errors},null,2));
if(errors.length)process.exitCode=1;
