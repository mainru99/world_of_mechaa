import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CONST} from '../data/balance.js';
import {partStat} from '../js/stats.js';
const {samples}=JSON.parse(fs.readFileSync(new URL('./fixtures/legacy-parts-v12.json',import.meta.url),'utf8'));
const check=()=>{for(const {part,expected} of samples){const actual=partStat(part);
  assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort());
  for(const k in expected)assert(Math.abs(actual[k]-expected[k])<1e-9,`${part.rarity} ${part.slot} +${part.enh}: ${k} ${actual[k]} != ${expected[k]}`);
}};
check();
const scale=CONST.ENH_SCALE,pct=CONST.ENH_PCT;
try{CONST.ENH_SCALE=.97;CONST.ENH_PCT=.33;check();}finally{CONST.ENH_SCALE=scale;CONST.ENH_PCT=pct;}
console.log(`${samples.length} saved v12 parts unchanged; new-part tuning does not modify legacy upgrades.`);
