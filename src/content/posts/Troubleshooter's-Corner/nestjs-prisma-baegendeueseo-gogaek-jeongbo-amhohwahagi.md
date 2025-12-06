---
tags:
  - Engineering
  - IssueNote
  - Encryption
  - Prisma
  - NestJS
  - TypeScript
  - Security
  - Logging
title: Nestjs + Prisma 백엔드에서 고객 정보 암호화하기
created: '2024-06-03 10:44'
modified: '2024-06-03 11:17'
---

# Intro

고객정보 암호화는 참으로 다루기 어렵다. 일단 고객의 비밀번호는 단방향 암호화로 바로 처리 가능하다.
만약 고객의 주민번호나 신용카드 번호라면? 이 부분은 검색을 하지도 않을테고, 대놓고 암호화하라는 지침이 내려와있다. 하지만, 고객의 전화번호나 이메일이라면?

이 부분부터 조금 애매해진다. 전화번호나 이메일이 과연 고객의 개인정보일까? 일단 nipa 에서 전화번호를 고객 개인정보로 규정하고있지는 않지만, 여러 정보들과 조합되어서 고객의 개인 정보라고 볼 수도 있다.

며칠동안 이에 관해 곰곰히 생각해보았다. 프로그래머는 항상 최악의 상황을 생각해봐야한다. 우리 데이터베이스가 털렸을 때, 암호화되지 않은 이메일과 전화번호, 고객 이름이 같이 인터넷에 떠돌게된다면? 이건 좀 문제가 되는 듯 하다.

이내 고객 데이터를 암호화하기로 결심했다. 서론이 길었다.

# Concept

일단 우리에게 필요한 암호화 기술은 검색 가능한 암호화이다. 뭐, 그보다 더 나아가면 동형 암호화같은 기술들도 있지만, 우리에게는 검색가능 암호화정도면 충분했다.

그리고 암호화 방법은? aes-256-ecb 을 사용하면서, iv 를 null 값으로 넣으면, 결정론적인 암호화가 되며, 검색가능한 암호화가 된다. 다만, 보안은 그만큼 낮아질 수 밖에 없지만, 어쩔 수 없는 trade-off 이다.

적용 방법은? 현재 ORM 을 prisma 를 사용중이므로, prisma 에서 데이터를 출입할 떄, 중간에 암호화와 복호화를 하도록 미들웨어 구성하면 될 것이다.

# EncryptService

서비스 레이어는 단순하게 만들어주었다.

```typescript
// src/encryption/encryption.module.ts
import { createCipheriv, createDecipheriv } from 'crypto';

import { Injectable } from '@nestjs/common';

@Injectable()
export class EncryptionService {
  private readonly encryptionKey: Buffer;

  constructor() {
    // 키가 32바이트가 되도록 조정
    // 환경변수에서 ENCRYPTION_KEY를 가져옴
    const key = process.env.ENCRYPTION_KEY!;

    // 키가 32바이트가 되도록 조정
    if (key.length < 32) {
      // 키가 32바이트보다 짧으면 오른쪽에 0으로 패딩
      this.encryptionKey = Buffer.concat([
        Buffer.from(key),
        Buffer.alloc(32 - key.length),
      ]);
    } else if (key.length > 32) {
      // 키가 32바이트보다 길면 잘라냄
      this.encryptionKey = Buffer.from(key.slice(0, 32));
    } else {
      // 키가 정확히 32바이트면 그대로 사용
      this.encryptionKey = Buffer.from(key);
    }
  }

  deterministicEncrypt(data: string): string {
    const cipher = createCipheriv('aes-256-ecb', this.encryptionKey, null);
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
  }

  decrypt(encryptedData: string): string {
    const decipher = createDecipheriv('aes-256-ecb', this.encryptionKey, null);
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}
```

encryptionKey 부분만 환경변수가 어떤 길이로 들어오더라도 오류가 나지 않도록 길이를 조정하도록 초기화해주었다.

```typescript
// src/encryption/encryption.module.ts
import { Global, Module } from '@nestjs/common';

import { EncryptionService } from './encryption.service';
import { SecureDataService } from './secure-data.service';

@Global()
@Module({
  providers: [EncryptionService, SecureDataService],
  exports: [EncryptionService],
})
export class EncryptionModule {}
```

EncryptionService 가 이곳 한곳에서만 쓰이지는 않을테니, 전역 모듈로 설정해주었다.

# EncryptionMiddleware

EncryptionMiddleware 를 통해, prisma 의 입력과 출력을 가로챈다.

prisma 를 부를 떄, model 의 이름, action 의 종류 등에 따라서 각각 다른 동작을 취하게 만들어준다. 그리고 이 작업을 하기 전에 미리 emailEncrypted attribute 를 모델 스키마에 추가하여, 암호화가 되었는지 되지 않았는지를 플래그해준다.

내가 이를 표시해주는 이유는 기존의 데이터베이스는 평문으로 저장되어있었기 때문이다.

```typescript
// src/encryption/encryption.middleware.ts
import { Prisma } from '@prisma/client';

import { EncryptionService } from './encryption.service';

export function encryptionMiddleware(
  encryptionService: EncryptionService,
): Prisma.Middleware {
  return async (params, next) => {
    if (
      params.model &&
      ['User'].includes(params.model)
    ) {
      if (['create', 'update', 'updateMany'].includes(params.action)) {
        if (params.args.data?.email && !params.args.data.emailEncrypted) {
          params.args.data.email = encryptionService.deterministicEncrypt(
            params.args.data.email,
          );
          params.args.data.emailEncrypted = true; // 이메일 암호화 플래그 설정
        }
        if (
          params.args.data?.phoneNumber &&
          !params.args.data.phoneNumberEncrypted
        ) {
          params.args.data.phoneNumber = encryptionService.deterministicEncrypt(
            params.args.data.phoneNumber,
          );
          params.args.data.phoneNumberEncrypted = true; // 전화번호 암호화 플래그 설정
        }
      }

      if (
        [
          'findUnique',
          'findUniqueOrThrow',
          'findMany',
          'findFirst',
          'findFirstOrThrow',
          'delete',
          'deleteMany',
          'update',
          'updateMany',
        ].includes(params.action)
      ) {
        if (params.args.where?.email) {
          const encryptedEmail = encryptionService.deterministicEncrypt(
            params.args.where.email,
          );
          params.args.where = {
            OR: [
              { email: params.args.where.email, emailEncrypted: false },
              { email: encryptedEmail, emailEncrypted: true },
            ],
          };
        }

        if (params.args.where?.phoneNumber) {
          const encryptedPhoneNumber = encryptionService.deterministicEncrypt(
            params.args.where.phoneNumber,
          );
          params.args.where = {
            OR: [
              {
                phoneNumber: params.args.where.phoneNumber,
                phoneNumberEncrypted: false,
              },
              { phoneNumber: encryptedPhoneNumber, phoneNumberEncrypted: true },
            ],
          };
        }
      }
    }

    const result = await next(params);
    if (
      params.model &&
      ['User'].includes(params.model) &&
      [
        'findUnique',
        'findUniqueOrThrow',
        'findMany',
        'findFirst',
        'findFirstOrThrow',
        'delete',
        'deleteMany',
      ].includes(params.action)
    ) {
      if (Array.isArray(result)) {
        result.forEach((user) => {
          if (user.email && user.emailEncrypted) {
            user.email = encryptionService.decrypt(user.email);
          }
          if (user.phoneNumber && user.phoneNumberEncrypted) {
            user.phoneNumber = encryptionService.decrypt(user.phoneNumber);
          }
        });
      } else if (result) {
        if (result.email && result.emailEncrypted) {
          result.email = encryptionService.decrypt(result.email);
        }
        if (result.phoneNumber && result.phoneNumberEncrypted) {
          result.phoneNumber = encryptionService.decrypt(result.phoneNumber);
        }
      }
    }
    return result;
  };
}

```

검색가능 암호화를 구현해주기 위해서, 검색시에는 평문 검색과 암호화된 문장을 둘 모두 검색해준다. 이러한 구조로 인해, findUnique 를 쓰는 항목에서는 오류가 날 수 있으므로, email 이나 phoneNumber 를 검색할 떄에는 미리 findFirst 로 고쳐주자.

이후 result 부분에서는 복호화를 하여 결과를 평문으로 받을 수 있도록 코드를 구성한다.

여기서 끝은 아니다. prisma 에 middleware 를 주입해주어야한다.

```typescript
// src/app.module.ts
	...
    PrismaModule.forRoot({
      isGlobal: true,
      prismaServiceOptions: {
        middlewares: [
          encryptionMiddleware(new EncryptionService()),
        ],
      },
    }),
    ...
```

prisma 모듈에 EncryptionService 와 함께 미들웨어를 넣어준다. 이로서 검색가능한 양방향 암호화의 구현은 끝났다!

…끝일까?

# 기존 평문 데이터 암호화

아직 기존 평문으로 저장된 데이터들은 그대로이다. 이 데이터들도 모두 암호화해야한다.

암호화되지 않은 user 를 모두 찾은 뒤, 하나하나 암호화해준다. 이 떄, email 이 비어있을 떄는 암호화를 하지 않는다.

또한 이러한 작업은 서버를 시작하고 5 분 뒤 시작하도록 코드를 작성해준다.

```typescript
// src/encryption/secure-data.service.ts
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { PrismaService } from 'nestjs-prisma';
import { Logger } from 'winston';

import { Inject, Injectable } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { EncryptionService } from './encryption.service';

@Injectable()
export class SecureDataService {
  constructor(
    private prisma: PrismaService,
    private schedulerRegistry: SchedulerRegistry,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
    private encryptionService: EncryptionService,
  ) {}

  async onApplicationBootstrap() {
    this.scheduleEncryptionTask();
  }

  private scheduleEncryptionTask() {
    const timeout = setTimeout(() => this.encrypteAll(), 3000000); // 5분 뒤 실행
    this.schedulerRegistry.addTimeout('encryptionTask', timeout);
    this.logger.info('Scheduled encryption task.');
  }

  private async encrypteUser() {
    try {
      const users = await this.prisma.user.findMany({
        where: {
          OR: [
            { emailEncrypted: false, email: { not: null } },
            { phoneNumberEncrypted: false },
          ],
        },
        select: {
          id: true,
          email: true,
          phoneNumber: true,
          emailEncrypted: true,
          phoneNumberEncrypted: true,
        },
      });

      if (!users.length) return;

      this.logger.info(`Encrypting ${users.length} users.`);

      for (const user of users) {
        if (user.emailEncrypted && user.phoneNumberEncrypted) continue;

        if (!user.emailEncrypted && user.email) {
          await this.prisma.user.update({
            where: { id: user.id },
            data: {
              email: this.encryptionService.deterministicEncrypt(user.email),
              emailEncrypted: true,
            },
          });
        }

        if (!user.phoneNumberEncrypted && user.phoneNumber) {
          await this.prisma.user.update({
            where: { id: user.id },
            data: {
              phoneNumber: this.encryptionService.deterministicEncrypt(
                user.phoneNumber,
              ),
              phoneNumberEncrypted: true,
            },
          });
        }
      }

      this.logger.info('Encrypted users.');
    } catch (error) {
      this.logger.error(error);
    }
  }

  private async encrypteAll() {
    await this.encrypteUser();

    this.logger.info('Encrypted all.');
  }
}

```

다른 모델들도 암호화를 해야한다면, 각각에 대해 비슷한 코드만 작성해주면 된다.

이를 통해 진짜 코드 작성이 종료되었다.

모두들 손쉽게 고객 데이터를 안전하게 보관하길 바란다.

# 주의사항

주의사항이라고 말해야 할 정도인지는 모르겠지만, 이 작업을 할 때에는 데이터베이스의 백업이 필수적이다. 중간에 무언가 코드가 잘못 꼬인다면 암호화된 이메일을 다시 암호화한다던지, 공백을 복호화하려고 해, 오류가 난다든지등의 문제가 계속해서 나타난다.

본인도 이 작업을 하면서 데이터베이스를 3 번정도 restore 한 것 같다. 데이터가 불러와지지 않을 때 마다 식은땀이 나려했지만 어쨋든 완성했으니 된것 아닐까?

# Reference

https://nestjs-prisma.dev/

# 연결문서
- [AES-256과 Prisma Middleware로 개인정보 안전하게 돌리기](/post/aes-256gwa-prisma-middlewarero-gaeinjeongbo-anjeonhage-dolligi)
- [AWS KMS와 AES-GCM으로 서버 사이드 암호화 업로드 구축기](/post/aws-kmswa-aes-gcmeuro-seobeo-saideu-amhohwa-eomnodeu-guchukgi)
- [Fluid Pipeline으로 OCR과 AI 검증을 한 번에 묶어낸 기록](/post/fluid-pipelineeuro-ocrgwa-ai-geomjeungeul-han-beone-mukkeonaen-girok)
