---
tags:
  - Engineering
  - IssueNote
  - iOS
  - ReactNative
  - Frontend
  - Mobile
aliases: null
tag: null
my_rate: null
created: '2023-03-20 01:16'
modified: '2024-01-17 03:26'
title: React Native .ipa로 추출하기
---

### 1. project root 에서 아래 코드로 iOS 를 번들링한다.

```text
react-native bundle --entry-file index.js --platform ios --dev false --bundle-output ios/main.jsbundle --assets-dest ios
```

방법 2

```text
react-native bundle --entry-file index.js --platform ios --dev false --bundle-output ios/main.jsbundle --assets-dest ios
react-native bundle --entry-file index.js --platform ios --dev false --bundle-output ios/main.jsbundle --assets-dest ios

react-native bundle --dev false --entry-file index.ios.js --bundle-output ios/main.jsbundle --platform ios
react-native bundle --dev false --entry-file index.js --bundle-output ios/main.jsbundle --platform ios
```

### 2. Xcode 로 돌아와 Device 를 Generic iOS device 로 바꾼다.

### 3. Product > Scheme > Edit Scheme…에서 Run > info > Build Configuration 을 Debug > Release 로 바꾼다.

### 3. Product > Build

###4. ~/Libaray/Developer/Xcode/DerivedData/{프로젝트명의 폴더}/Build/Products/Release-iphoneos/프로젝트명.app

Library 는 숨겨져있는 폴더다. 숨겨진 폴더는 맥에서 shift + command + . 으로 보이게 할 수 있다.  
프로젝트명.app 를 이제 .ipa 로 바꾸어야 한다. 이어서 진행해보자.

### 5. Payload 폴더를 만든다.

### 6. 폴더 안에 프로젝트명.app 을 넣고, 압축파일로 만든다.

### 7. Payload.zip 파일이 만들어 졌다. 그 파일명을 Payload.ipa 로 바꾸면 .ipa 추출 완료…!

# Reference

# 연결문서
- [[ActionSheet를 안전하게 감싸는 훅을 만든 이유]]
- [[React Native Map 실제 기기에서 실행 시 로고만 뜨고 지도가 안뜰때 대처방법]]
- [[React Native에서 Android SHA-1 인증서 추출 방법]]
