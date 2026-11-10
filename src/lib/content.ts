import { getCollection, type CollectionEntry } from 'astro:content';

export type Kind = 'post' | 'project' | 'retro';
type AnyEntry = CollectionEntry<'posts'> | CollectionEntry<'projects'> | CollectionEntry<'retrospectives'>;

export interface Category {
	key: string;
	label: string;
	kind: Kind;
	tone: string;
	blurb: string;
}

// 폴더 이름을 화면용 이름과 그래프 색 토큰에 연결한다.
export const CATEGORIES: Record<string, Category> = {
	'Architecture-Patterns': {
		key: 'Architecture-Patterns',
		label: '아키텍처',
		kind: 'post',
		tone: 'arch',
		blurb: '데이터 모델, 동기화, 다국어, 알림처럼 구조를 정하는 글',
	},
	'Data-Docs': {
		key: 'Data-Docs',
		label: '데이터',
		kind: 'post',
		tone: 'data',
		blurb: '수집, 검산, 추출 평가처럼 숫자를 맞추는 글',
	},
	'Devops-Automation': {
		key: 'Devops-Automation',
		label: '배포·자동화',
		kind: 'post',
		tone: 'ops',
		blurb: 'CI/CD, 인프라 이전, 반복 업무 자동화',
	},
	'Product-Builds': {
		key: 'Product-Builds',
		label: '제품 개발',
		kind: 'post',
		tone: 'product',
		blurb: '기능 하나를 사용자 흐름까지 완성한 기록',
	},
	'Security-Reliability': {
		key: 'Security-Reliability',
		label: '보안·안정성',
		kind: 'post',
		tone: 'secure',
		blurb: '인증, 암호화, 동시성, 장애 대응',
	},
	'Project-Showcase': {
		key: 'Project-Showcase',
		label: '오픈소스',
		kind: 'project',
		tone: 'oss',
		blurb: '직접 배포한 라이브러리와 도구',
	},
	Startup: {
		key: 'Startup',
		label: '창업 회고',
		kind: 'retro',
		tone: 'retro',
		blurb: '공동창업, 투자, 외주 실패에서 배운 것',
	},
};

export interface Item {
	slug: string;
	url: string;
	title: string;
	summary?: string;
	created: string;
	date: Date;
	tags: string[];
	kind: Kind;
	category: Category;
	minutes: number;
	entry: AnyEntry;
	/** 예약 공개 시각(ms). 없으면 undefined */
	publishAtMs?: number;
	/** 빌드 시각 기준으로 아직 공개 전인 예약 글 */
	scheduled: boolean;
}

const KIND_OF: Record<string, Kind> = { posts: 'post', projects: 'project', retrospectives: 'retro' };

const toItem = (entry: AnyEntry): Item => {
	const id = entry.id.replace(/\\/g, '/');
	const folder = id.split('/')[0];
	const slug = (id.split('/').pop() ?? id).replace(/\.md$/i, '');
	const kind = KIND_OF[entry.collection];
	const category =
		CATEGORIES[folder] ?? { key: folder, label: folder.replace(/-/g, ' '), kind, tone: 'arch', blurb: '' };
	// 한국어 본문 기준 분당 약 500자로 읽는 시간을 어림한다.
	const chars = (entry.body ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, '').length;
	return {
		slug,
		url: `/post/${slug}/`,
		title: entry.data.title,
		summary: entry.data.summary,
		created: String(entry.data.created).slice(0, 10),
		date: new Date(entry.data.created),
		tags: (entry.data.tags ?? []).map(String),
		kind,
		category,
		minutes: Math.max(1, Math.round(chars / 500)),
		entry,
		publishAtMs: publishAtMs(entry),
		scheduled: !isPublished(entry),
	};
};

/**
 * 예약 발행: publishAt이 빌드 시각보다 미래면 글을 숨긴다.
 * 로컬에서 예약 글까지 보려면 SHOW_SCHEDULED=1 로 실행한다.
 */
export function publishAtMs(entry: { data: { publishAt?: string } }): number | undefined {
	const at = entry.data.publishAt;
	if (!at) return undefined;
	const t = Date.parse(at);
	if (Number.isNaN(t)) throw new Error(`publishAt 형식이 잘못됐다: ${at}`);
	return t;
}

export function isPublished(entry: { data: { publishAt?: string } }, now = Date.now()): boolean {
	if (process.env.SHOW_SCHEDULED === '1') return true;
	const t = publishAtMs(entry);
	return t === undefined || t <= now;
}

let cacheAll: Item[] | undefined;

/** 예약 글까지 포함한 전체 목록. 글 페이지 생성과 피드(브라우저가 시각에 맞춰 보여 줌)에만 쓴다. */
export async function getAllItemsIncludingScheduled(): Promise<Item[]> {
	if (cacheAll) return cacheAll;
	const entries = [
		...(await getCollection('posts')),
		...(await getCollection('projects')),
		...(await getCollection('retrospectives')),
	] as AnyEntry[];
	cacheAll = entries.map(toItem).sort((a, b) => b.date.getTime() - a.date.getTime());
	return cacheAll;
}

/** 빌드 시각 기준으로 공개된 글만. 검색창·그래프·관련 글·이전/다음 글·개수에 쓴다. */
export async function getAllItems(): Promise<Item[]> {
	return (await getAllItemsIncludingScheduled()).filter((i) => !i.scheduled);
}

export const KIND_LABEL: Record<Kind, string> = { post: '기술 글', project: '프로젝트', retro: '회고' };

/** 공유 태그가 많은 순서로 관련 글을 고른다. 같은 카테고리면 가산점을 준다. */
export function relatedItems(all: Item[], target: Item, limit = 3): Item[] {
	const tags = new Set(target.tags.map((t) => t.toLowerCase()));
	return all
		.filter((i) => i.slug !== target.slug)
		.map((i) => ({
			i,
			score:
				i.tags.filter((t) => tags.has(t.toLowerCase())).length * 2 +
				(i.category.key === target.category.key ? 1 : 0),
		}))
		.filter((x) => x.score > 0)
		.sort((a, b) => b.score - a.score || b.i.date.getTime() - a.i.date.getTime())
		.slice(0, limit)
		.map((x) => x.i);
}

export function formatDate(d: Date): string {
	if (Number.isNaN(d.getTime())) return '';
	return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}
