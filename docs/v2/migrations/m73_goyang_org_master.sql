-- m73: 고양 기관 마스터·이름 매핑·후보 큐 (goyang-focus P1, issue 01) — 2026-11-08
-- 목적: 핵심 영역 '고양시'를 이름 ILIKE 대신 기관 코드 한 곳에서 정의한다.
-- 분류: Neutral (predict-architect 11/8). 예측 경로(predict_v6·pred_bias_map·lookup_agency_mode·
--   pred_baseg_finetune·agency_win_stats·클라이언트)는 이 객체를 읽지 않는다. 읽기 시작하면 Generator(P5).
-- 권한: 테이블 RLS on + 정책 없음 → service_role(RLS 우회)만 읽기·쓰기. anon·authenticated 회수(m66 패턴).
--   뷰는 security_invoker(m71 교훈: 기본 뷰는 소유자 권한으로 RLS를 우회).
-- 부하: v_goyang_records는 bid_records 전체 조인 — 평가·수동 조회 전용. 클라이언트 주기 조회·cron 금지(10/21 IO 사고).
-- 데이터 적재: m74_goyang_org_seed.sql. 되돌리기: m73_rollback.sql

CREATE TABLE public.goyang_org_master (
  ag_code     text PRIMARY KEY,           -- 나라장터 수요기관코드. 코드 미확인 기관은 'NC:' || 기관명
  ag_name     text NOT NULL,
  grp         text NOT NULL CHECK (grp IN ('G1','G2','G3','G4','G5','X')),
  parent_code text,
  include     boolean NOT NULL DEFAULT false,  -- 핵심 영역 포함 여부. 바꾸면 정의 변경(evaluate.md 재기준화)
  note        text,
  verified_by text,
  verified_at timestamptz
);

CREATE TABLE public.goyang_org_alias (
  ag_text text PRIMARY KEY,               -- bid_records.ag / bid_predictions.ag / bid_notices.ag 원문
  ag_code text NOT NULL REFERENCES public.goyang_org_master(ag_code),
  source  text NOT NULL CHECK (source IN ('notice','record','prediction','manual'))
);

ALTER TABLE public.goyang_org_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goyang_org_alias  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.goyang_org_master, public.goyang_org_alias FROM PUBLIC, anon, authenticated;

-- 핵심 영역 고양 기록: include=true 기관만
CREATE VIEW public.v_goyang_records WITH (security_invoker = true) AS
SELECT r.*, m.ag_code AS goyang_code, m.grp AS goyang_grp
FROM public.bid_records r
JOIN public.goyang_org_alias a ON a.ag_text = r.ag
JOIN public.goyang_org_master m ON m.ag_code = a.ag_code
WHERE m.include;

CREATE VIEW public.v_goyang_notices WITH (security_invoker = true) AS
SELECT n.*, m.grp AS goyang_grp
FROM public.bid_notices n
JOIN public.goyang_org_master m ON m.ag_code = n.ag_code
WHERE m.include;

-- 후보 큐: 최근 60일 새 고양 기관·표기. 자동 확정 금지 — 사람이 보고 master/alias에 넣는다.
-- shortcut: 이름에 '고양'이 없는 고교(경기도교육청 ○○고등학교)는 못 잡는다. 놓친 학교가 보이면 수동 alias.
CREATE VIEW public.v_goyang_org_candidates WITH (security_invoker = true) AS
SELECT 'notice'::text AS src, n.ag_code, n.ag, count(*) AS n, max(n.created_at) AS last_seen
FROM public.bid_notices n
WHERE n.created_at >= current_date - 60
  AND (n.ag ILIKE '%고양%' OR n.ag_code ~ '^762[01]')
  AND NOT EXISTS (SELECT 1 FROM public.goyang_org_master m WHERE m.ag_code = n.ag_code)
GROUP BY n.ag_code, n.ag
UNION ALL
SELECT 'record', NULL, r.ag, count(*), max(r.created_at)
FROM public.bid_records r
WHERE r.created_at >= current_date - 60
  AND r.ag ILIKE '%고양%'
  AND NOT EXISTS (SELECT 1 FROM public.goyang_org_alias a WHERE a.ag_text = r.ag)
GROUP BY r.ag;

REVOKE ALL ON public.v_goyang_records, public.v_goyang_notices, public.v_goyang_org_candidates
  FROM PUBLIC, anon, authenticated;
