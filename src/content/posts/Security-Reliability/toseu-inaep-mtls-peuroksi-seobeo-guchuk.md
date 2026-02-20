---
tags:
  - mTLS
  - TLS
  - Proxy
  - Express
  - AWS
  - Toss
  - Payments
  - Serverless
title: 토스 인앱 mTLS 프록시 서버 구축
created: '2026-01-28'
modified: '2026-02-06'
---

# 배경

토스 앱 안에서 동작하는 서비스를 만들려면 앱인토스(Apps in Toss) 플랫폼과 연동해야 한다. 인앱 결제, 토스페이, 푸시 알림, 프로모션 등 앱인토스의 모든 API는 mTLS(mutual TLS)를 요구한다. 일반 HTTPS에서는 클라이언트가 서버의 인증서만 검증하지만, mTLS에서는 서버도 클라이언트의 인증서를 검증한다. 앱인토스 콘솔에서 발급받은 인증서와 개인키를 HTTP 요청에 첨부해야만 `apps-in-toss-api.toss.im` 엔드포인트에 접근할 수 있다.

문제는 백엔드가 Supabase였다는 점이다. Supabase Edge Functions는 Deno 기반 서버리스 환경이라 Node.js의 `https.request`처럼 인증서를 직접 첨부할 수 없다. 서버리스 함수에서 파일 시스템에 인증서를 올려놓는 것도 구조적으로 불가능하다. 결국 mTLS 핸드셰이크를 전담하는 별도 서버가 필요했고, EC2 위에 Express 프록시를 올리는 방식으로 해결했다.

# 아키텍처

```
모바일 앱 (puffzone-app)
  → Supabase Edge Function (비즈니스 로직)
    → EC2 Express 프록시 (mTLS 핸드셰이크)
      → apps-in-toss-api.toss.im (앱인토스 API)
```

모바일 앱은 Supabase Edge Function을 호출하고, Edge Function이 비즈니스 로직(결제 검증, 포인트 지급 등)을 처리한 뒤 앱인토스 API 호출이 필요한 시점에 EC2 프록시로 요청을 넘긴다. 프록시는 토스에서 발급받은 클라이언트 인증서를 첨부해 mTLS 통신을 수행하고, 응답을 Edge Function에 반환한다.

mTLS 인증서는 EC2 한 곳에만 존재한다. 인증서가 클라이언트 기기나 서버리스 환경에 분산되지 않으니 유출 경로가 최소화된다.

# 인증서 로딩

앱인토스 콘솔에서 발급받은 인증서(.pem)와 개인키를 환경변수로 주입한다. PEM 문자열을 환경변수에 직접 넣으면 줄바꿈 처리가 플랫폼마다 달라 `error:04800066:PEM routines::bad end line` 같은 오류가 자주 발생한다. 이를 피하기 위해 Base64 인코딩을 우선 사용하고, PEM 문자열을 폴백으로 둔다.

```js
const getTlsCert = () => {
  if (process.env.TOSS_PUBLIC_CRT_B64) {
    return Buffer.from(process.env.TOSS_PUBLIC_CRT_B64, 'base64').toString('utf-8');
  }
  return process.env.TOSS_PUBLIC_CRT?.replace(/\\n/g, '\n');
};

const getTlsKey = () => {
  if (process.env.TOSS_PRIVATE_KEY_B64) {
    return Buffer.from(process.env.TOSS_PRIVATE_KEY_B64, 'base64').toString('utf-8');
  }
  return process.env.TOSS_PRIVATE_KEY?.replace(/\\n/g, '\n');
};
```

로컬에서 Base64로 변환하는 명령은 간단하다.

```bash
cat client-cert.pem | base64 -w 0 > cert-base64.txt
cat client-key.pem | base64 -w 0 > key-base64.txt
```

서버 시작 시 PEM 형식을 검증해 잘못된 인증서로 실행되는 것을 막는다. `BEGIN CERTIFICATE`와 `PRIVATE KEY` 마커가 없으면 즉시 종료한다.

```js
if (
  !TOSS_CERT.includes('BEGIN CERTIFICATE') ||
  !TOSS_KEY.includes('PRIVATE KEY')
) {
  console.error('Invalid PEM format detected!');
  process.exit(1);
}
```

# 프록시 엔드포인트

단일 `/proxy` 엔드포인트가 모든 앱인토스 API 호출을 중계한다. Supabase Edge Function은 HTTP 메서드, API 경로, 본문, 헤더를 JSON으로 보내고, 프록시는 이를 mTLS 연결로 `apps-in-toss-api.toss.im`에 전달한다.

```js
app.post('/proxy', (req, res) => {
  const { method, path, body, headers, hostname } = req.body || {};

  if (!method || !path) {
    return res.status(400).json({ error: 'Missing method or path' });
  }

  const targetHost = hostname || 'apps-in-toss-api.toss.im';
  const hasBody = body != null && typeof body === 'object' && Object.keys(body).length > 0;
  const bodyString = hasBody ? JSON.stringify(body) : '';

  const options = {
    hostname: targetHost,
    path,
    method,
    cert: TOSS_CERT,
    key: TOSS_KEY,
    headers: {
      'Content-Type': 'application/json',
      ...(headers || {}),
      ...(hasBody ? { 'Content-Length': Buffer.byteLength(bodyString) } : {}),
    },
  };

  const proxyReq = https.request(options, (proxyRes) => {
    let data = '';
    proxyRes.on('data', chunk => data += chunk);
    proxyRes.on('end', () => {
      const contentType = proxyRes.headers['content-type'] || '';
      if (contentType.includes('application/json')) {
        try {
          return res.status(proxyRes.statusCode).json(JSON.parse(data));
        } catch {
          return res.status(500).json({ error: 'Failed to parse response', raw: data });
        }
      }
      return res.status(proxyRes.statusCode).send(data);
    });
  });

  proxyReq.on('error', (e) => {
    res.status(500).json({ error: 'Proxy request failed', details: e.message });
  });

  if (hasBody) proxyReq.write(bodyString);
  proxyReq.end();
});
```

Node.js `https.request`에 `cert`와 `key`를 직접 전달해 mTLS 핸드셰이크를 수행한다. `hostname`을 오버라이드할 수 있도록 열어놨는데, 앱인토스 간편결제 API는 `pay-apps-in-toss-api.toss.im`으로 도메인이 다르기 때문이다.

Supabase Edge Function에서 호출하는 모습은 다음과 같다.

```ts
const response = await fetch('http://EC2_PROXY_HOST:3001/proxy', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    method: 'POST',
    path: '/api-partner/v1/payments/confirm',
    body: { orderId, amount, paymentKey },
    headers: { Authorization: `Bearer ${partnerToken}` },
  }),
});
const result = await response.json();
```

# CORS와 접근 제한

프록시는 Supabase Edge Function 같은 서버 사이드에서만 호출한다. 브라우저에서 직접 접근하는 것은 개발 환경에서만 허용한다.

```js
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return callback(null, true);
    return callback(new Error('CORS not allowed'), false);
  },
}));
```

서버 간 호출에서는 `Origin` 헤더가 없으므로 `!origin` 조건으로 통과된다. EC2 Security Group에서 프록시 포트(3001)를 내부 네트워크에서만 접근 가능하도록 제한하면 한 겹 더 보호할 수 있다.

# 배포

GitHub Actions로 EC2에 SCP 전송 후 PM2로 프로세스를 관리한다.

```yaml
- name: Transfer files to EC2
  uses: appleboy/scp-action@v0.1.7
  with:
    host: ${{ secrets.EC2_HOST }}
    username: ${{ secrets.EC2_USER }}
    key: ${{ secrets.EC2_PRIVATE_KEY }}
    source: "index.js,package.json,package-lock.json"
    target: "~/puffzone-toss-mtls-proxy"

- name: Deploy to EC2
  uses: appleboy/ssh-action@v1.0.3
  with:
    host: ${{ secrets.EC2_HOST }}
    username: ${{ secrets.EC2_USER }}
    key: ${{ secrets.EC2_PRIVATE_KEY }}
    script: |
      cd ~/puffzone-toss-mtls-proxy
      npm ci --omit=dev

      echo "TOSS_PUBLIC_CRT_B64=${{ secrets.TOSS_PUBLIC_CRT_B64 }}" > .env
      echo "TOSS_PRIVATE_KEY_B64=${{ secrets.TOSS_PRIVATE_KEY_B64 }}" >> .env
      echo "PORT=3001" >> .env
      echo "NODE_ENV=production" >> .env
      chmod 600 .env

      pm2 delete toss-mtls-proxy || true
      pm2 start index.js --name "toss-mtls-proxy"
      pm2 save
```

인증서는 GitHub Secrets에 Base64로 저장하고, 배포 시 `.env`에 주입한다. 코드 저장소에는 어떤 인증서 데이터도 포함되지 않는다. `.env` 파일 권한을 600으로 설정해 다른 사용자가 읽지 못하도록 했다.

프로덕션에서는 ALB를 앞에 두고 퍼블릭 HTTPS(ACM 인증서)를 처리하게 했다. EC2 자체는 HTTP만 리슨하므로 두 종류의 TLS가 분리된다.

```
외부 클라이언트
  → HTTPS (443, ACM 인증서) → ALB
    → HTTP (3001, VPC 내부) → EC2 Express
      → HTTPS + mTLS (토스 인증서) → apps-in-toss-api.toss.im
```

# PEM 줄바꿈 트러블슈팅

배포 후 처음 마주친 에러가 `error:04800066:PEM routines::bad end line`이었다. GitHub Actions에서 `.env`에 PEM 문자열을 쓸 때 줄바꿈이 소실되면서 발생했다. PEM 형식은 64자 단위의 줄바꿈이 필수인데, 환경변수 전달 과정에서 `\n`이 리터럴 문자열로 들어갔다.

해결책으로 Base64 인코딩을 도입했다. PEM 전체를 Base64로 감싸면 줄바꿈 없는 단일 문자열이 되므로 환경변수에 안전하게 전달할 수 있다. 서버 시작 시 `Buffer.from(b64, 'base64').toString('utf-8')`로 복원하면 원본 PEM이 온전하게 돌아온다.

# 인증서 관리

앱인토스 mTLS 인증서는 390일 유효기간을 가진다. 만료되면 서버 간 통신이 즉시 중단되므로 만료일 전 교체가 필수다. 앱인토스 콘솔에서 새 인증서를 미리 발급받고, 프록시 서버의 환경변수만 교체하면 되기 때문에 앱 업데이트 없이 갱신할 수 있다. 무중단 교체가 필요하면 인증서 두 개를 병행 등록해두는 것을 앱인토스에서도 권장하고 있다.

인증서가 유출되면 제3자가 API를 도용해 의도치 않은 포인트 지급이나 결제 요청을 보낼 수 있다. 유출이 의심되면 앱인토스 콘솔에서 즉시 해당 인증서를 폐기하고 재발급해야 한다.

# 한계와 개선 방향

현재 구조의 한계는 EC2 단일 인스턴스가 SPOF라는 점이다. PM2 자동 재시작과 ALB 헬스체크로 기본적인 복구는 되지만, 트래픽이 늘면 ECS Fargate로 컨테이너화하거나 Auto Scaling Group을 붙여야 한다. 서버리스 환경에서 mTLS를 직접 처리할 수 있는 방법이 생기면 프록시 계층 자체를 제거할 수 있지만, 현재로서는 이 구조가 가장 단순하면서도 안전하다.

# Reference

- https://developers-apps-in-toss.toss.im/development/integration-process.html
- https://developers-apps-in-toss.toss.im/api/overview.html
- https://developers-apps-in-toss.toss.im/iap/intro.html
- https://en.wikipedia.org/wiki/Mutual_authentication

# 연결문서

- [토스 결제 위젯 재시도와 웹훅 검증](/post/toseu-gyeolje-wijet-jaesidowa-wepuk-geomjeung)
- [React Native에 토스 결제 위젯 연동](/post/react-nativee-toseu-gyeolje-wijet-yeondong)
- [로컬 HTTPS와 ALB SSL 종료를 함께 다루기](/post/rokeol-httpswa-alb-ssl-jongnyoreul-hamkke-darugi)
- [EC2 초기 세팅 자동화 스크립트](/post/ec2-chogi-seting-jadonghwa-seukeuripteu)
