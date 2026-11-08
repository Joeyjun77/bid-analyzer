-- m76: 개찰 전체 순위 API 수집 테이블 (goyang-focus P3, 2026-11-08)
-- 원천: ScsbidInfoService getOpengResultListInfoOpengCompt (실측 docs/v2/GOYANG_DATA_SOURCES_PROBE_2026-11-08.md §2.1)
-- 대상: 고양 마스터 include × bid_notices.is_target(전기·정보통신·전문소방) × 개찰 완료 (D1 결정)
-- 분류: Neutral — 업로드 테이블(bid_participants·bid_details)과 분리, 예측 경로는 읽지 않는다. INSERT-only(ON CONFLICT DO NOTHING).
-- 단위: 금액이 원본. 비율은 기준을 칼럼명에 명시(rate_vs_plnprc = 투찰금액/예정가격×100, API bidprcrt).
--   업로드 bid_participants.bid_rate와 기준이 다르므로 섞지 않는다.
-- 권한: RLS on + 정책 없음, anon·authenticated 회수 → service_role(수집 함수)만. 되돌리기: m76_rollback.sql

CREATE TABLE public.api_bid_ranks (
  bid_ntce_no    text NOT NULL,
  bid_ntce_ord   text NOT NULL,
  bid_clsfc_no   text NOT NULL,
  rbid_no        text NOT NULL,
  bizno          text NOT NULL,          -- prcbdrBizno
  openg_rank     integer,                -- opengRank (숫자가 아니면 NULL)
  co_name        text,                   -- prcbdrNm
  bid_amount     numeric,                -- bidprcAmt (원본)
  rate_vs_plnprc numeric,                -- bidprcrt = bid_amount / 예정가격 × 100
  rmrk           text,                   -- 정상·무효 등
  drwt_no1       smallint,               -- 업체가 고른 추첨번호
  drwt_no2       smallint,
  bid_dt         timestamptz,            -- bidprcDt (KST)
  collected_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bid_ntce_no, bid_ntce_ord, bid_clsfc_no, rbid_no, bizno)
);

-- 공고 단위 수집 표시: 전 페이지를 받은 공고만 기록(재수집 방지·완전성 확인)
CREATE TABLE public.api_bid_rank_notices (
  bid_ntce_no   text PRIMARY KEY,
  total_count   integer NOT NULL,
  rows_received integer NOT NULL,
  rows_saved    integer NOT NULL,
  fetched_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.api_bid_ranks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_bid_rank_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_bid_ranks, public.api_bid_rank_notices FROM PUBLIC, anon, authenticated;

-- 수집 대상: 고양 include × 대상 업종 × 개찰 2시간 경과 × 아직 수집 안 함
CREATE FUNCTION public.rank_targets(p_since date DEFAULT '2026-04-01', p_limit integer DEFAULT 20)
RETURNS TABLE (bid_ntce_no text, od timestamptz)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT n.bid_ntce_no, max(n.od)
  FROM v_goyang_notices n
  WHERE n.is_target AND n.od >= p_since AND n.od < now() - interval '2 hours'
    AND NOT EXISTS (SELECT 1 FROM api_bid_rank_notices d WHERE d.bid_ntce_no = n.bid_ntce_no)
  GROUP BY n.bid_ntce_no
  ORDER BY max(n.od)
  LIMIT p_limit;
$$;

-- 공고 1건의 전 페이지 항목을 한 번에 저장 + 수집 표시
CREATE FUNCTION public.save_bid_ranks(p_bid_ntce_no text, p_total integer, p_items jsonb)
RETURNS TABLE (saved integer)
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_saved integer;
BEGIN
  INSERT INTO api_bid_ranks (bid_ntce_no, bid_ntce_ord, bid_clsfc_no, rbid_no, bizno, openg_rank, co_name,
                             bid_amount, rate_vs_plnprc, rmrk, drwt_no1, drwt_no2, bid_dt)
  SELECT x."bidNtceNo", coalesce(x."bidNtceOrd", '000'), coalesce(x."bidClsfcNo", '0'), coalesce(x."rbidNo", '000'),
         x."prcbdrBizno",
         CASE WHEN trim(x."opengRank") ~ '^\d+$' THEN trim(x."opengRank")::int END,
         x."prcbdrNm",
         CASE WHEN trim(x."bidprcAmt") ~ '^\d+(\.\d+)?$' THEN trim(x."bidprcAmt")::numeric END,
         CASE WHEN trim(x."bidprcrt") ~ '^\d+(\.\d+)?$' THEN trim(x."bidprcrt")::numeric END,
         x."rmrk",
         CASE WHEN trim(x."drwtNo1") ~ '^\d+$' THEN trim(x."drwtNo1")::smallint END,
         CASE WHEN trim(x."drwtNo2") ~ '^\d+$' THEN trim(x."drwtNo2")::smallint END,
         CASE WHEN x."bidprcDt" ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$' THEN (x."bidprcDt" || '+09')::timestamptz END
  FROM jsonb_to_recordset(p_items) AS x("bidNtceNo" text, "bidNtceOrd" text, "bidClsfcNo" text, "rbidNo" text,
       "prcbdrBizno" text, "opengRank" text, "prcbdrNm" text, "bidprcAmt" text, "bidprcrt" text, "rmrk" text,
       "drwtNo1" text, "drwtNo2" text, "bidprcDt" text)
  WHERE x."bidNtceNo" = p_bid_ntce_no AND coalesce(x."prcbdrBizno", '') <> ''
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_saved = ROW_COUNT;

  INSERT INTO api_bid_rank_notices (bid_ntce_no, total_count, rows_received, rows_saved)
  VALUES (p_bid_ntce_no, p_total, jsonb_array_length(p_items), v_saved)
  ON CONFLICT (bid_ntce_no) DO NOTHING;

  RETURN QUERY SELECT v_saved;
END $$;

REVOKE ALL ON FUNCTION public.rank_targets(date, integer), public.save_bid_ranks(text, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rank_targets(date, integer), public.save_bid_ranks(text, integer, jsonb) TO service_role;
