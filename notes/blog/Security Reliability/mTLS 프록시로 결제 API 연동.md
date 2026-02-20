---
tags:
  - mTLS
  - TLS
  - Proxy
  - Express
  - AWS
  - Payments
title: mTLS 프록시로 결제 API 연동
created: 2026-01-28
modified: 2026-02-06
---

# 배경

결제 API 중에는 mTLS(mutual TLS) 인증을 요구하는 곳이 있다. 일반 HTTPS에서는 클라이언트가 서버의 인증서만 검증하지만, mTLS에서는 서버도 클라이언트의 인증서를 검증한다. 문제는 브라우저나 모바일 앱에서 mTLS 인증서를 직접 관리할 수 없다는 것이다. 사용자 기기에 인증서를 배포하는 것은 보안적으로도 운영적으로도 불가능하다.

해결 방법은 간단하다. 서버에 mTLS 인증서를 보관하고, 클라이언트 요청을 받아 결제 API로 대신 전달하는 프록시를 두는 것이다.

# 아키텍처

전체 흐름은 다음과 같다.

```
Client (브라우저/앱)
  → HTTPS → ALB (퍼블릭 TLS 종료)
    → HTTP → EC2 (Express 프록시)
      → HTTPS + mTLS → 결제 API
```

두 구간의 TLS가 분리되어 있다.

- 클라이언트 → ALB: AWS ACM 인증서로 퍼블릭 HTTPS 처리. 일반적인 TLS.
- Express → 결제 API: 결제사에서 발급받은 클라이언트 인증서로 mTLS 핸드셰이크.

ALB와 EC2 사이는 VPC 내부 통신이라 HTTP로 충분하다.

# 구현

## 인증서 로딩

인증서는 GitHub Secrets에 Base64로 인코딩해 저장하고, 배포 시 `.env` 파일에 주입한다. PEM 문자열을 직접 환경변수에 넣으면 개행 문자 처리가 플랫폼마다 달라 문제가 생기기 쉬운데, Base64로 인코딩하면 이 문제를 피할 수 있다.

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

const TOSS_CERT = getTlsCert();
const TOSS_KEY = getTlsKey();

if (!TOSS_CERT?.includes('BEGIN CERTIFICATE') || !TOSS_KEY?.includes('PRIVATE KEY')) {
  console.error('Invalid PEM format detected!');
  process.exit(1);
}
```

Base64 방식을 우선 시도하고, 없으면 개행 문자가 이스케이프된 PEM 문자열을 폴백으로 처리한다. 서버 시작 시 PEM 형식을 검증해 잘못된 인증서로 실행되는 것을 방지한다.

## 프록시 엔드포인트

단일 `/proxy` 엔드포인트가 모든 결제 API 호출을 중계한다. 클라이언트는 HTTP 메서드, 경로, 본문, 헤더를 JSON으로 보내고, 프록시는 이를 mTLS 연결로 전달한다.

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
      res.status(proxyRes.statusCode).send(data);
    });
  });

  proxyReq.on('error', (e) => {
    res.status(502).json({ error: 'Proxy request failed', message: e.message });
  });

  if (hasBody) proxyReq.write(bodyString);
  proxyReq.end();
});
```

`https.request`에 `cert`와 `key`를 직접 전달해 mTLS 핸드셰이크를 수행한다. 별도의 `https.Agent`를 만들지 않고 요청마다 인증서를 포함시킨다.

## CORS 제한

프록시는 내부 서비스만 호출해야 한다. 외부에서 직접 접근하는 것을 막기 위해 CORS를 localhost로 제한한다.

```js
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return callback(null, true);
    return callback(new Error('CORS not allowed'), false);
  },
}));
```

실제 프로덕션에서는 모바일 앱이나 서버에서 호출하므로 `Origin` 헤더가 없다. 브라우저에서 직접 호출하는 것은 개발 환경에서만 허용한다.

## 헬스체크

```js
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'Toss mTLS Proxy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});
```

ALB 헬스체크와 배포 후 검증에 사용한다.

# 배포

GitHub Actions로 EC2에 SCP/SSH 배포한다.

```yaml
steps:
  - name: Deploy to EC2
    uses: appleboy/ssh-action@v1
    with:
      host: ${{ secrets.EC2_HOST }}
      username: ${{ secrets.EC2_USER }}
      key: ${{ secrets.EC2_PRIVATE_KEY }}
      script: |
        cd ~/puffzone-toss-mtls-proxy
        npm ci --omit=dev

        cat > .env << 'EOF'
        TOSS_PUBLIC_CRT_B64=${{ secrets.TOSS_PUBLIC_CRT_B64 }}
        TOSS_PRIVATE_KEY_B64=${{ secrets.TOSS_PRIVATE_KEY_B64 }}
        PORT=3001
        NODE_ENV=production
        EOF

        pm2 delete toss-mtls-proxy || true
        pm2 start index.js --name "toss-mtls-proxy"
        pm2 save

  - name: Health Check
    run: curl -f http://${{ secrets.EC2_HOST }}:3001/
```

인증서가 GitHub Secrets에서 `.env`로 주입되므로 코드에는 어떤 인증서 데이터도 포함되지 않는다. PM2로 프로세스를 관리해 서버 재시작 시에도 자동 복구된다.

# 결과

이 프록시 구조의 장점은 다음과 같다.

- 인증서가 서버 1곳에만 존재한다. 클라이언트에 인증서를 배포하거나 관리할 필요가 없다.
- 결제 API의 mTLS 요구사항이 변경되어도 프록시만 수정하면 된다. 앱 업데이트가 불필요하다.
- ALB에서 퍼블릭 TLS를 처리하므로, EC2의 Express는 mTLS 핸드셰이크만 담당한다. 관심사가 분리된다.

단점은 단일 장애점이 생긴다는 것이다. EC2가 다운되면 모든 결제가 중단된다. 현재는 PM2의 자동 재시작과 ALB 헬스체크로 대응하고 있지만, 트래픽이 더 늘면 ECS 같은 컨테이너 오케스트레이션으로 이전하는 것을 고려해야 한다.

# Reference

- https://en.wikipedia.org/wiki/Mutual_authentication
- https://nodejs.org/api/https.html
- https://docs.aws.amazon.com/elasticloadbalancing/latest/application/
- https://pm2.keymetrics.io/

# 연결문서

- [[토스 결제 위젯 재시도와 웹훅 검증]]
- [[React Native에 토스 결제 위젯 연동]]
- [[로컬 HTTPS와 ALB SSL 종료를 함께 다루기]]
- [[GitHub Actions와 Docker, Elastic Beanstalk로 통합 배포 자동화하기]]
