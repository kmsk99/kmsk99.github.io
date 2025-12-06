---
tags:
  - Engineering
  - IssueNote
  - ReactNative
  - Android
  - Frontend
  - Mobile
title: React Native에서 Android SHA-1 인증서 추출 방법
created: 2023-03-20 11:11
modified: 2023-03-20 11:18
uploaded: "true"
---

# Intro

항상 사용하지만 문서화되어있지 않아, 인터넷을 찾아봐서 이번 기회에 문서화한다.

# 추출 방법

1. react native 루트 폴더에서 아래 명령을 실행한다.
```
cd android && ./gradlew signingReport
```

2. 출력된 가장 위쪽의 Task :app:signingReport를 찾는다.
3. 종류는 debug, release 등이 있는데, 상황에 맞춰 사용한다.
4. 특히 debug만 넣어놓고 release 시에 작동 안하는 오류를 범하지 말자

# Reference

### [ReactNative - android SHA-1 인증서 확인하기 (tistory.com)](https://right-hot.tistory.com/entry/ReactNative-android-SHA1-%EC%9D%B8%EC%A6%9D%EC%84%9C-%ED%99%95%EC%9D%B8%ED%95%98%EA%B8%B0)

# 연결문서
- [[ActionSheet를 안전하게 감싸는 훅을 만든 이유]]
- [[React Native .ipa로 추출하기]]
- [[React Native Map 실제 기기에서 실행 시 로고만 뜨고 지도가 안뜰때 대처방법]]
