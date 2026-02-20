---
tags:
  - NICE
  - Auth
  - Express
  - Crypto
  - Security
  - EC2
title: NICE 본인인증 API 서버 구현
created: 2025-02-20
modified: 2025-02-20
---

NICE 본인인증을 클라이언트 앱과 NICE API 사이에 두는 전용 Express 서버를 구현했다. 해당 프로젝트는 EC2에 PM2로 띄워 두고, 웹·모바일 앱 모두에서 동일한 REST API로 본인인증을 처리한다.

## 아키텍처

```
[Client App] → [Express 서버 (EC2/PM2)] → [NICE API]
                     ↑
                     └── 세션 + 메모리 Map (하이브리드 저장)
```

클라이언트는 NICE API를 직접 호출하지 않는다. Express 서버가 토큰 발급·콜백 처리·암복호화를 담당하고, 클라이언트는 이 서버의 엔드포인트만 사용한다.

## 인증 플로우

1. 클라이언트가 `GET /checkplus_main?return_url=...` 호출
2. 서버가 NICE API로 암호화 토큰 요청 (`POST /digital/niceid/api/v1.0/common/crypto/token`)
3. 서버가 토큰에서 key/iv/hmac_key를 도출해 세션과 메모리 Map에 저장
4. 서버가 `token_version_id`, `enc_data`, `integrity`를 클라이언트에 반환
5. 클라이언트가 NICE 팝업을 열고 폼 제출
6. NICE가 인증 완료 후 `GET|POST /checkplus_success`로 콜백
7. 서버가 저장된 키로 HMAC 검증 후 AES 복호화
8. 서버가 `name`, `birthdate`, `gender`, `di`, `ci`, `mobileno` 등을 JSON으로 반환

## 토큰 생성

NICE API 토큰 요청은 Bearer 인증과 함께 보낸다. 타임스탬프와 클라이언트 ID를 조합한 값을 base64 인코딩한다.

```ts
const timestamp = Math.floor(new Date().getTime() / 1000);
const Auth = access_token + ":" + timestamp + ":" + clientID;
const base64_Auth = Buffer.from(Auth).toString('base64');

const req_dtim = new Date().toISOString().substring(0, 19).replace(/[\D]/g, '');
const req_no = (isMobileRequest ? "MOBILE" : "WEB") + req_dtim + String(Math.floor(Math.random() * 9999)).padStart(4, "0");

const url = APIUrl + "/digital/niceid/api/v1.0/common/crypto/token";
const data = {
  dataHeader: { CNTY_CD: "ko" },
  dataBody: {
    req_dtim,
    req_no,
    enc_mode: "1"
  }
};

const headers = {
  "Content-Type": "application/json",
  "Authorization": "bearer " + base64_Auth,
  "productID ": productID
};

const response = await axios.post(url, data, { headers });
const { site_code, token_version_id, token_val } = response.data.dataBody;
```

## 키 도출

`req_dtim + req_no + token_val`을 SHA256 해시한 뒤, 앞·뒤·앞 32바이트를 잘라 key, iv, hmac_key로 쓴다. 실제 코드는 base64 인코딩을 사용한다.

```ts
const result = req_dtim + req_no + token_val;
const resultVal = crypto.createHash('sha256').update(result).digest('base64');

const key = resultVal.slice(0, 16);
const iv = resultVal.slice(-16);
const hmac_key = resultVal.slice(0, 32);
```

## 암호화·복호화

평문 데이터를 AES-128-CBC로 암호화하고, HMAC-SHA256으로 무결성 값을 계산한다.

```ts
function encrypt(data: string, key: string, iv: string): string {
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  let encrypted = cipher.update(data, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
}

function decrypt(enc_data: string, key: string, iv: string): string {
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  let decrypted = decipher.update(enc_data, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// plain_data 구성
const plain_data = {
  requestno: req_no,
  returnurl: returnURL,
  sitecode: sitecode,
  methodtype: "GET"
};
const plain = JSON.stringify(plain_data);
const enc_data = encrypt(plain, key, iv);

const hmac = crypto.createHmac('sha256', hmac_key);
const integrity = hmac.update(enc_data).digest('base64');
```

## 하이브리드 토큰 저장

세션만 쓰면 ALB 뒤에서 세션이 다른 인스턴스로 가지 않을 때 콜백에서 키를 못 찾는 문제가 생긴다. 그래서 세션과 메모리 Map을 함께 사용한다.

```ts
const tokenStorage = new Map<string, {
  key: string;
  iv: string;
  hmac_key: string;
  req_no: string;
  return_url: string;
  created_at: number;
}>();

const TOKEN_EXPIRE_TIME = 60 * 60 * 1000; // 1시간

// 발급 시 세션 + 메모리 동시 저장
req.session.token_version_id = token_version_id;
req.session.key = key;
req.session.iv = iv;
req.session.hmac = hmac_key;
req.session.req_no = req_no;

tokenStorage.set(token_version_id, {
  key,
  iv,
  hmac_key,
  req_no,
  return_url: returnURL,
  created_at: Date.now()
});

// 1분마다 만료 토큰 정리
setInterval(() => {
  const now = Date.now();
  for (const [token_version_id, data] of tokenStorage.entries()) {
    if (now - data.created_at > TOKEN_EXPIRE_TIME) {
      tokenStorage.delete(token_version_id);
    }
  }
}, 60000);
```

콜백에서는 메모리를 먼저 보고, 없으면 세션으로 폴백한다.

```ts
const tokenData = tokenStorage.get(token_version_id);
let key: string, iv: string, hmac_key: string, req_no: string;

if (tokenData) {
  ({ key, iv, hmac_key, req_no } = tokenData);
} else {
  key = req.session.key || "";
  iv = req.session.iv || "";
  hmac_key = req.session.hmac || "";
  req_no = req.session.req_no || "";
}
```

## return_url 검증

Open Redirect를 막기 위해 `return_url`을 화이트리스트로 검증한다. 웹 도메인과 모바일 딥링크 스킴을 구분해서 처리한다.

```ts
function validateReturnUrl(returnUrl: string): boolean {
  try {
    const url = new URL(returnUrl);

    // 모바일 딥링크 스킴 허용
    const mobileSchemes = ['schoolmeets', 'myapp', 'yourapp'];
    if (mobileSchemes.some(scheme => returnUrl.startsWith(`${scheme}://`))) {
      return true;
    }

    // HTTP/HTTPS만 허용
    if (!['http:', 'https:'].includes(url.protocol)) return false;

    // 프로덕션에서 localhost 차단
    const hostname = url.hostname;
    if (['localhost', '127.0.0.1'].includes(hostname) && nodeEnv === 'production') {
      return false;
    }

    // 의심스러운 패턴 차단
    const suspiciousPatterns = [
      /\.(exe|bat|sh|cmd)$/i,
      /javascript:/i,
      /data:/i,
      /file:/i,
      /[<>"']/
    ];
    if (suspiciousPatterns.some(pattern => pattern.test(returnUrl))) return false;

    // 도메인 화이트리스트 (ALLOWED_RETURN_DOMAINS)
    const allowedReturnDomains = process.env.ALLOWED_RETURN_DOMAINS?.split(',') || [];
    const isAllowed = allowedReturnDomains.some(domain =>
      hostname === domain || hostname.endsWith('.' + domain)
    );
    return isAllowed;
  } catch {
    return false;
  }
}
```

## 콜백 처리

NICE는 브라우저에 따라 GET 또는 POST로 콜백한다. 두 방식 모두 처리한다.

```ts
app.all("/checkplus_success", (req: Request, res: Response) => {
  let token_version_id = "";
  let enc_data = "";
  let integrity_value = "";

  if (req.method === "GET") {
    token_version_id = req.query.token_version_id as string || "";
    enc_data = req.query.enc_data as string || "";
    integrity_value = req.query.integrity_value as string || "";
  } else {
    token_version_id = req.body.token_version_id || "";
    enc_data = req.body.enc_data || "";
    integrity_value = req.body.integrity_value || "";
  }

  // key, iv, hmac_key 조회 (메모리 → 세션 폴백)
  // ...

  const hmac = crypto.createHmac('sha256', hmac_key);
  const integrity = hmac.update(enc_data).digest('base64');

  if (integrity !== integrity_value) {
    // 무결성 실패
    return;
  }

  const dec_data = JSON.parse(decrypt(enc_data, key, iv));
  if (req_no !== dec_data.requestno) {
    // 요청번호 불일치
    return;
  }

  // 성공 시 세션 정리
  delete req.session.token_version_id;
  delete req.session.key;
  delete req.session.iv;
  delete req.session.hmac;
  delete req.session.req_no;

  res.json({
    success: true,
    data: {
      authtype: dec_data.authtype,
      nationalinfo: dec_data.nationalinfo,
      responseno: dec_data.responseno,
      resultcode: dec_data.resultcode,
      mobileno: dec_data.mobileno,
      di: dec_data.di,
      ci: dec_data.ci,
      birthdate: dec_data.birthdate,
      gender: dec_data.gender,
      name: decodeURI(dec_data.utf8_name)
      // ...
    }
  });
});
```

## 배포

EC2에 Node.js를 설치하고 PM2로 프로세스를 관리한다. GitHub Actions로 main/master 푸시 시 자동 배포한다.

- `appleboy/scp-action`: 빌드 결과물(dist, package.json 등)을 EC2로 전송
- `appleboy/ssh-action`: SSH로 접속해 `npm ci --omit=dev` 후 PM2로 재시작
- 프로덕션에서는 HTTP만 사용하고, ALB에서 SSL 종료
- 개발 환경에서는 mkcert로 로컬 인증서를 만들어 HTTP(8888)와 HTTPS(8443)를 함께 띄울 수 있다

```yaml
# .github/workflows/deploy.yml 요약
- name: Transfer files to EC2
  uses: appleboy/scp-action@v0.1.7
  with:
    source: "dist,package.json,package-lock.json"
    target: "~/schoolmeets-nice-api"

- name: Deploy to EC2
  uses: appleboy/ssh-action@v1.0.3
  script: |
    cd ~/schoolmeets-nice-api
    npm ci --omit=dev
    pm2 restart schoolmeets-api || pm2 start dist/app.js --name "schoolmeets-api"
```

## CORS

웹뷰·React Native·Capacitor 등 다양한 클라이언트에서 호출할 수 있도록 CORS를 넓게 설정했다. `file://`, `capacitor://`, `ionic://`, `localhost` 등을 허용하고, `credentials: true`로 쿠키를 넘긴다.

## 정리

- NICE API를 직접 노출하지 않고 Express 프록시로 감쌌다.
- 세션과 메모리 Map을 함께 써서 ALB 뒤에서도 콜백 시 키를 찾을 수 있게 했다.
- `return_url` 화이트리스트와 의심 패턴 검사로 Open Redirect를 막았다.
- EC2 + PM2 + GitHub Actions로 배포를 자동화했다.

# Reference
- https://www.nicepay.co.kr/
- https://nodejs.org/api/crypto.html

# 연결문서
- [[React Native에서 Next.js API를 인증된 상태로 호출하기]]
- [[공공데이터 API 프록시 구현]]
- [[useProfileWithRetry - 네트워크 불안정 대응 훅]]
