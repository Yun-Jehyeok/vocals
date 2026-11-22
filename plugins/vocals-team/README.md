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

| 훅                    | 대상                                 | 막는 것                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session-context.mjs` | SessionStart                         | 막지 않음. 팀장 컨텍스트에 30줄 이내 현황을 넣는다(아래)                                                                                                                                                                                                                                                                                                                                                                      |
| `guard-files.mjs`     | Edit, Write, MultiEdit, NotebookEdit | 아래 경로 규칙                                                                                                                                                                                                                                                                                                                                                                                                                |
| `guard-bash.mjs`      | Bash                                 | 강제 push(`-f`·`-fu`·`+refspec`·`--mirror`), main으로 가는 push(`--all`, 브랜치가 main일 때 refspec 없는 push 포함), 원격 DB를 바꾸는 supabase CLI(`db push`, `db reset --linked/--db-url`, `migration repair`, `functions deploy`, `secrets set` 등)와 원격 `psql`, 파일을 쓰는 명령의 경로 규칙 위반, QA가 아닌 역할의 트레일러 위조. 데이터(PR 본문·커밋 메시지·검색어)의 글자와 검사·테스트 실행은 막지 않는다(아래, #48) |
| `guard-mcp.mjs`       | `mcp__*__<위험 도구>`                | Supabase `create_project`, `pause_project`, `restore_project`, `create_branch`, `delete_branch`, `merge_branch`, `reset_branch`, `rebase_branch`, `apply_migration`, `execute_sql`, `deploy_edge_function`, `create_edge_function_secret`, `confirm_cost`, `run_notebook`, `create_notebook`, `delete_notebook`. 접두어가 달라도 막는다. Figma·GitHub의 같은 이름 도구는 허용                                                 |

경로 규칙(`lib/rules.mjs`, vocals 레포와 그 worktree 안에서만). 경로는 심볼릭 링크를 풀고 대소문자를 무시해 비교한다. `agent_type`도 대소문자를 무시한다.

| 누구      | 막는 경로                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 모든 세션 | `.env*`(`.env.example` 제외), main에 이미 있는 `supabase/migrations/*`                                                                     |
| developer | `docs/`, 인수 테스트·판정 헬퍼(`scripts/acceptance-guard.ts`의 `PROTECTED_PATHS`를 그때그때 읽어 씀)                                       |
| qa        | 테스트 파일(`*.test.ts` 등, `supabase/tests/`, `tests/`), `scripts/req-trace-baseline.txt`, QA 메모리(`.claude/agent-memory/…qa/`) 밖 전부 |
| planner   | `docs/`, `CLAUDE.md`, `.claude/rules/`, 이 플러그인의 `.md` 밖 전부                                                                        |
| designer  | `apps/`, `packages/`, `supabase/`, `scripts/`                                                                                              |

Bash 해석(`lib/shell.mjs`):

- 리다이렉트, tee, sed -i, perl -i, awk -i inplace, ex/vi/ed, cp/mv/install/ln/rsync, rm, touch, truncate, dd, tar -x, unzip, patch·`git apply`(패치 파일을 읽음), `git mv/rm`, `git checkout <커밋> -- 경로`, `git restore --source`, find -delete·`-fprint`·`-exec`, awk 프로그램의 `print > "파일"`, `curl -o`·`--output-dir`, `wget -O`·`-P`, `bash -c`·eval, `node -e`·`python -c`, 인터프리터·셸의 표준 입력 코드(`python3 - <<'EOF'`, `node <<EOF`, `<<<`, `< 파일`, `echo … | node`), `{a,b}`와 glob을 푼다. `ln`과 `cp -l/-s`는 링크가 가리키는 곳도 본다.
- 인터프리터 코드(#48): 파일 쓰기 API가 있을 때만 문자열을 본다. 경로 인자 자리(`open`·`Path`·`fs.*`·`os.*`·`shutil.*`·`File.*`의 인자, `writeFileSync` 등의 첫 인자)는 공백이 있어도 경로, 그 밖(변수 대입·목록)은 공백 없는 경로 모양 문자열만 경로로 본다. 바로 감싼 자리가 글 자리(`print`·`startswith`·`write`·`json.dump` 등의 인자, `writeFileSync` 등의 둘째 인자부터)인 문자열, `replace`·`sub`의 찾을 글자(첫 인자), 여러 줄 문자열(`'''…'''`, JS 템플릿), 주석은 보지 않는다. 백틱은 JS에서만 문자열이다(파이썬 문자열 속 마크다운 `` `…` ``는 경로가 아님). `replace`·`sub`의 바꿀 글자·대상 글(둘째 인자부터)은 결과가 경로가 될 수 있어 공백 없는 경로 모양이면 경로로 본다(QA 반려). 코드가 `argv`(`sys.orig_argv` 포함)·`ARGV`로 받은 경로에 쓰면 뒤의 인자를 쓰기 대상으로 본다. 쓰기 API가 있는 코드가 경로를 조합하거나 바깥에서 받으면(`join`·`resolve`·`format`, 문자열 더하기, f-string, `${}`, argv·환경 변수·입력·디렉터리 목록) 풀 수 없는 쓰기다(QA 반려 2차).
- `find -exec`(#48): `rm`·`mv`·`tee` 등과 `sed -i`·`perl -i`면 찾는 곳 전체를 쓰기 대상으로 본다. `sed -n`·`perl -ne`·`grep`은 읽기, `cp {} 대상`은 대상만 본다. 셸·인터프리터·러너를 `-exec`로 부르면 풀 수 없는 쓰기다.
- 명령 규칙(push·원격 DB)의 원문 검사는 데이터를 빼고 한다(#23, #48): `cat`·`tee`·`git`·`gh` 등 표준 입력을 실행하지 않는 명령의 heredoc 본문(`cat > 파일 <<'EOF'`, `git commit -F - <<'EOF'`), echo·printf·gh(`gh api -f body=…`)·jq·grep의 인자, `git commit -m`의 메시지. 데이터는 명령의 모든 세그먼트가 허용 목록일 때만 뺀다(QA 반려 2차): echo·printf·gh·jq·grep·rg·cat·head·tail·wc·sort·uniq·diff·ls·pwd·tee·cd 등, `-C` 밖의 전역 플래그가 없는 git(`add`·`commit`·`log`·`show`·`diff`·`status`·`push` 등), 검사·테스트 실행. 하나라도 모르는 명령(셸·인터프리터·find·awk·timeout·script·`./x`·`$(…)` 명령 자리·`git -c` 등)이 있으면 아무것도 빼지 않는다(파일에 쓴 글·커밋 메시지가 실행될 수 있다). 인터프리터·셸의 표준 입력, 파이프로 데이터 명령이 아닌 곳(`… | sh`, `… | xargs`)에 넘어가는 것, 작은따옴표 밖의 `$(…)`·백틱(따옴표 없는 구분자 `<<EOF` 본문 포함)은 계속 검사한다.
- HEAD·index로 되돌리는 `git restore 경로`·`git checkout -- 경로`는 막지 않는다(커밋된 내용으로 돌아갈 뿐).
- 풀 수 없는 쓰기(스크립트 실행, xargs, pnpm/npx, 변수 경로, 모르는 곳으로 cd한 뒤의 상대 경로 쓰기 등)가 보호 경로 문자열(docs/, 인수 테스트, 마이그레이션 디렉터리)과 한 명령에 있으면 developer는 보수적으로 막는다. 단(#48):
  - 검사·테스트 실행(허용 목록, QA 반려 2차): `pnpm check`·`check:*`·`test`·`test:*`·`lint`·`typecheck`·`format:check`·`harness:report`·`db:reset`·`db:query`(`run`, 전역 플래그는 `--filter`·`-F`·`-C`·`--dir`·`-r`·`--silent` 등만, 스크립트 인자는 위치 인자만), `vitest run|list`(플래그는 `--run`·`--silent`·`--passWithNoTests`·`-t`·`--reporter`·`--project`·`--dir`·`--bail`만), `tsc --noEmit`(`-p`·`--pretty`·`--skipLibCheck`만, `true`·`false` 위치 인자 불가), `eslint`(`--quiet`·`--max-warnings`만), `prettier --check`(`--log-level`만), `node scripts/<검사 스크립트>.ts`(플래그 없이). 목록 밖의 플래그(트레이스·캐시·커버리지·프로파일·설정 파일·출력 경로)가 하나라도 있으면 풀 수 없는 쓰기다. `pnpm format`도 그렇다.
  - 검사 실행만 단독으로(또는 `cd`·데이터 명령과) 돌리면 허용한다. 검사 실행 자신의 인자(`pnpm vitest run supabase/tests/acceptance/…`)는 보호 경로 언급으로 세지 않는다. 다른 세그먼트가 보호 경로를 말하면(`pnpm check && cat docs/prd.md`) main처럼 막는다. 읽기는 따로 실행한다(QA 반려 2차).
  - 직접 부른 `prettier`·`eslint`·`tsc`·`vitest`가 읽기 모드가 아니면, 셸·인터프리터가 훅이 못 읽는 표준 입력(`git log … | sh`)을 실행하면, 변수가 든 `bash -c "$X"`, awk의 `system()`·`|`, `curl -O`, 대상 없는 `wget`도 풀 수 없는 쓰기다(QA 반려).
  - `cd "$(…)"`는 그 자체로 쓰기가 아니다. 뒤의 상대 경로 쓰기·러너만 풀 수 없는 쓰기로 센다.
  - 보호 경로 문자열은 데이터를 빼고 찾는다(모든 세그먼트가 위 허용 목록일 때만): echo·printf·gh 인자, jq 필터, `git commit -m` 메시지, 데이터 heredoc 본문. 파일로 쓰는 데이터(`printf … > x.sh`, `cat > x.sh <<EOF`)와 쓰기 명령으로 파이프하는 데이터(`echo docs/x | xargs rm`), grep·cat의 파일 인자는 그대로 센다.
- QA가 아닌 역할: 명령 어디든 `Acceptance:`가 있으면 막는다. `-t/--template`, `-c core.editor`·`GIT_EDITOR`·`EDITOR`, `trailer.*` 설정, `interpret-trailers`, `-m` 안의 `$(…)`·백틱, 같은 명령에서 만든 `-F` 파일, Co-Authored-By·Claude-Session 밖의 `--trailer`, 트레일러가 있는 커밋의 `-C`·`--amend --no-edit`도 막는다. 커밋 메시지는 `git commit -F - <<'EOF' … EOF`로 쓴다.
- 그래도 못 보는 것: 개발 역할 밖에서 조합한 경로(`'do'+'cs'`, `os.path.join(…)`. 개발 역할은 보호 경로 언급과 함께면 막는다), 공백이 든 바꿀 글자를 경로로 쓰는 코드(`open(s.replace('x', 'docs/a b.md'), 'w')`), `os.system`·`subprocess`·`git -c core.fsmonitor` 같은 실행(명령 규칙은 원문 글자로만 본다), 스크립트 파일·테스트 코드 안에서의 쓰기, `git reset --hard`·`revert`로 QA 커밋 무르기. 인수 테스트·마이그레이션은 CI가 잡는다.

운영:

- 훅 단위 테스트: `scripts/plugin-hooks.test.ts`, `scripts/session-context.test.ts`, `scripts/hook-log.test.ts`(`pnpm test`). 규칙을 바꾸면 표에 줄을 더한다.
- 차단 메시지의 "왜"는 대상에 맞춘다(예: QA가 문서 → 기획 담당, seed → 개발 담당, 하네스 → 팀장 라벨).
- 로컬 `.claude/settings.json`의 PreToolUse 훅은 이 스크립트를 레포 경로(`$CLAUDE_PROJECT_DIR/plugins/vocals-team/hooks/`)에서 직접 부른다. 그래서 로컬은 항상 작업 트리의 최신 규칙을 쓴다. 플러그인 훅(마켓플레이스 캐시)과 둘 다 돌아도 판정이 같다.
- 이 디렉터리를 바꾸는 PR은 `harness` 라벨이 있어야 CI를 통과한다(`scripts/check-harness-change.ts`).
- 훅이 클라우드 스레드에서 실제로 도는지는 플러그인을 켠 새 세션에서 QA가 실측한다(#17 2단계 검증).

## 차단 로그 (`lib/log.mjs`, 이슈 #17 6단계)

- 훅이 막을 때마다(`lib/io.mjs`의 `block`) `<메인 체크아웃>/.claude/logs/<YYYY-MM-DD>-<세션 앞 8자>-<브랜치>.jsonl`에 한 줄을 더한다(#48). 날짜는 UTC, 세션은 훅 입력 `session_id`에서 `session_` 접두어와 영숫자가 아닌 글자를 뺀 앞 8자, 브랜치는 막힌 체크아웃(worktree·복사본이면 그곳)의 브랜치 이름에서 영숫자·`.`·`_`·`-` 밖의 글자를 `-`로 바꾼 것(`fix/48-x` → `fix-48-x`, 브랜치가 없으면 `detached`, 80자까지).
- 이름 규칙의 이유: 같은 세션이 여러 브랜치(docs PR과 기능 PR)에서 막혀도 브랜치마다 파일이 달라, 두 PR이 같은 파일을 고쳐 merge 때 충돌하지 않는다. #48 이전 이름(`<날짜>-<세션>.jsonl`)의 파일은 그대로 두고 집계에도 쓴다.
- 필드: `ts`, `session`, `event`(`block`), `rule`(규칙 id), `role`(`developer`·`qa`·`planner`·`designer`, 다른 에이전트는 `agent_type` 그대로, 메인 세션은 `main`), `tool`, `target`(저장소 기준 경로, MCP 도구 이름, 경로가 없는 명령 규칙은 `null`).
- **명령 원문·파일 내용·도구 인자 값은 남기지 않는다.** 저장소 밖 절대 경로는 파일 이름만 남긴다.
- 쓰는 곳: 세션 프로젝트(`CLAUDE_PROJECT_DIR`, 없으면 막힌 저장소)의 메인 체크아웃(`git rev-parse --git-common-dir`의 부모). 수동 worktree(`/tmp/wt-<이슈번호>`)나 /tmp 복사본에서 막혀도 메인 체크아웃에 남아, worktree를 지워도 기록이 사라지지 않는다(#48). `target`은 막힌 저장소 기준 경로다. vocals 저장소를 못 찾으면 남기지 않는다. 쓰기 실패는 무시한다(차단은 그대로).
- 커밋: 브랜치 이름이 붙은 파일은 그 브랜치의 PR에만 커밋한다(`git add .claude/logs/*-<브랜치>.jsonl`, `git add -A`로 다른 브랜치 파일까지 담지 않는다). 그 브랜치를 worktree에서 작업했으면 팀장이 메인 체크아웃의 파일을 worktree 쪽에 이어 붙이고(`cat <메인>/.claude/logs/<파일> >> /tmp/wt-<이슈번호>/.claude/logs/<파일>`) 메인 체크아웃의 파일은 지운 뒤 worktree에서 커밋한다(남겨 두면 그 브랜치를 checkout·pull할 때 추적되지 않은 파일과 부딪친다).
- 규칙 id는 `lib/log.mjs`의 `RULE_IDS`가 목록이다. 새 차단을 더하면 `block({ rule: "…" })`과 목록에 같이 더한다(`scripts/hook-log.test.ts`가 둘이 같은지 본다). id를 바꾸면 지난 로그와 집계가 끊긴다.
- 클라우드는 세션이 끝나면 파일이 사라져서 팀장이 작업 PR에 커밋한다(PM 결정 2026-11-20, team-lead 스킬 6장). `.gitignore`에 넣지 않고, `check-harness-change`는 이 디렉터리를 하네스로 보지 않는다.
- 집계: `pnpm harness:report`(`scripts/README.md`).

## 세션 시작 현황 (`session-context.mjs`, 이슈 #17 3단계)

- 메인 세션(팀장)의 SessionStart에서만 낸다. 서브에이전트는 SessionStart가 아니라 SubagentStart를 받고, `--agent`로 시작한 세션(입력에 `agent_type`)은 건너뛴다.
- `gh api`(REST)로 읽는다. 클라우드 세션은 GraphQL(`gh issue list`, `gh pr list`)을 막는다. 호출마다 5초 타임아웃, 실패하면 한 줄 안내만 내고 종료 코드 0.
- 내용: 열린 PR(번호·제목·draft·라벨·CI, 위 5개), 열린 이슈(위 6개), 블로커(라벨 `blocked`, 본문이나 최근 댓글 3개의 `막힘: 예`, 인라인 코드 속 글자는 제외), 결정 기록(`decisions.md`) `## 결정` 표의 위 10줄(파일이 없으면 건너뜀).
- 로컬 `.claude/settings.json`에는 넣지 않는다(플러그인이 켜져 있어 두 번 나온다).

## worktree 격리 (이슈 #17 4단계, 6단계에서 수동 방식으로 바꿈)

- 클라우드 환경은 서브에이전트 `isolation: "worktree"`를 권한으로 막는다("Permission to use Agent with isolation:* has been denied", 4단계 실측). 그래서 `developer` frontmatter에 `isolation`을 두지 않는다(있으면 developer 실행 자체가 막힐 수 있다).
- 병렬 작업은 팀장이 지시할 때만 수동 worktree로 한다: `git worktree add /tmp/wt-<이슈번호> -b <브랜치> origin/main`에서 일하고 끝나면 `git worktree remove`. 절차는 `agents/developer.md`의 worktree 절.
- 훅은 worktree 안에서도 그 worktree를 레포 루트로 본다(경로 규칙). 차단 로그는 메인 체크아웃의 `.claude/logs/`에 worktree 브랜치 이름으로 쓴다(위 "차단 로그", #48).
- `.claude/worktrees/`(로컬 Claude Code의 자동 worktree 위치)는 `.gitignore`·eslint·`check:req-trace`에서 계속 뺀다. 로컬에서는 쓸 수 있다.
- worktree별 포트 스크립트는 없다. DB 테스트가 PGlite(프로세스 안)라 포트를 쓰지 않는다. 로컬 Supabase 스택을 쓰는 E2E를 도입할 때 만든다.

## 에이전트 메모리

`developer`·`qa`는 `memory: project`로 `.claude/agent-memory/<에이전트>/`에 메모리를 둔다. 작업 PR에 같이 커밋하고, `check-harness-change`는 이 디렉터리를 하네스로 보지 않는다(PR diff로 리뷰). 반복되는 함정만 짧게, 개인정보·시크릿 금지.

`.claude/` 아래 파일을 Edit·Write 도구로 고치면 Claude Code가 승인을 요구해, 서브에이전트가 기다리다 세션과 함께 멈춘다(#34·#38·#48). 그래서 에이전트는 메모리에 넣을 줄을 [보고]의 `메모리` 칸에 적고, 팀장이 Bash로 `MEMORY.md`에 덧붙여 커밋한다. 모든 에이전트는 승인이 필요한 도구 호출을 기다리지 않고 [보고]하고 멈춘다.

인수 테스트는 QA만 바꾼다(`Acceptance: qa` 트레일러, CI의 acceptance-guard).
