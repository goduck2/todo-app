# 할 일 관리 앱

하루 10~20개 할 일을 관리하는 1인용 웹 앱입니다. 한 페이지, 순수 HTML/CSS/JavaScript, 서버·로그인·동기화 없음. 데이터는 각자의 브라우저(localStorage)에만 저장됩니다.

- 기능: 할 일 추가/수정/삭제(삭제 실행 취소), 완료 체크, 카테고리(업무/개인/공부) 필터, 오늘 진행률, 매일 08:00 확인 알림(주말 포함), JSON 백업 내보내기/가져오기
- `index.html`을 더블클릭해 `file://`로 열어도 모든 핵심 기능이 동작합니다. 서비스 워커(설치·오프라인)와 시스템 알림은 지원될 때만 켜지는 부가 기능입니다.

---

## 1. 내 PC에서 실행

### 방법 A. 더블클릭 (`file://`)

`index.html`을 더블클릭합니다. 설치·오프라인 캐시는 켜지지 않지만 모든 핵심 기능은 동작합니다.

### 방법 B. 로컬 서버 (설치·오프라인·업데이트 안내까지 확인할 때)

프로젝트 폴더에서 실행하고 브라우저에서 `http://localhost:8000/`을 엽니다. (서비스 워커는 `localhost` 또는 `https`에서만 동작합니다.)

```bash
python3 -m http.server 8000
```

Windows에서 `python3`이 없으면:

```bash
py -m http.server 8000
```

### 테스트

`tests.html`을 더블클릭하면 데이터 계층 테스트가 실행되고 "전체 N개 통과"가 표시됩니다. 테스트는 별도 키(`todo-app-test-v1`)만 쓰므로 실제 데이터는 건드리지 않습니다.

---

## 2. GitHub Pages로 배포

푸시와 저장소 생성은 직접 하시고, 아래 명령을 순서대로 실행하면 됩니다. `<사용자>`와 `<저장소>`는 본인 값으로 바꿉니다.

### 2-1. 저장소 만들기

GitHub에서 **New repository**로 빈 저장소를 만듭니다(README, .gitignore, license 추가 옵션은 모두 끕니다). 비공개 저장소의 Pages는 요금제에 따라 쓸 수 없을 수 있으니, 공개 저장소가 가장 간단합니다. 앱 코드에는 개인 데이터가 없습니다(데이터는 각자의 브라우저에만 있습니다).

### 2-2. 커밋하고 푸시

프로젝트 폴더에서:

```bash
git add .
git status
```

`git status`의 목록에 `todo-backup-*.json` 같은 백업 파일이 **없는지** 확인합니다(`.gitignore`가 막아 줍니다). 이어서:

```bash
git commit -m "할 일 앱 첫 배포"
git branch -M main
git remote add origin https://github.com/<사용자>/<저장소>.git
git push -u origin main
```

### 2-3. Pages 켜기

GitHub 저장소 페이지에서 **Settings > Pages > Build and deployment**:

1. **Source**: **Deploy from a branch**
2. **Branch**: `main`, 폴더 **/(root)** 선택 후 **Save**
3. 1~2분 뒤 같은 화면 위쪽에 주소가 표시됩니다: `https://<사용자>.github.io/<저장소>/`

이 주소가 앱 주소입니다. `SETUP.md`의 `<앱 주소>` 자리에 넣으세요. 모든 경로가 상대 경로라서 `/<저장소>/` 하위 경로에서도 그대로 동작합니다.

### 2-4. 배포 확인

- 앱 주소를 열어 정상 동작을 확인하고, `CHECKLIST.md`의 "배포 URL" 열을 확인합니다.
- 개발자 도구 Application 탭에서 Service workers가 "activated and is running"인지, Cache storage에 `todo-app-…` 캐시가 있는지 봅니다.

---

## 3. 배포할 때마다 `sw.js`의 `CACHE_VERSION`을 올리세요 (필수)

`sw.js` 맨 위의 값을 바꿉니다.

```js
var CACHE_VERSION = 'v2';   // 배포할 때마다 v3, v4 … 로 올린다
```

올려야 하는 이유:

- 브라우저는 `sw.js` 파일이 **바이트 단위로 달라졌을 때만** 새 버전으로 인식합니다. 올리지 않으면 "새 버전이 있습니다 [새로고침]" 안내가 뜨지 않고, 이전 캐시도 정리되지 않습니다.
- 올리지 않아도 앱 파일(`app.js` 등)은 "캐시 우선 + 뒤에서 갱신"이라 다음다음 실행쯤에 조용히 바뀌지만, 화면이 옛 버전인 채로 한 번 더 열리는 일이 생깁니다.

### 업데이트 배포 순서

1. 파일을 수정합니다.
2. `sw.js`의 `CACHE_VERSION`을 올립니다.
3. `python3 -m http.server 8000`으로 로컬에서 확인합니다.
4. 푸시합니다.

   ```bash
   git add .
   git commit -m "변경 내용 설명"
   git push
   ```
5. 1~2분 뒤 앱을 열면 위쪽에 "새 버전이 있습니다 [새로고침]"이 나타납니다. [새로고침]을 누르면 새 버전으로 바뀝니다. (안 보이면 앱을 한 번 닫았다 열어 보세요.)

`tests.html`은 저장소에 함께 올라가 주소로 열 수 있지만 캐시되지는 않습니다.

---

## 4. 회사 PC에서 쓰기 (호스팅 접속·설치 불가)

앱 파일만 모은 폴더를 복사해서 `index.html`을 더블클릭합니다. `tests.html`과 문서 파일은 빼고 복사합니다.

macOS / Linux / Git Bash (프로젝트 폴더에서):

```bash
mkdir todo-app-company
cp index.html style.css app.js manifest.json sw.js todo-app-company/
cp -r icons todo-app-company/
```

Windows PowerShell (프로젝트 폴더에서):

```powershell
New-Item -ItemType Directory todo-app-company | Out-Null
Copy-Item index.html,style.css,app.js,manifest.json,sw.js todo-app-company\
Copy-Item icons todo-app-company\icons -Recurse
```

(`sw.js`와 `manifest.json`은 `file://`에서는 쓰이지 않지만 앱 파일을 한 벌로 두기 위해 함께 둡니다. PowerShell 명령은 이 문서를 쓴 환경에서 실행해 보지 못했습니다.)

이 `todo-app-company` 폴더를 회사 PC로 복사하는 방법은 회사 규정을 따르세요. 그 뒤 폴더 안의 `index.html`을 더블클릭하면 됩니다. 08:00 알림은 회사 PC에서는 앱을 켜 두면 배너로 확인합니다(`SETUP.md` 참고).

### 데이터 주의사항 (중요)

- 데이터는 **폴더가 아니라 브라우저에** 저장됩니다. 같은 PC라도 Chrome과 Edge는 저장소가 따로이므로 **항상 같은 브라우저로** 여세요. 브라우저의 사이트 데이터를 지우면 할 일도 함께 사라집니다.
- `file://`로 열 때는 **항상 같은 위치의 같은 파일**을 여는 것을 원칙으로 하세요. 파일 경로가 바뀌면 저장 데이터가 따로 생길 수 있습니다. 이 문서를 쓸 때 Chromium에서는 서로 다른 폴더의 사본이 저장소를 공유하는 것을 확인했지만, Firefox·Safari 등 다른 브라우저는 확인하지 못했고 브라우저와 버전에 따라 다를 수 있습니다. 같다고 믿고 폴더를 옮기지 마세요.
- 폴더를 옮기거나 새 버전 파일로 바꾸기 전에는 앱의 **설정 > 백업 > 내보내기**로 먼저 백업하세요. 새 위치에서 열었을 때 데이터가 비어 있으면 **가져오기**로 복원합니다.
- 새 버전으로 업데이트할 때는 폴더의 파일을 덮어쓰면 됩니다. 데이터는 브라우저에 있으므로 그대로 유지됩니다(그래도 업데이트 전에 백업을 권장합니다).
- 가끔 내보내기로 백업해 두세요. 내보낸 `todo-backup-YYYY-MM-DD.json`에는 개인 할 일이 들어 있으니 공개 저장소에 올리지 마세요(`.gitignore`가 막아 줍니다).

---

## 5. 파일 목록

| 파일 | 역할 |
| --- | --- |
| `index.html` | 화면 마크업(알림 배너, 진행률, 카테고리 탭, 목록, 입력 줄, 설정). manifest·아이콘 연결, `app.js`를 일반 `<script defer>`로 로드 |
| `style.css` | 스타일. CSS 변수로 색 정의, 시스템 글꼴만 사용, 600px 미만은 모바일 레이아웃(입력 줄 하단 고정) |
| `app.js` | 앱 전체. 위쪽은 데이터 계층 `Store`(저장·불러오기, 할 일 CRUD, 오늘 목록·진행률, 날짜 처리, 확인 알림 판단, 백업 검증·가져오기), 아래쪽은 화면 코드(렌더링, 이벤트, 알림, 백업 버튼, 서비스 워커 등록) |
| `manifest.json` | PWA 설정(이름, 시작 주소, 색, 아이콘). 모두 상대 경로 |
| `sw.js` | 서비스 워커. 앱 파일 캐시(오프라인 실행), 캐시 우선 + 뒤에서 갱신, 이전 캐시 삭제. `CACHE_VERSION`을 배포마다 올림 |
| `icons/` | `icon-192.png`, `icon-512.png`(일반), `icon-maskable-512.png`(마스크용), `apple-touch-icon.png`(iOS, 180px) |
| `tests.html` | 데이터 계층 자동 테스트(브라우저로 열어 확인). 캐시 대상 아님, 회사 PC용 폴더에서도 제외 |
| `SETUP.md` | 매일 08:00에 앱을 열도록 예약하는 방법(Windows 작업 스케줄러, iPhone 단축어, Android 루틴) |
| `CHECKLIST.md` | 환경별(file://, 로컬 서버, 배포 URL, 모바일) 수동 확인표 |
| `CLAUDE.md` | 프로젝트 규칙(기술 규칙, 데이터 규칙, 작업 방식) |
| `README.md` | 이 문서 |
| `.gitignore` | 백업 파일(`todo-backup-*.json`)과 OS 잡파일을 저장소에서 제외 |

저장은 localStorage 키 `todo-app-v1` 하나입니다. 가져오기 직전 데이터는 `todo-app-v1-before-import`, 깨진 데이터는 `todo-app-v1-corrupt`에 보관됩니다.
