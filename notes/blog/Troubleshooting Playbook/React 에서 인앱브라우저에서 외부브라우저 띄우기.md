---
tags:
  - React
  - InAppBrowser
  - DeepLink
  - WebView
  - Troubleshooting
title: 무제 파일
created: 2024-04-05 10:12
modified: 2024-04-05 10:18
---

# Intro

카카오톡의 인앱 브라우저에서는 파일 다운로드가 제대로 작동하지 않는다.

https://burndogfather.com/271

위 블로그에서는 script 를 활용해 간단히 외부브라우저를 띄우는 방법을 알려준다. 하지만 React 프로젝트에 바로 적용하기에는 script 뭉치가 영 낯설다.

# Solution

```js
  useEffect(() => {
    const copyToClipboard = async (val: string) => {
      await navigator.clipboard.writeText(val);
      alert(
        'URL주소가 복사되었습니다.\n\nSafari가 열리면 주소창을 길게 터치한 뒤, "붙여놓기 및 이동"를 누르면 정상적으로 이용하실 수 있습니다.'
      );
    };

    const redirectToExternalBrowser = () => {
      const targetUrl = window.location.href;
      copyToClipboard(targetUrl);

      if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        window.location.href = "x-web-search://?";
      } else {
        window.location.href = `intent://${targetUrl.replace(
          /https?:\/\//i,
          ""
        )}#Intent;scheme=http;package=com.android.chrome;end`;
      }
    };

    const userAgent = navigator.userAgent.toLowerCase();
    if (/kakaotalk/i.test(userAgent)) {
      window.location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(
        window.location.href
      )}`;
    } else if (/line/i.test(userAgent)) {
      const targetUrl = window.location.href;
      window.location.href = targetUrl.includes("?")
        ? `${targetUrl}&openExternalBrowser=1`
        : `${targetUrl}?openExternalBrowser=1`;
    } else if (
      /inapp|naver|snapchat|wirtschaftswoche|thunderbird|instagram|everytimeapp|whatsApp|electron|wadiz|aliapp|zumapp|iphone.*whale|android.*whale|kakaostory|band|twitter|DaumApps|DaumDevice\/mobile|FB_IAB|FB4A|FBAN|FBIOS|FBSS|trill|SamsungBrowser\/[^1]/i.test(
        userAgent
      )
    ) {
      redirectToExternalBrowser();
    }
  }, []);
```

스크립트 파일을 react 문법에 맞도록 옮겨왔다.

# Reference

- https://burndogfather.com/271

# 연결문서
- [[ActionSheet를 안전하게 감싸는 훅을 만든 이유]]
- [[React Native .ipa로 추출하기]]
- [[React Native에서 Android SHA-1 인증서 추출 방법]]
