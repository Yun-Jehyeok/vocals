// 인수 테스트: 이슈 #45 사용자 이용 제한 — DB 제약(서버 쓰기에도 걸린다), 막는 것, 막지 않는 것
// (QA가 개발 전에 쓴다. 개발은 고치지 않는다. 틀렸다고 보면 `[질문] 받는 역할: QA`)
//
// 준비 데이터와 역할은 45-fixture.ts(#41 사람·방 그대로, 제한G·지난G·제한T2·해제H).
// 값 검사·제한 판정은 attemptWrite(제약·트리거 거부도 거부)로 판정하고, 거부마다 허용되는 짝을 둔다.
// 막는 것의 짝은 "같은 시도에서 제한만 푼 것(liftG·liftT2)"이다. 그래야 거부가 제한 때문인지 가린다.
// 막는 방법(check, unique 부분 인덱스, 트리거)은 개발이 고른다.
// 막지 않는 것은 #41에서 허용되던 클라이언트·서버 쓰기가 제한 중에도 그대로 허용되는지 본다.
// 테스트로 쓰지 않는 것:
//   - 1:1 대화를 여는 사람의 제한 판정(PM 질문 3): 서버 함수 이슈(erd 10장). DB는 참여 행을 막지 않는 것만 본다.
//   - 메시지·후기 쓰기의 오류·안내 문구: 서버 함수 이슈(erd 10장)
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "../helpers/db.ts";
import { anon, asUser, queryAs, service, withActor } from "../helpers/db.ts";
import { attemptWrite } from "../helpers/rls-matrix.ts";
import type { OpCase } from "../helpers/rls-matrix.ts";
import { SEED } from "../helpers/seed-ids.ts";
import type { Setup } from "./45-fixture.ts";
import {
  FIXTURE_USERS,
  HW,
  LS,
  M,
  NEW,
  NEW45,
  ROOM,
  RS,
  RV,
  TK,
  U,
  U45,
  V,
  both,
  createBundle7Db,
  directRoomSASG,
  liftG,
  liftT2,
  makeupForSG,
  removeSGFromR1,
  restrictSA,
  reviewForSBOnT2,
  submissionForT2,
  suspendT1,
} from "./45-fixture.ts";

let db: PGlite;

beforeAll(async () => {
  db = await createBundle7Db();
});

afterAll(async () => {
  await db?.close();
});

const op = (text: string, setup?: Setup): OpCase => ({ sql: text, ...(setup ? { setup } : {}) });
type Expected = "allow" | "reject";
const serverCases = (cases: [string, OpCase, Expected][]) =>
  it.each(cases)("서버 × %s → %s", async (_, opCase, expected) => {
    expect(await attemptWrite(db, service, opCase)).toBe(expected);
  });

const restrictionInsert = (
  userId: string,
  reason: string,
  restrictedBy: string,
  lifted: { at?: string; by?: string } = {},
  setup?: Setup,
) =>
  op(
    `insert into public.user_restrictions (user_id, reason, restricted_by, lifted_at, lifted_by)
     values ('${userId}', '${reason}', '${restrictedBy}', ${lifted.at ? `'${lifted.at}'` : "null"}, ${
       lifted.by ? `'${lifted.by}'` : "null"
     })`,
    setup,
  );

// ===========================================================================
// 준비 상태 확인 (이 파일의 준비 데이터 범위 안에서만 본다)
// ===========================================================================

describe("#45 준비 상태 확인 — ADM-04", () => {
  type Row = { user_id: string; restricted: number; lifted: number };
  const counts = async (setup?: Setup) =>
    (
      await queryAs<Row>(
        db,
        service,
        `select u.id as user_id,
                count(r.id) filter (where r.lifted_at is null)::int as restricted,
                count(r.id) filter (where r.lifted_at is not null)::int as lifted
         from public.users u left join public.user_restrictions r on r.user_id = u.id
         where u.id = any($1)
         group by u.id`,
        [[...FIXTURE_USERS]],
        setup ? { setup } : {},
      )
    ).rows.reduce<Record<string, [number, number]>>((acc, row) => {
      acc[row.user_id] = [row.restricted, row.lifted];
      return acc;
    }, {});

  it("ADM-04: 준비 데이터 — 학생G(제한 1·지난 1), T2(제한 1), 학생H(지난 1), 학생A·학생B·T1(없음)", async () => {
    const c = await counts();
    expect(c[U.SG]).toEqual([1, 1]);
    expect(c[U.T2]).toEqual([1, 0]);
    expect(c[U.SH]).toEqual([0, 1]);
    expect(c[U.SA]).toEqual([0, 0]);
    expect(c[U.SB]).toEqual([0, 0]);
    expect(c[U.T1]).toEqual([0, 0]);
  });

  it("ADM-04: 준비 작업 — liftG·liftT2는 제한을 풀고, restrictSA는 학생A를 제한한다", async () => {
    expect((await counts(liftG))[U.SG]).toEqual([0, 2]);
    expect((await counts(liftT2))[U.T2]).toEqual([0, 1]);
    expect((await counts(restrictSA))[U.SA]).toEqual([1, 0]);
  });

  it("AUTH-07: 준비 데이터 — 운영자2는 활성 admin, 탈퇴 운영자는 withdrawn admin", async () => {
    const { rows } = await queryAs<{ id: string; role: string; status: string }>(
      db,
      service,
      `select id, role::text as role, status::text as status from public.users where id = any($1) order by id`,
      [[U45.ADMIN2, U45.ADMIN_W]],
    );
    expect(rows).toEqual([
      { id: U45.ADMIN2, role: "admin", status: "active" },
      { id: U45.ADMIN_W, role: "admin", status: "withdrawn" },
    ]);
  });

  it("REV-06: 준비 작업 — reviewForSBOnT2는 답글 없는 학생B의 T2 후기를 만든다", async () => {
    const { rows } = await queryAs<{ trainer_id: string; replies: number }>(
      db,
      service,
      `select r.trainer_id, (select count(*)::int from public.review_replies p where p.review_id = r.id) as replies
       from public.reviews r where r.id = $1`,
      [NEW45.RV_B],
      { setup: reviewForSBOnT2 },
    );
    expect(rows).toEqual([{ trainer_id: U.T2, replies: 0 }]);
  });
});

// ===========================================================================
// 스키마 제약 (서버 쓰기에도 걸린다, 팀장 결정 후보 1·4)
// ===========================================================================

describe("#45 user_restrictions 값 검사 — ADM-04 (팀장 결정 후보 4)", () => {
  serverCases([
    [
      "ADM-04: 바른 제한 줄(대상 T1, 운영자가 제한, 풀리지 않음) (허용 짝)",
      restrictionInsert(U.T1, "#45 T1 제한", U.ADMIN),
      "allow",
    ],
    ["ADM-04: reason이 비어 있다", restrictionInsert(U.T1, "", U.ADMIN), "reject"],
    [
      "ADM-04: 처음부터 풀린 바른 줄(lifted_at·lifted_by 함께) (허용 짝)",
      restrictionInsert(U.T1, "#45 지난 제한", U.ADMIN, {
        at: "2026-11-20 10:00:00+09",
        by: U.ADMIN,
      }),
      "allow",
    ],
    [
      "ADM-04: lifted_at만 있고 lifted_by가 없다",
      restrictionInsert(U.T1, "#45 어긋남", U.ADMIN, { at: "2026-11-20 10:00:00+09" }),
      "reject",
    ],
    [
      "ADM-04: lifted_by만 있고 lifted_at이 없다",
      restrictionInsert(U.T1, "#45 어긋남", U.ADMIN, { by: U.ADMIN }),
      "reject",
    ],
    ["ADM-04: restricted_by가 학생", restrictionInsert(U.T1, "#45 학생이 제한", U.SA), "reject"],
    [
      "ADM-04: restricted_by가 트레이너",
      restrictionInsert(U.SA, "#45 트레이너가 제한", U.T1),
      "reject",
    ],
    [
      "ADM-04: restricted_by가 다른 운영자 (허용 짝: 서버에는 '자기 자신' 판정이 없다)",
      restrictionInsert(U.T1, "#45 운영자2가 제한", U45.ADMIN2),
      "allow",
    ],
    [
      "ADM-04: lifted_by가 트레이너",
      restrictionInsert(U.T1, "#45 트레이너가 해제", U.ADMIN, {
        at: "2026-11-20 10:00:00+09",
        by: U.T1,
      }),
      "reject",
    ],
    [
      "ADM-04: 대상이 운영자(seed admin)",
      restrictionInsert(SEED.admin, "#45 운영자 제한", U45.ADMIN2),
      "reject",
    ],
    [
      "ADM-04: 대상이 다른 운영자(운영자2)",
      restrictionInsert(U45.ADMIN2, "#45 운영자 제한", U.ADMIN),
      "reject",
    ],
    [
      "ADM-04: 대상이 학생(학생A) (허용 짝)",
      restrictionInsert(U.SA, "#45 학생A 제한", U.ADMIN),
      "allow",
    ],
  ]);
});

describe("#45 user_restrictions 해제 값 검사(서버 update) — ADM-04 (팀장 결정 후보 4)", () => {
  const lift = (id: string, set: string) =>
    op(`update public.user_restrictions set ${set} where id = '${id}'`);
  serverCases([
    [
      "ADM-04: 제한T2를 lifted_at·lifted_by 함께 채워 푼다 (허용 짝)",
      lift(RS.T2, `lifted_at = now(), lifted_by = '${U.ADMIN}'`),
      "allow",
    ],
    ["ADM-04: 제한T2에 lifted_at만 채운다", lift(RS.T2, `lifted_at = now()`), "reject"],
    ["ADM-04: 제한T2에 lifted_by만 채운다", lift(RS.T2, `lifted_by = '${U.ADMIN}'`), "reject"],
    [
      "ADM-04: 제한T2의 lifted_by가 학생",
      lift(RS.T2, `lifted_at = now(), lifted_by = '${U.SA}'`),
      "reject",
    ],
    ["ADM-04: 제한G의 reason을 비운다", lift(RS.G, `reason = ''`), "reject"],
  ]);
});

describe("#45 사용자마다 풀리지 않은 줄은 하나다 — ADM-04 (팀장 결정 후보 1)", () => {
  serverCases([
    [
      "ADM-04: 제한G가 있는 학생G의 두 번째 제한",
      restrictionInsert(U.SG, "#45 학생G 두 번째", U.ADMIN),
      "reject",
    ],
    [
      "ADM-04: 제한T2가 있는 T2의 두 번째 제한",
      restrictionInsert(U.T2, "#45 T2 두 번째", U45.ADMIN2),
      "reject",
    ],
    [
      "ADM-04: 해제H만 있는 학생H의 새 제한 (허용 짝)",
      restrictionInsert(U.SH, "#45 학생H 다시 제한", U.ADMIN),
      "allow",
    ],
    [
      "ADM-04: 제한G를 푼 뒤 학생G의 새 제한 (허용 짝)",
      restrictionInsert(U.SG, "#45 학생G 다시 제한", U.ADMIN, {}, liftG),
      "allow",
    ],
    [
      "ADM-04: 학생H의 풀린 줄을 하나 더 넣는다(풀린 줄은 여러 개여도 된다) (허용 짝)",
      restrictionInsert(U.SH, "#45 학생H 지난 제한2", U.ADMIN, {
        at: "2026-11-20 10:00:00+09",
        by: U.ADMIN,
      }),
      "allow",
    ],
  ]);
});

// ===========================================================================
// 막는 것: 메시지 (서버 insert에도 걸린다)
// ===========================================================================

const textMessage = (room: string, sender: string, body: string, setup?: Setup) =>
  op(
    `insert into public.messages (room_id, sender_id, kind, body) values ('${room}', '${sender}', 'text', '${body}')`,
    setup,
  );
const imageMessage = (room: string, sender: string, setup?: Setup) =>
  op(
    `insert into public.messages (room_id, sender_id, kind, image_url)
     values ('${room}', '${sender}', 'image', 'https://example.test/b45/${sender}.jpg')`,
    setup,
  );

describe("#45 제한 중인 사람이 보내는 메시지는 서버 insert도 실패한다 — ADM-04, CHAT-05, DM-04 (팀장 결정 후보 4)", () => {
  serverCases([
    ["ADM-04·CHAT-05: 제한 중인 학생G → 방1 text", textMessage(ROOM.R1, U.SG, "#45 G"), "reject"],
    ["ADM-04·CHAT-05: 제한 중인 학생G → 방1 image", imageMessage(ROOM.R1, U.SG), "reject"],
    ["ADM-04·DM-04: 제한 중인 학생G → DM2 text", textMessage(ROOM.DM2, U.SG, "#45 G"), "reject"],
    ["ADM-04·DM-04: 제한 중인 학생G → DM2 image", imageMessage(ROOM.DM2, U.SG), "reject"],
    [
      "ADM-04·CHAT-05: 제한을 푼 학생G → 방1 text (허용 짝)",
      textMessage(ROOM.R1, U.SG, "#45 G", liftG),
      "allow",
    ],
    [
      "ADM-04·CHAT-05: 제한을 푼 학생G → 방1 image (허용 짝)",
      imageMessage(ROOM.R1, U.SG, liftG),
      "allow",
    ],
    [
      "ADM-04·DM-04: 제한을 푼 학생G → DM2 text (허용 짝)",
      textMessage(ROOM.DM2, U.SG, "#45 G", liftG),
      "allow",
    ],
    [
      "ADM-04·DM-04: 제한을 푼 학생G → DM2 image (허용 짝)",
      imageMessage(ROOM.DM2, U.SG, liftG),
      "allow",
    ],
    ["ADM-04·CHAT-05: 제한 중인 T2 → 방2 text", textMessage(ROOM.R2, U.T2, "#45 T2"), "reject"],
    ["ADM-04·CHAT-05: 제한 중인 T2 → 방2 image", imageMessage(ROOM.R2, U.T2), "reject"],
    [
      "ADM-04·CHAT-05: 제한을 푼 T2 → 방2 text (허용 짝)",
      textMessage(ROOM.R2, U.T2, "#45 T2", liftT2),
      "allow",
    ],
  ]);
});

describe("#45 제한이 풀렸거나 없는 사람의 메시지는 서버 insert가 된다 — ADM-04", () => {
  serverCases([
    ["ADM-04: 해제H만 있는 학생H → 방1 text", textMessage(ROOM.R1, U.SH, "#45 H"), "allow"],
    ["ADM-04: 해제H만 있는 학생H → DM2 text", textMessage(ROOM.DM2, U.SH, "#45 H"), "allow"],
    ["ADM-04: 해제H만 있는 학생H → 방1 image", imageMessage(ROOM.R1, U.SH), "allow"],
    ["ADM-04: 제한이 없는 학생A → 방1 text", textMessage(ROOM.R1, U.SA, "#45 A"), "allow"],
    ["ADM-04: 제한이 없는 학생B → 방2 text", textMessage(ROOM.R2, U.SB, "#45 B"), "allow"],
  ]);
});

// ===========================================================================
// 막는 것: 후기·후기 고치기·답글 (서버 쓰기에도 걸린다)
// ===========================================================================

describe("#45 제한 중인 학생의 후기 쓰기는 서버 insert도 실패한다 — ADM-04, REV-02 (팀장 결정 후보 4)", () => {
  const reviewG = (setup: Setup) =>
    op(
      `insert into public.reviews (trainer_id, student_id, ticket_id, body)
       values ('${U.T1}', '${U.SG}', '${TK.G}', '#45 학생G 후기')`,
      setup,
    );
  serverCases([
    [
      "ADM-04·REV-02: 제한 중인 학생G가 자격 있는 TK.G(보강 기록)에 쓰는 후기",
      reviewG(makeupForSG),
      "reject",
    ],
    [
      "ADM-04·REV-02: 제한을 푼 학생G의 같은 후기 (허용 짝)",
      reviewG(both(makeupForSG, liftG)),
      "allow",
    ],
  ]);
});

describe("#45 제한 중인 작성자는 자기 후기를 고치지 못한다(지우기는 된다) — ADM-04, REV-04 (PM 질문 2)", () => {
  const editRV1 = (setup?: Setup) =>
    op(`update public.reviews set body = '#45 고친 후기' where id = '${RV.RV1}'`, setup);
  serverCases([
    ["ADM-04·REV-04: 제한 중인 학생A의 후기 RV1 body 고치기", editRV1(restrictSA), "reject"],
    ["ADM-04·REV-04: 제한이 없는 학생A의 후기 RV1 body 고치기 (허용 짝)", editRV1(), "allow"],
  ]);

  it("ADM-04·REV-04: 제한 중인 학생A는 자기 후기 RV1을 지운다(클라이언트 delete 허용)", async () => {
    expect(
      await attemptWrite(db, asUser(U.SA), {
        sql: `delete from public.reviews where id = $1`,
        params: [RV.RV1],
        setup: restrictSA,
      }),
    ).toBe("allow");
  });

  it("ADM-04·REV-05: 제한 중인 학생A의 후기도 운영자가 가린다(hidden만 바꾸는 update는 막지 않는다)", async () => {
    expect(
      await attemptWrite(db, asUser(U.ADMIN), {
        sql: `update public.reviews set hidden = true where id = $1`,
        params: [RV.RV1],
        setup: restrictSA,
      }),
    ).toBe("allow");
  });
});

describe("#45 제한 중인 트레이너의 답글은 서버 insert도 실패한다 — ADM-04, REV-06 (PM 질문 2)", () => {
  const reply = (setup: Setup) =>
    op(
      `insert into public.review_replies (review_id, body) values ('${NEW45.RV_B}', '#45 T2 답글')`,
      setup,
    );
  serverCases([
    [
      "ADM-04·REV-06: 제한 중인 T2가 받은 후기(학생B)에 다는 답글",
      reply(reviewForSBOnT2),
      "reject",
    ],
    [
      "ADM-04·REV-06: 제한을 푼 T2의 같은 답글 (허용 짝)",
      reply(both(reviewForSBOnT2, liftT2)),
      "allow",
    ],
  ]);
});

// ===========================================================================
// 막지 않는 것
// ===========================================================================

const SG = asUser(U.SG);
const T2 = asUser(U.T2);

const allowFor = (cases: [string, Actor, OpCase][]) =>
  it.each(cases)("%s → 허용", async (_, actor, opCase) => {
    expect(await attemptWrite(db, actor, opCase)).toBe("allow");
  });

describe("#45 제한 중인 학생G는 읽기·알림 끄기·나가기·차단·신고를 그대로 한다 — ADM-04, CHAT-04 (PM 결정 2026-11-22)", () => {
  it.each([
    ["방1의 학생A 메시지", M.R1_A],
    ["방1의 자기 메시지", M.R1_G],
    ["DM2의 자기 메시지", M.DM2_G],
  ])("ADM-04·CHAT-04: 제한 중인 학생G가 %s를 읽는다", async (_, id) => {
    const { rows } = await queryAs(db, SG, `select 1 from public.messages where id = $1`, [id]);
    expect(rows.length).toBe(1);
  });

  allowFor([
    [
      "ADM-04·CHAT-08: 제한 중인 학생G가 방1 참여 행의 muted를 바꾼다",
      SG,
      op(
        `update public.chat_members set muted = not muted where room_id = '${ROOM.R1}' and user_id = '${U.SG}'`,
      ),
    ],
    [
      "ADM-04·CHAT-03: 제한 중인 학생G가 방1에서 나간다",
      SG,
      op(
        `update public.chat_members set left_at = now(), left_reason = 'self'
         where room_id = '${ROOM.R1}' and user_id = '${U.SG}'`,
      ),
    ],
    [
      "ADM-04·CHAT-07: 제한 중인 학생G가 학생A를 차단한다",
      SG,
      op(`insert into public.blocks (blocker_id, blocked_id) values ('${U.SG}', '${U.SA}')`),
    ],
    [
      "ADM-04·CHAT-07: 제한 중인 학생G가 방1의 학생A 메시지를 신고한다",
      SG,
      op(
        `insert into public.reports (reporter_id, target_type, target_id, reason)
         values ('${U.SG}', 'message', '${M.R1_A}', '#45 신고')`,
      ),
    ],
  ]);
});

describe("#45 제한 중인 T2는 메시지 가리기·내보내기를 그대로 한다 — ADM-04, CHAT-06 (PM 결정 2026-11-22)", () => {
  allowFor([
    [
      "ADM-04·CHAT-06: 제한 중인 T2가 방2의 학생B 메시지를 가린다",
      T2,
      op(`update public.messages set hidden_by = '${U.T2}' where id = '${M.R2_B}'`),
    ],
    [
      "ADM-04·CHAT-06: 제한 중인 T2가 방2에서 학생B를 내보낸다",
      T2,
      op(
        `update public.chat_members set left_at = now(), left_reason = 'kicked'
         where room_id = '${ROOM.R2}' and user_id = '${U.SB}'`,
      ),
    ],
  ]);
});

describe("#45 제한 중에도 숙제는 그대로다 — ADM-04, HW-01, HW-06, HW-10 (PM 결정 2026-11-22)", () => {
  allowFor([
    [
      "ADM-04·HW-06: 제한 중인 학생G가 HW3에 연습 영상 PG2로 제출한다",
      SG,
      op(
        `insert into public.submissions (homework_id, student_id, video_id, question)
         values ('${HW.HW3}', '${U.SG}', '${V.PG2}', null)`,
      ),
    ],
    [
      "ADM-04·HW-01: 제한 중인 T2가 자기 회차 LS.B1에 숙제를 낸다",
      T2,
      op(
        `insert into public.homeworks (session_id, trainer_id, description, due_at)
         values ('${LS.B1}', '${U.T2}', '#45 T2 숙제', '2026-12-11 20:00:00+09')`,
      ),
    ],
    [
      "ADM-04·HW-10: 제한 중인 T2가 학생B의 제출에 피드백을 단다",
      T2,
      op(
        `insert into public.feedback_comments (submission_id, author_id, body, at_sec)
         values ('${NEW45.SUB_B}', '${U.T2}', '#45 T2 피드백', null)`,
        submissionForT2,
      ),
    ],
  ]);
});

describe("#45 서버는 제한 중인 학생을 채팅방 참여 행으로 넣는다(DB가 막지 않는다) — ADM-04, DM-01 (팀장 결정 후보 4, PM 질문 3)", () => {
  serverCases([
    [
      "ADM-04·CHAT-02: 제한 중인 학생G를 방1에 다시 넣는다",
      op(
        `insert into public.chat_members (room_id, user_id, member_role) values ('${ROOM.R1}', '${U.SG}', 'member')`,
        removeSGFromR1,
      ),
      "allow",
    ],
    [
      "ADM-04·DM-01: 학생A가 연 학생A ↔ 학생G 1:1 대화에 제한 중인 학생G의 참여 행을 만든다",
      op(
        `insert into public.chat_members (room_id, user_id, member_role) values ('${NEW.DM_SA_SG}', '${U.SG}', 'member')`,
        directRoomSASG,
      ),
      "allow",
    ],
  ]);
});

describe("#45 이용 제한과 트레이너 정지는 별개다 — ADM-04, ADM-02", () => {
  it("ADM-04·ADM-02: 제한 중인 T2의 approval_status는 approved 그대로다", async () => {
    const { rows } = await queryAs<{ approval_status: string }>(
      db,
      service,
      `select approval_status::text as approval_status from public.trainer_profiles where user_id = $1`,
      [U.T2],
    );
    expect(rows).toEqual([{ approval_status: "approved" }]);
  });

  it("ADM-04·ADM-02: 제한 중인 T2의 프로필은 anon에게 그대로 보인다", async () => {
    const { rows } = await queryAs(
      db,
      anon,
      `select 1 from public.trainer_profiles where user_id = $1`,
      [U.T2],
    );
    expect(rows.length).toBe(1);
  });

  it("ADM-04·ADM-02: 운영자가 T1을 제한해도 T1의 approval_status는 바뀌지 않는다", async () => {
    const status = await withActor(db, asUser(U.ADMIN), async (tx) => {
      const inserted = await tx.query(
        `insert into public.user_restrictions (user_id, reason, restricted_by)
         values ($1, '#45 T1 제한', auth.uid())`,
        [U.T1],
      );
      expect(inserted.affectedRows).toBe(1);
      const { rows } = await tx.query<{ approval_status: string }>(
        `select approval_status::text as approval_status from public.trainer_profiles where user_id = $1`,
        [U.T1],
      );
      return rows;
    });
    expect(status).toEqual([{ approval_status: "approved" }]);
  });

  it("ADM-04·ADM-02: T1을 정지해도 제한 줄이 생기지 않는다", async () => {
    const { rows } = await queryAs<{ approval_status: string; restricted: number }>(
      db,
      service,
      `select (select approval_status::text from public.trainer_profiles where user_id = $1) as approval_status,
              (select count(*)::int from public.user_restrictions where user_id = $1 and lifted_at is null) as restricted`,
      [U.T1],
      { setup: suspendT1 },
    );
    expect(rows).toEqual([{ approval_status: "suspended", restricted: 0 }]);
  });

  serverCases([
    [
      "ADM-04·ADM-02: 제한 줄이 없는 정지 T(T1)가 방1에 보내는 메시지",
      textMessage(ROOM.R1, U.T1, "#45 정지 T", suspendT1),
      "allow",
    ],
  ]);
});
