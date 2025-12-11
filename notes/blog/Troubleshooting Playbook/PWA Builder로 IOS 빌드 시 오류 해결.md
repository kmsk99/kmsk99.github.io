---
tags:
  - Engineering
  - IssueNote
  - Firebase
  - iOS
  - Backend
  - Mobile
title: IOS 빌드 시 오류 해결
created: 2024-06-18 02:28
modified: 2024-06-19 01:56
uploaded: "false"
---

# Intro

PWA Builder 로 우리 서비스의 IOS 배포 버전을 만들어보았습니다. 하지만 배포를 할 때, 여러 버그가 있었고 이를 해결하기 위한 방법들을 다음에라도 다시 겪지 않도록 문서를 만듭니다.

## 빌드 시작!

맨 처음에 만나는 오류는 다음과 같습니다.

```
No such module 'FirebaseCore'
```

일단 루트 폴더에서 XXX.xcworkspace, Podfile.lock, Pods 폴더를 지운 후, Podfile 내부에서 불러와주는 pod 들을 수정합니다.

```bash
  # Comment the next line if you don't want to use dynamic frameworks
  use_frameworks!
  # pod 'GoogleUtilities', :modular_headers => true

  pod 'FirebaseCore'

  pod 'FirebaseAnalytics'

  # Add the pod for Firebase Cloud Messaging
  pod 'FirebaseMessaging'
```

pod 를 작성할 때, Firebase/Messaging 과 같이 /가 들어간다면 outdated 된 것이니, 필수로 고쳐줍니다.

그리고 Xcode 의 target 에서 아래와 같이 현재 사용하는 Firebase 라이브러리를 추가해줍니다.

만일 라이브러리를 추가하지 못한다면, project 의 package Dependencies 에 firebase 를 먼저 추가한 후, 추가해줍니다.

![[874b7409352f1b809a2d27535af4eb64_MD5.png]]

중간에 아래와 같은 오류도 나는데, 정확한 해결 방법은 찾지 못하였고, 하다보니? 해결되었습니다.

```
Redefined firebase
```

## Ios 코드 정리

AppDelegate 내에서
```
// TODO: if we're using Firebase, uncomment next string
        FirebaseApp.configure()
```

이러한 방식으로 주석처리된 코드들을 주석을 해제하여 활성화해줍니다.
각자 상황에 맞춰서 주석을 해제해줍니다.

중간에 여러 다른 오류들도 나는데,

Excluded Architectures 에서 arm64 삭제
User Script Sandboxing No 로 설정

등을 통해 해결할 수 있었습니다.

이외에도 빌드 시 도움을 받았던 블로그들입니다.

# Reference

- https://uniqueimaginate.tistory.com/31
- https://es1015.tistory.com/440
- https://tngusmiso.tistory.com/67
- https://sy-catbutler.tistory.com/35

# 연결문서
- [[Firebase Admin SDK로 상태 기반 푸시 알림을 다듬은 후기]]
- [[Firebase에서 검색 기능 구현하기]]
- [[React Native .ipa로 추출하기]]
