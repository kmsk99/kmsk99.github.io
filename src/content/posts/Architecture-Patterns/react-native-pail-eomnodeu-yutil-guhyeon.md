---
tags:
  - ReactNative
  - Expo
  - Supabase
  - Uploads
  - Mobile
  - Backend
title: React Native 파일 업로드 유틸 구현
created: '2025-11-27 13:00'
modified: '2025-11-27 13:00'
---

# Intro

Expo 프로젝트에서 이미지와 문서를 동시에 업로드해야 했는데, 플랫폼별 URI 스킴과 포맷 차이가 상당했다. ImagePicker와 DocumentPicker 자산을 하나의 `ReactNativeFile` 타입으로 통합하고, FormData/base64 변환을 지원했다.

# ReactNativeFile 타입 설계

이미지, 문서, 이미 업로드된 파일까지 모두 수용하는 `ReactNativeFile` 유니온 타입을 정의했다. 파일 이름/크기/타입을 추출하는 헬퍼를 만들어 FormData 전송과 메타데이터 저장을 동시에 처리했다. base64가 제공되지 않는 경우 `FileSystem.readAsStringAsync`와 fetch 폴백으로 안전하게 변환했다.

Supabase 스토리지를 사용하고 있어서 REST 업로드에 필요한 FormData 구조를 직접 만들어야 했다. Expo 환경이라 Node.js의 Buffer를 사용할 수 없어 `base64-arraybuffer`를 이용했다. DocumentPicker, ImagePicker가 서로 다른 필드명을 갖고 있어 타입 가드 로직을 명확히 작성했다.

# 구현 포인트

ImagePickerAsset, DocumentPickerAsset, Supabase Attachment를 모두 포괄하는 타입을 선언했다. 프로젝트의 `useSecuredFilePicker`는 ActionSheet로 앨범/문서 선택을 분기하고, `launchImageLibraryAsync`에 `base64: true`를 넣어 Supabase 업로드에 바로 쓸 수 있게 했다.

```tsx
const pickFromAlbum = async () => {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') {
    errorMessage('사진 라이브러리 접근 권한이 필요합니다.');
    return;
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: false,
    allowsMultipleSelection: true,
    quality: 1,
    selectionLimit: maxFiles,
    base64: true,  // Supabase 업로드용
    exif: false,
  });

  if (result.canceled) return;

  const maxSizeBytes = maxFileSizeMB * 1024 * 1024;
  for (const image of result.assets) {
    if (image.fileSize && image.fileSize > maxSizeBytes) {
      errorMessage(`최대 ${maxFileSizeMB}MB의 파일만 업로드할 수 있습니다.`);
      return;
    }
  }

  const normalizedImages = result.assets.map(image => ({
    ...image,
    name: image.fileName || image.uri.split('/').pop() || '이미지 파일',
  }));
  onFilesSelected(normalizedImages);
};
```

각 타입별로 name, size, mimeType을 안전하게 가져오는 함수들을 만들었다. 새로 선택한 에셋만 FormData 객체로 변환하고, 이미 저장된 파일은 에러를 던지도록 했다. ImagePicker에서 base64가 제공되면 그대로 쓰고, 없을 경우 FileSystem과 fetch로 폴백했다.

```ts
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

# 결과

이미지/문서 업로드 모두 동일한 업로드 파이프라인을 쓰게 되어 코드 중복이 크게 줄었다. base64 변환 실패 시 자동 폴백이 작동해 content:// URI에서도 안정적으로 업로드됐다. 앞으로는 업로드 큐를 만들어 여러 파일을 동시에 전송할 때도 순서를 보장할 계획이다.

# Reference
- https://docs.expo.dev/versions/latest/sdk/imagepicker/
- https://docs.expo.dev/versions/latest/sdk/document-picker/
- https://docs.expo.dev/versions/latest/sdk/filesystem/

# 연결문서
- [React Native 로컬 리텐션 알림 스케줄링](/post/react-native-rokeol-ritensyeon-allim-seukejulling)
- [공공데이터 위치 정보 전처리](/post/gonggongdeiteo-wichi-jeongbo-jeoncheori)
- [네이버 지도 SDK로 매장 지도 구현](/post/neibeo-jido-sdkro-maejang-jido-guhyeon)
