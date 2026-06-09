# 참여업체 적재 인프라 (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SUCVIEW 엑셀의 참여업체리스트를 `bid_participants` 테이블에 행 단위로 적재하고, 동일 작업에서 `parseSucview`의 자회사 행 버그를 수정한다.

**Architecture:** 순수 파싱 로직을 standalone `src/lib/sucviewParse.js`로 추출(utils.js는 `import.meta.env` 체인 탓에 node 임포트 불가 → 기존 predConfidence.js / g2bFrequency.js 패턴 답습)해 node 단위테스트한다. `parseSucview`는 이 모듈을 호출하고 `participants[]`를 반환. 업로드 경로(`loadFiles` SUCVIEW 분기)가 `sbSaveParticipants`로 멱등 bulk 적재한다. 조회/시각화(RPC·모달)는 Phase 2.

**Tech Stack:** React + Vite, Supabase Postgres(REST, SDK 미사용), xlsx, node `*.test.mjs`(테스트 러너 없음, `node` 직접 실행).

**Spec:** `docs/superpowers/specs/2026-06-09-participant-adj-distribution-design.md` (Phase 1 부분)

---

## File Structure

| 파일 | 책임 | 신규/수정 |
|---|---|---|
| `src/lib/sucviewParse.js` | SUCVIEW 행 → 참여업체·투찰결과 순수 파싱 (의존성 0) | 신규 |
| `tests/sucviewParse.test.mjs` | 위 모듈 node 단위테스트 | 신규 |
| `src/lib/utils.js` | `parseSucview`가 standalone 모듈 사용 + `participants` 반환 + 자회사 버그 fix | 수정 |
| `db/migrations/bid_participants.sql` | 테이블+인덱스+RLS DDL (저장소 기록용) | 신규 |
| `src/lib/supabase.js` | `sbSaveParticipants` 멱등 bulk 적재 | 수정 |
| `src/App.jsx` | `loadFiles` SUCVIEW 분기에서 참여업체 저장 호출 | 수정 |

DB 테이블/인덱스/RLS/정책은 Supabase MCP `apply_migration`으로 원격 적용(코드 빌드와 무관).

---

## Task 1: standalone 파싱 모듈 + 단위테스트 (TDD)

**Files:**
- Create: `src/lib/sucviewParse.js`
- Test: `tests/sucviewParse.test.mjs`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `tests/sucviewParse.test.mjs`:

```js
import { parseBidResultRows, parseParticipants, findParticipantHeader, findResultHeader } from "../src/lib/sucviewParse.js";

let bad = 0;
const eq = (got, exp, msg) => { if (got !== exp) { console.error(`XX ${msg}: got ${JSON.stringify(got)} expect ${JSON.stringify(exp)}`); bad++; } };
const near = (got, exp, msg, tol = 1e-9) => { if (got == null || Math.abs(got - exp) > tol) { console.error(`XX ${msg}: got ${got} expect ~${exp}`); bad++; } };

// 실제 SUCVIEW 양식(자회사 행 포함): 투찰결과 헤더=16, 자회사=17, 나의업체=18, 1순위=19, 참여헤더=21
const rows = [];
for (let i = 0; i < 15; i++) rows.push([]);
rows[15] = ["투 찰 결 과"];
rows[16] = ["순위","등록번호","","업체명","","대표자","투찰금액","","투찰율(%)","기초대비(%)","업체별사정율(%)",""];
rows[17] = ["자회사(1410)","7446000370","","이룸일렉트릭","","이원",24882426,"",90.4068,90.7852,100.5567,0.5567];
rows[18] = ["나의업체(-80)","1282919297","","태찬산업공사","","정인권",24698710,"",89.6982,90.1149,99.8098,-0.1901];
rows[19] = ["1순위업체(1)","5168800600","","주식회사 청명전기","","남춘미",24711351,"",89.7469,90.161,99.8611,-0.1388];
rows[20] = ["참 여 업 체 리 스 트 [ 총 참여업체 수: 2820]"];
rows[21] = ["순위","등록번호","","업체명","","대표자","투찰금액","","투찰율(%)","기초대비(%)","업체별사정율(%)",""];
rows[22] = [1,"5168800600","","주식회사 청명전기","","남춘미",24711351,"",89.7469,90.161,99.8611,-0.1388];
rows[23] = [2,"5098600817","","주식회사 동명씨앤아이","","박상덕",24711410,"",89.7472,90.1613,99.8614,-0.1385];

// 1. 헤더 탐지 — 투찰결과(16) vs 참여리스트(21) 구분
eq(findResultHeader(rows), 16, "findResultHeader → 16");
eq(findParticipantHeader(rows), 21, "findParticipantHeader → 21");

// 2. 투찰결과: 나의업체/1순위를 라벨로 — 자회사(17) 오인 금지
const br = parseBidResultRows(rows);
near(br.my_bid_rate, 89.6982, "my_bid_rate=나의업체(태찬) 89.6982");
near(br.my_adj_rate, -0.1901, "my_adj_rate=나의업체 -0.1901");
eq(br.my_rank, -80, "my_rank=나의업체(-80)");
near(br.win_bid_rate, 89.7469, "win_bid_rate=1순위(청명) 89.7469");
near(br.win_adj_rate, -0.1388, "win_adj_rate=1순위 -0.1388");
eq(br.my_bid_rate === 90.4068, false, "자회사(이룸 90.4068) 오인 안 함");
eq(br.my_rank === 1410, false, "자회사 등록번호(1410) 순위 오인 안 함");

// 3. 참여업체리스트 추출 (100기준 절대 adj_rate)
const ps = parseParticipants(rows);
eq(ps.length, 2, "참여 2건 추출");
eq(ps[0].rank, 1, "p0 rank=1");
eq(ps[0].co_no, "5168800600", "p0 등록번호");
eq(ps[0].co_name, "주식회사 청명전기", "p0 업체명");
eq(ps[0].rep, "남춘미", "p0 대표자");
eq(ps[0].bid_amount, 24711351, "p0 투찰금액");
near(ps[0].bid_rate, 89.7469, "p0 투찰율");
near(ps[0].base_rate, 90.161, "p0 기초대비");
near(ps[0].adj_rate, 99.8611, "p0 업체별사정율(100기준 절대)");
eq(ps[1].rank, 2, "p1 rank=2");
eq(ps[1].co_name, "주식회사 동명씨앤아이", "p1 업체명");

// 4. 자회사 없는 양식: 나의업체=17, 1순위=18, 참여헤더=20 — win이 참여제목(19) 오독 안 함
const rows2 = [];
for (let i = 0; i < 16; i++) rows2.push([]);
rows2[16] = ["순위","등록번호","","업체명","","대표자","투찰금액","","투찰율(%)","기초대비(%)","업체별사정율(%)",""];
rows2[17] = ["나의업체(3)","1111111111","","우리회사","","대표A",1000,"",89.70,90.10,99.80,-0.20];
rows2[18] = ["1순위업체(1)","2222222222","","승자회사","","대표B",1010,"",89.75,90.16,99.86,-0.14];
rows2[19] = ["참 여 업 체 리 스 트 [ 총 참여업체 수: 3]"];
rows2[20] = ["순위","등록번호","","업체명","","대표자","투찰금액","","투찰율(%)","기초대비(%)","업체별사정율(%)",""];
rows2[21] = [1,"2222222222","","승자회사","","대표B",1010,"",89.75,90.16,99.86,-0.14];
const br2 = parseBidResultRows(rows2);
near(br2.win_bid_rate, 89.75, "자회사無: win=1순위(18) 89.75 (참여제목 오독 안 함)");
near(br2.my_bid_rate, 89.70, "자회사無: my=나의업체(17) 89.70");
eq(parseParticipants(rows2).length, 1, "자회사無 참여 1건");

// 5. 엣지: 빈 입력
eq(parseParticipants([]).length, 0, "빈 입력 참여 []");
const e = parseBidResultRows([]);
eq(e.my_bid_rate, null, "빈 입력 my null");
eq(e.win_bid_rate, null, "빈 입력 win null");

console.log(bad === 0 ? "OK sucviewParse (모든 케이스 통과)" : `FAIL: ${bad}건`);
process.exit(bad === 0 ? 0 : 1);
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node tests/sucviewParse.test.mjs`
Expected: FAIL — `Cannot find module '../src/lib/sucviewParse.js'` (모듈 미생성)

- [ ] **Step 3: standalone 모듈 구현**

Create `src/lib/sucviewParse.js`:

```js
// SUCVIEW 참여업체·투찰결과 행 파싱 — standalone(외부 import 0)이라 node 단위테스트 가능.
// utils.js parseSucview가 import해 사용. predConfidence.js / g2bFrequency.js와 동일 정책.

const toNum = (v) => { if (v == null || v === "") return 0; if (typeof v === "number") return v; return parseFloat(String(v).replace(/,/g, "").trim()) || 0; };
const cell = (rows, r, c) => String(rows[r]?.[c] ?? "").trim();

// 투찰결과 헤더(순위/등록번호) 첫 등장 행 인덱스. 없으면 -1.
export function findResultHeader(rows){
  for (let i = 15; i < Math.min(rows.length, 22); i++){
    if (String(rows[i]?.[0]).trim() === "순위" && String(rows[i]?.[1] || "").includes("등록번호")) return i;
  }
  return -1;
}

// 참여업체리스트 헤더(순위/등록번호 두 번째 등장) 행 인덱스. 없으면 -1.
export function findParticipantHeader(rows){
  for (let i = 20; i < Math.min(rows.length, 25); i++){
    if (String(rows[i]?.[0]).trim() === "순위" && String(rows[i]?.[1] || "").includes("등록번호")) return i;
  }
  return -1;
}

// 투찰결과 블록(자회사/나의업체/1순위)에서 나의업체·1순위 행을 라벨로 스캔.
// 절대 행번호(17/19) 하드코딩 버그 수정 — 자회사 행이 끼어도 정확히 매칭.
export function parseBidResultRows(rows){
  const out = { my_rank: null, my_bid_rate: null, my_adj_rate: null, win_bid_rate: null, win_adj_rate: null };
  const hdr = findResultHeader(rows);
  if (hdr < 0) return out;
  for (let i = hdr + 1; i < Math.min(rows.length, hdr + 8); i++){
    const label = cell(rows, i, 0);
    if (!label || label.includes("참 여") || label.includes("참여업체")) break; // 참여리스트 시작 → 종료
    const bidR = parseFloat(cell(rows, i, 8)), adjR = parseFloat(cell(rows, i, 11));
    if (label.includes("나의업체")){
      out.my_bid_rate = isNaN(bidR) ? null : bidR;
      out.my_adj_rate = isNaN(adjR) ? null : adjR;
      const m = label.match(/\(\s*(-?\d+)\s*\)/); if (m) out.my_rank = parseInt(m[1]);
    } else if (label.includes("1순위")){
      out.win_bid_rate = isNaN(bidR) ? null : bidR;
      out.win_adj_rate = isNaN(adjR) ? null : adjR;
    } // 자회사 행은 의도적으로 건너뜀
  }
  return out;
}

// 참여업체리스트 → participants[]. rank 숫자가 끊기면 종료.
// adj_rate = 업체별사정율(= 가정사정율) 100기준 절대값(col 10).
export function parseParticipants(rows){
  const start = findParticipantHeader(rows);
  if (start < 0) return [];
  const out = [];
  for (let i = start + 1; i < rows.length; i++){
    const rank = parseInt(String(rows[i]?.[0]));
    if (isNaN(rank)) break;
    const br = parseFloat(cell(rows, i, 8)), baseR = parseFloat(cell(rows, i, 9)), adj = parseFloat(cell(rows, i, 10));
    out.push({
      rank,
      co_no: cell(rows, i, 1),
      co_name: cell(rows, i, 3),
      rep: cell(rows, i, 5),
      bid_amount: toNum(cell(rows, i, 6)),
      bid_rate: isNaN(br) ? null : br,
      base_rate: isNaN(baseR) ? null : baseR,
      adj_rate: isNaN(adj) ? null : adj,
    });
  }
  return out;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node tests/sucviewParse.test.mjs`
Expected: PASS — `OK sucviewParse (모든 케이스 통과)`, exit 0

- [ ] **Step 5: 커밋**

```bash
git add src/lib/sucviewParse.js tests/sucviewParse.test.mjs
git commit -m "feat(sucview): 참여업체·투찰결과 standalone 파서 + 자회사 행 버그 fix (node 테스트)"
```

---

## Task 2: `parseSucview`가 standalone 모듈 사용

**Files:**
- Modify: `src/lib/utils.js` (import 추가 ~line 59 근처, `parseSucview` 본문 ~line 456–474)

- [ ] **Step 1: import 추가**

`src/lib/utils.js`의 import 블록(line 59 `import { clsAg, isMilitaryAgency } from "./agencyClass.js";` 아래)에 추가:

```js
import { parseBidResultRows, parseParticipants } from "./sucviewParse.js";
```

- [ ] **Step 2: 나의업체/1순위 블록을 라벨 스캔으로 교체**

`parseSucview` 내부의 기존 블록(현재 line 456–461):

```js
  // 나의업체 (row17), 1순위 (row19)
  let my_rank=null,my_bid_rate=null,my_adj_rate=null,win_bid_rate=null,win_adj_rate=null;
  const myRaw=g(17,0);const myRankM=myRaw.match(/\((\d+)\)/);
  if(myRankM)my_rank=parseInt(myRankM[1]);
  my_bid_rate=parseFloat(g(17,8))||null;my_adj_rate=parseFloat(g(17,11))||null;
  win_bid_rate=parseFloat(g(19,8))||null;win_adj_rate=parseFloat(g(19,11))||null;
```

를 다음으로 교체:

```js
  // 나의업체/1순위 — 라벨 스캔(자회사 행 끼어도 정확). sucviewParse.js로 분리(node 테스트).
  const {my_rank,my_bid_rate,my_adj_rate,win_bid_rate,win_adj_rate}=parseBidResultRows(rows);
```

- [ ] **Step 3: participants 추출 + 반환 객체에 추가**

`parseSucview` 끝의 `return{...}` 직전에 추가:

```js
  const participants=parseParticipants(rows);
```

그리고 기존 `return{pn_no,pn,ag,at,od,ba,ep,xp,av,floor_rate,adj_rate,pre_rates,selected_nums,pre_avg,pre_min,pre_max,participant_count,bid_dist,bid_median,bid_q1,bid_q3,my_rank,my_bid_rate,my_adj_rate,win_bid_rate,win_adj_rate,source_file:fileName}` 의 마지막 필드 뒤에 `,participants` 추가:

```js
  return{pn_no,pn,ag,at,od,ba,ep,xp,av,floor_rate,adj_rate,pre_rates,selected_nums,pre_avg,pre_min,pre_max,participant_count,bid_dist,bid_median,bid_q1,bid_q3,my_rank,my_bid_rate,my_adj_rate,win_bid_rate,win_adj_rate,source_file:fileName,participants}}
```

- [ ] **Step 4: 빌드 검증**

Run: `npx vite build`
Expected: 빌드 성공(에러 0). CRLF 경고는 무시.

- [ ] **Step 5: 실제 샘플로 통합 확인 (수동)**

standalone 모듈로 실제 파일 검증 (xlsx만 사용, utils.js 우회):
```bash
node --input-type=module -e "import('xlsx').then(async X=>{const fs=await import('fs');const wb=X.read(fs.readFileSync('C:/Users/home/Downloads/SUCVIEW[2026-06-09].xlsx'),{type:'buffer',codepage:949,raw:true});const ws=wb.Sheets[wb.SheetNames[0]];const rows=X.utils.sheet_to_json(ws,{header:1,defval:'',raw:true});const m=await import('./src/lib/sucviewParse.js');const ps=m.parseParticipants(rows);const br=m.parseBidResultRows(rows);console.log('참여수',ps.length,'p0',ps[0]?.co_name,ps[0]?.adj_rate,'win',br.win_bid_rate,'my',br.my_bid_rate);})"
```
Expected: `참여수 2820 p0 주식회사 청명전기 99.8611 win 89.7469 my 89.6982` (my가 자회사 90.4068이 아님)

- [ ] **Step 6: 커밋**

```bash
git add src/lib/utils.js
git commit -m "refactor(sucview): parseSucview가 standalone 파서 사용 + participants 반환"
```

---

## Task 3: `bid_participants` 테이블 (DB 마이그레이션)

**Files:**
- Create: `db/migrations/bid_participants.sql`
- DB: Supabase MCP `apply_migration` (project_id `sadunejfkstxbxogzutl`)

- [ ] **Step 1: 마이그레이션 SQL 파일 작성**

Create `db/migrations/bid_participants.sql`:

```sql
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
```

- [ ] **Step 2: 원격 적용 (Supabase MCP)**

`apply_migration` 호출 — `project_id`: `sadunejfkstxbxogzutl`, `name`: `bid_participants`, `query`: 위 SQL 전체.

- [ ] **Step 3: 적용 검증**

`execute_sql` (project `sadunejfkstxbxogzutl`):
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name='bid_participants' ORDER BY ordinal_position;
```
Expected: 15개 컬럼(id…created_at). 이어서:
```sql
SELECT polname FROM pg_policy WHERE polrelid='public.bid_participants'::regclass ORDER BY polname;
```
Expected: `participants_delete_admin`, `participants_insert_auth`, `participants_select_auth`, `participants_update_auth`

- [ ] **Step 4: 커밋 (저장소 기록)**

```bash
git add db/migrations/bid_participants.sql
git commit -m "feat(db): bid_participants 테이블 (참여업체 적재, RLS bid_details 미러)"
```

---

## Task 4: `sbSaveParticipants` 멱등 bulk 적재

**Files:**
- Modify: `src/lib/supabase.js` (bid_details CRUD 블록 직후, `sbFetchDetailsByAg` 아래 ~line 313)

- [ ] **Step 1: 함수 추가**

`src/lib/supabase.js`의 `sbFetchDetailsByAg`(line 313) 정의 끝 다음 줄에 추가. (`sanitizeJson`은 line 1에서, `JSON_H`는 line 6에서, `authedFetch`는 line 2에서 이미 사용 가능):

```js
// 참여업체 멱등 bulk 적재 (Phase 1). on_conflict=pn_no,co_no merge → 재업로드 안전. 1000행씩 청크.
export async function sbSaveParticipants(meta, participants){
  if(!participants||!participants.length)return true;
  const rows=participants.map(p=>({
    pn_no:meta.pn_no, od:meta.od||null, ag:meta.ag||null,
    canonical_ag:meta.canonical_ag||meta.ag||null, at:meta.at||null,
    rank:p.rank, co_no:p.co_no||null, co_name:p.co_name||null, rep:p.rep||null,
    bid_amount:p.bid_amount, bid_rate:p.bid_rate, base_rate:p.base_rate, adj_rate:p.adj_rate,
  }));
  for(let i=0;i<rows.length;i+=1000){
    const body=sanitizeJson(JSON.stringify(rows.slice(i,i+1000)));
    const res=await authedFetch("/rest/v1/bid_participants?on_conflict=pn_no,co_no",
      {method:"POST",headers:{...JSON_H,"Prefer":"resolution=merge-duplicates,return=minimal"},body});
    if(!res.ok)return false;
  }
  return true;
}
```

- [ ] **Step 2: 빌드 검증**

Run: `npx vite build`
Expected: 빌드 성공(에러 0).

- [ ] **Step 3: 커밋**

```bash
git add src/lib/supabase.js
git commit -m "feat(sucview): sbSaveParticipants 멱등 bulk 적재"
```

---

## Task 5: 업로드 경로 연결 (`loadFiles`)

**Files:**
- Modify: `src/App.jsx` (supabase import 블록 + `loadFiles` SUCVIEW 분기 line 881–885)

- [ ] **Step 1: import에 `sbSaveParticipants` 추가**

`src/App.jsx`에서 `./lib/supabase.js`(또는 `./lib/supabase`)를 가져오는 import 구문을 찾아 식별자 목록에 `sbSaveParticipants`를 추가한다. (`sbSaveDetail`이 이미 그 목록에 있으므로 같은 import에 추가.)

예) 기존:
```js
import { ..., sbSaveDetail, sbFetchDetails, ... } from "./lib/supabase.js";
```
변경:
```js
import { ..., sbSaveDetail, sbSaveParticipants, sbFetchDetails, ... } from "./lib/supabase.js";
```

- [ ] **Step 2: SUCVIEW 분기에서 참여업체 저장 호출**

`src/App.jsx`의 SUCVIEW 분기(현재 line 881–885):

```js
        if(isSucviewFile(raw)){
          const detail=parseSucview(raw,file.name);if(!detail.pn_no)throw new Error("공고번호 없음");
          await sbSaveDetail(detail);const sim=simDraws(detail.pre_rates);setSimResult(sim);
          logs.push({name:file.name,type:"ok",text:`[상세] ${detail.ag} | 예가15개 + 참여${detail.participant_count}건`});
          setUploadLog([...logs]);continue}
```

를 다음으로 교체 (detail 저장은 유지, 참여 저장 실패는 경고만 — 대량 업로드 내성):

```js
        if(isSucviewFile(raw)){
          const detail=parseSucview(raw,file.name);if(!detail.pn_no)throw new Error("공고번호 없음");
          await sbSaveDetail(detail);
          if(detail.participants&&detail.participants.length){
            try{await sbSaveParticipants({pn_no:detail.pn_no,od:detail.od,ag:detail.ag,canonical_ag:detail.ag,at:detail.at},detail.participants);}
            catch(e){console.warn("참여업체 저장 실패:",e.message);}
          }
          const sim=simDraws(detail.pre_rates);setSimResult(sim);
          logs.push({name:file.name,type:"ok",text:`[상세] ${detail.ag} | 예가15개 + 참여${detail.participant_count}건`});
          setUploadLog([...logs]);continue}
```

- [ ] **Step 3: 빌드 검증**

Run: `npx vite build`
Expected: 빌드 성공(에러 0).

- [ ] **Step 4: 커밋**

```bash
git add src/App.jsx
git commit -m "feat(sucview): SUCVIEW 업로드 시 참여업체 적재 연결"
```

---

## Task 6: 엔드투엔드 수동 검증 + 배포

**Files:** (코드 변경 없음 — 실행/확인만)

- [ ] **Step 1: 로컬 빌드 최종 확인**

Run: `npx vite build`
Expected: 성공.

- [ ] **Step 2: 단위테스트 회귀 확인**

Run: `node tests/sucviewParse.test.mjs && node tests/g2bFrequency.test.mjs && node tests/agencyClass.test.mjs`
Expected: 3개 모두 `OK …`, exit 0.

- [ ] **Step 3: push (Vercel 자동 배포)**

```bash
git pull --rebase
git push
```
(거버넌스: 본 변경은 데이터 수집 파서 + 신규 테이블 — Generator 예측 로직 아님 → `/evaluate` 면제. 배포 2~3분.)

- [ ] **Step 4: 실데이터 적재 확인 (배포 후, 수동)**

데이터탭에서 `SUCVIEW[2026-06-09].xlsx` 1건 업로드 후, Supabase `execute_sql`:
```sql
SELECT count(*) AS n, min(adj_rate) AS adj_min, max(adj_rate) AS adj_max,
       count(*) FILTER (WHERE rank=1) AS winners
FROM bid_participants WHERE pn_no='R26BK01551961-000';
```
Expected: `n` ≈ 2820(참여수와 일치), `winners` = 1, `adj_*`는 99~101대 값.
※ pn_no는 업로드 파일의 실제 공고번호로 대체.

- [ ] **Step 5: 멱등 재업로드 확인 (수동)**

같은 파일을 한 번 더 업로드 후 위 `count(*)` 재실행.
Expected: `n` 불변(중복 누적 없음 = `on_conflict` 멱등 동작).

- [ ] **Step 6: 대량 적재 안내**

검증 통과 시, 사용자에게 데이터탭에서 SUCVIEW 다발 업로드를 안내 → Phase 2(RPC·매트릭스 모달) 착수 데이터 축적.

---

## Self-Review 결과

- **Spec 커버리지**: 1.1 테이블(Task 3)·1.2 파서 확장+자회사 fix(Task 1·2)·1.3 sbSaveParticipants(Task 4)·1.4 loadFiles 연결(Task 5)·1.5 검증(Task 6) — 전부 매핑됨.
- **플레이스홀더**: 없음(모든 코드·SQL·명령 실체 포함).
- **타입 일관성**: `parseBidResultRows`/`parseParticipants`/`findResultHeader`/`findParticipantHeader` 명칭이 모듈·테스트·utils.js 인용에서 동일. participant 객체 필드(rank·co_no·co_name·rep·bid_amount·bid_rate·base_rate·adj_rate)가 파서·`sbSaveParticipants`·테이블 컬럼에서 일치.
- **알려진 한계**: 참여 헤더 탐지가 [20,25) 범위(기존 parseSucview와 동일) — 투찰결과 블록이 비정상적으로 길면 미탐지. 기존 동작 유지이며 Phase 2 진입 시 재검토.
