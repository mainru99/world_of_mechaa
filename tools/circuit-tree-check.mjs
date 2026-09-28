// Presentation regression check (no browser or server required).
// node tools/circuit-tree-check.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const file = 'docs/balance/core-circuit-draft-2026-09-23.html';
const html = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script); // Include initialization in syntax validation.
const before = execFileSync('git', ['show', '0ed5a54:' + file], {encoding:'utf8',maxBuffer:8e6});
const original = before.match(/<script>([\s\S]*?)<\/script>/)[1];
const withoutRenderer = s => s.replace(/function drawSvg\(\) \{[\s\S]*?(?=function focusStar)/, '');
assert.equal(withoutRenderer(script), withoutRenderer(original), 'Only SVG rendering may change, never data or rules');

class Element {
  constructor(tag) { this.tag=tag; this.attrs={}; this.children=[]; this.dataset={}; this.handlers={}; }
  set textContent(v) { this.children=[]; this.text=v; }
  setAttribute(k,v) { this.attrs[k]=String(v); if(k.startsWith('data-')) this.dataset[k.slice(5)]=String(v); }
  appendChild(e) { this.children.push(e); return e; }
  addEventListener(name, fn) { this.handlers[name]=fn; }
  querySelectorAll(selector) { return this.children.flatMap(e=>[...(selector==='.star'&&e.attrs.class==='star'?[e]:[]),...e.querySelectorAll(selector)]); }
}
const svg=new Element('svg'), toast=new Element('p');
const context=vm.createContext({document:{createElementNS:(_,tag)=>new Element(tag),getElementById:id=>id==='svg'?svg:toast},console,setTimeout:()=>0,clearTimeout:()=>{}});
vm.runInContext(script.slice(0,script.indexOf('/* 가격표 */')),context);
const run = s => vm.runInContext(s,context);
const ids=run('Object.keys(D.mechs)');
assert.equal(ids.length,76);
let renders=0;
for(const mech of ids) {
  context.testMech=mech;
  run('st.mech=testMech;st.lv=60');
  for(const preset of ['deep','wide','clear']) {
    context.testPreset=preset;
    run('preset(testPreset);drawSvg()');
    const nodes=svg.querySelectorAll('.star');
    assert.equal(nodes.length,36);
    assert.equal(new Set(nodes.map(n=>n.dataset.id)).size,36);
    assert.equal(nodes.filter(n=>n.dataset.state==='taken').length,preset==='clear'?0:20);
    assert.equal(nodes.filter(n=>n.dataset.kind==='notable').length,4);
    assert.equal(nodes.filter(n=>n.dataset.kind==='notable'&&n.dataset.state==='taken').length,preset==='deep'?2:0);
    assert.equal(nodes.filter(n=>n.dataset.state==='available').length,preset==='clear'?4:0);
    for(const node of nodes) {
      assert.ok(node.handlers.click&&node.handlers.keydown);
      for(const child of node.children) for(const value of Object.values(child.attrs)) assert.ok(!/NaN|Infinity/.test(value));
    }
    renders++;
  }
  run("toggle('A2')"); assert.equal(run('st.taken.size'),0,'Prerequisites block A2');
  run("toggle('A1');toggle('A2');toggle('A1')"); assert.equal(run('st.taken.size'),2,'Cannot drop parent');
  run("toggle('A2');toggle('A1')"); assert.equal(run('st.taken.size'),0,'Leaf refunds work');
  run("preset('deep');st.lv=1;fit();drawSvg()"); assert.equal(run('st.taken.size'),0);
}
console.log(`PASS: ${ids.length} mechs, ${renders} renders, 36 nodes, presets, prerequisites, refunds, level trimming; all non-renderer JS unchanged.`);
