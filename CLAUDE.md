# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# 프로젝트: 할 일 관리 앱
- 하루 10~20개 할 일을 관리하는 1인용 앱. 화면은 한 페이지.
- 기능: 할 일 추가/수정/삭제, 완료 체크, 카테고리(업무/개인/공부) 필터, 오늘 진행률, 매일 08:00 확인 알림(주말 포함, 오늘 일정 개수·제목도 표시), 월 달력 일정 추가/삭제(카테고리 구분, 그날 오늘 할 일에 반영), JSON 백업 내보내기/가져오기.

## 실행과 테스트
빌드·린트 단계는 없습니다. 파일을 고친 뒤 브라우저로 바로 엽니다.
- 핵심 기능 확인: `index.html`을 더블클릭(`file://`).
- 서비스 워커·설치·업데이트 안내 확인: 프로젝트 폴더에서 `py -m http.server 8000`(또는 `python3 -m http.server 8000`) 후 `http://localhost:8000/`.
- 자동 테스트: `tests.html`을 브라우저로 열면 데이터 계층(`Store`) 테스트가 모두 실행되고 "전체 N개 통과"가 표시됩니다. 단일 테스트 실행 기능은 없습니다. 특정 테스트만 보려면 결과 목록에서 이름으로 찾습니다.
  - 테스트는 `test(name, fn)` / `ok()` / `eq()`로 작성합니다. 각 테스트 전에 `reset()`이 `Store.configure({ key: 'todo-app-test-v1', clock: null })`로 별도 키를 쓰게 하므로 실제 데이터(`todo-app-v1`)는 건드리지 않습니다.
  - 시간 관련 테스트는 `Store.configure({ clock: fn })`으로 시계를 주입합니다.
- 화면·환경별 수동 확인은 `CHECKLIST.md`의 표를 따릅니다.

## 구조
- `app.js` 하나에 두 부분이 있습니다.
  - 위쪽 `var Store = (function () { ... })()`: 데이터 계층. 저장·불러오기, 마이그레이션, 할 일 CRUD, 오늘 목록·진행률, 날짜 처리, 알림 판단, 백업 검증·가져오기. DOM을 쓰지 않습니다.
  - 아래쪽 IIFE: 화면 코드. `#todo-list`가 없으면 바로 끝나므로 `tests.html`에서 `app.js`를 그대로 불러와도 화면 코드는 실행되지 않습니다.
  - 화면 코드는 `Store`의 공개 함수만 호출합니다. 데이터 로직은 `Store`에 넣고 `tests.html`에 테스트를 추가합니다.
- 화면 갱신은 변경 후 `afterChange()` → `Store.save()` 후 `render()`로 목록 전체를 다시 그리는 방식입니다. 일정 영역은 따로 `renderSchedule()`이 달력과 선택한 날의 목록을 다시 그립니다(선택한 날짜·보고 있는 달은 저장하지 않음).
- 삭제 실행 취소(토스트, Ctrl+Z)는 할 일과 일정이 함께 씁니다. `lastDeleted = { kind: 'todo'|'event', item }`.
- 보조 localStorage 키: 가져오기 직전 데이터 `todo-app-v1-before-import`, 읽지 못한 깨진 데이터 `todo-app-v1-corrupt`.
- `sw.js`: `ASSETS` 목록의 앱 파일을 캐시 우선 + 뒤에서 갱신. 자동 `skipWaiting`을 하지 않고, 화면의 [새로고침]이 `SKIP_WAITING` 메시지를 보내 교체합니다. 앱 파일을 추가·삭제하면 `ASSETS`도 고칩니다.
- 배포는 GitHub Pages(저장소 루트). 모든 경로는 상대 경로로 유지합니다. 자세한 배포·회사 PC 사용법은 `README.md`, 08:00 자동 열기 예약은 `SETUP.md`.

## 기술 규칙 (반드시 지킬 것)
- 순수 HTML, CSS, 자바스크립트만 사용. 프레임워크, npm 패키지, 빌드 도구, 외부 CDN, 웹폰트 금지.
- 파일: index.html, style.css, app.js, manifest.json, sw.js, icons/. 그 외 파일은 필요할 때만.
- index.html을 더블클릭해 file://로 열어도 모든 핵심 기능이 동작해야 한다(회사 PC는 호스팅 접속·설치 불가).
  - script는 type="module" 없이 일반 <script defer>로 로드. import/export, fetch 사용 금지.
  - 서비스 워커와 시스템 알림(Notification)은 지원될 때만 켜는 부가 기능. 실패해도 앱은 정상 동작.
  - 서비스 워커 등록은 location.protocol이 http:/https:일 때만. sw.js는 http(s)에서만 실행되므로 그 안에서는 fetch/caches 사용 가능(index.html·app.js는 여전히 fetch 금지).
  - 배포(앱 파일 변경)할 때마다 sw.js의 CACHE_VERSION을 올린다. tests.html은 캐시하지 않는다.
- 저장은 localStorage 키 "todo-app-v1" 하나에 JSON으로. 서버, 로그인, 기기 간 동기화 없음.
- 최신 Chrome, Edge, Safari(iOS), Samsung Internet 지원. 폭 600px 미만은 모바일 레이아웃.
- UI 문구는 한국어. 코드 주석은 짧게.

## 데이터 규칙
- todo: { id, title(1~100자), category: "work"|"personal"|"study", done, createdAt, doneAt|null, updatedAt, eventId|null }
- settings: { reminderTime: "08:00", lastCategory, lastAckDate, lastNotifiedDate, activeTab: "all"|"work"|"personal"|"study" }
- event: { id, date: "YYYY-MM-DD"(로컬 날짜), time: "HH:MM"|null(종일), title(1~100자), category, synced, createdAt }. 자동 삭제 없음.
  - category·synced·eventId는 나중에 생긴 선택 항목이다. 없으면 category는 "personal", synced는 false, eventId는 null로 읽는다.
- 일정 → 오늘 할 일: 그날이 되면(시작·날짜 변경·오늘 일정 추가·가져오기 때 `Store.syncToday()`) 같은 카테고리의 할 일을 만든다(제목은 "HH:MM 내용", eventId로 연결).
  - 만든 뒤 일정의 synced를 true로 바꿔, 할 일을 지워도 다시 만들지 않는다.
  - 일정을 지우면 연결된 미완료 할 일도 지우고(완료한 것은 남김), 실행 취소하면 둘 다 되돌린다. 할 일 수정·완료는 일정에 반영하지 않는다.
- 최상위: { version: 1, todos: [], events: [], settings: {} }
  - events는 나중에 추가된 선택 항목이라 version은 1 그대로다(옛 버전 앱이 새 데이터를 깨진 데이터로 보지 않도록). events가 없는 데이터·백업도 정상으로 읽는다.
  - events가 없는 옛 백업을 가져오면 현재 일정은 유지한다(settings가 없을 때와 같은 방식).
- 완료 후 7일이 지난 항목은 앱 시작 시 자동 삭제.
- ‘오늘 할 일’ = 미완료 전체 + 오늘 완료한 항목. 진행률은 이 집합 기준.

## 작업 방식
- 내가 단계별로 지시한다. 지시한 단계 범위만 구현하고 다음 단계 기능을 미리 만들지 말 것.
- 단계가 끝나면 바뀐 파일, 직접 확인한 방법, 남은 문제를 짧게 보고한다.
