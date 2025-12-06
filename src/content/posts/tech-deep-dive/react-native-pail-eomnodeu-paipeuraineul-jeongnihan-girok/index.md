---
tags:
  - Engineering
  - TechDeepDive
  - Supabase
  - Expo
  - ReactNative
  - Payment
  - CICD
  - DevOps
title: React Native 파일 업로드 파이프라인을 정리한 기록
created: '2024-11-27 13:00'
modified: '2024-11-27 13:00'
slug: react-native-pail-eomnodeu-paipeuraineul-jeongnihan-girok
---

# Intro
- Expo 프로젝트에서 이미지와 문서를 동시에 업로드해야 했는데, 플랫폼별 URI 스킴과 포맷 차이가 상당했습니다.
- 저는 ImagePicker와 DocumentPicker 자산을 하나의 `ReactNativeFile` 타입으로 통합하고, FormData/base64 변환을 지원했습니다.

## 핵심 아이디어 요약
- 이미지, 문서, 이미 업로드된 파일까지 모두 수용하는 `ReactNativeFile` 유니온 타입을 정의했습니다.
- 파일 이름/크기/타입을 추출하는 헬퍼를 만들어 FormData 전송과 메타데이터 저장을 동시에 처리했습니다.
- base64가 제공되지 않는 경우 `FileSystem.readAsStringAsync`와 fetch 폴백으로 안전하게 변환했습니다.

## 준비와 선택
- Supabase 스토리지를 사용하고 있어서 REST 업로드에 필요한 FormData 구조를 직접 만들어야 했습니다.
- Expo 환경이라 Node.js의 Buffer를 사용할 수 없어 `base64-arraybuffer`를 이용했습니다.
- DocumentPicker, ImagePicker가 서로 다른 필드명을 갖고 있어 타입 가드 로직을 명확히 작성했습니다.

## 구현 여정
1. **타입 정의**: ImagePickerAsset, DocumentPickerAsset, Supabase Attachment를 모두 포괄하는 타입을 선언했습니다.
2. **파일 메타 추출**: 각 타입별로 name, size, mimeType을 안전하게 가져오는 함수들을 만들었습니다.
3. **FormData 변환**: 새로 선택한 에셋만 FormData 객체로 변환하고, 이미 저장된 파일은 에러를 던지도록 했습니다.
4. **base64 변환**: ImagePicker에서 base64가 제공되면 그대로 쓰고, 없을 경우 FileSystem과 fetch로 폴백했습니다.
5. **에러 처리**: base64 변환 실패 시 에러를 로그에 남기고 상위에서 토스트로 안내할 수 있게 했습니다.

```ts
// src/shared/supabase/libs/index.ts:1-295
export type ReactNativeFile =
  | ImagePicker.ImagePickerAsset
  | DocumentPicker.DocumentPickerAsset
  | Tables<'attachment'>;

export const getFileNameFromReactNative = (file: ReactNativeFile): string => {
  if ('id' in file) return file.name || 'file';
  if ('fileName' in file && 'fileSize' in file)
    return file.fileName || `image_${Date.now()}.jpg`;
  if ('name' in file && 'size' in file)
    return file.name || `file_${Date.now()}`;
  return `file_${Date.now()}`;
};

export const getFileTypeFromReactNative = (file: ReactNativeFile): string => {
  if ('id' in file) return file.type || 'application/octet-stream';
  if ('fileName' in file && 'fileSize' in file)
    return file.mimeType || 'image/jpeg';
  if ('name' in file && 'size' in file)
    return file.mimeType || 'application/octet-stream';
  return 'application/octet-stream';
};

export const createFormDataCompatibleFile = (asset: ReactNativeFile) => {
  if ('id' in asset) {
    throw new Error('이미 저장된 파일은 FormData 호환 객체로 변환할 수 없습니다.');
  }
  return {
    uri: asset.uri,
    name: getFileNameFromReactNative(asset),
    type: getFileTypeFromReactNative(asset),
    size: getFileSizeFromReactNative(asset),
  };
};

export const readBase64FromReactNativeFile = async (
  asset: ReactNativeFile,
): Promise<{ base64: string; mimeType: string }> => {
  if ('id' in asset) throw new Error('이미 저장된 파일은 base64로 읽을 수 없습니다.');

  const mimeType = getFileTypeFromReactNative(asset);
  if ('fileName' in asset && 'fileSize' in asset) {
    const imageAsset = asset as ImagePicker.ImagePickerAsset & { base64?: string | null };
    if (imageAsset.base64 && imageAsset.base64.length > 0) {
      return { base64: imageAsset.base64, mimeType };
    }
  }

  try {
    const base64 = await FileSystem.readAsStringAsync(asset.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    if (base64 && base64.length > 0) {
      return { base64, mimeType };
    }
  } catch (_e) {
    // 무시 후 폴백
  }

  const res = await fetch(asset.uri);
  const buffer = await res.arrayBuffer();
  const base64 = base64Encode(buffer);
  return { base64, mimeType };
};
```

## 결과와 회고
- 이미지/문서 업로드 모두 동일한 업로드 파이프라인을 쓰게 되어 코드 중복이 크게 줄었습니다.
- base64 변환 실패 시 자동 폴백이 작동해 content:// URI에서도 안정적으로 업로드가 되었습니다.
- 앞으로는 업로드 큐를 만들어 여러 파일을 동시에 전송할 때도 순서를 보장할 계획입니다.
- 여러분은 React Native에서 파일 업로드를 어떻게 다루고 있나요? 다른 노하우가 있다면 공유해 주세요.

# Reference
- https://docs.expo.dev/versions/latest/sdk/document-picker/
- https://docs.expo.dev/versions/latest/sdk/filesystem/

# 연결문서
- [[React Native에서 로컬 리텐션 알림을 스케줄링하며 확인한 포인트]]
- [[공공기관 위치 데이터를 우리가 쓰는 방식으로 정제하기]]
- [[네이버 지도 SDK로 모바일 매장 지도를 설계한 과정]]
