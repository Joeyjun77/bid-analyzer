SESSION_ID:01a162b7-49ea-73b1-9128-818b5c812e65
지정한 저장소 코드와 테스트만 읽고 설계와 대조하겠습니다. DB·네트워크 조회나 파일 변경 없이, 지표의 타당성과 P2/P3의 업무 흐름 위험을 우선 확인하겠습니다.
[codex ran] "C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command 'Get-Content src/lib/eligibility.js; Get-Content src/lib/performance.js; Get-Content src/components/PerformanceTab.jsx'
[codex ran] "C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command 'Get-Content tests/eligibility.test.mjs; Get-Content tests/performance.test.mjs; Get-Content src/components/RecommendPanel.jsx; Get-Content src/components/WhyPanel.jsx'
[codex ran] "C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "Get-Content src/components/NoticesTab.jsx; rg -n 'PerformanceTab|bidDetails|setBidDetails|recommendMain|resolvePcDist|buildAdjHistory|fetchBidDetails|fetchAll|setRecs' src/App.jsx src/lib/supabase.js src/lib/participantCount.js; Get-Content docs/superpowers/specs/2026-10-22-bid-ops-funnel-redesign-design.md"
[codex ran] "C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "rg -n 'PerformanceTab|bidDetails|setBidDetails|recommendMain|buildAdjHistory|setRecs' src/App.jsx; rg -n 'sbLoad|bid_details|bid_records|limit|Range|order=' src/lib/supabase.js; Get-Content src/lib/participantCount.js; Get-Content src/components/NoticesTab.jsx"
P1은 명세의 집계식을 대체로 그대로 구현했지만, 집계식 자체에 문제가 있습니다. 커버리지는 동일한 공고 집합끼리 대조하지 않고, 통과율은 순위 유무를 하한 통과로 해석합니다. P2에서는 자동수집 행과 업로드 행을 합칠 때 어떤 추천을 선택하는지가 핵심인데, 그 규칙이 빌더 재량으로 남아 있습니다.
[codex ran] "C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "Get-Content src/lib/passProb.js; Get-Content src/lib/fmtAdj.js; Get-Content src/lib/modeResolver.js; Select-String -Path src/lib/sucviewParse.js -Pattern 'my_rank|my_bid_rate|win_bid_rate|floor_rate|pn_no|my_adj_rate' -Context 2,3; Get-Content package.json"
[codex ran] "C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "Select-String -Path src/App.jsx -Pattern 'PerformanceTab|bidDetails|setBidDetails|recommendMain|buildAdjHistory|setRecs' -Context 2,3; Select-String -Path src/lib/supabase.js -Pattern 'bid_details|bid_records|limit|Range|order=' -Context 2,3"
[codex ran] "C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command '$code = Get-Content src/lib/supabase.js; $code[0..92]; $hits = Select-String -Path src/lib/supabase.js -Pattern '"'"'^export async function sbFetchDetails|''^export async function sbFetchPredictions'"'; foreach ("'$hit in $hits) { $code[($hit.LineNumber-1)..($hit.LineNumber+20)] }; Select-String -Path src/App.jsx -Pattern '"'getFinalRecommendation|RecommendPanel|WhyPanel|mainMetric=' -Context 1,5; Select-String -Path src/lib/performance.js,src/components/PerformanceTab.jsx -Pattern 'nearBand:|coverage =|nearRate:|noUpload =|periodLabel|90%|dedupeByPnNo|classifyRecord'"
[codex ran] "C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command 'node --test tests/eligibility.test.mjs tests/performance.test.mjs; $code=Get-Content src/App.jsx; $code[551..601]; $code[1158..1198]; Select-String -Path src/lib/supabase.js -Pattern '"'"'^export async function sbFetchDetails|''^export async function sbFetchNotices'"'; Select-String -Path src/components/RecommendPanel.jsx -Pattern 'mainMetric|metricPct|metricLabel'; Select-String -Path src/components/WhyPanel.jsx -Pattern 'modeReason|median_gap|p90_gap|source'"
1. **[최우선] §0은 원인을 입증하지 못했다.**  
   경쟁 과밀과 실격이 불리하다는 사실에서 “엔진 고장이 아니다·예측 정밀도는 레버가 아니다”는 결론은 나오지 않는다. 추첨의 불확실성과 **자사 투찰의 체계적 하향 편향**은 별개다. 고양에서 −0.4%p 편향이 있었다면 오히려 후자를 의심해야 한다. 추천 준수도 9%이므로 자사 실적으로 앱 엔진을 판정할 수도 없다. 빠진 대안 설명은 추천 미사용, 잘못된 요율·자사 점수, 자격·적격심사 탈락, 결과 수집 누락이다. 과거 낙찰 14건도 전체 참여 건수 없이 비교하면 생존자 편향이다.

2. **[최우선] ‘하한 통과’와 ‘당첨 구간 접근’이 충돌하는데 선택 기준이 없다.**  
   투찰금을 높이면 하한 통과율은 개선되지만 1위 금액에서 멀어질 수 있다. 따라서 **통과율 90% 달성이 낙찰 기회 개선을 보장하지 않는다.** 월별 가시화도 측정 수단이지 독립적인 승률 레버가 아니다. 엔진을 동결하면서 UI만으로 통과율을 크게 올리겠다는 목표에는 추천 채택률 개선이라는 검증되지 않은 전제가 있다. G2의 “현 52%”도 §0에서는 **실격률**이다. §6.4 키워드 집합의 순위 기준 통과율은 72/146≈49.3%다.

3. **[최우선] 커버리지는 현재 ‘참여 가능한 시장 커버리지’가 아니다.**  
   `bid_records`가 참여 가능한 공고 전체를 빠짐없이 포함한다는 보장이 없다. 발주처·제목에 “고양”이 있다고 자사 자격이 성립하지도 않는다. 업종·실적·금액·지역 제한을 확인하지 않는다. 구현은 두 데이터의 공고 ID를 대조하지 않고 **각각 센 숫자를 나누므로 100% 초과도 가능**하다. 분모에서 제외·유찰을 빼면서 분자에 동일한 제외 규칙도 적용하지 않는다. 키워드를 줄이거나 분모 파일을 덜 올리면 성적이 좋아진다. ([집계 코드](C:/Users/home/bid-analyzer/src/lib/performance.js:59))

4. **[높음] §6.2의 추천 빈칸 결정은 업무 흐름 확인 전에는 채택할 수 없다.**  
   현재 공고 화면은 자동수집 공고를 “예측 등록”으로 처리하도록 안내한다. 이를 엑셀 업로드 필수로 바꾸는 것은 기능 축소다. 월 300~500건에서 성립하려면 **일괄 내보내기→일괄 업로드→누락·실패 확인**이 가능해야 한다. 문서에는 처리 시간, 일괄 처리 가능 범위, 실패 복구 기준이 없다. §8의 실제 업무 흐름 질문은 열린 질문이 아니라 **P2 착수 선행조건**이다. ([현재 화면](C:/Users/home/bid-analyzer/src/components/NoticesTab.jsx:53))

5. **[높음] ‘오늘의 공고’에 투찰 마감일이 없다.**  
   개찰일은 작업 마감일이 아니다. 개찰 예정이어도 이미 투찰이 마감됐을 수 있다. 세 상태만으로는 마감·취소·정정·결과 대기·예측 실패·미지원·준비 완료를 구분하지 못한다. “예측됨”은 자사가 실제로 투찰했다는 뜻도 아니다. 이 상태 모델로는 일일 누락 방지가 불가능하다. 더구나 기존 조회는 **개찰일 오름차순 최대 1,000건**이라 누적되면 최신 공고가 잘릴 수 있다. 조회 경로 무변경 제약과 충돌한다. ([조회 코드](C:/Users/home/bid-analyzer/src/lib/supabase.js:656))

6. **[높음] P1의 통과율·근접률은 이름과 해석이 부정확하다.**  
   `my_rank >= 1`은 순위 확인율에 가깝다. 순위 null은 파싱 실패·미확인·다른 탈락 사유일 수도 있다. 그런데 화면은 이를 “하한가 위에 안착한 비율”이라고 설명하고 사정률을 올리라고 지시한다.  
   근접률은 `gap <= 0.5`만 검사하여 **−0.4도 근접으로 집계**한다. 단위가 bid_rate라는 사실만으로 지표가 타당해지지는 않는다. 0.5%p가 실제 1위 경쟁에서 충분히 가까운지 근거가 없고, 고정 폭은 경쟁 규모 차이도 무시한다. 결측·이상치 간격은 분자에서 제외하면서 분모에는 남겨 데이터 품질 저하를 성적 악화로 표시한다. ([판정](C:/Users/home/bid-analyzer/src/lib/performance.js:23), [안내 문구](C:/Users/home/bid-analyzer/src/components/PerformanceTab.jsx:30))

7. **[높음] 세 KPI를 모두 개선해도 재설계는 실패할 수 있다.**  
   키워드 축소로 커버리지, 고가 투찰로 통과율, 유리한 결과만 업로드해 근접률을 올릴 수 있다. 자사 낙찰·수익을 KPI로 삼지 않더라도 **실제 결과와 연결되는지 감시하는 장치**는 필요하다. 특히 §8의 “1순위인데 다른 업체 낙찰”은 핵심 문제다. 현재 `rank1`을 성과로 세면 가격 순위와 최종 낙찰을 혼동한다.

8. **[높음] P2 통합 키와 추천 선택 규칙을 빌더에게 맡기면 잘못된 금액을 보여준다.**  
   동일 공고에 자동수집·파일 업로드·재업로드·정정차수별 예측이 존재할 수 있다. 공고번호 하나로 합치면 잘못 합치거나 오래된 추천이 살아남는다. 공고 식별자, 차수, 출처 우선순위, 결과 연결, 삭제·내보내기 대상을 먼저 정해야 한다. `getFinalRecommendation`은 자동수집 행을 받으면 편향 보정이 중복될 수 있다고 명시한다. **함수 diff 0줄이어도 호출 대상을 바꾸면 예측 동작은 바뀐다.** ([격리 전제](C:/Users/home/bid-analyzer/src/App.jsx:572))

9. **[높음] RecommendPanel·WhyPanel은 그대로 재사용할 수 없다.**  
   `RecommendPanel`은 Mode A에서 주 지표를 **낙찰 확률**로 표시하지만 §6.3은 하한 통과 확률을 요구한다. 패널 입력은 0~1, `passProbPct` 출력은 0~100이다. 연결 실수로 9,500%가 표시될 수 있다. `WhyPanel`의 표본·신뢰도는 모드 판정 근거이지 현재 추천금액의 근거라고 보장되지 않는다. 필요한 2순위 안·유효 하한율도 구현돼 있지 않다. **추천 하나에 다른 계산 경로의 설명을 붙이는 오류**가 가장 조용하게 발생할 부분이다. ([추천 패널](C:/Users/home/bid-analyzer/src/components/RecommendPanel.jsx:55), [근거 패널](C:/Users/home/bid-analyzer/src/components/WhyPanel.jsx:41))

10. **[중간] ‘엔진 4개’ 문제를 메뉴 안으로 옮길 뿐이다.**  
    보조 메뉴에 V6·발주사 하한·AI 상담을 유지하고 카드에 2순위 안·분포·과거 이력까지 제공한다. 사용자가 다른 추천을 선택하는 문제는 그대로다. 어떤 값이 유일한 업무 추천인지, 대체 추천 진입을 어디까지 허용하는지 기준이 없다. 최근 20건 이력을 펼쳐 보여주는 구성은 숫자 8개 이하 목표와도 충돌한다. P2에서는 통합 목록과 기존 예측 화면이, P3에서는 새 카드와 이전 보조 화면이 공존하므로 “각 단계 단독 배포 가능”에도 별도 전환 설계가 필요하다.

11. **[중간] P1은 명세를 대체로 구현했지만 데이터 완전성과 기간 표시는 보호하지 못한다.**  
    투찰 0건인 달을 곧바로 “업로드 없음”으로 판정한다. 일부만 업로드한 달은 정상으로 취급한다. 최근 3개 업로드 월이 불연속이어도 `시작~끝`으로 표시해 연속 기간처럼 보인다. 키워드를 바꾸면 과거 성적도 재분류되고 다른 PC에서는 다른 성적표가 나온다. `sbFetchDetails`는 페이지 실패 시 부분 데이터를 반환할 수 있는데 화면에 오류 상태가 없다. **데이터가 없는 것과 수집이 실패한 것을 구분하지 못한다.** ([기간 집계](C:/Users/home/bid-analyzer/src/lib/performance.js:99), [로딩](C:/Users/home/bid-analyzer/src/lib/supabase.js:321))

12. **[중간] 검증 계획은 위 실패를 잡지 못한다.**  
    P1 테스트 2개는 통과했다. 그러나 합성 데이터가 명세의 계산을 재확인할 뿐, 실제 967건의 완전성이나 지표 타당성을 검증하지 않는다. 커버리지 초과, 음수 간격, 부분 로드, 불연속 기간, 출처 충돌, 미지원 공고, 표·카드·엑셀의 추천 일치 검증이 빠져 있다. 빌드·스크린샷·문자열 검사는 **틀린 공고에 정상적인 숫자가 붙는 오류**를 잡지 못한다. 업로드·매칭·조회 변경을 모두 금지하면 발견된 문제를 해결할 범위조차 없다.
tokens used: 436018