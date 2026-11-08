-- m74: 고양 기관 마스터·alias 초기 적재 (issue 01, 학교 매핑 A+B 결정 2026-11-08)
-- 원천: bid_notices (ag, ag_code) 고양 쌍 23개, bid_records·bid_predictions 고양 표기(11/8 조회).
-- include 초안: G1~G5 true, X false. B 후보(이름에 고양 없는 경기도교육청 고교·특수학교)는 전부 false —
--   사용자가 고양 소재를 확인한 것만 m74 이후 UPDATE로 true + verified_by/verified_at 기록.
-- 되돌리기: DELETE FROM goyang_org_alias; DELETE FROM goyang_org_master;  (또는 m73_rollback.sql)

-- 1) 코드가 확인된 기관 (bid_notices)
INSERT INTO public.goyang_org_master (ag_code, ag_name, grp, parent_code, include, note) VALUES
  ('3940000','경기도 고양시','G1',NULL,true,'본청'),
  ('3950000','경기도 고양시 덕양구','G2','3940000',true,NULL),
  ('3960100','경기도 고양시 일산동구','G2','3940000',true,NULL),
  ('4100100','고양시 일산서구청','G2','3940000',true,NULL),
  ('B552741','고양도시관리공사','G3','3940000',true,'현 ILIKE 정의 밖 → 포함 시 정의 확대'),
  ('Z008654','고양시장애인종합복지관','G3',NULL,true,'현 정의 안(이름에 고양시)'),
  ('Z010310','고양시흰돌종합사회복지관','G3',NULL,true,'현 정의 안(이름에 고양시)'),
  ('7621000','경기도고양교육지원청','G4',NULL,true,NULL),
  ('7620064','경기도고양교육청 성석초등학교','G5','7621000',true,NULL),
  ('7620174','경기도고양교육청 가좌초등학교','G5','7621000',true,NULL),
  ('7620305','경기도고양교육청 일산양일중학교','G5','7621000',true,NULL),
  ('7621033','경기도고양교육지원청 중산중학교','G5','7621000',true,NULL),
  ('7621077','경기도고양교육지원청 신원초등학교','G5','7621000',true,NULL),
  ('7621080','경기도고양교육지원청 오마초등학교','G5','7621000',true,NULL),
  ('7621101','경기도고양교육지원청 호수초등학교','G5','7621000',true,NULL),
  ('7621165','경기도고양교육지원청 풍동초등학교','G5','7621000',true,NULL),
  ('7530777','경기도교육청 고양예술고등학교','G5',NULL,true,'753xxxx = 경기도교육청 직속 고교(도 전체)'),
  ('7530977','경기도교육청 고양국제고등학교','G5',NULL,true,NULL),
  ('1495044','고용노동부 경기지방고용노동청 고양지청','X',NULL,false,'국가기관 지청'),
  ('1810756','경찰청 경기도북부경찰청 고양경찰서','X',NULL,false,'국가기관'),
  ('C681006','중부대학교 중부대학교고양캠퍼스','X',NULL,false,'사립대'),
  ('D152133','한국농어촌공사 경기지역본부 고양지사','X',NULL,false,'공기업 지사'),
  ('D325111','한국지역난방공사 고양사업소','X',NULL,false,'공기업 지사');

-- 2) 코드 미확인 기관 (bid_records·bid_predictions에만 있는 이름) — ag_code = 'NC:' || 이름
INSERT INTO public.goyang_org_master (ag_code, ag_name, grp, parent_code, include, note)
SELECT 'NC:' || v.name, v.name, v.grp, v.parent, v.inc, v.note
FROM (VALUES
  ('고양시건강가정지원센터','G3',NULL,true,'현 정의 안'),
  ('재단법인 고양문화재단','G3','3940000',true,'시 출연기관'),
  ('(재)고양지식정보산업진흥원','G3','3940000',true,'시 출연기관(고양산업진흥원 구 명칭)'),
  ('고양산업진흥원','G3','3940000',true,'시 출연기관'),
  ('(재)고양국제꽃박람회','G3','3940000',true,'시 출연기관'),
  ('재단법인고양연구원','G3','3940000',true,'시 출연기관'),
  ('경기도교육청 고양외국어고등학교','G5',NULL,true,NULL),
  ('경기도교육청 고양고등학교','G5',NULL,true,NULL),
  ('경기도교육청 고양여자고등학교','G5',NULL,true,NULL),
  ('고양동산고등학교','G5',NULL,true,NULL),
  ('경기도 고양소방서','X',NULL,false,'경기도 소속'),
  ('한국수자원공사 고양권관리단','X',NULL,false,'공기업'),
  ('한국토지주택공사 고양사업본부','X',NULL,false,'공기업'),
  ('한국토지주택공사 고양직할사업단','X',NULL,false,'공기업'),
  ('국세청 인천지방국세청 동고양세무서','X',NULL,false,'국가기관')
) AS v(name, grp, parent, inc, note);

-- 3) B 후보: 이름에 고양 없는 경기도교육청 고교·특수학교 중 공고 지역제한에 고양시가 나온 32곳 (전부 include=false)
INSERT INTO public.goyang_org_master (ag_code, ag_name, grp, include, note)
SELECT 'NC:' || name, name, 'G5', false, 'B 후보: 고양 소재 확인 전'
FROM unnest(ARRAY[
  '경기도교육청 가좌고등학교','경기도교육청 경기영상과학고등학교','경기도교육청 광탄고등학교',
  '경기도교육청 김포외국어고등학교','경기도교육청 능곡고등학교','경기도교육청 명현학교',
  '경기도교육청 문산수억고등학교','경기도교육청 문산여자고등학교','경기도교육청 백석고등학교',
  '경기도교육청 백송고등학교','경기도교육청 백신고등학교','경기도교육청 백양고등학교',
  '경기도교육청 삼광고등학교','경기도교육청 새얼학교','경기도교육청 서정고등학교',
  '경기도교육청 세경고등학교','경기도교육청 세원고등학교','경기도교육청 신일비즈니스고등학교',
  '경기도교육청 안곡고등학교','경기도교육청 운정고등학교','경기도교육청 율곡고등학교',
  '경기도교육청 일산국제컨벤션고등학교','경기도교육청 일산대진고등학교','경기도교육청 일산동고등학교',
  '경기도교육청 자운학교','경기도교육청 저동고등학교','경기도교육청 통진고등학교',
  '경기도교육청 파주고등학교','경기도교육청 파주여자고등학교','경기도교육청 풍동고등학교',
  '경기도교육청 홀트학교','경기도교육청 화수고등학교'
]) AS name;

-- 4) alias: bid_notices 쌍 (코드 확정 표기)
INSERT INTO public.goyang_org_alias (ag_text, ag_code, source)
SELECT DISTINCT ON (n.ag) n.ag, n.ag_code, 'notice'
FROM public.bid_notices n
JOIN public.goyang_org_master m ON m.ag_code = n.ag_code
ORDER BY n.ag, n.ag_code;

-- 5) alias: 수동 (같은 기관 다른 표기)
INSERT INTO public.goyang_org_alias (ag_text, ag_code, source) VALUES
  ('경기도고양교육지원청','7621000','manual'),
  ('경기도 고양시 푸른도시사업소','3940000','manual')
ON CONFLICT (ag_text) DO NOTHING;

-- 6) A: '고양교육(지원)청' 접두 학교·유치원 표기 (bid_records·bid_predictions, 코드 미확인) → 학교별 NC 코드
INSERT INTO public.goyang_org_master (ag_code, ag_name, grp, parent_code, include, note)
SELECT 'NC:' || t.ag, t.ag, 'G5', '7621000', true, 'A: 고양교육지원청 접두'
FROM (SELECT ag FROM public.bid_records WHERE ag ILIKE '%고양교육%' AND ag ~ '(학교|유치원)'
      UNION SELECT ag FROM public.bid_predictions WHERE ag ILIKE '%고양교육%' AND ag ~ '(학교|유치원)') t
WHERE NOT EXISTS (SELECT 1 FROM public.goyang_org_alias a WHERE a.ag_text = t.ag);

-- 7) alias: NC 기관은 이름 그대로
INSERT INTO public.goyang_org_alias (ag_text, ag_code, source)
SELECT ag_name, ag_code, 'record' FROM public.goyang_org_master WHERE ag_code LIKE 'NC:%'
ON CONFLICT (ag_text) DO NOTHING;
