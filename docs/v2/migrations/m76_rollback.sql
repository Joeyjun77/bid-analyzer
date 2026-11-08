-- m76 되돌리기: 새 객체만 지운다(업로드 테이블·기존 함수 미변경).
DROP FUNCTION IF EXISTS public.save_bid_ranks(text, integer, jsonb);
DROP FUNCTION IF EXISTS public.rank_targets(date, integer);
DROP TABLE IF EXISTS public.api_bid_rank_notices;
DROP TABLE IF EXISTS public.api_bid_ranks;
