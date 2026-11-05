-- m67 되돌리기: anon 전체 권한 복원 (공개 키로 쓰기가 다시 열리므로 장애 복구 때만 사용)
GRANT ALL ON TABLE public.api_collection_rules TO anon;
GRANT ALL ON TABLE public.api_ingestion_log TO anon;
CREATE POLICY anon_all_rules ON public.api_collection_rules FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY anon_all_api_log ON public.api_ingestion_log FOR ALL TO anon USING (true) WITH CHECK (true);
