# 프로젝트: 할 일 관리 앱
- 하루 10~20개 할 일을 관리하는 1인용 앱. 화면은 한 페이지.
- 기능: 할 일 추가/수정/삭제, 완료 체크, 카테고리(업무/개인/공부) 필터, 오늘 진행률, 매일 08:00 확인 알림(주말 포함), JSON 백업 내보내기/가져오기.

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
- todo: { id, title(1~100자), category: "work"|"personal"|"study", done, createdAt, doneAt|null, updatedAt }
- settings: { reminderTime: "08:00", lastCategory, lastAckDate, lastNotifiedDate, activeTab: "all"|"work"|"personal"|"study" }
- 최상위: { version: 1, todos: [], settings: {} }
- 완료 후 7일이 지난 항목은 앱 시작 시 자동 삭제.
- ‘오늘 할 일’ = 미완료 전체 + 오늘 완료한 항목. 진행률은 이 집합 기준.

## 작업 방식
- 내가 단계별로 지시한다. 지시한 단계 범위만 구현하고 다음 단계 기능을 미리 만들지 말 것.
- 단계가 끝나면 바뀐 파일, 직접 확인한 방법, 남은 문제를 짧게 보고한다.
