(function () {
    'use strict';

    if (window.__lampaFireSortLoaded) return;
    window.__lampaFireSortLoaded = true;

    const cache = {};
    let isSorting = false;

    function getCardData(el) {
        if (!el) return null;
        if (el.card_data && el.card_data.id) return el.card_data;
        if (window.$) {
            const $el = window.$(el);
            const d = $el.data('card') || $el.data('item') || $el.data('data');
            if (d && d.id) return d;
        }
        return null;
    }

    function getMethod(data) {
        if (data.media_type === 'tv' || data.media_type === 'movie') {
            return data.media_type;
        }
        return data.name ? 'tv' : 'movie';
    }

    function getFireCount(list) {
        if (!Array.isArray(list)) return 0;
        const fireItem = list.find(item => item && item.type === 'fire');
        return fireItem && typeof fireItem.counter === 'number' ? fireItem.counter : 0;
    }

    async function fetchFireCount(method, id) {
        const key = `${method}_${id}`;
        if (Object.prototype.hasOwnProperty.call(cache, key)) {
            return cache[key];
        }

        const urls = [
            `https://cub.best/api/reactions/get/${key}`,
            `https://cub.rip/api/reactions/get/${key}`
        ];

        for (const url of urls) {
            try {
                const res = await fetch(url);
                if (res.ok) {
                    const data = await res.json();
                    const list = Array.isArray(data && data.result) ? data.result : [];
                    const count = getFireCount(list);
                    cache[key] = count;
                    return count;
                }
            } catch (_) {}
        }

        cache[key] = 0;
        return 0;
    }

    function getCardFireFromDom(card) {
        const badge = card.querySelector('.card__reaction-fire, [class*="fire"]');
        const sourceText = badge ? badge.textContent : '';
        const m = (sourceText || '').match(/([\d]+(?:[.,]\d+)?)\s*(K)?/i);
        if (!m) return null;

        const num = parseFloat(m[1].replace(',', '.'));
        if (Number.isNaN(num)) return null;

        return num * (m[2] ? 1000 : 1);
    }

    async function runWithConcurrency(items, limit, worker) {
        const queue = items.slice();
        const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
            while (queue.length) {
                const item = queue.shift();
                await worker(item);
            }
        });
        await Promise.all(runners);
    }

    async function sortCardsByFire() {
        if (isSorting) return;
        isSorting = true;

        try {
            if (window.Lampa && Lampa.Noty) {
                Lampa.Noty.show('Сортування за вогниками (🔥 >)...');
            }

            const visibleCards = Array.from(document.querySelectorAll('.card'))
                .filter(el => el.offsetParent !== null && getCardData(el) !== null);

            if (!visibleCards.length) return;

            await runWithConcurrency(visibleCards, 6, async (card) => {
                const data = getCardData(card);
                const key = data && data.id ? `${getMethod(data)}_${data.id}` : null;

                let fireCount = null;
                if (key && Object.prototype.hasOwnProperty.call(cache, key)) {
                    fireCount = cache[key];
                } else {
                    fireCount = getCardFireFromDom(card);
                }

                if ((fireCount === null || fireCount === 0) && data && data.id) {
                    const apiCount = await fetchFireCount(getMethod(data), data.id);
                    if (fireCount === null || apiCount > 0) {
                        fireCount = apiCount;
                    }
                }

                const normalized = typeof fireCount === 'number' && !Number.isNaN(fireCount) ? fireCount : 0;
                card.dataset.fireSortCount = String(normalized);
            });

            const groups = new Map();
            for (const card of visibleCards) {
                const parent = card.parentElement;
                if (!parent) continue;
                if (!groups.has(parent)) groups.set(parent, []);
                groups.get(parent).push(card);
            }

            groups.forEach((cards, parent) => {
                if (cards.length < 2) return;

                cards.sort((a, b) => {
                    const fa = parseFloat(a.dataset.fireSortCount || '0') || 0;
                    const fb = parseFloat(b.dataset.fireSortCount || '0') || 0;
                    if (fb !== fa) return fb - fa;
                    return 0;
                });

                cards.forEach(card => parent.appendChild(card));
            });

            if (window.Lampa && Lampa.Noty) {
                Lampa.Noty.show('Відсортовано за вогниками (🔥 >)');
            }
        } finally {
            isSorting = false;
        }
    }

    function injectIntoOpenSelectbox(rootNode) {
        const scope = rootNode && rootNode.querySelectorAll ? rootNode : document;

        // Шукаємо саме відкрите вікно вибору (selectbox), а не рядки бокової панелі "Фільтр"
        const popups = Array.from(scope.querySelectorAll('.selectbox__body, .selectbox, [class*="selectbox__"]')).filter(el => {
            if (!(el instanceof HTMLElement)) return false;
            if (el.offsetParent === null) return false;
            // Переконуємося, що це не бокова панель фільтра
            const inFilterPanel = el.closest('.filter, [class*="filter__body"], .filter-body');
            if (inFilterPanel && !el.closest('.selectbox')) return false;
            return true;
        });

        popups.forEach(popup => {
            const container = popup.querySelector('.selectbox__body, .scroll__body') || popup;
            if (!container || container.querySelector('.lampa-fire-sort-option')) return;

            const items = Array.from(container.querySelectorAll('.selectbox__item, .selector-item, [class*="item"]')).filter(el => {
                if (!(el instanceof HTMLElement)) return false;
                if (el.offsetParent === null) return false;
                const txt = (el.textContent || '').trim().toLowerCase();
                return ['будь-який', 'любой', 'any', 'всі', 'все', '0', '0.0'].some(k => txt === k || txt.startsWith(k + ' '));
            });

            if (!items.length) return;

            const sample = items[items.length - 1];
            const parent = sample.parentElement;
            if (!parent || parent.querySelector('.lampa-fire-sort-option')) return;

            const opt = sample.cloneNode(true);
            opt.classList.remove('active', 'focus', 'selected');
            opt.classList.add('lampa-fire-sort-option');

            // Замінюємо лише текстовий вузол або внутрішній блок назви, зберігаючи структуру елемента
            const titleTarget = opt.querySelector('.selectbox__item-title, .title, span') || opt;
            titleTarget.textContent = '🔥 >';
            opt.style.cursor = 'pointer';

            const onPick = (e) => {
                if (e) {
                    e.preventDefault();
                    e.stopPropagation();
                }
                if (window.Lampa && Lampa.Select && typeof Lampa.Select.close === 'function') {
                    Lampa.Select.close();
                } else {
                    const closeBtn = document.querySelector('.selectbox__close, .selector__close');
                    if (closeBtn) closeBtn.click();
                }
                setTimeout(() => {
                    sortCardsByFire();
                }, 50);
            };

            opt.addEventListener('click', onPick, true);
            opt.addEventListener('hover:enter', onPick, true);

            parent.appendChild(opt);
        });
    }

    function init() {
        injectIntoOpenSelectbox(document);

        if (!window.__lampaFireSortObserver) {
            window.__lampaFireSortObserver = new MutationObserver((mutations) => {
                for (const m of mutations) {
                    for (const node of m.addedNodes) {
                        if (node instanceof HTMLElement) {
                            injectIntoOpenSelectbox(node);
                        }
                    }
                }
            });
            window.__lampaFireSortObserver.observe(document.body, { childList: true, subtree: true });
        }
    }

    init();
})();
