---
tags:
  - AWS
  - KMS
  - AES-GCM
  - Supabase
  - Encryption
  - Security
title: 파일 암호화 파이프라인 구현
created: '2025-06-04'
modified: '2025-09-05'
---

내부 자료를 Supabase Storage에 보관할 때 평문으로 남아 있을 가능성이 신경 쓰였다. 권한 관리가 탄탄해도 스토리지 키가 유출되면 그대로 열람될 수 있으니, 프로젝트에서 AWS KMS와 AES-GCM으로 업로드부터 다운로드·삭제까지 이중 보호하는 파이프라인을 구축했다.

## 전체 아키텍처

- 업로드: KMS에서 AES-256 데이터 키 발급 → AES-GCM으로 파일 암호화 → 서명된 URL로 Storage 업로드 → 암호화된 키·IV를 `secure_file_keys` 테이블에 분리 저장
- 다운로드: Storage에서 암호문 다운로드 → DB에서 키·IV 조회 → KMS로 키 복호화 → AES-GCM으로 원본 복원 → MIME 타입에 따라 인라인 미리보기 또는 첨부 다운로드
- 삭제: Storage 파일 삭제 → `secure_file_keys` 레코드 삭제

파일·계좌·HMAC 등 민감도에 따라 서로 다른 KMS 키를 쓰도록 클라이언트를 분리했고, 브라우저와 Node 모두 지원하는 AES-GCM으로 무결성과 기밀성을 확보했다.

---

## 핵심 라이브러리

### kms.ts — AWS KMS 연동

`generateDataKey(type)`로 AES-256 데이터 키를 발급받고, `decryptDataKey(type, encryptedKey)`로 암호화된 키를 복호화한다. `getDecryptedBytes(bucketName, filePath)`는 Storage에서 파일을 받아 복호화한 뒤 바이트를 반환한다. OCR 등 서버 자동화용으로 Admin 클라이언트를 사용한다.

```ts
function getKMSClientFor(type: 'file' | 'bank' | 'hmac') {
  const config = {
    region: 'ap-northeast-2',
    credentials: {
      accessKeyId: process.env[`AWS_${type.toUpperCase()}_ACCESS_KEY_ID`]!,
      secretAccessKey:
        process.env[`AWS_${type.toUpperCase()}_SECRET_ACCESS_KEY`]!,
    },
  };
  return new KMSClient(config);
}

export async function generateDataKey(type: 'file' | 'bank' | 'hmac') {
  const kms = getKMSClientFor(type);

  const response = await kms.send(
    new GenerateDataKeyCommand({
      KeyId: process.env[`KMS_${type.toUpperCase()}_KEY_ID`],
      KeySpec: 'AES_256',
    }),
  );

  if (!response.Plaintext || !response.CiphertextBlob) {
    throw new Error('KMS 데이터 키 생성 실패');
  }

  return {
    plaintextKey: response.Plaintext,
    encryptedKey: arrayBufferToBase64(response.CiphertextBlob),
    plaintextKeyBase64: arrayBufferToBase64(response.Plaintext),
  };
}

export async function decryptDataKey(
  type: 'file' | 'bank' | 'hmac',
  encryptedKey: Uint8Array | string,
) {
  const kms = getKMSClientFor(type);
  const binaryEncryptedKey =
    typeof encryptedKey === 'string'
      ? base64ToArrayBuffer(encryptedKey)
      : encryptedKey;

  const response = await kms.send(
    new DecryptCommand({
      CiphertextBlob: binaryEncryptedKey,
      KeyId: process.env[`KMS_${type.toUpperCase()}_KEY_ID`],
    }),
  );

  if (!response.Plaintext) {
    throw new Error('KMS 데이터 키 복호화 실패');
  }
  return response.Plaintext;
}
```

환경 변수는 `KMS_FILE_KEY_ID`, `KMS_BANK_KEY_ID`, `KMS_HMAC_KEY_ID`와 각 타입별 `AWS_*_ACCESS_KEY_ID`, `AWS_*_SECRET_ACCESS_KEY`를 사용한다.

### crypto.ts — AES-GCM 암복호화

Web Crypto API로 AES-GCM 암호화·복호화를 수행한다. IV는 12바이트 랜덤으로 생성하고, `computeFileHash`로 SHA-256 해시를 구해 중복 검사에 쓴다.

```ts
export async function aesGcmEncrypt(data: ArrayBuffer, key: ArrayBuffer) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    data,
  );
  return { encrypted, iv };
}

export async function aesGcmDecrypt(
  data: ArrayBuffer,
  key: ArrayBuffer,
  iv: Uint8Array,
) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );
  const ivForDecrypt = new Uint8Array(iv);
  return await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivForDecrypt },
    cryptoKey,
    data,
  );
}

export async function computeFileHash(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
```

---

## 업로드 플로우

### secure-file.server.ts — encryptUploadFile

1. 파일 검증(크기 0, 최대 500MB)
2. `generateDataKey('file')`로 데이터 키 발급
3. `aesGcmEncrypt`로 파일 암호화
4. `createSignedUploadUrl`로 서명된 URL 생성
5. 암호문을 Blob으로 만들어 PUT 업로드
6. `secure_file_keys`에 `encrypted_key`, `iv`, `path`, `user_id` 저장
7. DB 저장 실패 시 Storage에서 해당 파일 삭제(롤백)

```ts
export const encryptUploadFile = async (
  file: File,
  userId: string,
  bucketName: string,
  maxRetries: number = 3,
): Promise<ProcessResult> => {
  const validation = validateFileForEncryption(file);
  if (!validation.isValid) {
    return { success: false, error: validation.error };
  }

  const fileName = generateSecureFileName(file.name);
  const path = `${userId}/${fileName}`;

  const { plaintextKey, encryptedKey } = await generateDataKey('file');
  const keyArrayBuffer = validateAndConvertKey(plaintextKey);

  const arrayBuffer = await file.arrayBuffer();
  const { encrypted, iv } = await aesGcmEncrypt(arrayBuffer, keyArrayBuffer);
  const ivBase64 = arrayBufferToBase64(iv);

  const signedData = await getSecureSignedUploadUrl(bucketName, path);
  if (!signedData) throw new Error('Signed URL 생성 실패');

  const encryptedBlob = new Blob([encrypted], {
    type: 'application/octet-stream',
  });
  const uploadSuccess = await uploadEncryptedFileWithSignedUrl(
    encryptedBlob,
    signedData.signedUrl,
  );

  if (!uploadSuccess) throw new Error('암호화된 파일 업로드 실패');

  const supabase = await createClient();
  const { error: keyError } = await supabase
    .from('secure_file_keys')
    .insert({
      user_id: userId,
      path,
      encrypted_key: encryptedKey,
      iv: ivBase64,
    });

  if (keyError) {
    await supabase.storage.from(bucketName).remove([path]);
    throw new Error(`암호화 키 저장 실패: ${keyError.message}`);
  }

  return { path, fileName, success: true };
};
```

`generateSecureFileName`은 타임스탬프와 UUID를 섞어 같은 파일명이 여러 번 올라와도 덮어쓰기를 막는다.

### API 라우트 — /api/encrypt-upload

FormData로 `file`, `bucketPrefix`를 받고, 화이트리스트에 있는 버킷만 허용한다.

```ts
export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get('file') as File;
  const bucketName = formData.get('bucketPrefix') as string;

  const allowedBuckets = [
    SECURED_ATTACHMENT_FILE_BUCKET,
    SECURED_ATTACHMENT_IMAGE_BUCKET,
  ];
  if (!allowedBuckets.includes(bucketName)) {
    return NextResponse.json({ error: '허용되지 않은 버킷입니다.' }, { status: 400 });
  }

  const supabase = await createClient();
  const user = await supabase.auth.getUser();
  if (!user.data.user?.id) {
    return NextResponse.json(
      { error: '인증된 사용자만 파일을 업로드할 수 있습니다.' },
      { status: 401 },
    );
  }

  const result = await encryptUploadFile(file, user.data.user.id, bucketName);
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    path: result.path,
    fileName: result.fileName,
  });
}
```

---

## 다운로드 플로우

### secure-file.server.ts — downloadDecryptFile

1. Storage에서 암호문 다운로드
2. `secure_file_keys`에서 `encrypted_key`, `iv` 조회
3. `decryptDataKey('file', encrypted_key)`로 평문 키 복원
4. `aesGcmDecrypt`로 원본 복호화
5. 파일명과 함께 `decryptedData` 반환

```ts
export const downloadDecryptFile = async (
  path: string,
  bucketName: string,
): Promise<DownloadResult> => {
  const supabase = await createClient();

  const { data: fileData, error: fileError } = await supabase.storage
    .from(bucketName)
    .download(path);

  if (fileError || !fileData) {
    return { error: '파일을 찾을 수 없습니다.', data: null };
  }

  const { data: keyInfo, error: keyError } = await supabase
    .from('secure_file_keys')
    .select('encrypted_key, iv')
    .eq('path', path)
    .single();

  if (keyError || !keyInfo) {
    return { error: '암호화 키를 찾을 수 없습니다.', data: null };
  }

  const decryptedKey = await decryptDataKey('file', keyInfo.encrypted_key);
  const keyArrayBuffer = validateAndConvertKey(decryptedKey);
  const ivArray = base64ToArrayBuffer(keyInfo.iv);

  const fileArrayBuffer = await fileData.arrayBuffer();
  const decryptedData = await aesGcmDecrypt(
    fileArrayBuffer,
    keyArrayBuffer,
    ivArray,
  );

  const fileName = path.split('/').pop() || 'decrypted_file';

  return {
    data: { decryptedData, fileName },
    error: null,
  };
};
```

### API 라우트 — /api/decrypt-download

POST는 JSON body로, GET은 쿼리스트링으로 `path`, `bucket`을 받는다. `name` 파라미터로 파일명을 덮어쓸 수 있다. 확장자로 MIME 타입을 추정하고, 이미지는 인라인 미리보기, 그 외는 `Content-Disposition: attachment`로 설정한다. 한글 파일명은 RFC 5987 형식으로 인코딩한다.

```ts
function getMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', pdf: 'application/pdf', /* ... */
  };
  return ext && mimeTypes[ext] ? mimeTypes[ext] : 'application/octet-stream';
}

// POST
const result = await downloadDecryptFile(path, bucketName);
const mimeType = getMimeType(result.data.fileName || 'decrypted.bin');
const isImage = mimeType.startsWith('image/');

const blob = new Blob([new Uint8Array(result.data.decryptedData)], {
  type: mimeType,
});

const headers: HeadersInit = { 'Content-Type': mimeType };
if (!isImage) {
  headers['Content-Disposition'] =
    `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`;
}
return new Response(blob, { headers });
```

---

## 삭제 플로우

### secure-file.server.ts — deleteEncryptedFile

Storage에서 파일을 먼저 삭제하고, `secure_file_keys`에서 해당 경로 레코드를 삭제한다.

```ts
export const deleteEncryptedFile = async (
  path: string,
  bucketName: string,
): Promise<{ success: boolean; error?: string }> => {
  const supabase = await createClient();

  const { error: storageError } = await supabase.storage
    .from(bucketName)
    .remove([path]);

  if (storageError) {
    return {
      success: false,
      error: `파일 삭제 실패: ${storageError.message}`,
    };
  }

  const { error: dbError } = await supabase
    .from('secure_file_keys')
    .delete()
    .eq('path', path);

  if (dbError) {
    return { success: false, error: `키 정보 삭제 실패: ${dbError.message}` };
  }

  return { success: true };
};
```

### API 라우트 — /api/delete-encrypted-file

POST로 `path`, `bucketName`을 받아 인증 후 `deleteEncryptedFile`을 호출한다.

---

## 데이터베이스

`secure_file_keys` 테이블 구조:

| 컬럼         | 타입      | 설명                    |
|--------------|-----------|-------------------------|
| id           | uuid      | PK                      |
| user_id      | uuid      | FK → auth.users         |
| path         | text      | Storage 경로 (unique)   |
| encrypted_key| text      | Base64 인코딩된 암호키  |
| iv           | text      | Base64 인코딩된 IV      |
| created_at   | timestamptz | 생성 시각            |

```sql
create table if not exists public.secure_file_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  path text not null unique,
  encrypted_key text not null,
  iv text not null,
  created_at timestamptz default now()
);
```

RLS로 사용자별 접근을 제한한다.

---

## 서비스 레이어 — secured-attachment.service.ts

첨부파일 도메인과 암호화 파이프라인을 연결한다.

- insertSecuredAttachment: `encrypt-upload` API 호출 → `secured_attachment` 테이블에 메타데이터 저장. DB 저장 실패 시 `delete-encrypted-file`로 롤백 처리
- deleteSecuredAttachment: `delete-encrypted-file`로 Storage·키 삭제 후 `secured_attachment` 레코드 삭제
- addSignedUrlToAttachments: `decryptedUrl`을 `/api/decrypt-download?path=...&name=...&bucket=...` 형태로 붙여서 미리보기·다운로드에 사용

```ts
const addSignedUrlToAttachments = async (
  attachments: Tables<'secured_attachment'>[],
): Promise<SecuredAttachmentWithUrl[]> => {
  const result: SecuredAttachmentWithUrl[] = [];

  for (const attachment of attachments) {
    const decryptedUrl = `/api/decrypt-download?path=${encodeURIComponent(
      attachment.file_path,
    )}&name=${encodeURIComponent(
      attachment.name || 'file',
    )}&bucket=${encodeURIComponent(attachment.bucket_name)}`;

    result.push({
      ...attachment,
      decryptedUrl,
    });
  }
  return result;
};
```

---

## 겪은 이슈와 해결

- KMS 속도: 대용량 파일 연속 업로드 시 KMS 호출이 병목이 됐다. 재시도 간 1초 지연을 두어 AWS 제한을 피했다.
- IV 저장: 처음엔 IV를 문자열로 저장했다가 디코딩에서 깨졌다. `arrayBufferToBase64`로 안전하게 변환하고, 다운로드 시 `base64ToArrayBuffer`로 역변환하는 방식으로 수정했다.
- 파일명 충돌: 같은 파일을 여러 번 올리면 마지막 업로드가 덮어쓰는 문제가 있었다. `generateSecureFileName`에서 타임스탬프와 UUID를 섞어 고유 파일명을 만들었다.
- 이미지 미리보기: 이미지도 무조건 다운로드되던 문제였다. MIME이 `image/`로 시작하면 `Content-Disposition`을 생략해 인라인으로 보여주도록 했다.
- 한글 파일명: `filename*` 포맷으로 인코딩해 브라우저에서 깨지지 않게 했다.

---

## 결과

Storage 브라우저에서 봐도 암호문만 보여서 안심이 됐다. KMS 키를 잃지 않는 한 평문 유출 가능성이 사라졌고, Supabase RLS도 간결하게 유지할 수 있었다. 사용자는 암호화된 파일을 자연스럽게 내려받을 수 있고, 이미지 미리보기까지 지원한다. 스토리지와 키가 분리되어 있어 안전하면서도 UX를 해치지 않게 됐다.

---

# Reference

- https://docs.aws.amazon.com/kms/
- https://nodejs.org/api/crypto.html
- https://supabase.com/docs/guides/storage

# 연결문서

- [갤럭시 기기 Supabase 파일 업로드 안정화](/post/gaelleoksi-gigi-supabase-pail-eomnodeu-anjeonghwa)
- [useProfileWithRetry - 네트워크 불안정 대응 훅](/post/useprofilewithretry-neteuwokeu-buranjeong-daeeung-huk)
- [Nestjs + Prisma 백엔드에서 고객정보 양방향 암호화하기](/post/nestjs-prisma-baegendeueseo-gogaekjeongbo-yangbanghyang-amhohwahagi)
