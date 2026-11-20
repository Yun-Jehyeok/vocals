# vocals-team

보컬 레슨 플랫폼 레포에서 쓰는 역할 에이전트 묶음이다. PM(사람)이 결정하고, 메인 세션이 팀장으로 일을 나누고, 아래 에이전트가 일한다.

| 에이전트    | 역할                                   | 모델 (노력)   |
| ----------- | -------------------------------------- | ------------- |
| `planner`   | 기획: 요구사항·완료 조건 정리, docs PR | opus (medium) |
| `designer`  | 디자인: Figma 화면과 디자인 규칙       | opus (medium) |
| `developer` | 개발: 구현, 테스트, 코드 PR            | opus (기본)   |
| `qa`        | QA: 인수 테스트 작성, 실행 근거로 판정 | opus (medium) |

스킬 `team-lead`는 팀장(메인 세션)이 따르는 진행 절차다. 질문 단계, 질문·보고 형식 같은 팀 규칙은 레포의 `.claude/rules/team.md`에 있다.

## 설치

- claude.ai/code Projects: Project settings → Plugins에서 GitHub 마켓플레이스 `Yun-Jehyeok/vocals`를 추가하고 `vocals-team`을 켠다. 새 스레드부터 적용된다.
- 로컬 Claude Code: 레포의 `.claude/settings.json`이 마켓플레이스와 플러그인을 켠다. 처음 열 때 신뢰 여부를 묻는다.
- 직접 설치: `/plugin install vocals-team --marketplace Yun-Jehyeok/vocals`

## 훅 (`hooks/hooks.json`, 이슈 #17)

플러그인 에이전트의 frontmatter `hooks`, `mcpServers`, `permissionMode`는 적용되지 않는다. 그래서 차단은 플러그인 자체 훅에 두고, 훅 입력의 `agent_type`으로 역할을 고른다(`developer` 또는 `vocals-team:developer`). 메인 세션(팀장)은 `agent_type`이 없어 역할 차단을 받지 않는다. 차단 메시지는 "왜 + 대신 할 일"로 쓴다.

| 훅                | 대상                                 | 막는 것                                                                                                                                                                                                                                                                                                                 |
| ----------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `guard-files.mjs` | Edit, Write, MultiEdit, NotebookEdit | 아래 경로 규칙                                                                                                                                                                                                                                                                                                          |
| `guard-bash.mjs`  | Bash                                 | 강제 push, main 직접 push, `supabase db reset --linked`, 파일을 쓰는 명령(리다이렉트, tee, sed -i, cp/mv/rm, git mv/rm/checkout/restore, find -delete, 한 줄 코드 등)의 경로 규칙 위반, QA가 아닌 역할의 `Acceptance:` 트레일러 커밋(-m, --trailer, -F, -C, --amend)                                                    |
| `guard-mcp.mjs`   | `mcp__*__<위험 도구>`                | Supabase `create_project`, `pause_project`, `restore_project`, `create_branch`, `delete_branch`, `merge_branch`, `reset_branch`, `rebase_branch`, `apply_migration`, `execute_sql`, `deploy_edge_function`, `create_edge_function_secret`, `confirm_cost`. 접두어가 달라도 막는다. Figma·GitHub의 같은 이름 도구는 허용 |

경로 규칙(`lib/rules.mjs`, vocals 레포와 그 worktree 안에서만):

| 누구      | 막는 경로                                                                                           |
| --------- | --------------------------------------------------------------------------------------------------- |
| 모든 세션 | `.env*`(`.env.example` 제외), main에 이미 있는 `supabase/migrations/*`                              |
| developer | `docs/`, 인수 테스트·판정 헬퍼(`scripts/acceptance-guard.ts`의 `PROTECTED_PATHS`를 읽어 씀)         |
| qa        | 테스트 파일(`*.test.ts` 등, `supabase/tests/`, `tests/`)과 `scripts/req-trace-baseline.txt` 밖 전부 |
| planner   | `docs/`, `CLAUDE.md`, `.claude/rules/`, 이 플러그인의 `.md` 밖 전부                                 |
| designer  | `apps/`, `packages/`, `supabase/`, `scripts/`                                                       |

- Bash 해석은 흔한 경로만 본다(xargs, 스크립트 실행, `git apply`, 변수로 만든 경로는 못 봄). 최종 보증은 CI다(`scripts/README.md`).
- 훅 단위 테스트: `scripts/plugin-hooks.test.ts`(`pnpm test`). 규칙을 바꾸면 표에 줄을 더한다.
- 로컬에서 고친 훅을 시험하려면 `claude --plugin-dir plugins/vocals-team`. 평소에는 마켓플레이스(GitHub main) 버전이 돈다.
- 훅이 클라우드 스레드에서 실제로 도는지는 플러그인을 켠 새 세션에서 QA가 실측한다(#17 2단계 검증).

인수 테스트는 QA만 바꾼다(`Acceptance: qa` 트레일러, CI의 acceptance-guard).
