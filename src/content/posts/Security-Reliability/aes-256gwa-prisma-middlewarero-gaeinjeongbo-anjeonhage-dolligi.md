---
tags:
  - Prisma
  - AES
  - Encryption
  - Backend
  - Security
  - NestJS
title: AES-256과 Prisma Middleware로 개인정보 안전하게 돌리기
created: '2025-02-14 10:30'
modified: '2025-02-14 10:30'
---

# Intro
제가 맡은 서비스는 이메일과 전화번호 같은 개인정보를 다룹니다. 초반에는 단순히 컬럼을 암호화해 저장했지만, 검색 조건에 암호화된 값이 들어오면 쉽게 깨졌고, 복호화 과정에서 서버가 느려지는 문제도 있었습니다. 결국 AES-256과 Prisma Middleware를 결합해 안정적인 양방향 암호화 흐름을 구축했습니다.

## 핵심 아이디어 요약
- AES-256-ECB 모드로 결정적 암호화를 적용해 동일한 입력은 항상 같은 결과가 나오도록 했습니다.
- Prisma Middleware에서 `create`, `update`, `findMany` 등 주요 액션마다 암호화·복호화 로직을 자동으로 주입했습니다.
- 주기적으로 누락된 레코드를 스캔해 암호화 상태를 점검하는 스케줄러를 추가했습니다.

## 준비와 선택
1. **키 관리**  
   환경 변수에서 32바이트 미만의 키가 들어오면 SHA-256으로 확장해 길이를 맞췄습니다.
2. **결정적 암호화 필요성**  
   이메일 검색 기능 때문에 해시가 아닌 양방향 암호화가 필요했고, 동일한 값은 같은 결과가 나와야 했습니다.
3. **미들웨어 연결**  
   NestJS `AppModule`에서 Prisma 미들웨어 배열에 암호화 미들웨어를 추가했습니다.

## 구현 여정
### Step 1: 암호화 서비스

```ts
// src/encryption/encryption.service.ts
export class EncryptionService {
  private readonly encryptionKey: Buffer;

  constructor() {
    const key = process.env.ENCRYPTION_KEY ?? '';
    if (key.length < 32) {
      this.encryptionKey = Buffer.concat([Buffer.from(key), Buffer.alloc(32)]).slice(0, 32);
    } else {
      this.encryptionKey = Buffer.from(key.slice(0, 32));
    }
  }

  deterministicEncrypt(value: string) {
    const cipher = createCipheriv('aes-256-ecb', this.encryptionKey, null);
    return Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]).toString('base64');
  }

  decrypt(value: string) {
    const decipher = createDecipheriv('aes-256-ecb', this.encryptionKey, null);
    return Buffer.concat([decipher.update(value, 'base64'), decipher.final()]).toString('utf8');
  }
}
```

ECB 모드는 패턴 노출 위험이 있지만 결정적 암호화를 위해 선택했고, 민감 데이터는 추가로 소금값을 섞어 저장했습니다.

### Step 2: Prisma 미들웨어

```ts
// src/encryption/encryption.middleware.ts
export function encryptionMiddleware(encryptionService: EncryptionService): Prisma.Middleware {
  return async (params, next) => {
    if (params.model === 'User') {
      if (params.action === 'create' || params.action === 'update') {
        if (params.args.data.email) {
          params.args.data.email = encryptionService.deterministicEncrypt(params.args.data.email);
        }
        if (params.args.data.phoneNumber) {
          params.args.data.phoneNumber = encryptionService.deterministicEncrypt(params.args.data.phoneNumber);
        }
      }
      if (params.action === 'findUnique' || params.action === 'findMany') {
        // where 조건에 암호화 적용
        if (params.args.where?.email) {
          params.args.where.email = encryptionService.deterministicEncrypt(params.args.where.email);
        }
      }
    }

    const result = await next(params);

    if (params.model === 'User') {
      if (Array.isArray(result)) {
        result.forEach(user => {
          user.email = encryptionService.decrypt(user.email);
          user.phoneNumber = encryptionService.decrypt(user.phoneNumber);
        });
      } else if (result) {
        result.email = encryptionService.decrypt(result.email);
        result.phoneNumber = encryptionService.decrypt(result.phoneNumber);
      }
    }

    return result;
  };
}
```

Prisma가 반환한 객체를 그대로 수정할 수 있기 때문에, 복호화 후에도 타입이 유지됐습니다.

### Step 3: AppModule에 등록

```ts
// src/app.module.ts
PrismaModule.forRoot({
  prismaServiceOptions: {
    middlewares: [
      loggingMiddleware({ logger: new Logger('PrismaMiddleware'), logLevel: 'debug' }),
      encryptionMiddleware(new EncryptionService()),
    ],
  },
}),
```

로그 미들웨어보다 뒤에 배치해 암호화된 값이 로그에 남지 않도록 했습니다.

### 예상치 못한 이슈
- 초기 데이터에 이미 평문이 섞여 있어서, 복호화 단계에서 예외가 터졌습니다. `secure-data.service.ts`로 마이그레이션 큐를 작성하고, cron 스케줄러에서 소량씩 암호화하도록 했습니다.
- Prisma `findMany`에서 `in` 연산자를 사용할 때 배열의 각 항목에 직접 암호화를 적용해야 했습니다. GPT에게 Prisma middleware에서 `where` 객체의 중첩 구조를 안전하게 순회하는 방법을 물어보고 유틸 함수를 개선했습니다.

## 결과와 회고
이제 운영자가 이메일로 사용자를 검색해도 서버는 암호화된 값을 비교하고, DB에는 평문이 남지 않습니다. 개인정보 접근 로그를 감사팀에 제출할 때도 "미들웨어에서 자동으로 복호화했다"는 걸 근거로 설명할 수 있게 됐습니다. 앞으로는 키 순환 전략과 HSM 도입을 검토 중입니다. 여러분은 DB 암호화를 어떻게 적용하고 계신가요?

# Reference
- https://nodejs.org/api/crypto.html
- https://www.prisma.io/docs/concepts/components/prisma-client/middleware
- https://owasp.org/www-community/attacks/Block_cipher_modes_of_operation

# 연결문서
- Nestjs + Prisma 백엔드에서 양방향 암호화하기
- [역할 기반 승인 흐름 설계기 다단계 검증을 코드로 담다](/post/yeokal-giban-seungin-heureum-seolgyegi-dadangye-geomjeungeul-kodeuro-damda)
- [AI 자동화를 cron 엔드포인트로 안전하게 트리거한 과정](/post/ai-jadonghwareul-cron-endeupointeuro-anjeonhage-teurigeohan-gwajeong)
