---
tags:
  - AWS
  - KMS
  - AES-GCM
  - Supabase
  - Uploads
  - Security
title: AWS KMS와 AES-GCM으로 서버 사이드 암호화 업로드 구축기
created: 2025-10-09 14:06
modified: 2025-10-09 14:06
---

# Intro
저는 내부 자료를 Supabase Storage에 보관하다가 “혹시 평문으로 남아 있지는 않을까?” 하는 걱정에 잠이 오질 않았습니다. 권한 관리가 탄탄해도 스토리지 키가 유출되면 그대로 열람될 수 있으니까요. 그래서 서버에서 파일을 업로드하는 순간 AWS KMS와 AES-GCM으로 이중 보호하는 파이프라인을 직접 구축했습니다.

## 핵심 아이디어 요약
- 업로드 직전에 KMS에서 AES-256 데이터 키를 발급받고, Node의 Web Crypto API로 파일을 AES-GCM으로 감쌉니다.
- 암호화된 바이트만 객체 스토리지에 올리고, 데이터 키와 IV는 별도의 키 테이블에 분리 보관합니다.
- 업로드·다운로드 API를 통해 인증된 사용자만 암복호화 경로를 통과하도록 만들었습니다.

## 준비와 선택
1. **키 관리**: 파일·계좌·HMAC 등 민감도에 따라 서로 다른 KMS 키를 사용하도록 클라이언트 팩토리를 분리했습니다.
2. **암호화 알고리즘**: 브라우저와 Node 모두 지원하는 AES-GCM을 채택해 무결성과 기밀성을 동시에 확보했습니다.
3. **스토리지 접근**: 서명된 업로드 URL을 활용해 PUT 방식만 허용하고, 실패 시 업로드된 객체를 즉시 삭제하는 롤백을 추가했습니다.

## 구현 여정
### Step 1: 데이터 키 생성과 파일 암호화
업로드 요청이 들어오면 먼저 KMS에서 AES-256 데이터 키를 발급받습니다. 평문 키는 즉시 웹 크립토 API로 파일 암호화에 사용하고, 암호화된 키(Base64)는 키 테이블에 보관합니다.

```ts
import { generateDataKey } from './kms';
import { aesGcmEncrypt } from './crypto';

interface EncryptedPayload {
  encrypted: ArrayBuffer;
  iv: Uint8Array;
  encryptedKey: string;
}

export async function encryptFileBeforeUpload(file: File): Promise<EncryptedPayload> {
  // 1. KMS에서 파일 전용 데이터 키를 발급받습니다.
  const { plaintextKey, encryptedKey } = await generateDataKey('file');

  // 2. 업로드할 파일을 ArrayBuffer로 읽습니다.
  const fileBuffer = await file.arrayBuffer();

  // 3. AES-GCM으로 암호화하고 IV를 함께 반환합니다.
  const { encrypted, iv } = await aesGcmEncrypt(
    fileBuffer,
    validateAndConvertKey(plaintextKey),
  );

  return { encrypted, iv, encryptedKey };
}
```

### Step 2: 서명 URL 업로드와 메타 저장
암호문은 Blob으로 감싸 서명된 URL에 PUT 요청으로 업로드합니다. 성공하면 키 테이블에 경로, 암호화된 키, IV를 저장합니다. 저장 중 문제가 생기면 이미 업로드한 객체를 제거해 키와 파일이 분리되지 않도록 했습니다.

### Step 3: 다운로드 시 복호화 흐름
다운로드 요청이 올 때는 암호화된 키를 KMS에서 다시 복호화하고, 저장된 IV를 이용해 AES-GCM으로 원본 파일을 복원합니다. 복원된 ArrayBuffer는 MIME 타입을 판별한 뒤 인라인 미리보기 또는 첨부 다운로드 형태로 응답했습니다.

### Step 4: API 게이트와 버킷 화이트리스트
업로드 API는 허용된 버킷만 화이트리스트로 통과시키고, 인증되지 않은 요청은 즉시 차단합니다. 이렇게 하면 스토리지 보안 규칙을 과도하게 복잡하게 만들지 않아도 됩니다.

## 겪은 이슈와 해결 과정
- **KMS 속도 병목**: 대용량 파일을 연속으로 올리면 KMS 호출이 발목을 잡았습니다. `generateDataKey`가 Plaintext와 Ciphertext를 모두 돌려주니 별도 캐시는 쓰지 않았지만, 재시도 간 1초씩 지연을 둬 AWS 제한을 피했습니다.
- **IV 저장 방식**: 처음엔 IV를 문자열로 저장했다가 디코딩에서 깨졌습니다. 지금은 `arrayBufferToBase64`로 안전하게 변환하고, 다운로드 시 정확히 역변환해 씁니다.
- **파일명 충돌**: 사용자가 같은 파일을 여러 번 올리면 마지막 업로드가 덮어쓰이는 문제가 있었습니다. 그래서 `generateSecureFileName`에서 타임스탬프와 UUID를 섞은 이름을 만들어 버렸습니다.

## 결과와 회고
이제 Storage 브라우저로 들어가도 암호문만 보여서 마음이 한결 편해졌습니다. KMS 키를 잃어버리지 않는 이상 평문 유출 가능성이 사라졌고, Supabase RLS도 간결하게 유지할 수 있었습니다. 다음에는 비동기로 돌아가는 `deleteEncryptedFile` 경로에 감사 로그를 붙여서 누가 언제 삭제했는지도 추적해볼 생각입니다.

여러분은 서버 사이드 암호화를 어떻게 구현하고 계신가요? 비슷한 고민이 있다면 댓글로 경험을 공유해 주세요. 저는 특히 KMS 호출 비용을 더 줄이는 방법이 궁금합니다.

# Reference
- https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html
- https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt
- https://supabase.com/docs/guides/storage

# 연결문서
- [[Fluid Pipeline으로 OCR과 AI 검증을 한 번에 묶어낸 기록]]
- [[Winston과 CloudWatch로 구조화 로깅 파이프라인 다듬기]]
- [[갤럭시 기기까지 고려한 Supabase 첨부파일 업로드 안정화기]]
