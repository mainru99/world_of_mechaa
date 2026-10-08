import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {motionAssetUrl} from '../js/motion.js';
import {MOTION_ASSETS} from '../js/motion-assets.js';
const root=new URL('../',import.meta.url);
assert.equal(motionAssetUrl(null),null);
assert.equal(motionAssetUrl(''),null);
for(const src of [...Object.values(MOTION_ASSETS.atlas),...Object.values(MOTION_ASSETS.pose).map(p=>p.src)])
 assert.equal(motionAssetUrl(src),new URL(src,root).href);
assert.equal(motionAssetUrl('assets/effects/a.png?v=42'),new URL('assets/effects/a.png?v=42',root).href);
for(const name of ['attack-motion-preview.html','azure-dagger-sequence-preview.html']){
 const html=await readFile(new URL('docs/art/'+name,root),'utf8');
 assert.ok(!/<base\b/i.test(html),'CSP base-uri none supported');
}
const html=await readFile(new URL('docs/art/azure-dagger-sequence-preview.html',root),'utf8');
assert.ok(html.includes("fetch('../../assets/"));
assert.ok(html.includes("src:'../../'+f.src"));
console.log('motion-path-check: module-relative assets/query preserved; nested pages need no forbidden base tag');
