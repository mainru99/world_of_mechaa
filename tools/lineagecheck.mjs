/* 개발 계보 검사 — node tools/lineagecheck.mjs
   데이터(data/lineage.js)가 규칙(js/lineage.js · 사용자 결정 2026-09-23)을 지키는지 본다. */
import { ROBOT_TYPES } from '../data/balance.js';
import { LINEAGE, LINEAGE_SIBS, parentsOf, childrenOf, isRoot, isGachaEntry, canDevelop, developable, lineageView } from '../js/lineage.js';
import { traitPoints } from '../js/stats.js';

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };
const R = ['C', 'UC', 'R', 'UQ', 'EP'];
const rar = t => ROBOT_TYPES[t] && ROBOT_TYPES[t].rarity;
const gacha = Object.keys(ROBOT_TYPES).filter(t => !ROBOT_TYPES[t].story);

console.log('== ① 데이터 ==');
ok(LINEAGE.every(([a, b]) => ROBOT_TYPES[a] && ROBOT_TYPES[b]), `연결 ${LINEAGE.length}개 — 모르는 기체 없음`);
ok(LINEAGE.every(([a, b]) => R.indexOf(rar(b)) === R.indexOf(rar(a)) + 1), '연결은 모두 한 등급 위로');
ok(LINEAGE.every(([a, b]) => !ROBOT_TYPES[a].story && !ROBOT_TYPES[b].story), '스토리 기체는 계보에 없다');
ok(new Set(LINEAGE.map(([a, b]) => a + '>' + b)).size === LINEAGE.length, '같은 연결이 두 번 없다');
ok(LINEAGE_SIBS.every(([s, k]) => ROBOT_TYPES[s] && ROBOT_TYPES[k] && ROBOT_TYPES[s].family && ROBOT_TYPES[s].family === ROBOT_TYPES[k].family
                                && rar(s) === rar(k)), `분화 ${LINEAGE_SIBS.length}개 — 같은 집안 · 같은 등급`);
ok(LINEAGE_SIBS.every(([, k]) => !parentsOf(k).length), '분화로 여는 아종은 아래에서 오는 선이 없다(표준형만 이어진다)');
const orphan = gacha.filter(t => rar(t) !== 'EP' && !childrenOf(t).length && t !== 'lens');
ok(!orphan.length, `EP 가 아닌데 다음이 없는 기체는 LENS 뿐(약한 연결을 끊은 자리) ${orphan.length ? '— ' + orphan.join(',') : ''}`);
const entries = gacha.filter(isGachaEntry);
ok(entries.sort().join(',') === 'orbit,swift', `뽑기 입구 = ${entries.join(' · ')}`);

console.log('\n== ② 판정 ==');
ok(canDevelop('mule', []).ok && canDevelop('mule', []).why === 'root', 'C 는 언제나 조립할 수 있다');
ok(!canDevelop('bastion', []).ok && canDevelop('bastion', ['mule']).ok, 'BASTION — MULE 이 있어야');
const at = canDevelop('atlas', ['halo', 'osprey', 'hydra_s', 'nimbus_c']);
ok(!at.ok && at.need.join() === 'goliath_r', 'ATLAS — 앞 기체 다섯 중 하나라도 없으면 닫힌다(합류)');
ok(canDevelop('atlas', ['halo', 'osprey', 'hydra_s', 'nimbus_c', 'goliath_r']).ok, 'ATLAS — 다섯을 다 가지면 열린다');
ok(!canDevelop('goliath_r', ['aegis']).ok && canDevelop('goliath_r', ['goliath_s']).ok, 'GOLIATH RUST — 표준형 SAND 가 있어야(분화)');
ok(!canDevelop('orbit', ['patch', 'tracer', 'swift']).ok && canDevelop('orbit', []).why === 'gacha', 'ORBIT — 조각으로는 못 연다(뽑기 입구)');
ok(canDevelop('orbit', ['orbit']).ok, '이미 가진 기체는 막지 않는다(중복 보상)');
ok(!canDevelop('rook3', []).ok, '스토리 기체는 조립하지 못한다');
const d = developable(['mule', 'rust']);
ok(d.includes('bastion') && d.includes('vanguard') && !d.includes('glacier'), `개발 후보 — MULE · RUST 를 가지면 ${d.join(' · ')}`);
const v = lineageView(['mule']);
ok(v.mule.state === 'owned' && v.bastion.state === 'open' && v.glacier.state === 'locked' && v.orbit.state === 'gacha', '계보도 한 장 — owned · open · locked · gacha');

console.log('\n== ③ 모든 기체에 닿는 길 ==');
/* C 전부에서 시작해 조립 가능한 것을 계속 더하면, 뽑기 입구와 그 아래를 빼고 전부 닿아야 한다 */
let have = new Set(gacha.filter(isRoot));
for (let i = 0; i < 10; i++) for (const t of developable(have)) have.add(t);
const miss = gacha.filter(t => !have.has(t));
ok(miss.every(t => isGachaEntry(t) || parentsOf(t).some(p => miss.includes(p))), `C 에서 조립만으로 ${have.size}/${gacha.length} — 못 닿는 것은 뽑기 입구와 그 뒤뿐(${miss.join(' · ') || '없음'})`);
for (const e of entries) have.add(e);
for (let i = 0; i < 10; i++) for (const t of developable(have)) have.add(t);
ok(have.size === gacha.length, `뽑기 입구 둘을 더하면 ${have.size}/${gacha.length} 전부`);

console.log('\n== ④ 숙련 = 특성 포인트 ==');
const tp = [1, 5, 10, 30, 59, 60].map(l => `Lv.${l} ${traitPoints(l)}`);
ok(traitPoints(4) === 0 && traitPoints(5) === 1 && traitPoints(10) === 3 && traitPoints(59) === 16 && traitPoints(60) === 20, tp.join(' · '));

console.log(bad ? `\n✗ ${bad}건 실패` : '\n전부 통과');
if (bad) process.exitCode = 1;
