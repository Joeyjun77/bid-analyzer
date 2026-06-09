-- 참여업체리스트 적재 (Phase 1). SUCVIEW 참여업체 행 단위.
-- adj_rate = 업체별사정율(= 가정사정율) 100기준 절대값. RLS는 bid_details 정책 미러.
CREATE TABLE IF NOT EXISTS public.bid_participants (
  id           bigserial PRIMARY KEY,
  pn_no        text NOT NULL,
  od           date,
  ag           text,
  canonical_ag text,
  at           text,
  rank         integer,
  co_no        text,
  co_name      text,
  rep          text,
  bid_amount   numeric,
  bid_rate     numeric,
  base_rate    numeric,
  adj_rate     numeric,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bid_participants_uniq UNIQUE NULLS NOT DISTINCT (pn_no, co_no)
);
CREATE INDEX IF NOT EXISTS bid_participants_ag_od_idx ON public.bid_participants (canonical_ag, od DESC);
CREATE INDEX IF NOT EXISTS bid_participants_cono_idx  ON public.bid_participants (co_no);
CREATE INDEX IF NOT EXISTS bid_participants_pnno_idx  ON public.bid_participants (pn_no);

ALTER TABLE public.bid_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY participants_select_auth ON public.bid_participants FOR SELECT TO authenticated USING (true);
CREATE POLICY participants_insert_auth ON public.bid_participants FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY participants_update_auth ON public.bid_participants FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY participants_delete_admin ON public.bid_participants FOR DELETE
  USING (auth.uid() IN (SELECT users.id FROM auth.users WHERE (users.email)::text = 'bsilisk777@gmail.com'));
