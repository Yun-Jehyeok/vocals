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

| 훅                    | 대상                                 | 막는 것                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session-context.mjs` | SessionStart                         | 막지 않음. 팀장 컨텍스트에 30줄 이내 현황을 넣는다(아래)                                                                                                                                                                                                                                                                                                                      |
| `guard-files.mjs`     | Edit, Write, MultiEdit, NotebookEdit | 아래 경로 규칙                                                                                                                                                                                                                                                                                                                                                                |
| `guard-bash.mjs`      | Bash                                 | 강제 push(`-f`·`-fu`·`+refspec`·`--mirror`), main으로 가는 push(`--all`, 브랜치가 main일 때 refspec 없는 push 포함), 원격 DB를 바꾸는 supabase CLI(`db push`, `db reset --linked/--db-url`, `migration repair`, `functions deploy`, `secrets set` 등)와 원격 `psql`, 파일을 쓰는 명령의 경로 규칙 위반, QA가 아닌 역할의 트레일러 위조                                        |
| `guard-mcp.mjs`       | `mcp__*__<위험 도구>`                | Supabase `create_project`, `pause_project`, `restore_project`, `create_branch`, `delete_branch`, `merge_branch`, `reset_branch`, `rebase_branch`, `apply_migration`, `execute_sql`, `deploy_edge_function`, `create_edge_function_secret`, `confirm_cost`, `run_notebook`, `create_notebook`, `delete_notebook`. 접두어가 달라도 막는다. Figma·GitHub의 같은 이름 도구는 허용 |

경로 규칙(`lib/rules.mjs`, vocals 레포와 그 worktree 안에서만). 경로는 심볼릭 링크를 풀고 대소문자를 무시해 비교한다. `agent_type`도 대소문자를 무시한다.

| 누구      | 막는 경로                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 모든 세션 | `.env*`(`.env.example` 제외), main에 이미 있는 `supabase/migrations/*`                                                                     |
| developer | `docs/`, 인수 테스트·판정 헬퍼(`scripts/acceptance-guard.ts`의 `PROTECTED_PATHS`를 그때그때 읽어 씀)                                       |
| qa        | 테스트 파일(`*.test.ts` 등, `supabase/tests/`, `tests/`), `scripts/req-trace-baseline.txt`, QA 메모리(`.claude/agent-memory/…qa/`) 밖 전부 |
| planner   | `docs/`, `CLAUDE.md`, `.claude/rules/`, 이 플러그인의 `.md` 밖 전부                                                                        |
| designer  | `apps/`, `packages/`, `supabase/`, `scripts/`                                                                                              |

Bash 해석(`lib/shell.mjs`):

- 리다이렉트, tee, sed -i, perl -i, awk -i inplace, ex/vi/ed, cp/mv/install/ln/rsync, rm, touch, truncate, dd, tar -x, unzip, patch·`git apply`(패치 파일을 읽음), `git mv/rm`, `git checkout <커밋> -- 경로`, `git restore --source`, find -delete, `bash -c`·eval, `node -e`·`python -c`, 인터프리터·셸의 표준 입력 코드(`python3 - <<'EOF'`, `node <<EOF`, `<<<`, `< 파일`, `echo … | node`), `{a,b}`와 glob을 푼다. `ln`과 `cp -l/-s`는 링크가 가리키는 곳도 본다.
- 명령 규칙(push·원격 DB)의 원문 검사는 데이터 heredoc 본문을 빼고 한다: `cat`·`tee`·`git`·`gh` 등 표준 입력을 실행하지 않는 명령의 heredoc(`cat > 파일 <<'EOF'`, `git commit -F - <<'EOF'`). 인터프리터·셸의 표준 입력, 파이프로 그런 명령에 넘어가는 본문, 따옴표 없는 구분자(`<<EOF`) 본문의 `$(…)`·백틱은 계속 검사한다.
- HEAD·index로 되돌리는 `git restore 경로`·`git checkout -- 경로`는 막지 않는다(커밋된 내용으로 돌아갈 뿐).
- 풀 수 없는 쓰기(스크립트 실행, xargs, pnpm/npx, 변수 경로, `$(…)`로 이동한 cd 등)가 보호 경로 문자열(docs/, 인수 테스트, 마이그레이션 디렉터리)과 한 명령에 있으면 developer는 보수적으로 막는다.
- QA가 아닌 역할: 명령 어디든 `Acceptance:`가 있으면 막는다. `-t/--template`, `-c core.editor`·`GIT_EDITOR`·`EDITOR`, `trailer.*` 설정, `interpret-trailers`, `-m` 안의 `$(…)`·백틱, 같은 명령에서 만든 `-F` 파일, Co-Authored-By·Claude-Session 밖의 `--trailer`, 트레일러가 있는 커밋의 `-C`·`--amend --no-edit`도 막는다. 커밋 메시지는 `git commit -F - <<'EOF' … EOF`로 쓴다.
- 그래도 못 보는 것: 문자열을 이어 붙여 만든 경로(`'do'+'cs'`), 스크립트 파일 안에서의 쓰기, `git reset --hard`·`revert`로 QA 커밋 무르기. 인수 테스트·마이그레이션은 CI가 잡는다.

운영:

- 훅 단위 테스트: `scripts/plugin-hooks.test.ts`, `scripts/session-context.test.ts`(`pnpm test`). 규칙을 바꾸면 표에 줄을 더한다.
- 차단 메시지의 "왜"는 대상에 맞춘다(예: QA가 문서 → 기획 담당, seed → 개발 담당, 하네스 → 팀장 라벨).
- 로컬 `.claude/settings.json`의 PreToolUse 훅은 이 스크립트를 레포 경로(`$CLAUDE_PROJECT_DIR/plugins/vocals-team/hooks/`)에서 직접 부른다. 그래서 로컬은 항상 작업 트리의 최신 규칙을 쓴다. 플러그인 훅(마켓플레이스 캐시)과 둘 다 돌아도 판정이 같다.
- 이 디렉터리를 바꾸는 PR은 `harness` 라벨이 있어야 CI를 통과한다(`scripts/check-harness-change.ts`).
- 훅이 클라우드 스레드에서 실제로 도는지는 플러그인을 켠 새 세션에서 QA가 실측한다(#17 2단계 검증).

## 세션 시작 현황 (`session-context.mjs`, 이슈 #17 3단계)

- 메인 세션(팀장)의 SessionStart에서만 낸다. 서브에이전트는 SessionStart가 아니라 SubagentStart를 받고, `--agent`로 시작한 세션(입력에 `agent_type`)은 건너뛴다.
- `gh api`(REST)로 읽는다. 클라우드 세션은 GraphQL(`gh issue list`, `gh pr list`)을 막는다. 호출마다 5초 타임아웃, 실패하면 한 줄 안내만 내고 종료 코드 0.
- 내용: 열린 PR(번호·제목·draft·라벨·CI, 위 5개), 열린 이슈(위 6개), 블로커(라벨 `blocked`, 본문이나 최근 댓글 3개의 `막힘: 예`, 인라인 코드 속 글자는 제외), 결정 기록(`decisions.md`) `## 결정` 표의 위 10줄(파일이 없으면 건너뜀).
- 로컬 `.claude/settings.json`에는 넣지 않는다(플러그인이 켜져 있어 두 번 나온다).

## 에이전트 메모리

`developer`·`qa`는 `memory: project`로 `.claude/agent-memory/<에이전트>/`에 메모리를 둔다. 작업 PR에 같이 커밋하고, `check-harness-change`는 이 디렉터리를 하네스로 보지 않는다(PR diff로 리뷰). 반복되는 함정만 짧게, 개인정보·시크릿 금지.

인수 테스트는 QA만 바꾼다(`Acceptance: qa` 트레일러, CI의 acceptance-guard).
