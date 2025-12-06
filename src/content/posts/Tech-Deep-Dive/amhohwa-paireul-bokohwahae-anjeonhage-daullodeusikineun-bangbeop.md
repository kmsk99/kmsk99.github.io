---
tags:
  - Engineering
  - TechDeepDive
  - Encryption
  - AWS
  - Supabase
  - UX
  - DevOps
  - Backend
title: 암호화 파일을 복호화해 안전하게 다운로드시키는 방법
created: '2025-10-09 14:06'
modified: '2025-10-09 14:06'
---

# Intro
저는 Supabase Storage에 저장된 암호화 파일을 직접 내려받으려다가, 브라우저가 알아보기 힘든 바이너리만 던져준다는 사실을 깨달았습니다. 그래서 서버에서 복호화한 뒤 사용자에게 적절한 헤더와 함께 전달하는 방식을 만들었습니다.

## 핵심 아이디어 요약
- 파일 경로와 버킷을 받아 Supabase Storage에서 암호문을 가져옵니다.
- AWS KMS로 암호화된 키를 복호화해 AES-GCM으로 원본 데이터를 되살립니다.
- MIME 타입과 파일명을 분석해 인라인 미리보기/다운로드 헤더를 다르게 설정합니다.

## 준비와 선택
1. **인증 확인**: Supabase 세션에서 사용자 ID를 가져와 인증된 사용자만 다운로드할 수 있도록 했습니다.
2. **MIME 추론**: 확장자를 기반으로 MIME을 추정하고, 모르면 `application/octet-stream`으로 처리했습니다.
3. **파일명 인코딩**: 한글 파일명을 `filename*` 포맷으로 인코딩해 브라우저가 깨지지 않도록 했습니다.

## 구현 여정
### Step 1: 복호화 데이터 가져오기
암호화된 키와 IV를 조회한 뒤, KMS에서 키를 복호화하고 AES-GCM으로 원본 데이터를 얻습니다.

```ts
import { decryptDataKey } from './kms';
import { aesGcmDecrypt, validateAndConvertKey, base64ToArrayBuffer } from './crypto';
import { storageClient, getKeyRecord, parseFileName } from './storage';

export const downloadEncryptedFile = async (path: string, bucket: string) => {
  const { encrypted_key, iv } = await getKeyRecord(path);
  const encryptedFile = await storageClient.from(bucket).download(path);

  const plaintextKey = await decryptDataKey('file', encrypted_key);
  const decrypted = await aesGcmDecrypt(
    encryptedFile.data,
    validateAndConvertKey(plaintextKey),
    base64ToArrayBuffer(iv),
  );

  return { decryptedData: decrypted, fileName: parseFileName(path) };
};
```

### Step 2: Response 생성
API 라우트에서는 ArrayBuffer를 `Blob`으로 감싼 후 `new Response`로 반환합니다. 이미지면 인라인으로 보여주고, 그 외에는 `Content-Disposition: attachment`를 설정합니다.

### Step 3: GET과 POST 지원
POST는 JSON body로, GET은 쿼리스트링으로 경로와 버킷을 받습니다. 이름을 지정하면 `name` 파라미터로 덮어씁니다.

## 겪은 이슈와 해결 과정
- **잘못된 IV**: 저장된 IV가 깨지면 복호화가 실패합니다. Base64 인코딩/디코딩을 꼼꼼히 검사해 문제를 해결했습니다.
- **이미지 미리보기**: 이미지 파일도 무조건 다운로드가 되길래, MIME이 `image/`로 시작하면 Content-Disposition을 생략했습니다.
- **권한 누락**: 버킷 이름을 전달하지 않으면 에러가 나길래, GET에서는 `bucket` 파라미터를 필수로 받도록 했습니다.

## 결과와 회고
지금은 사용자가 암호화된 파일을 자연스럽게 내려받을 수 있고, 이미지 미리보기까지 지원합니다. 스토리지와 키가 분리되어 있어 안전하면서도 UX를 해치지 않게 된 셈이죠. 다음에는 다운로드 로그를 남겨 누가 언제 어떤 파일을 열람했는지 추적해볼 계획입니다.

여러분은 암호화 파일을 어떻게 전달하고 계신가요? 더 나은 방법이 있다면 댓글로 공유해주세요.

# Reference
- https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html
- https://supabase.com/docs/guides/storage
- https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/decrypt

# 연결문서
- [[AWS KMS와 AES-GCM으로 서버 사이드 암호화 업로드 구축기]]
- [[네트워크 흔들릴 때도 프로필 세션을 지키는 useProfileWithRetry 만들기]]
- [[스탬프 누적과 리워드를 자동화한 워크플로우]]
