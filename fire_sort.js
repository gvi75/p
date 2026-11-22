(function () {
    'use strict';

    if (window.__lampaFireSortLoaded) return;
    window.__lampaFireSortLoaded = true;

    const cache = {};
    let isSorting = false;
    let wantFireSort = false;
    let autoSortTimer = null;

    function getCardData(el) {
        if (!el) return null;
        if (el.card_data && el.card_data.id) return el.card_data;
        if (window.$) {
            const $el = window.$(el);
            const d = $el.data('card') || $el.data('item') \vert{}\vert{}$el.data('data');
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

    function formatScore(val) {
        const num = Number(val) || 0;
        if (num >= 1000) {
            const k = (num / 1000).toFixed(1).replace(/\.0$/, '');
            return k + 'K';
        }
        return String(Math.round(num * 10) / 10);
    }

    function getPositiveScoreFromList(list) {
        if (!Array.isArray(list)) return 0;
        const fireItem = list.find(function (item) { return item && item.type === 'fire'; });
        const niceItem = list.find(function (item) { return item && item.type === 'nice'; });

        const fireCount = fireItem && typeof fireItem.counter === 'number' ? fireItem.counter : 0;
        const niceCount = niceItem && typeof niceItem.counter === 'number' ? niceItem.counter : 0;

        return fireCount + niceCount;
    }

    async function fetchPositiveScore(method, id) {
        const key = method + '_' + id;
        if (Object.prototype.hasOwnProperty.call(cache, key)) {
            return cache[key];
        }

        const urls = [
            'https://cub.best/api/reactions/get/' + key,
            'https://cub.rip/api/reactions/get/' + key
        ];

        for (let i = 0; i < urls.length; i++) {
            try {
                const res = await fetch(urls[i]);
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
            if (v > 0 || fireBadge.textContent.indexOf('0') !== -1) {
                total += v;
                foundAny = true;
            }
        }

        const niceBadge = card.querySelector('.card__reaction-nice, [class*="nice"]');
        if (niceBadge && niceBadge.textContent) {
            const v = parseMetricValue(niceBadge.textContent);
            if (v > 0 || niceBadge.textContent.indexOf('0') !== -1) {
                total += v;
                foundAny = true;
            }
        }

        return foundAny ? total : null;
    }

    function renderScoreBadge(card, score) {
        const targetContainer =
            card.querySelector('.card__view, .card__box, .card__img-box') || card;

        let badge = card.querySelector('.lampa-fire-sum-badge');
        if (!badge) {
            badge = document.createElement('div');
            badge.className = 'lampa-fire-sum-badge';
            badge.style.position = 'absolute';
            badge.style.top = '6px';
            badge.style.left = '6px';
            badge.style.zIndex = '15';
            badge.style.display = 'inline-flex';
            badge.style.alignItems = 'center';
            badge.style.gap = '6px';
            badge.style.padding = '3px 9px';
            badge.style.borderRadius = '8px';
            badge.style.background = 'rgba(0, 0, 0, 0.78)';
            badge.style.color = '#fff';
            badge.style.fontSize = '19px';
            badge.style.fontWeight = '700';
            badge.style.lineHeight = '1.15';
            badge.style.pointerEvents = 'none';
            badge.style.backdropFilter = 'blur(3px)';

            const iconEl = document.createElement('span');
            iconEl.className = 'lampa-fire-sum-icon';
            iconEl.textContent = '⭐';
            iconEl.style.fontSize = '28px';
            iconEl.style.lineHeight = '1';
            iconEl.style.display = 'inline-block';

            const valEl = document.createElement('span');
            valEl.className = 'lampa-fire-sum-val';
            valEl.style.fontSize = '19px';
            valEl.style.lineHeight = '1.15';
            valEl.style.display = 'inline-block';

            badge.appendChild(iconEl);
            badge.appendChild(valEl);

            const computedPos = window.getComputedStyle(targetContainer).position;
            if (!computedPos || computedPos === 'static') {
                targetContainer.style.position = 'relative';
            }

            targetContainer.appendChild(badge);
        }

        badge.style.fontSize = '19px';

        const iconEl = badge.querySelector('.lampa-fire-sum-icon');
        if (iconEl) {
            iconEl.style.fontSize = '28px';
        }

        const valEl = badge.querySelector('.lampa-fire-sum-val');
        if (valEl) {
            valEl.style.fontSize = '19px';
            valEl.textContent = formatScore(score);
        }
    }

    async function runWithConcurrency(items, limit, worker) {
        const queue = items.slice();
        const runners = Array.from({ length: Math.min(limit, queue.length) }, async function () {
            while (queue.length) {
                const item = queue.shift();
                await worker(item);
            }
        });
        await Promise.all(runners);
    }

    async function sortCardsByFire(options) {
        const silentWhenEmpty = Boolean(options && options.silentWhenEmpty);
        if (isSorting) return;
        isSorting = true;

        try {
            const visibleCards = Array.from(document.querySelectorAll('.card'))
                .filter(function (el) { return el.offsetParent !== null && getCardData(el) !== null; });

            if (!visibleCards.length) {
                if (!silentWhenEmpty && window.Lampa && Lampa.Noty) {
                    Lampa.Noty.show('Режим 🔥 + 👍 > увімкнено. Натисніть «Розпочати пошук» або дочекайтесь карток.');
                }
                return;
            }

            if (window.Lampa && Lampa.Noty) {
                Lampa.Noty.show('Сортування за 🔥 + 👍 >...');
            }

            await runWithConcurrency(visibleCards, 6, async function (card) {
                const data = getCardData(card);
                const key = data && data.id ? (getMethod(data) + '_' + data.id) : null;

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
                renderScoreBadge(card, normalized);
            });

            const groups = new Map();
            for (let i = 0; i < visibleCards.length; i++) {
                const card = visibleCards[i];
                const parent = card.parentElement;
                if (!parent) continue;
                if (!groups.has(parent)) groups.set(parent, []);
                groups.get(parent).push(card);
            }

            groups.forEach(function (cards, parent) {
                if (cards.length < 2) return;

                cards.sort(function (a, b) {
                    const fa = parseFloat(a.dataset.fireSortCount || '0') || 0;
                    const fb = parseFloat(b.dataset.fireSortCount || '0') || 0;
                    if (fb !== fa) return fb - fa;
                    return 0;
                });

                cards.forEach(function (card) { parent.appendChild(card); });
            });

            if (window.Lampa && Lampa.Noty) {
                Lampa.Noty.show('Відсортовано за 🔥 + 👍 >');
            }
        } finally {
            isSorting = false;
        }
    }

    function scheduleAutoSortIfNeeded() {
        if (!wantFireSort || isSorting) return;
        clearTimeout(autoSortTimer);
        autoSortTimer = setTimeout(function () {
            const hasCards = Array.from(document.querySelectorAll('.card'))
                .some(function (el) { return el.offsetParent !== null && getCardData(el) !== null; });
            if (hasCards) {
                sortCardsByFire({ silentWhenEmpty: true });
            }
        }, 350);
    }

    function isRatingScrollBody(scrollBody) {
        const box = scrollBody.closest('.selectbox, .select, [class*="selectbox"], [class*="select"]') || scrollBody.parentElement;
        const boxText = (box && box.textContent ? box.textContent : '').toLowerCase();

        const hasRatingHeader =
            boxText.indexOf('рейтинг') !== -1 ||
            boxText.indexOf('rating') !== -1 ||
            ((scrollBody.parentElement && scrollBody.parentElement.textContent || '').toLowerCase().indexOf('рейтинг') !== -1);

        const items = Array.from(scrollBody.querySelectorAll('.selectbox-item')).filter(function (item) {
            return !item.classList.contains('lampa-fire-sort-option');
        });
        if (!items.length) return false;

        const texts = items.map(function (item) {
            return (item.textContent || '').trim().toLowerCase();
        }).filter(Boolean);

        const yearLikeCount = texts.filter(function (t) {
            return /^\d{4}(\s*[-–]\s*\d{4})?$/.test(t);
        }).length;
        if (yearLikeCount >= 2) return false;

        const hasRatingRange = texts.some(function (t) {
            return /^(від|от|from)\s+\d+/.test(t);
        });

        return Boolean(hasRatingHeader || hasRatingRange);
    }

    function injectIntoOpenSelectbox(rootNode) {
        const scope = rootNode && rootNode.querySelectorAll ? rootNode : document;

        const scrollBodies = Array.from(scope.querySelectorAll('.scroll__body')).filter(function (el) {
            if (!(el instanceof HTMLElement)) return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        });

        for (let i = 0; i < scrollBodies.length; i++) {
            const scrollBody = scrollBodies[i];
            const existingOpt = scrollBody.querySelector('.lampa-fire-sort-option');
            const validRating = isRatingScrollBody(scrollBody);

            if (!validRating) {
                if (existingOpt) existingOpt.remove();
                continue;
            }

            if (existingOpt) continue;

            const items = Array.from(scrollBody.querySelectorAll('.selectbox-item')).filter(function (item) {
                return !item.classList.contains('lampa-fire-sort-option');
            });
            if (!items.length) continue;

            const sample = items[items.length - 1];
            const opt = sample.cloneNode(true);
            opt.classList.remove('active', 'focus', 'selected');
            opt.classList.add('lampa-fire-sort-option');

            const titleTarget = opt.querySelector('[class*="title"], span, div') || opt;
            titleTarget.textContent = '🔥 + 👍 >';
            opt.style.cursor = 'pointer';

            const onPick = function (e) {
                if (e) {
                    e.preventDefault();
                    e.stopPropagation();
                }
                wantFireSort = true;

                if (window.Lampa && Lampa.Select && typeof Lampa.Select.close === 'function') {
                    Lampa.Select.close();
                } else {
                    const closeBtn = document.querySelector('.selectbox__close, .selector__close, .select__close');
                    if (closeBtn) closeBtn.click();
                }
                setTimeout(function () {
                    sortCardsByFire({ silentWhenEmpty: false });
                }, 60);
            };

            opt.addEventListener('click', onPick, true);
            opt.addEventListener('hover:enter', onPick, true);

            const anyItem = items.find(function (item) {
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

    function bindSearchTriggers() {
        if (window.__lampaFireSortSearchBound) return;
        window.__lampaFireSortSearchBound = true;

        const handleSearchClick = function (e) {
            if (!wantFireSort) return;
            const target = e.target instanceof HTMLElement ? e.target : null;
            if (!target) return;
            const txt = (target.textContent || '').
