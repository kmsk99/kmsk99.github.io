---
tags:
  - IntersectionObserver
  - Animation
  - React
  - CSS
  - Swiper
title: Intersection Observer로 스크롤 기반 애니메이션 구현
created: 2025-09-01 10:00
modified: 2025-09-01 14:00
---

# 배경

회사 소개 웹사이트에서 스크롤에 따라 섹션이 등장하는 애니메이션이 필요했다. 스크롤 이벤트 리스너로 구현하면 매 프레임마다 `getBoundingClientRect()`를 호출해 리플로우가 발생한다. `IntersectionObserver`를 사용해 요소가 뷰포트에 진입할 때만 애니메이션을 트리거하도록 했다.

# useIntersectionObserver 훅

```ts
import { useEffect, useRef, useState } from 'react';

interface UseIntersectionObserverOptions {
  threshold?: number;
  rootMargin?: string;
  triggerOnce?: boolean;
}

export default function useIntersectionObserver(
  options: UseIntersectionObserverOptions = {},
) {
  const { threshold = 0.3, rootMargin = '0px 0px -50px 0px', triggerOnce = true } = options;
  const [isVisible, setIsVisible] = useState(false);
  const elementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          if (triggerOnce) observer.disconnect();
        } else if (!triggerOnce) {
          setIsVisible(false);
        }
      },
      { threshold, rootMargin },
    );

    if (elementRef.current) observer.observe(elementRef.current);
    return () => observer.disconnect();
  }, [threshold, rootMargin, triggerOnce]);

  return { isVisible, elementRef };
}
```

주요 설계 결정:

- `threshold: 0.3`: 요소의 30%가 보여야 트리거. 0으로 설정하면 1px만 보여도 실행되어 사용자가 애니메이션을 인지하기 어렵다.
- `rootMargin: '0px 0px -50px 0px'`: 하단에 -50px 마진을 줘서, 요소가 뷰포트 하단 50px 안쪽에 진입해야 트리거된다. 스크롤할 때 요소가 충분히 올라온 후 애니메이션이 시작되는 효과.
- `triggerOnce: true`: 한 번 트리거되면 `disconnect()`로 옵저버를 해제한다. 등장 애니메이션은 반복할 필요가 없다.

# CSS 애니메이션

```css
@keyframes slide-up {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

.animate-slide-up {
  animation: slide-up 0.6s ease-out forwards;
}

.animate-fade-in-up {
  animation: slide-up 0.8s ease-out forwards;
}
```

순차적 등장을 위해 카드별로 딜레이를 다르게 설정했다.

```css
.animate-service-card-1 { animation: slide-up 0.6s ease-out 0.1s forwards; }
.animate-service-card-2 { animation: slide-up 0.6s ease-out 0.2s forwards; }
.animate-service-card-3 { animation: slide-up 0.6s ease-out 0.3s forwards; }
.animate-service-card-4 { animation: slide-up 0.6s ease-out 0.4s forwards; }
```

`forwards`는 애니메이션 종료 후 마지막 프레임의 스타일을 유지시킨다. 이를 누락하면 애니메이션 후 요소가 원래 위치(opacity: 0)로 돌아간다.

## 접근성

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

모션 민감성이 있는 사용자를 위해 `prefers-reduced-motion` 미디어 쿼리로 모든 애니메이션을 비활성화한다. `0ms`가 아닌 `0.01ms`로 설정하는 이유는 `animation-fill-mode: forwards`가 적용되어 최종 상태로 즉시 이동하게 하기 위해서다.

# 컴포넌트에서의 사용

```tsx
function TextSection({ title, description }: Props) {
  const { isVisible, elementRef } = useIntersectionObserver();

  return (
    <div ref={elementRef}
      className={isVisible ? 'animate-fade-in-up' : 'opacity-0'}>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}
```

초기 상태는 `opacity-0`으로 숨기고, `isVisible`이 `true`가 되면 애니메이션 클래스를 적용한다. 훅이 `elementRef`를 반환하므로 `ref`를 수동으로 관리할 필요 없다.

서비스 카드 섹션처럼 여러 카드가 순차적으로 나타나는 경우:

```tsx
function ServicesSection({ services }: Props) {
  const { isVisible, elementRef } = useIntersectionObserver();

  return (
    <div ref={elementRef}>
      <h2 className={isVisible ? 'animate-service-title' : 'opacity-0'}>
        서비스
      </h2>
      {services.map((service, i) => (
        <div key={i}
          className={isVisible ? `animate-service-card-${i + 1}` : 'opacity-0'}>
          {service.name}
        </div>
      ))}
    </div>
  );
}
```

부모 요소 하나에만 Observer를 걸고, 자식 카드들은 CSS 딜레이로 순차 등장시킨다. Observer를 카드마다 거는 것보다 효율적이다.

# requestAnimationFrame 무한 스크롤

파트너 로고 섹션에서는 로고가 끊임없이 흐르는 애니메이션을 `requestAnimationFrame`으로 구현했다.

```tsx
function Partners({ logos }: Props) {
  const positionRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    let frameId: number;
    const speed = 0.5;

    const animate = () => {
      if (!isPaused && containerRef.current) {
        positionRef.current -= speed;
        const totalWidth = containerRef.current.scrollWidth / 2;
        if (Math.abs(positionRef.current) >= totalWidth) {
          positionRef.current = 0;
        }
        containerRef.current.style.transform = `translateX(${positionRef.current}px)`;
      }
      frameId = requestAnimationFrame(animate);
    };

    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [isPaused]);

  return (
    <div onMouseEnter={() => setIsPaused(true)}
         onMouseLeave={() => setIsPaused(false)}>
      <div ref={containerRef}>
        {[...logos, ...logos].map((logo, i) => (
          <img key={i} src={logo} />
        ))}
      </div>
    </div>
  );
}
```

로고 배열을 두 번 복제해서 이어붙이고, 절반 지점에 도달하면 위치를 0으로 리셋한다. 시각적으로 끊김 없는 무한 루프가 된다. hover 시 일시정지, 모바일에서는 터치로 일시정지한다.

CSS animation으로도 구현할 수 있지만, `requestAnimationFrame` 방식은 일시정지/속도 변경 등 동적 제어가 쉽다.

# Swiper 통합

모바일 해상도에서는 카드를 Swiper로 슬라이드하도록 전환한다.

```tsx
import { Swiper, SwiperSlide } from 'swiper/react';
import { Pagination } from 'swiper/modules';

function MobileServiceCards({ services }: Props) {
  return (
    <div className="block md:hidden">
      <Swiper
        modules={[Pagination]}
        slidesPerView="auto"
        spaceBetween={20}
        slidesOffsetBefore={20}
        slidesOffsetAfter={20}
        pagination={{ clickable: true }}
      >
        {services.map((service, i) => (
          <SwiperSlide key={i} style={{ width: '80%' }}>
            <ServiceCard {...service} />
          </SwiperSlide>
        ))}
      </Swiper>
    </div>
  );
}
```

`slidesPerView: 'auto'`와 `SwiperSlide`에 `width: 80%`를 지정해 양쪽에 다음 카드의 일부가 살짝 보이는 peek 효과를 준다. `slidesOffsetBefore/After`로 첫 번째와 마지막 카드에도 좌우 여백이 생긴다.

# Kakao Map 임베딩

Contact 섹션에 카카오 지도를 임베딩했다. SDK를 `beforeInteractive` 전략으로 로드하고, Geocoder로 주소를 좌표로 변환한다.

```tsx
function KakaoMap({ address, markerImageUrl, mapLevel }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.kakao.maps.load(() => {
      const container = mapRef.current;
      const map = new window.kakao.maps.Map(container, {
        center: new window.kakao.maps.LatLng(37.4812, 126.8826),
        level: mapLevel ?? 4,
      });

      const geocoder = new window.kakao.maps.services.Geocoder();
      geocoder.addressSearch(address, (result, status) => {
        if (status === window.kakao.maps.services.Status.OK) {
          const coords = new window.kakao.maps.LatLng(result[0].y, result[0].x);
          map.setCenter(coords);
          new window.kakao.maps.CustomOverlay({
            position: coords,
            content: `<img src="${markerImageUrl}" style="width:40px;height:40px;" />`,
            map,
          });
        }
      });
    });
  }, [address]);

  return <div ref={mapRef} style={{ width: '100%', height: '400px' }} />;
}
```

`CustomOverlay`로 기본 마커 대신 회사 로고를 표시한다. `next.config.ts`의 CSP에 카카오 도메인(`dapi.kakao.com`, `ssl.daumcdn.net` 등)을 추가해야 한다.

# Reference

- https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API
- https://swiperjs.com/react
- https://apis.map.kakao.com/web/documentation/

# 연결문서

- [[Next.js PWA 구현과 S3 업로드]]
- [[react-native-clusterer로 지도 마커 클러스터링]]
