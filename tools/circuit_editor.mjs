/* 코어 서킷 별자리 편집기 — 로컬 서버. 사용자가 별을 끌어 옮기고 저장한다(2026-09-25 사용자 요청).
 *
 *   node tools/circuit_editor.mjs [포트=8791]      →  http://127.0.0.1:8791
 *
 * 화면은 tools/circuit-editor.html. 이 서버는
 *   · 저장소 파일을 읽기 전용으로 내준다(그림 · 모듈) — 저장소 밖은 막는다
 *   · GET  /api/layout  — 지금 data/circuit_layout.js 의 좌표 · 이름 칸
 *   · POST /api/save    — 기체 하나의 좌표 · 이름 칸을 data/circuit_layout.js 에 쓴다. **그 기체 줄만** 바꾸고 hand:true 를 붙인다.
 *                         hand 인 기체는 tools/circuit_layout.py 가 다시 돌아도 덮지 않는다(--force 일 때만)
 * 127.0.0.1 에만 붙는다. 처음 저장하기 전에 원래 파일을 임시 폴더에 한 번 떠 둔다.
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkLayout } from '../js/circuitlayout.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data', 'circuit_layout.js');
const PORT = Number(process.argv[2]) || 8791;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
                '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json', '.css': 'text/css; charset=utf-8' };
const ID = /^[a-z0-9_]{1,24}$/;
let backedUp = false;

const LINE = id => new RegExp(`^  ${id}: \\{.*\\},$`, 'm');
function readData() {
  const src = fs.readFileSync(DATA, 'utf8');
  const [layPart, lblPart = ''] = src.split('export const CIRCUIT_LABEL_BOXES');
  const grab = part => Object.fromEntries([...part.matchAll(/^  (\w+): (\{.*\}),$/gm)].map(m => [m[1], JSON.parse(m[2])]));
  return { src, layout: grab(layPart), labels: grab(lblPart) };
}

/* 들어온 좌표가 모양을 갖췄나 — 숫자 쌍 · 판 안 · 갈래마다 9 점 */
function validPoint(p) { return Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && p[0] >= 0 && p[0] <= 520 && p[1] >= 0 && p[1] <= 430; }
function validLayout(L) {
  return L && validPoint(L.core) && ['A', 'B', 'C', 'D'].every(b => Array.isArray(L[b]) && L[b].length === 9 && L[b].every(validPoint));
}
function validLabels(lb) {
  if (lb == null) return true;
  return typeof lb === 'object' && Object.entries(lb).every(([k, v]) => ['A', 'B', 'C', 'D'].includes(k) &&
    (v == null || (Array.isArray(v) && v.length === 4 && v.every(Number.isFinite) && v[2] === 90 && v[3] === 20)));
}
const r1 = v => Math.round(v * 10) / 10;

function save(id, layout, labels) {
  const cur = readData();
  if (!cur.layout[id]) throw new Error(`좌표 파일에 ${id} 가 없다`);
  if (!backedUp) {
    const bak = path.join(os.tmpdir(), `circuit_layout.${new Date().toISOString().replace(/[:.]/g, '-')}.js`);
    fs.writeFileSync(bak, cur.src); backedUp = true;
    console.log(`  원래 파일을 떠 두었다 — ${bak}`);
  }
  const old = cur.layout[id];
  const next = { ...old, core: layout.core.map(r1) };
  for (const b of ['A', 'B', 'C', 'D']) next[b] = layout[b].map(p => p.map(r1));
  delete next.bent;                                          // 휘기 기록은 도구 몫 — 손으로 고치면 의미가 없다
  next.hand = true;
  const [layPart, lblPart] = cur.src.split('export const CIRCUIT_LABEL_BOXES');
  let lay = layPart.replace(LINE(id), `  ${id}: ${JSON.stringify(next)},`);
  let lbl = lblPart;
  if (labels) {
    const clean = Object.fromEntries(Object.entries(labels).filter(([, v]) => v).map(([k, v]) => [k, v.map(r1)]));
    const line = `  ${id}: ${JSON.stringify(clean)},`;
    lbl = LINE(id).test(lbl) ? lbl.replace(LINE(id), line) : lbl.replace(/\n\};\s*$/, `\n${line}\n};\n`);
  }
  const out = lay + 'export const CIRCUIT_LABEL_BOXES' + lbl;
  fs.writeFileSync(DATA, out.replace(/\r\n/g, '\n'));
  return { layout: next, check: checkLayout(next, labels || cur.labels[id]) };
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (req.method === 'GET' && url.pathname === '/') { res.writeHead(302, { Location: '/tools/circuit-editor.html' }); return res.end(); }
  if (req.method === 'GET' && url.pathname === '/api/layout') {
    try { const { layout, labels } = readData(); return send(res, 200, { layout, labels }); }
    catch (e) { return send(res, 500, { error: String(e.message || e) }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/save') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 64 * 1024) req.destroy(); });
    req.on('end', () => {
      try {
        const { id, layout, labels } = JSON.parse(body || '{}');
        if (!ID.test(id || '')) return send(res, 400, { error: '기체 이름이 이상하다' });
        if (!validLayout(layout)) return send(res, 400, { error: '좌표 모양이 이상하다 — 코어 1 + 갈래마다 9 점, 판(520 x 430) 안' });
        if (!validLabels(labels)) return send(res, 400, { error: '이름 칸 모양이 이상하다 — [왼쪽, 위, 90, 20]' });
        const r = save(id, layout, labels);
        console.log(`  저장 — ${id} ${r.check.ok ? '통과' : '실패: ' + r.check.bad.join(' · ')}`);
        send(res, 200, { ok: true, layout: r.layout, check: { ok: r.check.ok, bad: r.check.bad, warn: r.check.warn } });
      } catch (e) { send(res, 500, { error: String(e.message || e) }); }
    });
    return;
  }
  if (req.method !== 'GET') return send(res, 405, { error: 'GET · POST /api/save 만' });
  const file = path.resolve(ROOT, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'not found', 'text/plain');
  send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
}).listen(PORT, '127.0.0.1', () => {
  console.log(`코어 서킷 별자리 편집기 — http://127.0.0.1:${PORT}   (끝내려면 Ctrl+C)`);
  console.log(`  저장하면 ${path.relative(ROOT, DATA)} 의 그 기체 줄만 바뀐다. 커밋은 따로 한다`);
});
