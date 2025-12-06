---
created: '2022-05-03 09:45'
modified: '2022-05-03 09:50'
tags:
  - Engineering
  - IssueNote
title: PowerShell yarn 사용 불가 문제
---

# Intro

```
# yarn.ps1 cannot be loaded because running scripts is disabled on this system
```

위와같은 powershell에서 yarn이 실행 불가능한 문제와 마주쳤다. 이는 현재 유저의 실행 정책이 설정되지 않아 마주한 문제이다

powershell을 관리자 권한으로 실행 후, 아래의 코드를 입력한다

```sh
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy Unrestricted
```

# Reference
- https://stackoverflow.com/questions/41117421/ps1-cannot-be-loaded-because-running-scripts-is-disabled-on-this-system
- https://www.codegrepper.com/code-examples/typescript/yarn.ps1+cannot+be+loaded+because+running+scripts+is+disabled+on+this+system

# 연결문서
- [[Docker 사용시 Error connect ECONNREFUSED 오류]]
- [[Elastic Beanstalk Enviroment 끄기]]
- [[Elastic Beanstalk 메모리 스왑하기]]
