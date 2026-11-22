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

    function parseMetricValue(raw) {
        if (typeof raw === 'number') {
            return Number.isNaN(raw) ? 0 : raw;
        }
        if (!raw) return 0;
        const m = String(raw).match(/([\d]+(?:[.,]\d+)?)\s*(K)?/i);
        if (!m) return 0;
        const num = parseFloat(m[1].replace(',', '.'));
        if (Number.isNaN(num)) return 0;
        return num * (m[2] ? 1000 : 1);
    }

    function getPositiveScoreFromList(list) {
        if (!Array.isArray(list)) return 0;
        const fireItem = list.find(item => item && item.type === 'fire');
        const niceItem = list.find(item => item && item.type === 'nice');

        const fireCount = fireItem && typeof fireItem.counter === 'number' ? fireItem.counter : 0;
        const niceCount = niceItem && typeof niceItem.counter === 'number' ? niceItem.counter : 0;

        return fireCount + niceCount;
    }

    async function fetchPositiveScore(method, id) {
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
                    const score = getPositiveScoreFromList(list);
                    cache[key] = score;
                    return score;
                }
            } catch (_) {}
        }

        cache[key] = 0;
        return 0;
    }

    function getCardScoreFromDom(card) {
        let total = 0;
        let foundAny = false;

        const fireBadge = card.querySelector('.card__reaction-fire, [class*="fire"]');
        if (fireBadge && fireBadge.textContent) {
            const v = parseMetricValue(fireBadge.textContent);
            if (v > 0 || /0/.test(fireBadge.textContent)) {
                total += v;
                foundAny = true;
            }
        }

        const niceBadge = card.querySelector('.card__reaction-nice, [class*="nice"]');
        if (niceBadge && niceBadge.textContent) {
            const v = parseMetricValue(niceBadge.textContent);
            if (v > 0 || /0/.test(niceBadge.textContent)) {
                total += v;
                foundAny = true;
            }
        }

        if (!foundAny) {
            const text = card.textContent || '';
            const fireMatch = text.match(/🔥\s*([\d]+(?:[.,]\d+)?\s*K?)/i);
            const niceMatch = text.match(/👍\s*([\d]+(?:[.,]\d+)?\s*K?)/i);
            if (fireMatch) {
                total += parseMetricValue(fireMatch[1]);
                foundAny = true;
            }
            if (niceMatch) {
                total += parseMetricValue(niceMatch[1]);
                foundAny = true;
            }
        }

        return foundAny ? total : null;
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
                Lampa.Noty.show('Сортування за 🔥 + 👍 >...');
            }

            const visibleCards = Array.from(document.querySelectorAll('.card'))
                .filter(el => el.offsetParent !== null && getCardData(el) !== null);

            if (!visibleCards.length) return;

            await runWithConcurrency(visibleCards, 6, async (card) => {
                const data = getCardData(card);
                const key = data && data.id ? `${getMethod(data)}_${data.id}` : null;

                let score = null;
                if (key && Object.prototype.hasOwnProperty.call(cache, key)) {
                    score = cache[key];
                } else {
                    score = getCardScoreFromDom(card);
                }

                if ((score === null || score === 0) && data && data.id) {
                    const apiScore = await fetchPositiveScore(getMethod(data), data.id);
                    if (score === null || apiScore > 0) {
                        score = apiScore;
                    }
                }

                const normalized = typeof score === 'number' && !Number.isNaN(score) ? score : 0;
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
                Lampa.Noty.show('Відсортовано за 🔥 + 👍 >');
            }
        } finally {
            isSorting = false;
        }
    }

    function isRatingScrollBody(scrollBody) {
        const box = scrollBody.closest('.selectbox, .select, [class*="selectbox"], [class*="select"]') || scrollBody.parentElement;
        const boxText = (box && box.textContent ? box.textContent : '').toLowerCase();

        const hasRatingHeader =
            /\bрейтинг\b/.test(boxText) ||
            /\brating\b/.test(boxText) ||
            /\bрейтинг\b/.test((scrollBody.parentElement && scrollBody.parentElement.textContent || '').toLowerCase());

        const items = Array.from(scrollBody.querySelectorAll('.selectbox-item')).filter(
            item => !item.classList.contains('lampa-fire-sort-option')
        );
        if (!items.length) return false;

        const texts = items.map(item => (item.textContent || '').trim().toLowerCase()).filter(Boolean);

        // Відсікаємо списки з роками (наприклад, 2026, 2025, 2027-2022)
        const yearLikeCount = texts.filter(t => /^\d{4}(\s*[-–]\s*\d{4})?$/.test(t)).length;
        if (yearLikeCount >= 2) return false;

        const hasRatingRange = texts.some(t =>
            /^(від|от|from)\s+\d+/.test(t) ||
            /^(від|от|from)\s+\d+\s+(до|по|to)\s+\d+/.test(t)
        );

        return Boolean(hasRatingHeader || hasRatingRange);
    }

    function injectIntoOpenSelectbox(rootNode) {
        const scope = rootNode && rootNode.querySelectorAll ? rootNode : document;

        const scrollBodies = Array.from(scope.querySelectorAll('.scroll__body')).filter(el => {
            if (!(el instanceof HTMLElement)) return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        });

        for (const scrollBody of scrollBodies) {
            const existingOpt = scrollBody.querySelector('.lampa-fire-sort-option');
            const validRating = isRatingScrollBody(scrollBody);

            if (!validRating) {
                if (existingOpt) existingOpt.remove();
                continue;
            }

            if (existingOpt) continue;

            const items = Array.from(scrollBody.querySelectorAll('.selectbox-item')).filter(
                item => !item.classList.contains('lampa-fire-sort-option')
            );
            if (!items.length) continue;

            const sample = items[items.length - 1];
            const opt = sample.cloneNode(true);
            opt.classList.remove('active', 'focus', 'selected');
            opt.classList.add('lampa-fire-sort-option');

            const titleTarget = opt.querySelector('[class*="title"], span, div') || opt;
            titleTarget.textContent = '🔥 + 👍 >';
            opt.style.cursor = 'pointer';

            const onPick = (e) => {
                if (e) {
                    e.preventDefault();
                    e.stopPropagation();
                }
                if (window.Lampa && Lampa.Select && typeof Lampa.Select.close === 'function') {
                    Lampa.Select.close();
                } else {
                    const closeBtn = document.querySelector('.selectbox__close, .selector__close, .select__close');
                    if (closeBtn) closeBtn.click();
                }
                setTimeout(() => {
                    sortCardsByFire();
                }, 60);
            };

            opt.addEventListener('click', onPick, true);
            opt.addEventListener('hover:enter', onPick, true);

            const anyItem = items.find(item => {
                const txt = (item.textContent || '').trim().toLowerCase();
                return txt === 'будь-який' || txt === 'любой' || txt === 'any';
            });

            if (anyItem) {
                anyItem.insertAdjacentElement('afterend', opt);
            } else {
                scrollBody.appendChild(opt);
            }
        }
    }

    function init() {
        injectIntoOpenSelectbox(document);

        if (!window.__lampaFireSortObserver) {
            let timer = null;
            window.__lampaFireSortObserver = new MutationObserver(() => {
                if (timer) return;
                timer = setTimeout(() => {
                    timer = null;
                    injectIntoOpenSelectbox(document);
                }, 40);
            });
            window.__lampaFireSortObserver.observe(document.body, {
                childList: true,
                subtree: true
            });
        }
    }

    init();
})();
