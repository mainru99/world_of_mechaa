-- 난투 (2026-10-07 사용자 결정 · docs/plan/brawl-2026-10-07.md ④) — 표 셋 · 칸 하나.
--
-- brawl_run    진행 중인 런. 계정당 하나(PK). run 은 js/brawl.js 의 런 상태 JSON 그대로.
--              first = 그날 첫 런(보상 대상) · met = 이미 만난 유령 id(다시 만나지 않는다) · rev = 두 번 눌러도 한 번만.
--              런이 끝나면 행을 지운다(기록은 brawl_week 에 남는다).
-- brawl_ghost  라운드마다 저장하는 보드 — 다른 사람이 같은 라운드에서 만난다(아레나 방어 기록과 같은 방식).
--              board 는 [{ type, star } | null ×4] 뿐이라 밸런스를 고쳐도 낡지 않는다(능력치는 싸울 때 계산).
--              청소가 14일 넘은 행을 지운다(server/cleanup.js).
-- brawl_week   주간 순위 — 최고 승수 · 그때 남은 목숨. 주는 시련과 같다(월요일 00:00 UTC · js/trial.js weekOf).
-- player.brawl 오늘 쓴 것 { d: UTC 날짜, runs: 시작한 런 수, tickets: 쓴 대여 장 수 } — js/raid.js dayOf.
--
-- 기존 행은 건드리지 않는다. 스위치 CONST.BRAWL.on 이 꺼져 있는 동안 이 표들은 비어 있다.
CREATE TABLE IF NOT EXISTS brawl_run (
  account_id  INTEGER PRIMARY KEY REFERENCES account(id) ON DELETE CASCADE,
  run         TEXT    NOT NULL,
  first       INTEGER NOT NULL DEFAULT 0,
  met         TEXT,
  rev         INTEGER NOT NULL DEFAULT 0,
  started_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS brawl_ghost (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  round       INTEGER NOT NULL,
  account_id  INTEGER REFERENCES account(id) ON DELETE CASCADE,
  nickname    TEXT    NOT NULL,
  board       TEXT    NOT NULL,
  wins        INTEGER NOT NULL DEFAULT 0,
  lives       INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_brawl_ghost ON brawl_ghost(round, id DESC);
CREATE INDEX IF NOT EXISTS ix_brawl_ghost_at ON brawl_ghost(created_at);
CREATE TABLE IF NOT EXISTS brawl_week (
  week        INTEGER NOT NULL,
  account_id  INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  nickname    TEXT    NOT NULL,
  best        INTEGER NOT NULL DEFAULT 0,
  lives       INTEGER NOT NULL DEFAULT 0,
  runs        INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (week, account_id)
);
CREATE INDEX IF NOT EXISTS ix_brawl_week ON brawl_week(week, best DESC, lives DESC);
ALTER TABLE player ADD COLUMN brawl TEXT;

UPDATE meta SET v = '25' WHERE k = 'schema_version';
