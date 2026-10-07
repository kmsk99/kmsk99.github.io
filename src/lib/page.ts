/**
 * ClientRouter로 페이지를 바꿀 때마다 초기화를 다시 실행한다.
 * 콜백에 넘기는 signal은 다음 페이지로 넘어가기 직전에 abort되므로
 * window·document에 붙인 리스너는 이 signal로 등록하면 저절로 정리된다.
 */
export function onPage(init: (signal: AbortSignal) => void | (() => void)) {
	let controller: AbortController | null = null;
	let cleanup: void | (() => void);

	document.addEventListener('astro:page-load', () => {
		controller?.abort();
		controller = new AbortController();
		cleanup = init(controller.signal);
	});
	document.addEventListener('astro:before-swap', () => {
		controller?.abort();
		controller = null;
		if (typeof cleanup === 'function') cleanup();
		cleanup = undefined;
	});
}

export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
