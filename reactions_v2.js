(function () {
    'use strict';

    if (window.__lampaReactionsBadgesLoaded) return;
    window.__lampaReactionsBadgesLoaded = true;

    const cache = {};
    let enrichTimer = null;

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

    const pendingTotals = {};
    const reactionQueue = [];
    let reactionRequests = 0;

    function requestReactionJSON(url) {
        return new Promise(function (resolve, reject) {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.timeout = 12000;
            xhr.onload = function () {
                try {
                    if (xhr.status < 200 || xhr.status >= 300) {
                        const error = new Error('HTTP ' + xhr.status);
                        error.status = xhr.status;
                        const header = typeof xhr.getResponseHeader === 'function' && xhr.getResponseHeader('Retry-After');
                        const seconds = Number(header);
                        error.retryAfter = header ? (/^\d+$/.test(header) ? seconds * 1000 : Math.max(0, Date.parse(header) - Date.now())) : 0;
                        throw error;
                    }
                    const data = JSON.parse(xhr.responseText);
                    if (!data || !Array.isArray(data.result) || data.success === false || data.secuses === false) {
                        throw new Error('Invalid CUB response');
                    }
                    if (data.result.some(function (item) {
                        return !item || typeof item.counter !== 'number' || !Number.isFinite(item.counter) || item.counter < 0;
                    })) throw new Error('Invalid reaction counter');
                    resolve(computeTotalsFromList(data.result));
                } catch (error) { reject(error); }
            };
            xhr.onerror = xhr.ontimeout = xhr.onabort = function () { reject(new Error('CUB unavailable')); };
            xhr.send();
        });
    }

    let reactionCooldown = 0;
    function waitForReactionRetry(job) {
        return new Promise(function (resolve) {
            function check() {
                if ((job && job.cancelled) || Date.now() >= reactionCooldown) return resolve();
                setTimeout(check, Math.min(200, reactionCooldown - Date.now()));
            }
            check();
        });
    }

    function pumpReactions() {
        while (reactionRequests < 6 && reactionQueue.length) {
            reactionRequests++;
            reactionQueue.shift()();
        }
    }

    function fetchCardTotals(method, id, job) {
        const key = method + '_' + id;
        if (Object.prototype.hasOwnProperty.call(cache, key)) return Promise.resolve(cache[key]);
        if (pendingTotals[key]) return pendingTotals[key];
        pendingTotals[key] = new Promise(function (resolve) {
            reactionQueue.push(async function () {
                let totals = null;
                const hosts = ['https://cub.best', 'https://cub.rip'];
                // Two bounded rounds; a shared pause prevents parallel jobs from
                // immediately hammering the service after a throttling response.
                for (let attempt = 0; attempt < 2 && !totals; attempt++) {
                    if (attempt) reactionCooldown = Math.max(reactionCooldown, Date.now() + 1000);
                    for (let i = 0; i < hosts.length && !totals; i++) {
                        await waitForReactionRetry(job);
                        if (job && job.cancelled) break;
                        try {
                            totals = await requestReactionJSON(hosts[i] + '/api/reactions/get/' + key);
                            cache[key] = totals;
                        } catch (error) {
                            if (error.status === 429) reactionCooldown = Math.max(reactionCooldown, Date.now() + Math.max(5000, error.retryAfter || 0));
                        }
                    }
                    if (job && job.cancelled) break;
                }
                delete pendingTotals[key];
                reactionRequests--;
                resolve(totals); // A network error is never cached as zero likes.
                pumpReactions();
            });
        });
        pumpReactions();
        return pendingTotals[key];
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
        let nextItem = 0;
        const runners = Array.from({ length: Math.min(limit, queue.length) }, async function () {
            while (nextItem < queue.length) {
                const item = queue[nextItem++];
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
            if (totals) ensurePosterBadges(card, totals);
        });
    }

    function schedulePosterEnrich() {
        clearTimeout(enrichTimer);
        enrichTimer = setTimeout(function () {
            const cards = Array.from(document.querySelectorAll('.card'))
                .filter(function (el) {
                    return getCardData(el) !== null && !el.querySelector('.lampa-like-dislike-wrap');
                });

            if (cards.length) {
                populatePosterReactions(cards);
            }
        }, 300);
    }

    function init() {
        schedulePosterEnrich();

        if (!window.__lampaReactionsBadgesObserver) {
            let timer = null;
            window.__lampaReactionsBadgesObserver = new MutationObserver(function (mutations) {
                if (timer) return;
                timer = setTimeout(function () {
                    timer = null;
                    const hasNewCards = mutations.some(function (m) {
                        return Array.from(m.addedNodes).some(function (n) {
                            return n instanceof HTMLElement &&
                                (n.matches('.card') || (n.querySelector && n.querySelector('.card')));
                        });
                    });
                    if (hasNewCards) {
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


    let reactionSortInstalled = false;
    let filterMenu = null;
    let ratingMenu = null;
    let filterSignature = '';
    const LIKE_SORT = '__positiveReactions';
    const snapshots = new Map();
    let snapshotNumber = 0;

    function signature(menu) {
        return JSON.stringify(menu.items.filter(function (item) { return item.items; }).map(function (group) {
            return group.items.filter(function (item) { return !item[LIKE_SORT] && (item.selected || item.checked); });
        }));
    }

    function openLoadedSort() {
        const L = window.Lampa;
        const active = L.Activity.active();
        if (!active || !((active.component === 'category_full' && /^(discover\/(movie|tv)\?|\?cat=)/.test(active.url || '')) || active.component === 'reactions_loaded')) {
            return L.Noty.show('Спочатку застосуйте фільтри та відкрийте список фільмів або серіалів.');
        }
        if (signature(filterMenu) !== filterSignature) {
            return L.Noty.show('Фільтри змінено. Спочатку натисніть «Розпочати пошук», потім оберіть «👍 >».');
        }
        const component = active.activity && active.activity.component;
        const seen = new Set();
        const cards = [];
        function add(card) {
            if (!card || !card.id) return;
            const key = getMethod(card) + '_' + card.id;
            if (!seen.has(key)) { seen.add(key); cards.push(Object.assign({}, card)); }
        }
        // Read the component's data, including virtualized and buffered cards.
        // Never scan other rows or fetch another catalogue page.
        (component && component.items || []).forEach(function (item) { add(item.data); });
        (component && component.loaded || []).forEach(function (page) { page.forEach(add); });
        if (!cards.length) return L.Noty.show('У цьому списку ще немає завантажених карток.');
        const id = String(++snapshotNumber);
        snapshots.set(id, cards);
        while (snapshots.size > 2) snapshots.delete(snapshots.keys().next().value);
        L.Controller.toggle('content');
        L.Activity.push({component: 'reactions_loaded', source: active.source, url: active.url,
            reactions_snapshot: id, page: 1, card_type: true,
            title: '👍 > · ' + cards.length + ' завантажених карток'});
    }

    function installReactionSort() {
        if (reactionSortInstalled) return true;
        const L = window.Lampa;
        if (!L || !L.Select || !L.Select.listener || !L.Component || !L.Maker) return false;
        reactionSortInstalled = true;
        L.Component.add('reactions_loaded', function (object) {
            const Base = L.Component.get('category_full');
            const component = new Base(object);
            const loader = component.components.find(function (module) {
                return module.onCreate && module.onNext && module.onInstance;
            });
            if (!loader) throw new Error('Несумісна версія Lampa');
            component.unuse(loader);
            attachReactionSort(component, object, loader.onInstance, snapshots.get(object.reactions_snapshot));
            return component;
        });
        L.Select.listener.follow('preshow', function (event) {
            const menu = event.active;
            if (!menu || !Array.isArray(menu.items)) return;
            const search = menu.items.find(function (item) { return item.search === true; });
            const type = menu.items.find(function (item) { return item.items && item.items.some(function (entry) { return entry.cat === 'movie'; }); });
            const rating = menu.items.find(function (item) {
                return item.items && item.items.some(function (entry) { return entry.start === 8; }) &&
                    item.items.some(function (entry) { return entry.voite === '1-3'; });
            });
            if (search && type && rating) {
                if (filterMenu && menu.items[1] === filterMenu.items[1]) {
                    // Preserve the opening signature while navigating submenus.
                } else filterSignature = signature(menu);
                filterMenu = menu;
                ratingMenu = rating;
                if (!rating.items.some(function (entry) { return entry[LIKE_SORT]; })) {
                    const choice = {title: '👍 >', subtitle: 'Лише вже завантажені картки цього списку'};
                    choice[LIKE_SORT] = true;
                    rating.items.splice(1, 0, choice);
                }
                // Native Search applies changes and establishes the new selection.
                const original = menu.onSelect;
                menu.onSelect = function (item) {
                    if (item.search) filterSignature = signature(menu);
                    return original.apply(this, arguments);
                };
            } else if (ratingMenu && menu.items === ratingMenu.items && typeof menu.onSelect === 'function') {
                const original = menu.onSelect;
                menu.onSelect = function (item) {
                    if (item[LIKE_SORT]) return openLoadedSort();
                    return original.apply(this, arguments);
                };
            }
        });
        return true;
    }

    function attachReactionSort(component, object, onInstance, cards) {
        const resume = {cards: cards};
        let job = null;
        let sorted = null;
        let progress = null;
        const pageSize = 60;
        function slice(page) {
            return {results: sorted.slice((page - 1) * pageSize, page * pageSize),
                page: page, total_pages: Math.max(1, Math.ceil(sorted.length / pageSize)),
                total_results: sorted.length};
        }
        function cancel() { if (job) job.cancelled = true; }
        function removeProgress() { if (progress) progress.remove(); progress = null; }
        async function load() {
            cancel();
            const current = job = {cancelled: false};
            removeProgress();
            progress = document.createElement('div');
            progress.className = 'reactions-sort-progress';
            progress.setAttribute('role', 'status');
            progress.style.cssText = 'width:100%;box-sizing:border-box;flex:0 0 100%;padding:2em;font-size:1.2em;line-height:1.6';
            // The scroll element fills html's height. Siblings after it are offscreen.
            component.body.appendChild(progress);
            component.activity.loader(false);
            function report(text) {
                if (job === current && !current.cancelled && progress) {
                    progress.textContent = text + ' Натисніть «Назад», щоб скасувати.';
                }
            }
            report('Реакції для завантажених карток…');
            let done = 0;
            let total = 0;
            try {
                if (!cards) throw new Error('Цей список більше не збережено. Поверніться до фільтра та знову оберіть «👍 >».');
                total = cards.length;
                const scored = new Array(cards.length);
                await runWithConcurrency(cards.map(function (card, index) { return {card: card, index: index}; }), 6,
                    async function (entry) {
                        if (current.cancelled) return;
                        const totals = await fetchCardTotals(getMethod(entry.card), entry.card.id, current);
                        if (current.cancelled) return;
                        if (!totals) throw new Error('CUB не повернув реакції після повторних спроб.');
                        scored[entry.index] = {card: entry.card, likes: totals.likes, index: entry.index};
                        report('Реакції: ' + (++done) + ' / ' + cards.length + '.');
                    });
                if (current.cancelled || job !== current) return;
                scored.sort(function (a, b) { return b.likes - a.likes || a.index - b.index; });
                sorted = scored.map(function (entry) { return entry.card; });
                removeProgress();
                object.page = 1;
                component.build(slice(1));
            } catch (error) {
                if (current.cancelled || job !== current) return;
                current.cancelled = true;
                removeProgress();
                const known = resume.cards ? resume.cards.filter(function (card) {
                    return Object.prototype.hasOwnProperty.call(cache, getMethod(card) + '_' + card.id);
                }).length : 0;
                component.params.empty = {title: 'Сортування не завершено', descr: error.message +
                    (resume.cards ? ' Отримано реакції: ' + known + ' / ' + total +
                        '. Натисніть «Оновити»: буде використано збережений каталог і отримані реакції. Не перезавантажуйте Lampa.' : '')};
                component.empty();
            }
        }
        component.use({
            onCreate: load,
            onNext: function (resolve) { if (sorted) resolve(slice(object.page)); },
            onInstance: onInstance,
            onPause: function () { if (!sorted) cancel(); },
            onStart: function () {
                // Returning to an interrupted activity starts a new isolated job.
                if (!sorted && job && job.cancelled && progress) load();
            },
            onDestroy: function () { cancel(); sorted = null; removeProgress(); }
        });
    }

    function waitForReactionSort() {
        if (installReactionSort()) return;
        // Plugins can be loaded before Lampa finishes startup.
        if (window.Lampa && Lampa.Listener) {
            Lampa.Listener.follow('app', function (event) {
                if (event.type === 'ready') installReactionSort();
            });
        }
    }

    waitForReactionSort();
    init();
})();
