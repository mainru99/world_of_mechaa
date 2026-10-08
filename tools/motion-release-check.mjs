// Verify explicitly public art assets without exposing source archives or trial audio.
import assert from 'node:assert/strict';
import {readFile,readdir,access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>readFile(resolve(root,p));
const pages=['attack-motion-preview.html','attack-motion-review.html','azure-dagger-sequence-preview.html'];
assert.deepEqual((await readdir(resolve(root,'dist/docs/art'))).sort(),pages.sort());
for(const name of pages)assert.deepEqual(await read('docs/art/'+name),await read('dist/docs/art/'+name));
const sequence=JSON.parse(await read('assets/motions/sequence/azure-dagger-v1/sequence.json'));
assert.equal(sequence.frames.length,6);
assert.equal(sequence.total,400);
for(const path of [sequence.atlas,sequence.animatedPreview,...sequence.frames.map(f=>f.src),
 'assets/motions/sequence/azure-dagger-v1/sequence.json','assets/motions/attack/azure.png','assets/motions/attack/kestrel.png',
 'assets/effects/motion-slash.png','assets/effects/motion-cannon.png','assets/effects/motion-status-a.png',
 'js/motion.js','js/motion-assets.js','js/pose-sequence.js'])
 assert.deepEqual(await read(path),await read('dist/'+path),path);
for(const path of ['CONTRACT.md','server/schema.sql','tools','proto','docs/handoff',
 'docs/art/attack-motion-sources','docs/art/attack-motion-rejected','docs/art/azure-dagger-sequence-prompts-2026-10-08.json'])
 await assert.rejects(access(resolve(root,'dist',path)),{code:'ENOENT'},path);
const audio=(await readdir(resolve(root,'proto/juice/sfx'))).filter(n=>n.endsWith('.wav')).sort();
const raw=(await readdir(resolve(root,'proto/juice/sfx/raw'))).filter(n=>n.endsWith('.wav')).sort();
assert.equal(audio.length,31);assert.deepEqual(audio,raw);
console.log('motion-release-check: 3 public pages and motion files match; private archives/proto excluded; 31 audio + 31 raw preserved');
