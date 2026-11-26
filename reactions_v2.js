(function () {
    'use strict';

    if (window.__lampaReactionsBadgesLoaded) return;
    window.__lampaReactionsBadgesLoaded = true;

    const cache = {};
    let enrichTimer = null;
    let hideWatched = false;

    const POSITIVE_TYPES = ['fire', 'nice', 'think'];
    const NEGATIVE_TYPES = ['bore', 'shit'];

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

    function extractIdsFromCollection(list, targetSet) {
        if (!Array.isArray(list)) return;
        for (let i = 0; i < list.length; i++) {
            const entry = list[i];
            const rawId = entry && (entry.id || (entry.card && entry.card.id));
            if (rawId !== undefined && rawId !== null) {
                targetSet.add(String(rawId));
            }
        }
    }

    function collectWatchedAndLikedIds() {
        const ids = new Set();

        try {
            if (window.Lampa && Lampa.Favorite && typeof Lampa.Favorite.get === 'function') {
                const types = ['history', 'like'];
                for (let i = 0; i < types.length; i++) {
                    extractIdsFromCollection(Lampa.Favorite.get({ type: types[i] }), ids);
                }
            }
        } catch (_) {}

        try {
            if (window.Lampa && Lampa.Storage && typeof Lampa.Storage.get === 'function') {
                extractIdsFromCollection(Lampa.Storage.get('history'), ids);
            }
        } catch (_) {}

        return ids;
    }

    function isMainScreen() {
        try {
            const href = String(window.location.href || '').toLowerCase();
            if (href.indexOf('component=main') !== -1) return true;
            if (window.Lampa && Lampa.Activity && typeof Lampa.Activity.active === 'function') {
                const act = Lampa.Activity.active();
                if (act && act.component === 'main') return true;
            }
        } catch (_) {}
        return false;
    }

    function isCardHidden(card) {
        return Boolean(card && card.dataset && card.dataset.hiddenByPlugin === '1');
    }

    function setCardHidden(card, hidden) {
        if (!(card instanceof HTMLElement)) return;

        if (hidden) {
            if (card.dataset.origStyle === undefined) {
                card.dataset.origStyle = card.getAttribute('style') || '';
            }
            card.style.position = 'absolute';
            card.style.left = '-9999px';
            card.style.visibility = 'hidden';
            card.style.pointerEvents = 'none';
            card.classList.remove('focus');
            card.dataset.hiddenByPlugin = '1';
        } else if (card.dataset.hiddenByPlugin === '1') {
            if (card.dataset.origStyle) {
                card.setAttribute('style', card.dataset.origStyle);
            } else {
                card.removeAttribute('style');
            }
            delete card.dataset.origStyle;
            delete card.dataset.hiddenByPlugin;
        }
    }

    function restoreHiddenCards() {
        const hiddenCards = Array.from(document.querySelectorAll('.card[data-hidden-by-plugin="1"]'));
        for (let i = 0; i < hiddenCards.length; i++) {
            setCardHidden(hiddenCards[i], false);
        }
    }

    function isCardWatchedOrLiked(card, idsSet) {
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
            if (idsSet.has(String(data.id))) return true;
            if (data.viewed === true || data.watched === true) return true;
        }

        return false;
    }

    function moveFocusAwayFromHiddenCard(cards) {
        const focusedCard = cards.find(function (c) {
            return c.classList.contains('focus') || c.matches(':focus') || c.contains(document.activeElement);
        });
        if (!focusedCard || !isCardHidden(focusedCard)) return;

        const nextVisible = cards.find(function (c) {
            return c !== focusedCard && !isCardHidden(c) && c.offsetParent !== null;
        });

        focusedCard.classList.remove('focus');

        if (nextVisible) {
            nextVisible.classList.add('focus');
            if (typeof nextVisible.focus === 'function') {
                try { nextVisible.focus({ preventScroll: true }); } catch (_) {}
            }
            if (window.$) {
                try { window.$(nextVisible).trigger('hover:focus'); } catch (_) {}
            }
        }
    }

    function applyWatchedFilter() {
        if (!hideWatched || isMainScreen()) {
            restoreHiddenCards();
            return;
        }

        const cards = Array.from(document.querySelectorAll('.card'));
        if (!cards.length) return;

        const idsSet = collectWatchedAndLikedIds();

        for (let i = 0; i < cards.length; i++) {
            const card = cards[i];
            if (!getCardData(card)) continue;

            if (isCardWatchedOrLiked(card, idsSet)) {
                setCardHidden(card, true);
            } else if (isCardHidden(card)) {
                setCardHidden(card, false);
            }
        }

        moveFocusAwayFromHiddenCard(cards);
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
            ensurePosterBadges(card, totals);
        });
    }

    function schedulePosterEnrich() {
        clearTimeout(enrichTimer);
        enrichTimer = setTimeout(function () {
            const cards = Array.from(document.querySelectorAll('.card'))
                .filter(function (el) {
                    return getCardData(el) !== null &&
                        !isCardHidden(el) &&
                        !el.querySelector('.lampa-like-dislike-wrap');
                });

            if (cards.length) {
                populatePosterReactions(cards);
            }
        }, 300);
    }

    function isSubFilterTitle(title) {
        return (
            title === 'жанр' ||
            title === 'жанри' ||
            title === 'жанры' ||
            title === 'genre' ||
            title === 'рік' ||
            title === 'год' ||
            title === 'year' ||
            title === 'країна' ||
            title === 'страна' ||
            title === 'country' ||
            title.indexOf('рейтинг') !== -1 ||
            title.indexOf('rating') !== -1 ||
            title.indexOf('сортув') !== -1 ||
            title.indexOf('сортиров') !== -1 ||
            title.indexOf('sort') !== -1
        );
    }

    function isFilterMenuParams(params) {
        if (!params || !Array.isArray(params.items) || params.items.length < 2) return false;

        const title = String(params.title || '').trim().toLowerCase();
        if (isSubFilterTitle(title)) return false;

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

        let matchedCriteria = 0;
        if (itemTitles.some(function (t) { return t.indexOf('жанр') !== -1 || t.indexOf('genre') !== -1; })) matchedCriteria++;
        if (itemTitles.some(function (t) { return t.indexOf('рік') !== -1 || t.indexOf('год') !== -1 || t.indexOf('year') !== -1; })) matchedCriteria++;
        if (itemTitles.some(function (t) { return t.indexOf('країна') !== -1 || t.indexOf('страна') !== -1 || t.indexOf('country') !== -1; })) matchedCriteria++;
        if (itemTitles.some(function (t) { return t.indexOf('рейтинг') !== -1 || t.indexOf('rating') !== -1; })) matchedCriteria++;
        if (itemTitles.some(function (t) { return t.indexOf('сортув') !== -1 || t.indexOf('сортиров') !== -1 || t.indexOf('sort') !== -1; })) matchedCriteria++;

        return matchedCriteria >= 2;
    }

    function getHideWatchedLabel() {
        return (hideWatched ? '☑ ' : '☐ ') + 'Сховати переглянуті';
    }

    function toggleHideWatched() {
        hideWatched = !hideWatched;
        applyWatchedFilter();

        if (window.Lampa && Lampa.Select && typeof Lampa.Select.close === 'function') {
            Lampa.Select.close();
        } else {
            const closeBtn = document.querySelector('.selectbox__close, .selector__close, .select__close');
            if (closeBtn instanceof HTMLElement) closeBtn.click();
        }

        if (window.Lampa && Lampa.Noty) {
            Lampa.Noty.show(
                hideWatched
                    ? 'Переглянуті та вподобані картки приховано'
                    : 'Приховані картки знову показано'
            );
        }
    }

    function patchFilterSelect() {
        if (!window.Lampa || !Lampa.Select || typeof Lampa.Select.show !== 'function') {
            return false;
        }
        if (Lampa.Select.__hideWatchedPatched) return true;

        const origShow = Lampa.Select.show.bind(Lampa.Select);

        Lampa.Select.show = function (params) {
            if (params && Array.isArray(params.items) && isFilterMenuParams(params)) {
                const origOnSelect = params.onSelect;
                const alreadyHasOption = params.items.some(function (it) {
                    return it && it.__isHideWatchedOption;
                });

                const nextItems = alreadyHasOption
                    ? params.items.map(function (it) {
                        if (it && it.__isHideWatchedOption) {
                            return Object.assign({}, it, { title: getHideWatchedLabel() });
                        }
                        return it;
                    })
                    : params.items.concat([{
                        title: getHideWatchedLabel(),
                        __isHideWatchedOption: true
                    }]);

                params = Object.assign({}, params, {
                    items: nextItems,
                    onSelect: function (item) {
                        if (item && item.__isHideWatchedOption) {
                            toggleHideWatched();
                            return;
                        }
                        if (typeof origOnSelect === 'function') {
                            return origOnSelect.apply(this, arguments);
                        }
                    }
                });
            }

            return origShow(params);
        };

        Lampa.Select.__hideWatchedPatched = true;
        return true;
    }

    function init() {
        schedulePosterEnrich();

        if (!patchFilterSelect()) {
            let attempts = 0;
            const waitTimer = setInterval(function () {
                attempts++;
                if (patchFilterSelect() || attempts > 50) {
                    clearInterval(waitTimer);
                }
            }, 100);
        }

        if (!window.__lampaReactionsBadgesObserver) {
            let timer = null;
            window.__lampaReactionsBadgesObserver = new MutationObserver(function (mutations) {
                if (timer) return;
                timer = setTimeout(function () {
                    timer = null;
                    patchFilterSelect();
                    const hasNewCards = mutations.some(function (m) {
                        return Array.from(m.addedNodes).some(function (n) {
                            return n instanceof HTMLElement &&
                                (n.matches('.card') || (n.querySelector && n.querySelector('.card')));
                        });
                    });
                    if (hasNewCards) {
                        if (hideWatched && !isMainScreen()) {
                            applyWatchedFilter();
                        } else if (isMainScreen()) {
                            restoreHiddenCards();
                        }
                        schedulePosterEnrich();
                    }
                }, 200);
            });
            window.__lampaReactionsBadgesObserver.observe(document.body, {
                childList: true,
                subtree: true
            });
        }
    }

    init();
})();
