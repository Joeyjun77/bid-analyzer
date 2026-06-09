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
