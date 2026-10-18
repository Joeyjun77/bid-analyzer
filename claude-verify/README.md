# claude-verify

Claude Code가 코드를 바꾼 뒤 검증 없이 "완료"라고 말하지 못하게 하는 Stop 훅입니다.

- `verify-on-stop.mjs` — Claude가 응답을 끝내려 할 때 실행됩니다. 감시 경로의 파일이 지난 검사 이후 바뀌었으면 `verify.json`의 검사 중 관련된 것만 돌리고, 실패하면 완료를 막고 실패 내용을 Claude에게 돌려줍니다. 같은 파일 상태로는 한 번만 막습니다.
- `verify.json` — 검사 목록. `paths`에 해당하는 파일이 바뀌었을 때만 그 검사를 실행합니다.
- `install-hook.mjs` — `.claude/settings.json`에 Stop 훅을 등록합니다(기존 설정 유지, 중복 등록 안 함).

## 설치 (한 번)

프로젝트 폴더에서:

```
node claude-verify/install-hook.mjs
```

Claude Code를 다시 열면 적용됩니다. `/hooks`에서 등록 여부를 볼 수 있습니다.

## 끄기

`.claude/settings.json`의 `hooks.Stop`에서 `claude-verify` 항목을 지우면 됩니다.
