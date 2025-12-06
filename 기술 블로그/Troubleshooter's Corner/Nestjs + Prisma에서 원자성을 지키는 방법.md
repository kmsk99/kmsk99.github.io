---
aliases: 
tags:
  - Engineering
  - IssueNote
  - Prisma
  - Backend
my_rate: 
created: 2023-06-01 11:57
modified: 2023-06-01 11:58
uploaded: "false"
---
https://chat.openai.com/share/a36bbeb8-c515-4012-8d3e-27cd73a8391a

원자성 (Atomicity) 은 데이터베이스 트랜잭션에서 매우 중요한 속성 중 하나입니다. 원자성은 트랜잭션이 모두 성공하거나 실패해야 한다는 개념을 의미합니다. 즉, 트랜잭션 내의 모든 연산이 완료되거나 아무것도 실행되지 않아야 합니다.

위의 코드에서 원자성을 지키기 위해서는 Prisma 의 트랜잭션 기능을 이용할 수 있습니다. `prisma.$transaction` 메소드를 사용하여 여러 Prisma 작업을 하나의 트랜잭션으로 그룹화할 수 있습니다. 이 방식을 사용하면, 트랜잭션 내의 모든 작업이 성공적으로 완료되거나, 하나라도 실패할 경우 모든 작업이 롤백되는 원자성을 보장할 수 있습니다.

위의 코드를 원자성을 지키도록 수정하면 아래와 같습니다:

```javascript
async sendVerificationEmail({
  email,
}: FindUserByEmailInput): Promise<CoreOutput> {
  try {
    if (!this.emailValidator(email)) {
      return { ok: false, error: 'Email is not valid' };
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      return { ok: false, error: 'User not found' };
    }

    if (user.validated) {
      return { ok: false, error: 'Email already verified' };
    }

    const deleteOldVerification = this.prisma.verification.deleteMany({
      where: { userId: user.id },
    });

    const createNewVerification = this.prisma.verification.create({
      data: {
        user: { connect: { id: user.id } },
      },
    });

    const [_, verification] = await this.prisma.$transaction([
      deleteOldVerification,
      createNewVerification
    ]);

    await this.mailService.sendVerificationEmail({
      email,
      code: verification.code,
    });

    return { ok: true };
  } catch (error) {
    return { ok: false, error: 'Could not send verification email' };
  }
}

```
위의 코드에서 `deleteOldVerification` 와 `createNewVerification` 두 작업이 하나의 트랜잭션으로 묶여 있어, 둘 중 하나라도 실패하면 모든 작업이 롤백됩니다. 이렇게 하면 원자성을 보장할 수 있습니다.

# Reference

# 연결문서
- [[Prisma 개발 시 migration 기록 지우기]]
- [[AES-256과 Prisma Middleware로 개인정보 안전하게 돌리기]]
- [[역할 기반 승인 흐름 설계기 다단계 검증을 코드로 담다]]
