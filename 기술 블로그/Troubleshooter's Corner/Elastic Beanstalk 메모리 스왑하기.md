---
tags:
  - Engineering
  - IssueNote
  - AWS
  - ElasticBeanstalk
  - Caching
  - DevOps
title: Elastic Beanstalk 메모리 스왑하기
created: 2024-01-26 11:05
modified: 2024-01-26 01:42
uploaded: "false"
---

# Intro

현재 AWS 에서 elastic beanstalk 와 도커를 통해 서비스를 운영중이지만, 서버의 규모가 커지자, 메모리 부족 현상이 발생했다. 이에 따라 EC2 의 메모리를 증설하는 방법을 찾는 도중, 메모리 스왑이라는 것을 발견했다.

현재 t3.micro 를 사용중인데, 메모리가 1GB 이다. 메모리 스왑을 통해 가용 메모리를 늘려보려 한다.

# 적용 방법

기본적으로 ec2 에 적용하는 방법은 자세히 나와있지만, eb 에 적용하는 방법은 ec2 에 직접 적용하는 것 보다 간단하다.

.ebextensions 폴더에 다음과 같은 파일을 생성한다.

```
// 01_setup_swap.config

commands:
  01setup_swap:
    test: test ! -e /var/swapfile
    command: |
      /bin/dd if=/dev/zero of=/var/swapfile bs=128M count=16
      /bin/chmod 600 /var/swapfile
      /sbin/mkswap /var/swapfile
      /sbin/swapon /var/swapfile
```

이를 통해 eb 빌드 시, 자동으로 실행되며 메모리 스왑이 실행된다.

```
               total        used        free      shared  buff/cache   available
Mem:          926752      506880       70956       21520      348916      238576
Swap:        2097148       26624     2070524
```

shell 에서 free 명령어를 이용해 현재 메모리를 확인 가능하다.
이전에는 없던 2gb 의 swap 메모리가 생겨났다.

# Reference

- https://sundries-in-myidea.tistory.com/102
- https://stackoverflow.com/questions/62626724/how-do-i-configure-linux-swap-space-on-aws-elastic-beanstalk-running-aws-linux-2
- https://www.atomic14.com/2017/06/04/adding-swap-to-elastic-beanstalk.html

# 연결문서
- [[GitHub Actions와 Docker, Elastic Beanstalk로 통합 배포 자동화하기]]
- [[Elastic Beanstalk Enviroment 끄기]]
- [[EC2 초기 세팅 스크립트를 만들며 자동화에 집착한 이유]]
