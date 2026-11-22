(function () {
    'use strict';

    if (window.__lampaReactionsSortLoaded) return;
    window.__lampaReactionsSortLoaded = true;

    const cache = {};
    let isSorting = false;
    let wantLikeSort = false;
    let hideWatched = false;
    let selectedDecade = null;
    let autoSortTimer = null;

    const POSITIVE_TYPES = ['fire', 'nice', 'think'];
    const NEGATIVE_TYPES = ['bore', 'shit'];

    const CUSTOM_DECADE_RANGES = [
        '2020 - 2029',
        '2010 - 2019',
        '2000 - 2009',
        '1990 - 1999',
        '1980 - 1989',
        '1970 - 1979',
        '1960 - 1969',
        '1950 - 1959',
        '1940 - 1949',
        '1930 - 1939'
    ];

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

    function getCardYear(card, data) {
        const raw =
            (data && (data.release_date || data.first_air_date || data.year || data.release_year)) ||
            '';
        const match = String(raw).match(/\b(19\d\d|20\d\d)\b/);
        if (match) return Number(match[1]);

        if (card) {
            const yearEl = card.querySelector('.card__year, .card__age, [class*="year"]');
            if (yearEl) {
                const domMatch = String(yearEl.textContent || '').match(/\b(19\d\d|20\d\d)\b/);
                if (domMatch) return Number(domMatch[1]);
            }
        }
        return null;
    }

    function parseDecadeBounds(label) {
        const match = String(label || '').match(/(\d{4})\s*[-–]\s*(\d{4})/);
        if (!match) return null;
        return {
            start: Number(match[1]),
            end: Number(match[2])
        };
    }

    function getMethod(data) {
        if (data.media_type === 'tv' || data.media_type === 'movie') {
            return data.media_type;
        }
        return data.name ? 'tv' : 'movie';
    }

    function formatCount(val) {
        const num = Number(val) || 0;
        if (num >= 1000) {
            const k = (num / 1000).toFixed(1).replace(/\.0$/, '');
            return k + 'K';
        }
        return String(Math.round(num));
    }

    function computeTotalsFromList(list) {
        let likes = 0;
        let dislikes = 0;

        if (Array.isArray(list)) {
            for (let i = 0; i < list.length; i++) {
                const item = list[i];
                if (!item || typeof item.counter !== 'number') continue;
                if (POSITIVE_TYPES.indexOf(item.type) !== -1) {
                    likes += item.counter;
                } else if (NEGATIVE_TYPES.indexOf(item.type) !== -1) {
                    dislikes += item.counter;
                }
            }
        }

        return { likes: likes, dislikes: dislikes };
    }

    function collectWatchedIds() {
        const ids = new Set();

        try {
            if (window.Lampa && Lampa.Favorite && typeof Lampa.Favorite.get === 'function') {
                const categories = ['history', 'like', 'wath', 'watch', 'viewed', 'book', 'favorite'];
                for (let i = 0; i < categories.length; i++) {
                    const cat = Lampa.Favorite.get({ type: categories[i] });
                    if (Array.isArray(cat)) {
                        for (let j = 0; j < cat.length; j++) {
                            const entry = cat[j];
                            const rawId = entry && (entry.id || (entry.card && entry.card.id));
                            if (rawId !== undefined && rawId !== null) {
                                ids.add(String(rawId));
                            }
                        }
                    }
                }
            }
        } catch (_) {}

        try {
            if (window.Lampa && Lampa.Storage && typeof Lampa.Storage.get === 'function') {
                const hist = Lampa.Storage.get('history');
                if (Array.isArray(hist)) {
                    for (let i = 0; i < hist.length; i++) {
                        const h = hist[i];
                        const rawId = h && (h.id || (h.card && h.card.id));
                        if (rawId !== undefined && rawId !== null) {
                            ids.add(String(rawId));
                        }
                    }
                }
            }
        } catch (_) {}

        return ids;
    }

    function isCardWatched(card, watchedIds) {
        if (!card) return false;

        if (
            card.classList.contains('card--watched') ||
            card.classList.contains('watched') ||
            card.querySelector('.card__marker--watched, .icon--eye, .card--watched-icon')
        ) {
            return true;
        }

        const data = getCardData(card);
        if (data && data.id !== undefined && data.id !== null) {
            if (watchedIds.has(String(data.id))) return true;
            if (data.viewed === true || data.watched === true) return true;
        }

        return false;
    }

    function unlockScrollIfStuck() {
        try {
            const targets = [
                document.documentElement,
                document.body,
                document.querySelector('.scroll__body'),
                document.querySelector('.content'),
                document.querySelector('.main')
            ];

            for (let i = 0; i < targets.length; i++) {
                const el = targets[i];
                if (!(el instanceof HTMLElement)) continue;
                if (el.style.overflow === 'hidden') {
                    el.style.overflow = '';
                }
                if (el.style.overflowY === 'hidden') {
                    el.style.overflowY = '';
                }
            }

            const lingeringBox = document.querySelector('.selectbox--open, .selector--open');
            if (lingeringBox && lingeringBox.parentElement) {
                const isEmpty = !lingeringBox.querySelector('.selectbox-item, .selector-item');
                if (isEmpty) lingeringBox.remove();
            }
        } catch (_) {}
    }

    function closeSelectCleanly() {
        try {
            if (window.Lampa && Lampa.Select && typeof Lampa.Select.close === 'function') {
                Lampa.Select.close();
            }
        } catch (_) {}

        const closeBtn = document.querySelector('.selectbox__close, .selector__close, .select__close');
        if (closeBtn instanceof HTMLElement) {
            closeBtn.click();
        }

        setTimeout(unlockScrollIfStuck, 50);
    }

    function applyCardVisibilityFilters() {
        const cards = Array.from(document.querySelectorAll('.card'));
        if (!cards.length) return;

        const watchedIds = hideWatched ? collectWatchedIds() : null;
        const decadeBounds = selectedDecade ? parseDecadeBounds(selectedDecade) : null;

        for (let i = 0; i < cards.length; i++) {
            const card = cards[i];
            const data = getCardData(card);
            if (!data) continue;

            let shouldHide = false;

            if (hideWatched && isCardWatched(card, watchedIds)) {
                shouldHide = true;
            }

            if (!shouldHide && decadeBounds) {
                const yr = getCardYear(card, data);
                if (yr !== null && (yr < decadeBounds.start || yr > decadeBounds.end)) {
                    shouldHide = true;
                }
            }

            if (shouldHide) {
                card.style.display = 'none';
                card.dataset.hiddenByPlugin = '1';
            } else if (card.dataset.hiddenByPlugin === '1') {
                card.style.display = '';
                delete card.dataset.hiddenByPlugin;
            }
        }

        unlockScrollIfStuck();
    }

    async function fetchCardTotals(method, id) {
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
                    const totals = computeTotalsFromList(list);
                    cache[key] = totals;
                    return totals;
                }
            } catch (_) {}
        }

        const fallback = { likes: 0, dislikes: 0 };
        cache[key] = fallback;
        return fallback;
    }

    function ensurePosterBadges(card, totals) {
        const targetContainer =
            card.querySelector('.card__view, .card__box, .card__img-box') || card;

        let wrap = card.querySelector('.lampa-like-dislike-wrap');
        if (!wrap) {
            wrap = document.createElement('div');
            wrap.className = 'lampa-like-dislike-wrap';
            wrap.style.position = 'absolute';
            wrap.style.bottom = '6px';
            wrap.style.left = '6px';
            wrap.style.zIndex = '14';
            wrap.style.display = 'inline-flex';
            wrap.style.alignItems = 'center';
            wrap.style.gap = '5px';
            wrap.style.pointerEvents = 'none';

            const likeBadge = document.createElement('span');
            likeBadge.className = 'lampa-like-badge';
            likeBadge.style.display = 'inline-flex';
            likeBadge.style.alignItems = 'center';
            likeBadge.style.gap = '4px';
            likeBadge.style.padding = '6px 11px';
            likeBadge.style.borderRadius = '6px';
            likeBadge.style.background = 'rgba(20, 120, 55, 0.88)';
            likeBadge.style.color = '#fff';
            likeBadge.style.fontSize = '17px';
            likeBadge.style.fontWeight = '700';
            likeBadge.style.lineHeight = '1.2';

            const dislikeBadge = document.createElement('span');
            dislikeBadge.className = 'lampa-dislike-badge';
            dislikeBadge.style.display = 'inline-flex';
            dislikeBadge.style.alignItems = 'center';
            dislikeBadge.style.gap = '4px';
            dislikeBadge.style.padding = '6px 11px';
            dislikeBadge.style.borderRadius = '6px';
            dislikeBadge.style.background = 'rgba(145, 35, 35, 0.88)';
            dislikeBadge.style.color = '#fff';
            dislikeBadge.style.fontSize = '17px';
            dislikeBadge.style.fontWeight = '700';
            dislikeBadge.style.lineHeight = '1.2';

            wrap.appendChild(likeBadge);
            wrap.appendChild(dislikeBadge);

            const computedPos = window.getComputedStyle(targetContainer).position;
            if (!computedPos || computedPos === 'static') {
                targetContainer.style.position = 'relative';
            }

            targetContainer.appendChild(wrap);
        }

        const likeEl = wrap.querySelector('.lampa-like-badge');
        const dislikeEl = wrap.querySelector('.lampa-dislike-badge');

        if (likeEl) {
            likeEl.textContent = '👍 ' + formatCount(totals.likes);
        }
        if (dislikeEl) {
            dislikeEl.textContent = '👎 ' + formatCount(totals.dislikes);
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

    async function populatePosterReactions(cards) {
        const list = Array.isArray(cards) ? cards : [];
        if (!list.length) return;

        await runWithConcurrency(list, 6, async function (card) {
            const data = getCardData(card);
            if (!data || !data.id) return;

            const totals = await fetchCardTotals(getMethod(data), data.id);
            card.dataset.likeTotal = String(totals.likes);
            card.dataset.dislikeTotal = String(totals.dislikes);
            ensurePosterBadges(card, totals);
        });
    }

    async function sortCardsByLikes(options) {
        const opts = options || {};
        const silent = Boolean(opts.silent);
        if (isSorting) return;
        isSorting = true;

        try {
            const visibleCards = Array.from(document.querySelectorAll('.card'))
                .filter(function (el) {
                    return el.offsetParent !== null &&
                        getCardData(el) !== null &&
                        el.dataset.hiddenByPlugin !== '1';
                });

            if (!visibleCards.length) {
                if (!silent && window.Lampa && Lampa.Noty) {
                    Lampa.Noty.show('Сортування за 👍 > увімкнено. Натисніть «Розпочати пошук» або дочекайтесь карток.');
                }
                return;
            }

            if (!silent && window.Lampa && Lampa.Noty) {
                Lampa.Noty.show('Сортування за лайками (👍 >)...');
            }

            await populatePosterReactions(visibleCards);

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
                    const la = parseFloat(a.dataset.likeTotal || '0') || 0;
                    const lb = parseFloat(b.dataset.likeTotal || '0') || 0;
                    if (lb !== la) return lb - la;
                    return 0;
                });

                cards.forEach(function (card) { parent.appendChild(card); });
            });

            applyCardVisibilityFilters();

            if (!silent && window.Lampa && Lampa.Noty) {
                Lampa.Noty.show('Відсортовано за лайками (👍 >)');
            }
        } finally {
            isSorting = false;
            unlockScrollIfStuck();
        }
    }

    function schedulePosterEnrich(options) {
        const opts = options || {};
        const allowNotify = Boolean(opts.allowNotify);
        clearTimeout(autoSortTimer);
        autoSortTimer = setTimeout(function () {
            applyCardVisibilityFilters();

            const visibleCards = Array.from(document.querySelectorAll('.card'))
                .filter(function (el) {
                    return el.offsetParent !== null &&
                        getCardData(el) !== null &&
                        el.dataset.hiddenByPlugin !== '1' &&
                        !el.querySelector('.lampa-like-dislike-wrap');
                });

            if (!visibleCards.length) return;

            if (wantLikeSort) {
                sortCardsByLikes({ silent: !allowNotify });
            } else {
                populatePosterReactions(visibleCards);
            }
        }, 300);
    }

    function isYearSelectParams(params) {
        if (!params || !Array.isArray(params.items) || !params.items.length) return false;

        const title = String(params.title || '').trim().toLowerCase();
        if (
            title === 'рік' ||
            title === 'год' ||
            title === 'year' ||
            title.indexOf('рік') !== -1 ||
            title.indexOf('год') !== -1
        ) {
            return true;
        }

        const itemTitles = params.items.map(function (it) {
            return String((it && (it.title || it.name)) || '').trim().toLowerCase();
        }).filter(Boolean);

        const yearLikeCount = itemTitles.filter(function (t) {
            return /^\d{4}(\s*[-–]\s*\d{4})?$/.test(t);
        }).length;

        return yearLikeCount >= 3;
    }

    function applyYearLabelInFilterUi(label) {
        if (!label) return;
        const rows = Array.from(document.querySelectorAll('.selectbox-item, .selector-item, .filter-item, .list-item'));
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (!(row instanceof HTMLElement)) continue;
            const titleEl = row.querySelector('.selectbox-item__title, .selector-item__title, .filter-item__title, .title');
            const titleText = String((titleEl ? titleEl.textContent : row.textContent) || '').trim().toLowerCase();
            if (titleText === 'рік' || titleText === 'год' || titleText === 'year') {
                const subEl = row.querySelector('.selectbox-item__subtitle, .selector-item__subtitle, .filter-item__value, .subtitle, small');
                if (subEl && subEl !== titleEl) {
                    subEl.textContent = label;
                } else {
                    let valueNode = row.querySelector('.lampa-selected-decade-label');
                    if (!valueNode) {
                        valueNode = document.createElement('span');
                        valueNode.className = 'lampa-selected-decade-label';
                        valueNode.style.marginLeft = '8px';
                        valueNode.style.opacity = '0.85';
                        row.appendChild(valueNode);
                    }
                    valueNode.textContent = label;
                }
            }
        }
    }

    function handleCustomDecadeSelect(item, origItems, origOnSelect) {
        const rangeLabel = String((item && (item.title || item.name)) || '').trim();
        selectedDecade = rangeLabel || null;

        try {
            if (window.Lampa && Lampa.Storage && typeof Lampa.Storage.set === 'function') {
                Lampa.Storage.set('lampa_custom_decade_range', selectedDecade);
            }
        } catch (_) {}

        const bounds = parseDecadeBounds(rangeLabel);
        let matchedOrig = null;

        if (Array.isArray(origItems) && bounds) {
            matchedOrig = origItems.find(function (orig) {
                if (!orig || typeof orig !== 'object' || orig.__isCustomDecadeOption) return false;
                const cand = String(orig.value || orig.year || orig.title || orig.name || '');
                const numMatch = cand.match(/\b(19\d\d|20\d\d)\b/);
                if (!numMatch) return false;
                const yr = Number(numMatch[1]);
                return yr >= bounds.start && yr <= bounds.end;
            }) || null;
        }

        if (typeof origOnSelect === 'function') {
            try {
                if (matchedOrig) {
                    origOnSelect(Object.assign({}, matchedOrig, {
                        title: rangeLabel,
                        name: rangeLabel
                    }));
                } else {
                    origOnSelect(item);
                }
            } catch (_) {}
        }

        applyCardVisibilityFilters();
        closeSelectCleanly();

        setTimeout(function () {
            applyYearLabelInFilterUi(rangeLabel);
            unlockScrollIfStuck();
        }, 60);

        if (window.Lampa && Lampa.Noty) {
            Lampa.Noty.show('Обрано період: ' + rangeLabel);
        }
    }

    function buildDecadeItems(origItems) {
        const sample = Array.isArray(origItems) ? origItems.find(function (it) {
            return it && typeof it === 'object';
        }) : null;

        return CUSTOM_DECADE_RANGES.map(function (rangeLabel) {
            const compactValue = rangeLabel.replace(/\s+/g, '');
            const base = sample ? Object.assign({}, sample) : {};
            delete base.selected;
            delete base.active;
            delete base.checkbox;
            base.title = rangeLabel;
            base.name = rangeLabel;
            base.value = compactValue;
            base.year = compactValue;
            base.years = compactValue;
            base.__isCustomDecadeOption = true;
            return base;
        });
    }

    function isRatingSelectParams(params) {
        if (!params || !Array.isArray(params.items) || !params.items.length) return false;
        if (isYearSelectParams(params)) return false;

        const title = String(params.title || '').trim().toLowerCase();
        if (
            title.indexOf('рейтинг') !== -1 ||
            title.indexOf('рейтінг') !== -1 ||
            title.indexOf('rating') !== -1
        ) {
            return true;
        }

        const itemTitles = params.items.map(function (it) {
            return String((it && (it.title || it.name)) || '').trim().toLowerCase();
        }).filter(Boolean);

        const hasAnyOption = itemTitles.some(function (t) {
            return t === 'будь-який' || t === 'любой' || t === 'any' || t === 'все' || t === 'всі';
        });

        const hasRatingPatterns = itemTitles.some(function (t) {
            return (
                /^(від|от|from|понад|свыше|over)\s*\d+/.test(t) ||
                /^\d+(\.\d+)?\s*(\+|>\s*|=|>)/.test(t) ||
                /^[1-9](\.\d+)?$/.test(t)
            );
        });

        return Boolean(hasAnyOption && hasRatingPatterns);
    }

    function isFilterLikeSelectParams(params) {
        if (!params || !Array.isArray(params.items) || params.items.length < 2) return false;
        if (isRatingSelectParams(params) || isYearSelectParams(params)) return false;

        const title = String(params.title || '').trim().toLowerCase();
        if (
            title.indexOf('фільтр') !== -1 ||
            title.indexOf('фильтр') !== -1 ||
            title.indexOf('filter') !== -1
        ) {
            return true;
        }

        const itemTitles = params.items.map(function (it) {
            return String((it && (it.title || it.name)) || '').trim().toLowerCase();
        });

        return itemTitles.some(function (t) {
            return (
                t.indexOf('жанр') !== -1 ||
                t.indexOf('рік') !== -1 ||
                t.indexOf('год') !== -1 ||
                t.indexOf('країна') !== -1 ||
                t.indexOf('страна') !== -1 ||
                t.indexOf('рейтинг') !== -1 ||
                t.indexOf('сортув') !== -1 ||
                t.indexOf('сортиров') !== -1
            );
        });
    }

    function getHideWatchedLabel() {
        return (hideWatched ? '☑ ' : '☐ ') + 'Сховати переглянуті';
    }

    function toggleHideWatched() {
        hideWatched = !hideWatched;
        applyCardVisibilityFilters();
        closeSelectCleanly();

        if (window.Lampa && Lampa.Noty) {
            Lampa.Noty.show(
                hideWatched
                    ? 'Переглянуті картки приховано'
                    : 'Переглянуті картки знову показано'
            );
        }
    }

    function triggerLikeSortSelection() {
        wantLikeSort = true;
        closeSelectCleanly();

        setTimeout(function () {
            sortCardsByLikes({ silent: false });
        }, 80);
    }

    function patchLampaSelect() {
        if (!window.Lampa || !Lampa.Select || typeof Lampa.Select.show !== 'function') {
            return false;
        }
        if (Lampa.Select.__likeSortPatched) return true;

        const origShow = Lampa.Select.show.bind(Lampa.Select);

        Lampa.Select.show = function (params) {
            if (params && Array.isArray(params.items)) {
                const rawItems = params.items.slice();
                let nextItems = rawItems.slice();
                let modified = false;
                const isYearMenu = isYearSelectParams(params);
                const origOnSelect = params.onSelect;

                if (isYearMenu) {
                    const alreadyDecades = nextItems.some(function (it) {
                        return it && it.__isCustomDecadeOption;
                    });
                    if (!alreadyDecades) {
                        nextItems = buildDecadeItems(rawItems);
                        modified = true;
                    }
                } else if (isRatingSelectParams(params)) {
                    const alreadyHasRating = nextItems.some(function (it) {
                        return it && it.__isLikeSortOption;
                    });

                    if (!alreadyHasRating) {
                        const likeOption = {
                            title: '👍 >',
                            name: '👍 >',
                            __isLikeSortOption: true
                        };

                        const anyIndex = nextItems.findIndex(function (it) {
                            const t = String((it && (it.title || it.name)) || '').trim().toLowerCase();
                            return t === 'будь-який' || t === 'любой' || t === 'any' || t === 'все' || t === 'всі';
                        });

                        if (anyIndex !== -1) {
                            nextItems.splice(anyIndex + 1, 0, likeOption);
                        } else {
                            nextItems.unshift(likeOption);
                        }
                        modified = true;
                    }
                }

                if (isFilterLikeSelectParams(params)) {
                    const alreadyHasHide = nextItems.some(function (it) {
                        return it && it.__isHideWatchedOption;
                    });

                    if (!alreadyHasHide) {
                        nextItems.push({
                            title: getHideWatchedLabel(),
                            name: getHideWatchedLabel(),
                            __isHideWatchedOption: true
                        });
                        modified = true;
                    }
                }

                if (modified) {
                    params = Object.assign({}, params, {
                        items: nextItems,
                        onSelect: function (item) {
                            if (isYearMenu && item && item.__isCustomDecadeOption) {
                                handleCustomDecadeSelect(item, rawItems, origOnSelect);
                                return;
                            }
                            if (item && item.__isLikeSortOption) {
                                triggerLikeSortSelection();
                                return;
                            }
                            if (item && item.__isHideWatchedOption) {
                                toggleHideWatched();
                                return;
                            }
                            if (typeof origOnSelect === 'function') {
                                const res = origOnSelect.apply(this, arguments);
                                setTimeout(unlockScrollIfStuck, 80);
                                return res;
                            }
                        }
                    });
                }
            }

            const result = origShow(params);

            if (selectedDecade && isFilterLikeSelectParams(params)) {
                setTimeout(function () {
                    applyYearLabelInFilterUi(selectedDecade);
                }, 50);
            }

            return result;
        };

        Lampa.Select.__likeSortPatched = true;
        return true;
    }

    function bindSearchTriggers() {
        if (window.__lampaLikeSortSearchBound) return;
        window.__lampaLikeSortSearchBound = true;

        const handleSearchActivate = function (e) {
            const target = e.target instanceof HTMLElement ? e.target : null;
            if (!target) return;
            const txt = (target.textContent || '').trim().toLowerCase();
            if (
                txt.indexOf('розпочати пошук') !== -1 ||
                txt.indexOf('начать поиск') !== -1 ||
                txt.indexOf('start search') !== -1 ||
                target.closest('[class*="search"], [class*="submit"], [class*="apply"]')
            ) {
                setTimeout(function () {
                    unlockScrollIfStuck();
                    schedulePosterEnrich({ allowNotify: false });
                }, 400);
            }
        };

        document.addEventListener('click', handleSearchActivate, true);
        document.addEventListener('hover:enter', handleSearchActivate, true);
    }

    function init() {
        try {
            if (window.Lampa && Lampa.Storage && typeof Lampa.Storage.get === 'function') {
                const saved = Lampa.Storage.get('lampa_custom_decade_range');
                if (typeof saved === 'string' && saved.trim()) {
                    selectedDecade = saved.trim();
                }
            }
        } catch (_) {}

        bindSearchTriggers();
        schedulePosterEnrich({ allowNotify: false });

        if (!patchLampaSelect()) {
            let attempts = 0;
            const waitTimer = setInterval(function () {
                attempts++;
                if (patchLampaSelect() || attempts > 50) {
                    clearInterval(waitTimer);
                }
            }, 100);
        }

        if (!window.__lampaLikeSortObserver) {
            let timer = null;
            window.__lampaLikeSortObserver = new MutationObserver(function (mutations) {
                if (timer) return;
                timer = setTimeout(function () {
                    timer = null;
                    patchLampaSelect();
                    applyCardVisibilityFilters();
                    if (selectedDecade) {
                        applyYearLabelInFilterUi(selectedDecade);
                    }

                    const hasNewCards = mutations.some(function (m) {
                        return Array.from(m.addedNodes).some(function (n) {
                            return n instanceof HTMLElement &&
                                (n.matches('.card') || (n.querySelector && n.querySelector('.card')));
                        });
                    });
                    if (hasNewCards) {
                        schedulePosterEnrich({ allowNotify: false });
                    }
                }, 80);
            });
            window.__lampaLikeSortObserver.observe(document.body, {
                childList: true,
                subtree: true
            });
        }
    }

    init();
})();
