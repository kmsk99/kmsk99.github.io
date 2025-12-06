---
tags:
  - Engineering
  - IssueNote
  - ReactNative
  - Frontend
  - Mobile
title: React Native Map 실제 기기에서 실행 시 로고만 뜨고 지도가 안뜰때 대처방법
created: 2023-03-20 11:19
modified: 2023-03-20 11:24
uploaded: "true"
---

# Intro

React Native Map을 사용하는데 google map이 뜨지 않는다.
구글 로고만 뜨는 것이 아무래도 앱 자체 오류는 아닌 것 같다.

여러 방법을 찾아 적용해보았지만, 도무지 방법을 못찾았는데 사실 아주 간단한 문제였다.

구글 API 키에 안드로이드 제한을 걸어놓았었는데, 이때 입력한 SHA-1이 문제였다.

# 해결 방법

SHA-1을 입력할 때, 기존에 Variant: debug만을 입력해놓아서 release에서 작동하지 않았다. Variant: release의 SHA-1도 입력한 후 앱을 실행한다.

# Reference

# 연결문서
- [[React Native .ipa로 추출하기]]
- [[React Native에서 Android SHA-1 인증서 추출 방법]]
- [[ActionSheet를 안전하게 감싸는 훅을 만든 이유]]
