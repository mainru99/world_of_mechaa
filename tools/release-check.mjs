// Sequential: loadout/bind domain checks temporarily exercise both modes and
// restore the shared configuration. Never run these checks in parallel.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const checks=[
 'battle-ui-check','challenge-ui-check','circuit-ui-check','combat-integration-ui-check',
 'common-ui-check','development-ui-check','dispatch-ui-check','front-ui-check',
 'hangar-ui-check','inventory-performance-check','launch-ui-check','login-ui-check',
 'ranking-ui-check','recruitment-ui-check','shard-ui-check','territory-ui-check',
 'mastery-concurrency-check','preparation-check','masterycheck','refinecheck',
 'battlecheck','arenacheck','shopcheck','presetcheck','codexcheck','bindcheck',
 'relaycheck','frontcheck','raidcheck','jointcheck','terrcheck','trialcheck',
 'circuitcheck','synthcheck','lineagecheck','check_ignis_rain_integration'
];
for(const name of checks){
 const r=spawnSync(process.execPath,['--no-warnings',`tools/${name}.mjs`],{cwd:root,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});
 if(r.status!==0){process.stderr.write(`${name} FAILED\n${r.stdout||''}${r.stderr||''}${r.error?.message||''}\n`);process.exit(1);}
 console.log(`PASS ${name}`);
}
console.log(`Release checks passed: ${checks.length} sequential UI/domain checks (loopback API/build/production verification run separately).`);
