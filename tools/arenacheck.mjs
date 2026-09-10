/* 아레나 매칭 검사 — 가짜 env.DB 로 논리만 돌린다.

   D1 없이 확인할 수 있는 것만 본다: 옛 밸런스 스냅샷을 다시 계산하는가,
   닉네임 지목이 '없음'과 '자기 자신'을 구분하는가, 크론 마이그레이션이
   갱신할 것만 갱신하고 못 살릴 행만 지우는가.

   SQL 자체는 여기서 검증되지 않는다 — 문자열을 정규식으로 갈라 결과를 흉내 낼 뿐이다.
   실제 질의는 wrangler dev(로컬 D1)나 배포에서 확인할 것.

   node tools/arenacheck.mjs */
const { ROBOT_TYPES } = await import('../data/balance.js');
const { computeStats, power } = await import('../js/stats.js');
const A = await import('../server/arena.js');

const EMPTY={WEAPON:null,FRAME:null,BOOSTER:null,CORE:null};
const ok=(n,c)=>console.log((c?'  \u2713 ':'  \u2717 ')+n);
let fail=0; const chk=(n,c)=>{ ok(n,c); if(!c) fail++; };

/* ── ① recomputeSnapshot ── */
console.log('== recomputeSnapshot ==');
const rb={type:'azure',level:40,fat:0,skillLv:3,slots:EMPTY};
const snapOld={type:'azure',level:40,skillLv:3,slots:EMPTY,parts:[],
               stats:{hp:1,atk:1,def:1,spd:1,crit:0,eva:0}};   // 일부러 엉뚱한 옛 값
const fresh=A.recomputeSnapshot(snapOld);
const want=computeStats(rb,[]);
chk('스탯을 지금 밸런스로 다시 계산한다', fresh && fresh.stats.hp===want.hp && fresh.stats.spd===want.spd);
chk('power 도 다시 계산한다', fresh && fresh.power===power(rb,[]));
chk('원본 필드는 보존한다', fresh.snapshot.type==='azure' && fresh.snapshot.level===40 && fresh.snapshot.skillLv===3);
chk('모르는 기체 id 는 null', A.recomputeSnapshot({type:'nope',level:1})===null);
chk('빈 값도 null', A.recomputeSnapshot(null)===null);

/* ── ② 가짜 DB ── */
function fakeDB(rows){
  const writes=[];
  const mk=(sql)=>({ sql, args:[],
    bind(...a){ this.args=a; return this; },
    async first(){
      if(/WHERE nickname = \?1/.test(sql)) return rows.find(r=>r.nickname===this.args[0]) || null;
      if(/power BETWEEN/.test(sql)){
        const [lo,hi,cut,me]=this.args;
        const up=/rnd >=/.test(sql);
        const c=rows.filter(r=>r.power>=lo&&r.power<=hi&&r.account_id!==me&&(up?r.rnd>=cut:r.rnd<cut));
        c.sort((a,b)=>up?(a.power-b.power||a.rnd-b.rnd):(a.power-b.power||b.rnd-a.rnd));
        return c[0]||null;
      }
      return null;
    },
    async all(){
      if(/balance_ver != \?1/.test(sql)){
        const [ver,lim]=this.args;
        return { results: rows.filter(r=>r.balance_ver!==ver).slice(0,lim)
                             .map(r=>({account_id:r.account_id, snapshot:r.snapshot})) };
      }
      return { results: [] };
    },
    async run(){ writes.push(this); return { meta:{changes:1} }; },
  });
  return { DB:{ prepare:mk, async batch(st){ writes.push(...st); return st.map(()=>({})); } }, writes };
}
const mkSnap=(type,level)=>JSON.stringify({type,level,skillLv:0,slots:EMPTY,parts:[],
  stats:computeStats({type,level,fat:0,skillLv:0,slots:EMPTY},[])});
const ver=A.balanceVersion();
const rows=[
  {account_id:1,nickname:'GUEST-0001',robot_type:'azure',level:30,power:3000,rating:1000,rnd:100,balance_ver:ver,      snapshot:mkSnap('azure',30)},
  {account_id:2,nickname:'GUEST-0002',robot_type:'mule', level:30,power:3050,rating:1010,rnd:200,balance_ver:'옛버전', snapshot:mkSnap('mule',30)},
  {account_id:3,nickname:'GUEST-0003',robot_type:'nope', level:30,power:3100,rating:990, rnd:300,balance_ver:'옛버전', snapshot:JSON.stringify({type:'nope',level:30})},
];

console.log('\n== pickOpponentByNickname ==');
{
  const e=fakeDB(rows);
  chk('이름으로 찾는다',        (await A.pickOpponentByNickname(e.DB?e:e, 9, 'GUEST-0001'))?.callsign==='GUEST-0001');
  chk('없는 이름은 null',       (await A.pickOpponentByNickname(e, 9, 'GUEST-9999'))===null);
  chk('자기 자신은 self',       (await A.pickOpponentByNickname(e, 1, 'GUEST-0001'))==='self');
  chk('빈 이름은 null',         (await A.pickOpponentByNickname(e, 9, ''))===null);
  const stale=await A.pickOpponentByNickname(e, 9, 'GUEST-0002');
  const wantMule=computeStats({type:'mule',level:30,fat:0,skillLv:0,slots:EMPTY},[]);
  chk('옛 버전 행은 그 자리에서 다시 계산', stale && stale.stats.hp===wantMule.hp);
  chk('깨진 기체 id 는 null',   (await A.pickOpponentByNickname(e, 9, 'GUEST-0003'))===null);
}

console.log('\n== pickOpponentFromArena — 옛 버전도 매칭에서 안 사라진다 ==');
{
  /* rnd 가 셋뿐이라 정렬이 늘 같은 행을 준다. 그래서 '누가 뽑히나' 가 아니라
     '옛 버전 행이 후보에 남는가' 를 본다 — 그게 이번에 고친 것이다. */
  chk('현재 버전 행이 잡힌다',
      (await A.pickOpponentFromArena(fakeDB([rows[0]]), 9, 3000))?.callsign==='GUEST-0001');
  const staleOnly=await A.pickOpponentFromArena(fakeDB([rows[1]]), 9, 3050);
  const wantMule2=computeStats({type:'mule',level:30,fat:0,skillLv:0,slots:EMPTY},[]);
  chk('옛 버전 행도 잡힌다 (예전에는 통째로 걸러졌다)', staleOnly?.callsign==='GUEST-0002');
  chk('그리고 지금 밸런스로 다시 계산돼 나온다', staleOnly && staleOnly.stats.hp===wantMule2.hp);
  chk('자기 자신은 안 잡힌다', (await A.pickOpponentFromArena(fakeDB([rows[0]]), 1, 3000))===null);
  chk('전투력 창 밖은 안 잡힌다', (await A.pickOpponentFromArena(fakeDB([rows[0]]), 9, 9000))===null);
}

console.log('\n== migrateArena ==');
{
  const e=fakeDB(rows);
  const r=await A.migrateArena(e, 123456, 200);
  chk('옛 버전 2건을 훑는다', r.scanned===2);
  chk('1건 갱신 · 1건 삭제',  r.updated===1 && r.dropped===1);
  const upd=e.writes.filter(w=>/UPDATE arena_entry/.test(w.sql));
  const del=e.writes.filter(w=>/DELETE FROM arena_entry/.test(w.sql));
  chk('UPDATE 는 새 버전을 박는다', upd.length===1 && upd[0].args[1]===ver);
  chk('DELETE 는 깨진 행만',        del.length===1 && del[0].args[0]===3);
  const e2=fakeDB(rows.map(r=>({...r,balance_ver:ver})));
  const r2=await A.migrateArena(e2, 1, 200);
  chk('맞출 것이 없으면 쓰기 0',   r2.scanned===0 && e2.writes.length===0);
}
console.log(fail? `\n${fail}건 실패` : '\n전부 통과');
process.exit(fail?1:0);
