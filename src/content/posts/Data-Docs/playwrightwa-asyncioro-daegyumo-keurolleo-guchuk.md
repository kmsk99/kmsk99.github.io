---
tags:
  - Playwright
  - Crawling
  - AsyncIO
  - Python
  - DataEngineering
  - Automation
title: Playwright와 AsyncIO로 대규모 크롤러 구축
created: '2024-12-26'
modified: '2025-01-03'
---

# 배경

여러 프로젝트에서 외부 데이터 수집이 필요했다. 이커머스 66개 사이트의 상품 가격 비교, 채용 플랫폼 4곳의 인턴 공고 수집, 공공데이터 API를 통한 위치 정보 수집, 그리고 일본 흡연구역 API에서 230만 건의 장소 데이터 수집까지. 규모와 대상이 다양한 만큼 크롤러 아키텍처도 프로젝트마다 다르게 설계했다. 여기서는 네 가지 크롤러의 설계 차이와 각각에서 배운 점을 정리한다.

# 이커머스 가격 비교 크롤러

## 3단계 파이프라인

66개 전자담배 이커머스 사이트를 크롤링해 크로스사이트 가격 비교 데이터를 만드는 크롤러다. Discovery → Fetch → Export 3단계 파이프라인으로 구성했다.

Discovery 단계에서는 sitemap 파싱, HTML 링크 추출, 그리고 Playwright 네트워크 스니핑을 조합해 상품 페이지 URL을 수집한다. 네트워크 스니핑은 브라우저가 렌더링하면서 호출하는 내부 API 엔드포인트를 캡처하는 방식이다.

```python
class NetworkSniffer:
    API_PATTERNS = ['/api/', '/exec/front/', '/graphql', '/products.json']

    async def sniff(self, url: str) -> list[DiscoveredEndpoint]:
        page = await self.context.new_page()
        captured = []

        async def on_response(response):
            if response.request.resource_type in ('xhr', 'fetch'):
                content_type = response.headers.get('content-type', '')
                if 'json' in content_type:
                    captured.append({
                        'url': response.url,
                        'method': response.request.method,
                        'status': response.status,
                    })

        page.on('response', on_response)
        await page.goto(url)
        await page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
        await page.wait_for_timeout(3000)
        return self._classify_endpoints(captured)
```

페이지를 스크롤하면서 lazy-load되는 API 호출까지 캡처한다. 이렇게 발견한 엔드포인트 URL 패턴을 분류해 상품 목록 API, 상품 상세 API, 리뷰 API 등으로 구분한다.

## 플랫폼 어댑터 패턴

이커머스 사이트마다 구조가 다르다. Cafe24 기반 쇼핑몰, Imweb 기반 쇼핑몰, 그리고 나머지를 처리하는 Generic 어댑터로 나눠 각각의 파싱 로직을 분리했다.

```python
class SiteAdapter(ABC):
    @abstractmethod
    def can_handle(self, url: str, html: str) -> bool: ...

    @abstractmethod
    def extract_products_from_list(self, data: dict) -> list[Product]: ...

    @abstractmethod
    def extract_product_detail(self, data: dict) -> Product: ...

class Cafe24Adapter(SiteAdapter):
    def can_handle(self, url, html):
        return 'EC_SHOP_FRONT' in html or '/exec/front/' in url

class ImwebAdapter(SiteAdapter):
    def can_handle(self, url, html):
        return 'imweb' in html.lower() or 'imwebme' in url
```

Generic 어댑터는 JSON-LD, Open Graph 메타태그, CSS 셀렉터를 순서대로 시도하는 폴백 전략을 쓴다.

## 도메인별 Rate Limiting

66개 사이트에 동시 요청을 보내면 차단당한다. 도메인별로 동시성과 QPS를 제한하는 레이트 리미터를 구현했다.

```python
class DomainRateLimiter:
    def __init__(self, default_qps=2.0, max_concurrent=3):
        self.limiters: dict[str, DomainLimit] = {}
        self.default_qps = default_qps
        self.max_concurrent = max_concurrent

    async def acquire(self, domain: str):
        limiter = self._get_or_create(domain)
        async with limiter.semaphore:
            elapsed = time.monotonic() - limiter.last_request
            min_interval = 1.0 / limiter.qps
            if elapsed < min_interval:
                await asyncio.sleep(min_interval - elapsed)
            limiter.last_request = time.monotonic()

    def set_crawl_delay(self, domain: str, delay: float):
        limiter = self._get_or_create(domain)
        limiter.qps = min(limiter.qps, 1.0 / delay)
```

`robots.txt`에서 `Crawl-delay`를 읽어와 해당 도메인의 QPS를 자동 조정한다.

## 상품 중복 제거와 가격 비교

여러 사이트에서 같은 상품이 다른 이름으로 등록되어 있다. 브랜드명 + 정규화된 상품명(용량, 농도 등 제거)으로 키를 만들어 크로스사이트 중복을 제거한다.

```python
def _merge_similar_products(self, products):
    groups = defaultdict(list)
    for p in products:
        key = self._product_key(p['brand'], p['name'])
        groups[key].append(p)

    merged = []
    for key, listings in groups.items():
        if len(listings) >= 2:
            merged.append({
                'brand': listings[0]['brand'],
                'name': key,
                'price_min': min(l['price'] for l in listings),
                'price_max': max(l['price'] for l in listings),
                'site_count': len(set(l['domain'] for l in listings)),
                'listings': listings,
            })
    return merged
```

# 채용 플랫폼 크롤러

## 추상 베이스 클래스

4개 채용 플랫폼(잡코리아, 사람인, 인크루트, 혁신의숲)에서 인턴 공고를 수집하는 크롤러다. 공통 로직을 `BaseCrawler`에 모으고 플랫폼별 차이만 하위 클래스에서 구현하는 구조를 택했다.

```ts
abstract class BaseCrawler {
  protected page: Page;
  protected captchaHandler: CaptchaHandler;
  protected progressManager: ProgressManager;

  constructor(page: Page) {
    this.setupResourceBlocking();
  }

  private setupResourceBlocking() {
    this.page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'stylesheet', 'font'].includes(type)) return route.abort();
      const url = route.request().url();
      if (/doubleclick|googleadservices|analytics|facebook/.test(url)) return route.abort();
      return route.continue();
    });
  }

  abstract crawlUrls(): Promise<void>;
  abstract crawlJobInfo(): Promise<void>;
}
```

이미지, CSS, 폰트, 광고 네트워크 요청을 차단해 페이지 로딩 속도를 크게 높였다.

## VPN IP 로테이션으로 캡챠 우회

채용 플랫폼은 반복 접근을 감지하면 캡챠를 띄운다. Mullvad VPN 클라이언트와 연동해 캡챠가 감지되면 자동으로 IP를 변경하고 재시도한다.

```ts
class CaptchaHandler {
  private vpnManager: VPNManager;

  async handleCaptcha(page: Page): Promise<boolean> {
    const hasCaptcha = await this.detectCaptcha(page);
    if (!hasCaptcha) return false;

    this.vpnManager.markCurrentServerCaptcha();
    await this.vpnManager.switchToNextServer();
    await new Promise(r => setTimeout(r, 5000));
    await page.reload();
    return true;
  }

  private async detectCaptcha(page: Page): Promise<boolean> {
    const content = await page.content();
    return content.includes('이용이 일시적으로 중지되었습니다')
      || content.includes('보안문자')
      || (await page.$('input[name="captcha"]')) !== null;
  }
}
```

## 연락처 추출

공고 페이지에서 이메일, 전화번호, 사업자등록번호를 정규식으로 추출한다. 이메일은 `info@`, `contact@`, `recruit@`, `hr@` 순으로 우선순위를 매긴다.

```ts
class ContactExtractor {
  static extract(html: string): ContactInfo {
    const emails = this.extractEmails(html);
    const phones = this.extractPhones(html);
    const businessNumbers = this.extractBusinessNumbers(html);
    return {
      email: this.prioritizeAndFilter(emails)[0] ?? null,
      phone: phones[0] ?? null,
      businessNumber: businessNumbers[0] ?? null,
    };
  }

  private static prioritizeAndFilter(emails: string[]): string[] {
    const priority = ['info@', 'contact@', 'recruit@', 'hr@'];
    return emails.sort((a, b) => {
      const aIdx = priority.findIndex(p => a.startsWith(p));
      const bIdx = priority.findIndex(p => b.startsWith(p));
      return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
    });
  }
}
```

# AsyncIO 초고속 크롤러

## 브라우저 없이 API 직접 호출

일본 흡연구역 데이터를 수집할 때는 완전히 다른 접근을 택했다. 대상 서비스가 `spot/{id}` 형태의 REST API를 제공하고 있어서, Playwright 없이 `aiohttp`로 직접 HTTP 요청을 보내는 것이 가능했다. 이 차이가 속도에 결정적이었다.

```python
class ClubJTCrawler:
    MAX_CONCURRENT_REQUESTS = 500
    REQUEST_TIMEOUT = 10

    async def crawl(self, start_id=1480001, min_id=2300000):
        connector = aiohttp.TCPConnector(limit=0, ttl_dns_cache=300)

        async with aiohttp.ClientSession(headers=self.headers, connector=connector) as session:
            semaphore = asyncio.Semaphore(self.MAX_CONCURRENT_REQUESTS)
            pending_tasks = set()

            async def worker(spot_id):
                async with semaphore:
                    return await self.fetch_spot_info(session, spot_id), spot_id

            while True:
                while len(pending_tasks) < self.MAX_CONCURRENT_REQUESTS * 1.5:
                    if self.consecutive_403_count >= CONSECUTIVE_403_LIMIT:
                        break
                    task = asyncio.create_task(worker(current_id))
                    pending_tasks.add(task)
                    current_id += 1

                done, pending_tasks = await asyncio.wait(
                    pending_tasks, return_when=asyncio.FIRST_COMPLETED
                )

                for task in done:
                    result, spot_id = await task
                    if result and not result.get('_403_error'):
                        batch_results.append(result)
                    if len(batch_results) >= SAVE_BATCH_SIZE:
                        asyncio.create_task(self.save_batch(batch_results[:], file_index, ...))
                        batch_results = []
```

핵심 설계 결정은 다음과 같다.

- 동시 요청 500개: `asyncio.Semaphore(500)`으로 제어. Playwright 기반 크롤러는 브라우저 탭 수 제한 때문에 보통 3~10개가 한계다.
- TCPConnector의 연결 제한 해제: `limit=0`으로 설정하고 세마포어로만 동시성을 제어한다. DNS 캐시(`ttl_dns_cache=300`)로 DNS 조회 오버헤드도 줄인다.
- 비블로킹 파일 저장: `asyncio.to_thread()`로 Parquet 저장을 별도 스레드에서 실행해 이벤트 루프가 블로킹되지 않는다.
- 점진적 저장: 100건마다 배치 저장, 10,000건마다 병합. 중간에 크롤링이 중단되어도 데이터 유실이 최소화된다.

이 구조로 시간당 약 40~50만 건을 처리할 수 있었다. 같은 양을 Playwright로 처리하면 며칠이 걸릴 작업이 6~8시간 만에 끝났다.

## 안전 장치

연속 403 에러가 100회를 넘으면 서버 차단으로 판단하고 크롤링을 중단한다. 최소 보장 ID(`min_id`)까지는 연속 실패 제한을 무시하고, 그 이후부터 연속 10,000회 실패 시 더 이상 유효한 데이터가 없다고 판단해 종료한다.

```python
async def fetch_spot_info(self, session, spot_id):
    for attempt in range(1, MAX_RETRIES + 1):
        async with session.get(f"{self.base_url}/{spot_id}", timeout=REQUEST_TIMEOUT) as response:
            if response.status == 404:
                return None
            elif response.status == 403:
                if attempt < MAX_RETRIES:
                    await asyncio.sleep(1.0 * attempt)
                    continue
                return {'_403_error': True}
            elif response.status == 200:
                return await response.json()
```

404는 재시도 없이 건너뛰고, 403은 백오프 후 재시도한다.

# 공공데이터 수집 스크립트

## 흡연구역 크롤링

국내 흡연구역 데이터는 smokers.or.kr에서 BeautifulSoup으로 HTML을 파싱해 수집했다.

```python
class SmokersCrawler:
    def crawl_spot(self, map_idx):
        response = requests.post(
            'https://smokers.or.kr/map_update.php',
            data={'act': 'view', 'map_idx': map_idx}
        )
        soup = BeautifulSoup(response.text, 'html.parser')
        return self.parse_spot_data(soup)
```

## 금연구역 API 수집

공공데이터포털 API로 전국 금연구역 데이터를 수집했다. 페이지당 10,000건, 파일당 100,000건으로 분할한다.

```javascript
async function fetchAllData() {
  let pageNo = 1;
  let totalFetched = 0;

  while (true) {
    const url = `${BASE_URL}?serviceKey=${API_KEY}&numOfRows=10000&pageNo=${pageNo}`;
    const response = await fetch(url);
    const xml = await response.text();
    const items = parseXML(xml);

    if (items.length === 0) break;
    totalFetched += items.length;

    if (totalFetched % 100000 === 0) {
      saveToCSV(buffer, fileIndex++);
      buffer = [];
    }

    pageNo++;
    await sleep(200);
  }
}
```

## CSV 인코딩 복구

공공데이터에서 받은 CSV가 CP949나 EUC-KR로 인코딩된 경우가 많았다. chardet으로 인코딩을 감지하고, mojibake(깨진 문자열)가 발견되면 latin1 → CP949로 재디코딩한다.

```javascript
function repairMojibake(text) {
  const bytes = Buffer.from(text, 'latin1');
  return iconv.decode(bytes, 'cp949');
}

async function fixEncoding(filePath, options) {
  const rawBuffer = await fs.readFile(filePath);
  const detected = chardet.detect(rawBuffer);
  const decoded = iconv.decode(rawBuffer, detected.encoding);

  if (options.repairMojibake) {
    return repairMojibake(decoded);
  }
  return decoded;
}
```

# 크롤러 유형별 비교

| 항목 | 이커머스 | 채용 플랫폼 | AsyncIO 직접 호출 | 공공데이터 |
|------|---------|-----------|------------------|----------|
| 도구 | Playwright + httpx | Playwright | aiohttp | requests / fetch |
| 동시성 | 도메인당 2~3 | 탭 1개 + VPN | 500 동시 요청 | 순차 (API 제한) |
| 속도 | ~1,000건/시간 | ~500건/시간 | ~400,000건/시간 | ~50,000건/시간 |
| 차단 대응 | robots.txt 준수, rate limit | VPN IP 로테이션 | 연속 403 감지 | 없음 |
| 저장 | JSONL, Parquet | CSV | Parquet (배치/병합) | CSV |
| JS 렌더링 | 필요 (SPA) | 필요 (동적 페이지) | 불필요 (REST API) | 불필요 (XML API) |

가장 큰 교훈은 "대상에 맞는 도구를 선택하라"는 것이다. Playwright는 JS 렌더링이 필요한 사이트에만 쓰고, API가 있으면 직접 호출하는 것이 수백 배 빠르다. 크롤러의 성능은 동시성 × 요청당 오버헤드로 결정되는데, 브라우저를 띄우는 것 자체가 가장 큰 오버헤드다.

# Reference

- https://playwright.dev/python/
- https://docs.aiohttp.org/en/stable/
- https://docs.python.org/3/library/asyncio.html
- https://www.data.go.kr/

# 연결문서

- [공공데이터 위치 정보 전처리](/post/gonggongdeiteo-wichi-jeongbo-jeoncheori)
- [Firebase 서버리스 위치 기반 앱 구현](/post/firebase-seobeoriseu-wichi-giban-aep-guhyeon)
