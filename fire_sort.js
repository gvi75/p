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

    function getCardFireValue(card) {
        let fire = 0;
        const m = (card.textContent || '').match(/🔥\s*([\d.]+)\s*(K)?/i);
        if (m) {
            fire = parseFloat(m[1]) * (m[2] ? 1000 : 1);
        }
        return fire;
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

            for (const card of visibleCards) {
                const data = getCardData(card);
                let fireCount = getCardFireValue(card);
                if (!fireCount && data && data.id) {
                    fireCount = await fetchFireCount(getMethod(data), data.id);
                }
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
                    const fa = parseFloat(a.dataset.fireSortCount || '0');
                    const fb = parseFloat(b.dataset.fireSortCount || '0');
                    return fb - fa;
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

    function injectOption(rootNode) {
        const scope = rootNode && rootNode.querySelectorAll ? rootNode : document;

        const ratingTitles = Array.from(scope.querySelectorAll('*')).filter(el =>
            el.children.length === 0 &&
            ['рейтинг', 'rating'].includes((el.textContent || '').trim().toLowerCase())
        );

        ratingTitles.forEach(titleEl => {
            const root = titleEl.closest('[class*="selectbox"]') || titleEl.parentElement && titleEl.parentElement.parentElement;
            if (!root) return;

            const sampleBtn = Array.from(root.querySelectorAll('*')).find(el =>
                el.children.length === 0 &&
                ['будь-який', 'любой', 'any'].includes((el.textContent || '').trim().toLowerCase())
            );

            const btnParent = sampleBtn ? sampleBtn.parentElement : root;
            if (!btnParent || btnParent.querySelector('.lampa-fire-sort-btn')) return;

            const btn = sampleBtn ? sampleBtn.cloneNode(true) : document.createElement('div');
            btn.classList.add('lampa-fire-sort-btn');
            btn.textContent = '🔥 >';
            btn.style.cursor = 'pointer';

            const onSelect = (e) => {
                if (e) {
                    e.preventDefault();
                    e.stopPropagation();
                }
                if (window.Lampa && Lampa.Select && typeof Lampa.Select.close === 'function') {
                    Lampa.Select.close();
                }
                sortCardsByFire();
            };

            btn.addEventListener('click', onSelect);
            btn.addEventListener('hover:enter', onSelect);

            btnParent.appendChild(btn);
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
