---
tags:
  - iOS
  - PrivacyManifest
  - Expo
  - ReactNative
  - AppStore
title: iOS Privacy Manifest와 앱 스토어 규정 대응
created: 2025-09-02
modified: 2025-09-02
---

# 배경

2024년부터 Apple은 앱에서 사용하는 Required Reason API를 `PrivacyInfo.xcprivacy` 파일에 선언하도록 요구한다. 이를 누락하면 앱 심사에서 리젝된다. React Native(Expo) 앱에서 이 요구사항을 어떻게 처리했는지 정리한다.

# PrivacyInfo.xcprivacy

iOS 프로젝트의 `ios/app/` 디렉토리에 plist 형식의 Privacy Manifest 파일을 작성한다.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSPrivacyAccessedAPITypes</key>
  <array>
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategoryFileTimestamp</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array>
        <string>C617.1</string>
        <string>0A2A.1</string>
        <string>3B52.1</string>
      </array>
    </dict>
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategoryUserDefaults</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array>
        <string>CA92.1</string>
        <string>1C8F.1</string>
        <string>C56D.1</string>
      </array>
    </dict>
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategorySystemBootTime</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array>
        <string>35F9.1</string>
      </array>
    </dict>
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategoryDiskSpace</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array>
        <string>E174.1</string>
        <string>85F4.1</string>
      </array>
    </dict>
  </array>
  <key>NSPrivacyCollectedDataTypes</key>
  <array/>
  <key>NSPrivacyTracking</key>
  <false/>
</dict>
</plist>
```

각 API 카테고리와 사용 이유 코드의 의미:

### FileTimestamp (파일 타임스탬프)
- `C617.1`: 파일 타임스탬프로 DRM이나 라이선스 관리에서 사용
- `0A2A.1`: 앱 자체 파일의 생성/수정 시간 접근
- `3B52.1`: 파일 시스템의 파일 수정 날짜를 사용

React Native와 Expo가 번들 파일, 캐시, OTA 업데이트 등의 파일 작업에서 타임스탬프를 참조한다.

### UserDefaults
- `CA92.1`: 앱 자체의 UserDefaults 데이터 접근
- `1C8F.1`: 동일 앱 그룹 내 앱 간 데이터 공유
- `C56D.1`: 서드파티 SDK의 UserDefaults 접근

React Native의 `AsyncStorage`, Expo의 `SecureStore`, Supabase의 세션 저장 등이 내부적으로 UserDefaults를 사용한다.

### SystemBootTime (시스템 부팅 시간)
- `35F9.1`: 앱의 기능 시간 측정에 사용

`react-native-reanimated`, 성능 모니터링 등에서 부팅 시간을 참조한다.

### DiskSpace (디스크 공간)
- `E174.1`: 파일 다운로드 전 디스크 공간 확인
- `85F4.1`: 앱의 스토리지 관리 기능

이미지 캐싱, OTA 업데이트 다운로드 시 여유 공간을 확인한다.

# Expo app.config.js 설정

Expo 프로젝트에서는 `app.config.js`에서 권한 관련 설정을 관리한다.

```js
module.exports = {
  ios: {
    bundleIdentifier: 'com.example.app',
    infoPlist: {
      NSLocationWhenInUseUsageDescription: '위치 기반 혜택 정보를 제공하기 위해 사용됩니다',
      NSLocationTemporaryUsageDescriptionDictionary: {
        'benefit-location': '가까운 혜택 정보를 보여드리기 위해 현재 위치가 필요합니다',
      },
      NSCameraUsageDescription: '프로필 사진 및 인증 서류 촬영에 사용됩니다',
      NSPhotoLibraryUsageDescription: '프로필 사진 및 인증 서류 업로드에 사용됩니다',
      NSMicrophoneUsageDescription: '동영상 촬영 시 오디오 녹음에 사용됩니다',
      ITSAppUsesNonExemptEncryption: false,
      LSApplicationQueriesSchemes: [
        'supertoss', 'tosspayments', 'kb-acp', 'liivbank',
        'nhappcardansimclick', 'lottesmartpay', 'lotteappcard',
      ],
    },
  },
  android: {
    permissions: [
      'ACCESS_FINE_LOCATION',
      'ACCESS_COARSE_LOCATION',
      'CAMERA',
      'READ_MEDIA_IMAGES',
      'READ_MEDIA_VIDEO',
      'RECORD_AUDIO',
    ],
  },
  plugins: [
    ['expo-location', {
      locationAlwaysAndWhenInUsePermission: '위치 기반 혜택 정보를 제공하기 위해 사용됩니다',
      isIosBackgroundLocationEnabled: false,
      isAndroidBackgroundLocationEnabled: false,
    }],
  ],
};
```

주요 설정:

- `ITSAppUsesNonExemptEncryption: false`: HTTPS만 사용하고 자체 암호화를 하지 않으면 수출 규정 대상이 아님을 선언. 이걸 누락하면 앱을 제출할 때마다 수출 규정 질문이 뜬다.
- `LSApplicationQueriesSchemes`: 결제 SDK가 다른 앱(토스, 카카오뱅크 등)을 열 때 필요한 URL 스킴. iOS 9부터 `canOpenURL` 호출 시 이 목록에 없는 스킴은 `false`를 반환한다.
- `locationAlwaysAndWhenInUsePermission`: Expo Location 플러그인이 빌드 시 `Info.plist`에 자동 삽입한다. 백그라운드 위치 추적은 불필요하므로 비활성화했다.

# Android 딥링크

Android에서 앱 링크를 통해 웹에서 앱으로 전환하려면 `assetlinks.json`을 웹 서버에 배치해야 한다.

```json
[{
  "relation": [
    "delegate_permission/common.handle_all_urls",
    "delegate_permission/common.get_login_creds"
  ],
  "target": {
    "namespace": "android_app",
    "package_name": "com.example.app",
    "sha256_cert_fingerprints": ["D6:52:EC:76:..."]
  }
}]
```

`public/.well-known/assetlinks.json`에 배치하면 Android가 이 파일을 확인하고 해당 도메인의 링크를 앱에서 직접 열 수 있다. `handle_all_urls`는 URL 처리 권한, `get_login_creds`는 자격 증명 공유 권한이다.

# 심사 대응 체크리스트

1. `PrivacyInfo.xcprivacy`에 앱과 SDK가 사용하는 모든 Required Reason API를 선언했는지 확인
2. 각 API 카테고리의 사용 이유 코드가 실제 사용 목적과 일치하는지 검증
3. `NSPrivacyCollectedDataTypes`에 수집하는 데이터 유형을 정직하게 기재 (서버로 전송하지 않으면 빈 배열)
4. `NSPrivacyTracking`을 정확히 설정 (ATT 팝업을 띄우지 않으면 `false`)
5. 서드파티 SDK(Firebase, Supabase 등)가 자체 Privacy Manifest를 포함하는지 확인
6. `ITSAppUsesNonExemptEncryption`을 `false`로 설정하거나, 암호화를 사용하면 수출 규정 문서 제출

# Reference

- https://developer.apple.com/documentation/bundleresources/privacy_manifest_files
- https://developer.apple.com/documentation/bundleresources/privacy_manifest_files/describing_use_of_required_reason_api
- https://docs.expo.dev/versions/latest/config/app/

# 연결문서

- [[Expo 푸시 알림과 OTA 업데이트 구현]]
- [[Firebase에서 Supabase로 기술 스택 전환]]
