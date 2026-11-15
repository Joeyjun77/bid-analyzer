-- m90: 참여업체 분포 영구층을 공고당 1행 배열로 압축 (2026-11-15, 사용자 승인 "2번 진행") — m89 뒤 444MiB
-- 배경: participant_dist가 공고×0.01버킷마다 1행(1,204공고·37.6만 행)이라 표 26MB + PK 인덱스 29MB = 55MB.
-- 조치: participant_dist_packed(pn_no PK, buckets numeric[], cnts int[] — bucket 오름차순 짝)로 옮기고
--       읽는 함수 1개(get_participant_distribution)·쓰는 함수 2개(refresh_participant_dist, refresh_participant_dist_for)를 바꾼다.
--       값·의미는 그대로(0.01버킷, adj 80~120, 같은 bucket 표기). 시그니처·권한 유지(CREATE OR REPLACE) → 앱 변경 없음.
--       새 표는 SECURITY DEFINER 함수만 읽으므로 RLS 켜고 anon/authenticated 권한 없이 만든다.
-- 검증(적용 직후): 원본 표 전체 md5 = 새 표 unnest md5, get_participant_distribution 4기관×4버킷 결과 md5 전후 동일,
--       저장 함수 2개를 되돌려지는 시험 실행으로 돌려 원본과 같은 행이 나오는지 확인. 통과 후 아래 ② 실행.
-- ② (검증 통과 후 별도 실행) DROP TABLE public.participant_dist;
-- 되돌리기(② 전): 세 함수를 m46/m48 정의로 재생성하면 원본 표를 다시 읽는다(②까지 했으면 아래로 원본 행 재구성 후 재생성).
--   CREATE TABLE public.participant_dist AS SELECT d.pn_no, u.bucket, u.cnt FROM public.participant_dist_packed d,
--     unnest(d.buckets, d.cnts) u(bucket, cnt);  ALTER TABLE public.participant_dist ADD PRIMARY KEY (pn_no, bucket);

CREATE TABLE public.participant_dist_packed (
  pn_no   text PRIMARY KEY,
  buckets numeric[] NOT NULL,
  cnts    integer[] NOT NULL
);
ALTER TABLE public.participant_dist_packed ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.participant_dist_packed FROM anon, authenticated;

INSERT INTO public.participant_dist_packed (pn_no, buckets, cnts)
SELECT pn_no, array_agg(bucket ORDER BY bucket), array_agg(cnt ORDER BY bucket)
FROM public.participant_dist GROUP BY pn_no;

CREATE OR REPLACE FUNCTION public.get_participant_distribution(p_ag text, p_n integer DEFAULT 30, p_bucket numeric DEFAULT 0.01)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH recent AS (
  SELECT br.pn_no, max(br.od) AS od, max(br.pn) AS pn
  FROM bid_records br
  WHERE br.canonical_ag = p_ag
    AND EXISTS (SELECT 1 FROM participant_dist_meta m WHERE m.pn_no = br.pn_no)
  GROUP BY br.pn_no
  ORDER BY od DESC NULLS LAST, br.pn_no DESC
  LIMIT GREATEST(p_n, 1)
),
meta AS (
  SELECT m.pn_no, m.n, m.win_rate,
         CASE WHEN m.win_rate IS NOT NULL THEN floor(m.win_rate / p_bucket) * p_bucket END AS win_bucket
  FROM participant_dist_meta m JOIN recent r ON r.pn_no = m.pn_no
),
cell AS (
  SELECT * FROM (
    -- m90: 공고당 1행 배열(participant_dist_packed)을 풀어서 재집계
    SELECT d.pn_no, floor(u.bucket / p_bucket) * p_bucket AS bucket, SUM(u.cnt)::bigint AS cnt
    FROM participant_dist_packed d JOIN recent r ON r.pn_no = d.pn_no
    CROSS JOIN LATERAL unnest(d.buckets, d.cnts) AS u(bucket, cnt)
    WHERE p_bucket >= 0.01
    GROUP BY d.pn_no, floor(u.bucket / p_bucket) * p_bucket
    UNION ALL
    SELECT bp.pn_no, floor(bp.adj_rate / p_bucket) * p_bucket AS bucket, COUNT(*)::bigint AS cnt
    FROM bid_participants bp JOIN recent r ON r.pn_no = bp.pn_no
    WHERE p_bucket < 0.01 AND bp.adj_rate IS NOT NULL AND bp.adj_rate BETWEEN 80 AND 120
    GROUP BY bp.pn_no, floor(bp.adj_rate / p_bucket) * p_bucket
  ) u
)
SELECT jsonb_build_object(
  'ag', p_ag, 'bucket', p_bucket,
  'columns', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('pn_no',r.pn_no,'od',r.od,'pn',r.pn,
             'n',COALESCE(m.n,0),'win_rate',m.win_rate)
           ORDER BY r.od DESC NULLS LAST, r.pn_no DESC)
    FROM recent r LEFT JOIN meta m ON m.pn_no=r.pn_no
  ), '[]'::jsonb),
  'cells', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('pn_no',c.pn_no,'bucket',c.bucket,'cnt',c.cnt,
             'is_win', (m.win_bucket IS NOT NULL AND c.bucket = m.win_bucket)))
    FROM cell c LEFT JOIN meta m ON m.pn_no=c.pn_no
  ), '[]'::jsonb)
);
$function$;

CREATE OR REPLACE FUNCTION public.refresh_participant_dist()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_pnnos int;
BEGIN
  CREATE TEMP TABLE tmp_pn ON COMMIT DROP AS
    SELECT DISTINCT pn_no FROM bid_participants;
  SELECT COUNT(*) INTO v_pnnos FROM tmp_pn;

  -- m90: 공고당 1행 배열로 저장
  DELETE FROM participant_dist_packed d USING tmp_pn t WHERE d.pn_no = t.pn_no;
  INSERT INTO participant_dist_packed (pn_no, buckets, cnts)
    SELECT g.pn_no, array_agg(g.bucket ORDER BY g.bucket), array_agg(g.cnt ORDER BY g.bucket)
    FROM (
      SELECT bp.pn_no, floor(bp.adj_rate / 0.01) * 0.01 AS bucket, COUNT(*)::int AS cnt
      FROM bid_participants bp JOIN tmp_pn t ON t.pn_no = bp.pn_no
      WHERE bp.adj_rate IS NOT NULL AND bp.adj_rate BETWEEN 80 AND 120
      GROUP BY bp.pn_no, floor(bp.adj_rate / 0.01) * 0.01
    ) g
    GROUP BY g.pn_no;

  DELETE FROM participant_dist_meta m USING tmp_pn t WHERE m.pn_no = t.pn_no;
  INSERT INTO participant_dist_meta (pn_no, n, win_rate)
    SELECT t.pn_no,
      COALESCE((SELECT COUNT(*) FROM bid_participants b
                WHERE b.pn_no=t.pn_no AND b.adj_rate IS NOT NULL AND b.adj_rate BETWEEN 80 AND 120), 0),
      (SELECT MIN(b.adj_rate) FROM bid_participants b
        WHERE b.pn_no=t.pn_no AND b.rank=1 AND b.adj_rate IS NOT NULL)
    FROM tmp_pn t;
  RETURN v_pnnos;
END;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_participant_dist_for(p_pnnos text[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_cnt int;
BEGIN
  IF p_pnnos IS NULL OR array_length(p_pnnos, 1) IS NULL OR array_length(p_pnnos, 1) > 50 THEN
    RETURN 0;  -- 빈 입력 또는 과대 입력(업로드 1회 분량 초과) 거부
  END IF;

  CREATE TEMP TABLE tmp_pn_for ON COMMIT DROP AS
    SELECT DISTINCT bp.pn_no FROM bid_participants bp WHERE bp.pn_no = ANY(p_pnnos);
  SELECT COUNT(*) INTO v_cnt FROM tmp_pn_for;
  IF v_cnt = 0 THEN RETURN 0; END IF;

  -- m90: 공고당 1행 배열로 저장
  DELETE FROM participant_dist_packed d USING tmp_pn_for t WHERE d.pn_no = t.pn_no;
  INSERT INTO participant_dist_packed (pn_no, buckets, cnts)
    SELECT g.pn_no, array_agg(g.bucket ORDER BY g.bucket), array_agg(g.cnt ORDER BY g.bucket)
    FROM (
      SELECT bp.pn_no, floor(bp.adj_rate / 0.01) * 0.01 AS bucket, COUNT(*)::int AS cnt
      FROM bid_participants bp JOIN tmp_pn_for t ON t.pn_no = bp.pn_no
      WHERE bp.adj_rate IS NOT NULL AND bp.adj_rate BETWEEN 80 AND 120
      GROUP BY bp.pn_no, floor(bp.adj_rate / 0.01) * 0.01
    ) g
    GROUP BY g.pn_no;

  DELETE FROM participant_dist_meta m USING tmp_pn_for t WHERE m.pn_no = t.pn_no;
  INSERT INTO participant_dist_meta (pn_no, n, win_rate)
    SELECT t.pn_no,
      COALESCE((SELECT COUNT(*) FROM bid_participants b
                WHERE b.pn_no = t.pn_no AND b.adj_rate IS NOT NULL AND b.adj_rate BETWEEN 80 AND 120), 0),
      (SELECT MIN(b.adj_rate) FROM bid_participants b
        WHERE b.pn_no = t.pn_no AND b.rank = 1 AND b.adj_rate IS NOT NULL)
    FROM tmp_pn_for t;

  RETURN v_cnt;
END;
$function$;

-- ② 2026-11-15 검증 통과 뒤 실행 (migration m90b_drop_participant_dist):
--    원본 전체 md5 dd0f723b… = 새 표 unnest md5 (37.6만 행·1,204공고·합계 350만), 분포 RPC 4기관×4버킷 16건 md5 전후 동일,
--    저장 함수 2개 시험 실행(되돌림) 결과 원본과 동일. 새 표 2.3MB, DB 444→390MiB.
DROP TABLE public.participant_dist;
