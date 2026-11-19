# vocals-team

보컬 레슨 플랫폼 레포에서 쓰는 역할 에이전트 묶음이다. PM(사람)이 결정하고, 메인 세션이 팀장으로 일을 나누고, 아래 에이전트가 일한다.

| 에이전트    | 역할                                   | 모델 (노력)   |
| ----------- | -------------------------------------- | ------------- |
| `planner`   | 기획: 요구사항·완료 조건 정리, docs PR | opus (medium) |
| `designer`  | 디자인: Figma 화면과 디자인 규칙       | opus (medium) |
| `developer` | 개발: 구현, 테스트, 코드 PR            | opus (기본)   |
| `qa`        | QA: 완료 조건 대조, 권한·경계값 테스트 | opus (medium) |

스킬 `team-lead`는 팀장(메인 세션)이 따르는 진행 절차다. 질문 단계, 질문·보고 형식 같은 팀 규칙은 레포의 `.claude/rules/team.md`에 있다.

## 설치

- claude.ai/code Projects: Project settings → Plugins에서 GitHub 마켓플레이스 `Yun-Jehyeok/vocals`를 추가하고 `vocals-team`을 켠다. 새 스레드부터 적용된다.
- 로컬 Claude Code: 레포의 `.claude/settings.json`이 마켓플레이스와 플러그인을 켠다. 처음 열 때 신뢰 여부를 묻는다.

플러그인 에이전트에서는 frontmatter의 `hooks`, `mcpServers`, `permissionMode`가 적용되지 않는다. 역할별 제한은 에이전트 지침과 CI로 지킨다.
