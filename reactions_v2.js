(function () {
    'use strict';

    if (window.__lampaReactionsSortLoaded) return;
    window.__lampaReactionsSortLoaded = true;

    const cache = {};
    let isSorting = false;
    let wantLikeSort = false;
    let autoSortTimer = null;

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
            likeBadge.style.padding = '4px 9px';
            likeBadge.style.borderRadius = '6px';
            likeBadge.style.background = 'rgba(20, 120, 55, 0.88)';
            likeBadge.style.color = '#fff';
            likeBadge.style.fontSize = '15px';
            likeBadge.style.fontWeight = '700';
            likeBadge.style.lineHeight = '1.2';
          const dislikeBadge = document.createElement('span');
            dislikeBadge.className = 'lampa-dislike-badge';
            dislikeBadge.style.display = 'inline-flex';
            dislikeBadge.style.alignItems = 'center';
            dislikeBadge.style.gap = '4px';
            dislikeBadge.style.padding = '4px 9px';
            dislikeBadge.style.borderRadius = '6px';
            dislikeBadge.style.background = 'rgba(145, 35, 35, 0.88)';
            dislikeBadge.style.color = '#fff';
            dislikeBadge.style.fontSize = '15px';
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
        const silentWhenEmpty = Boolean(options && options.silentWhenEmpty);
        if (isSorting) return;
        isSorting = true;

        try {
            const visibleCards = Array.from(document.querySelectorAll('.card'))
                .filter(function (el) { return el.offsetParent !== null && getCardData(el) !== null; });

            if (!visibleCards.length) {
                if (!silentWhenEmpty && window.Lampa && Lampa.Noty) {
                    Lampa.Noty.show('Сортування за 👍 > увімкнено. Натисніть «Розпочати пошук» або дочекайтесь карток.');
                }
                return;
            }

            if (window.Lampa && Lampa.Noty) {
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

            if (window.Lampa && Lampa.Noty) {
                Lampa.Noty.show('Відсортовано за лайками (👍 >)');
            }
        } finally {
            isSorting = false;
        }
    }
  function schedulePosterEnrich() {
        clearTimeout(autoSortTimer);
        autoSortTimer = setTimeout(function () {
            const visibleCards = Array.from(document.querySelectorAll('.card'))
                .filter(function (el) {
                    return el.offsetParent !== null &&
                        getCardData(el) !== null &&
                        !el.querySelector('.lampa-like-dislike-wrap');
                });

            if (!visibleCards.length) return;

            if (wantLikeSort) {
                sortCardsByLikes({ silentWhenEmpty: true });
            } else {
                populatePosterReactions(visibleCards);
            }
        }, 300);
    }

    function isRatingSelectParams(params) {
        if (!params || !Array.isArray(params.items) || !params.items.length) return false;

        const title = String(params.title || '').trim().toLowerCase();
        const hasRatingTitle = title.indexOf('рейтинг') !== -1 || title.indexOf('rating') !== -1;

        const itemTitles = params.items.map(function (it) {
            return String((it && (it.title || it.name)) || '').trim().toLowerCase();
        }).filter(Boolean);

        const yearLikeCount = itemTitles.filter(function (t) {
            return /^\d{4}(\s*[-–]\s*\d{4})?$/.test(t);
        }).length;
        if (yearLikeCount >= 2) return false;

        const hasRatingRange = itemTitles.some(function (t) {
            return /^(від|от|from)\s+\d+/.test(t);
        });

        return Boolean(hasRatingTitle || hasRatingRange);
    }

    function triggerLikeSortSelection() {
        wantLikeSort = true;

        if (window.Lampa && Lampa.Select && typeof Lampa.Select.close === 'function') {
            Lampa.Select.close();
        } else {
            const closeBtn = document.querySelector('.selectbox__close, .selector__close, .select__close');
            if (closeBtn) closeBtn.click();
        }

        setTimeout(function () {
            sortCardsByLikes({ silentWhenEmpty: false });
        }, 80);
    }

    function patchLampaSelect() {
        if (!window.Lampa || !Lampa.Select || typeof Lampa.Select.show !== 'function') {
            return false;
        }
        if (Lampa.Select.__likeSortPatched) return true;

        const origShow = Lampa.Select.show.bind(Lampa.Select);

        Lampa.Select.show = function (params) {
            if (params && isRatingSelectParams(params)) {
                const alreadyHas = params.items.some(function (it) {
                    return it && it.__isLikeSortOption;
                });

                if (!alreadyHas) {
                    const newItems = params.items.slice();
                    const likeOption = {
                        title: '👍 >',
                        __isLikeSortOption: true
                    };

                    const anyIndex = newItems.findIndex(function (it) {
                        const t = String((it && (it.title || it.name)) || '').trim().toLowerCase();
                        return t === 'будь-який' || t === 'любой' || t === 'any';
                    });

                    if (anyIndex !== -1) {
                        newItems.splice(anyIndex + 1, 0, likeOption);
                    } else {
                        newItems.unshift(likeOption);
                    }

                    const origOnSelect = params.onSelect;
                    const origOnBack = params.onBack;

                    params = Object.assign({}, params, {
                        items: newItems,
                        onSelect: function (item) {
                            if (item && item.__isLikeSortOption) {
                                triggerLikeSortSelection();
                                if (typeof origOnBack === 'function') {
                                    origOnBack();
                                }
                                return;
                            }
                            if (typeof origOnSelect === 'function') {
                                return origOnSelect.apply(this, arguments);
                            }
                        }
                    });
                }
            }

            return origShow(params);
        };

        Lampa.Select.__likeSortPatched = true;
        return true;
    }

    function bindSearchTriggers() {
        if (window.__lampaLikeSortSearchBound) return;
        window.__lampaLikeSortSearchBound = true;

        const handleSearchActivate = function (e) {
            if (!wantLikeSort) return;
            const target = e.target instanceof HTMLElement ? e.target : null;
            if (!target) return;
            const txt = (target.textContent || '').trim().toLowerCase();
            if (
                txt.indexOf('розпочати пошук') !== -1 ||
                txt.indexOf('начать поиск') !== -1 ||
                txt.indexOf('start search') !== -1 ||
                target.closest('[class*="search"], [class*="submit"], [class*="apply"]')
            ) {
                setTimeout(function () { schedulePosterEnrich(); }, 400);
            }
        };

        document.addEventListener('click', handleSearchActivate, true);
        document.addEventListener('hover:enter', handleSearchActivate, true);
    }

    function init() {
        bindSearchTriggers();
        schedulePosterEnrich();

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

                    const hasNewCards = mutations.some(function (m) {
                        return Array.from(m.addedNodes).some(function (n) {
                            return n instanceof HTMLElement &&
                                (n.matches('.card') || (n.querySelector && n.querySelector('.card')));
                        });
                    });
                    if (hasNewCards) {
                        schedulePosterEnrich();
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
