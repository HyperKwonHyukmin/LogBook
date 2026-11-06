# 59 — 권상 실적의 구조 해석 결과를 WorkBench 에 내주기

작성 2026-11-06 · 상태: 구현됨·미커밋 · 전체 계획(WorkBench): `docs/plans/2026-11-06-mu-lifting-reference-stress-check.md`

## 왜

WorkBench Module Unit Studio 가 50 의 권상 실적(Wire 모델)을 부를 때, 그 실적이 **허용응력을 만족했는지**를
Studio 의 구조 해석 결과 화면 그대로 보이려 한다. WorkBench 관리자 보내기는 이제 Wire 모델과 함께
결과 세트(결과 JSON · 해석에 쓴 모델 JSON · F06)를 권한다. LogBook 은 받기는 이미 하지만(`.json` = other,
`.f06` = result), 서버 간으로는 BDF 만 내줬다(`files/{id}/content` 는 kind != model 이면 415).

## 한 것

- `lifting_refs.result_files(db, f)` — Wire 모델 `<stem>_lifting.bdf` 와 **같은 자료·같은 폴더(rel_path 의 폴더)** 에서
  `<stem>_lifting_nastranResult.json` + `<stem>_edited.json`(없으면 `<stem>.json`) + `<stem>_lifting.f06`(선택)을 찾는다.
  이름은 대소문자 무시(Nastran 이 F06 을 소문자로 쓴다). 결과·모델 JSON 둘 다 있어야 '결과 있음'.
- `GET /api/integration/lifting-refs/{fileId}/result?as=` → `{fileId, name, files:{result,model,f06}, result, model}`(JSON 내용).
  대상·권한은 50 상세와 같다(확정·보관소·Wire 모델, `as` 가 볼 수 있는 자료).
  오류: 404 `file_not_found`·`no_result` · 415 `not_wire_model` · 422 `drm`·`bad_json`·`too_large`·`file_missing` · 503 `storage_unreachable`.
- 목록·상세 항목에 `hasResult`.
- 테스트 `test_lifting_refs_50.py` 끝 3건(편집본 우선·목록 hasResult · 없음/깨짐/권한 · 다른 폴더는 짝 아님).

## 하지 않은 것

- F06 내용은 내주지 않는다(Studio 결과 화면에 필요 없음, 파일 정보만).
- 짝을 sha 로 보증하는 묶음 표는 만들지 않았다 — WorkBench 가 한 폴더의 세트를 한 번에 보낸다.

## 반영

145 LogBook `git pull` + 재시작 → WorkBench 백엔드 → WorkBench exe → MU Studio.
