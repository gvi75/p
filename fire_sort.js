(function () {
    'use strict';

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

    async function sortCardsByFire() {
        if (isSorting) return;
        isSorting = true;

        try {
            if (window.Lampa && Lampa.Noty) {
                Lampa.Noty.show('Підрахунок вогників та сортування...');
            }

            const visibleCards = Array.from(document.querySelectorAll('.card'))
                .filter(el => el.offsetParent !== null && getCardData(el) !== null);

            if (!visibleCards.length) return;

            for (const card of visibleCards) {
                const data = getCardData(card);
                const fireCount = await fetchFireCount(getMethod(data), data.id);
                card.dataset.fireSortCount = String(fireCount);
            }

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
                    const fa = parseInt(a.dataset.fireSortCount || '0', 10);
                    const fb = parseInt(b.dataset.fireSortCount || '0', 10);
                    return fb - fa;
                });

                cards.forEach(card => parent.appendChild(card));
            });

            if (window.Lampa && Lampa.Noty) {
                Lampa.Noty.show('Готово: спочатку найбільше вогників');
            }
        } finally {
            isSorting = false;
        }
    }

    function injectOption(rootNode) {
        const scope = rootNode && rootNode.querySelectorAll ? rootNode : document;
        scope.querySelectorAll('.selectbox').forEach(box => {
            const titleEl = box.querySelector('.selectbox__title');
            const bodyEl = box.querySelector('.selectbox__body .scroll__body') || box.querySelector('.selectbox__body');
            if (!titleEl || !bodyEl) return;

            const title = (titleEl.textContent || '').trim().toLowerCase();
            if (title !== 'рейтинг' && title !== 'rating') return;
            if (bodyEl.querySelector('.lampa-fire-sort-btn')) return;

            const template = bodyEl.querySelector('.selectbox-item');
            const btn = document.createElement('div');
            btn.className = (template ? template.className : 'selectbox-item selector') + ' lampa-fire-sort-btn';
            btn.innerHTML = `<div class="selectbox-item__title">🔥 Вогники (від більшого до меншого)</div>`;

            const onSelect = (e) => {
                if (e) {
                    e.preventDefault();
                    e.stopPropagation();
                }
                if (window.Lampa && Lampa.Select && typeof Lampa.Select.close === 'function') {
                    Lampa.Select.close();
                } else {
                    box.remove();
                }
                sortCardsByFire();
            };

            btn.addEventListener('click', onSelect);
            btn.addEventListener('hover:enter', onSelect);

            bodyEl.appendChild(btn);
        });
    }

    function init() {
        injectOption(document);

        if (!window.__lampaFireSortObserver) {
            window.__lampaFireSortObserver = new MutationObserver((mutations) => {
                for (const m of mutations) {
                    for (const node of m.addedNodes) {
                        if (node instanceof HTMLElement) {
                            injectOption(node);
                        }
                    }
                }
            });
            window.__lampaFireSortObserver.observe(document.body, { childList: true, subtree: true });
        }
    }

    init();
})();
