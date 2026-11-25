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


// Loads a complete catalogue before any sorted cards are rendered.
// The caller owns the progress UI and can cancel by setting job.cancelled = true.
async function loadReactionCatalog(params, job, onProgress) {
    const REQUEST_TIMEOUT = 20000;
    const DAY = 86400000;
    const sourceName = params && params.source;
    const provider = window.Lampa && Lampa.Api && Lampa.Api.sources && Lampa.Api.sources[sourceName];
    const allCards = new Map();
    let shardsCompleted = 0;
    let shardsPending = 1;
    let currentRange = "";
    let checkedReactions = false;

    function problem(message, cancelled) {
        const error = new Error(message);
        error.code = cancelled ? 'REACTIONS_CANCELLED' : 'REACTIONS_CATALOG_ERROR';
        error.cancelled = !!cancelled;
        return error;
    }

    function checkCancelled() {
        if (job && job.cancelled) throw problem('Сортування скасовано.', true);
    }

    function report(page, totalPages, currentCards) {
        checkCancelled();
        if (typeof onProgress !== 'function') return;
        let loaded = allCards.size;
        if (currentCards) currentCards.forEach(function (_, key) {
            if (!allCards.has(key)) loaded++;
        });
        onProgress({phase: 'catalog', loaded: loaded, page: page,
            totalPages: totalPages, shardsCompleted: shardsCompleted, shardsPending: shardsPending, range: currentRange});
    }

    function splitUrl(url) {
        if (typeof url !== 'string' || !url || url.indexOf('#') !== -1) {
            throw problem('Некоректний запит каталогу. Повторно виберіть фільтри.');
        }
        const question = url.indexOf('?');
        return {path: question < 0 ? url : url.slice(0, question),
            query: new URLSearchParams(question < 0 ? '' : url.slice(question + 1))};
    }

    function joinUrl(parts) {
        const query = parts.query.toString();
        return parts.path + (query ? '?' + query : '');
    }

    function cardKey(card, url) {
        if (!card || typeof card !== 'object' || Array.isArray(card) ||
            (typeof card.id !== 'number' && typeof card.id !== 'string') ||
            (typeof card.id === 'string' && !/^\d+$/.test(card.id)) ||
            !Number.isSafeInteger(Number(card.id)) || Number(card.id) < 1) {
            throw problem('Каталог повернув картку без коректного ID. Сортування зупинено.');
        }
        let method = card.media_type;
        if (method !== 'movie' && method !== 'tv') {
            const match = /^discover\/(movie|tv)(?:\?|$)/.exec(url);
            const category = splitUrl(url).query.get('cat');
            method = match ? match[1] : (category === 'movie' || category === 'tv') ? category : card.name ? 'tv' : 'movie';
        }
        return method + '_' + Number(card.id);
    }

    function requestPage(url, page) {
        checkCancelled();
        return new Promise(function (resolve, reject) {
            let settled = false;
            let timeout;
            let cancellation;
            // Lampa's TMDB list may advance this local page when its release filter
            // removes an entire page. Never share this object with an activity.
            const request = Object.assign({}, params, {url: url, page: page});
            delete request.filter; // Already included in the normalized URL.

            function finish(error, data) {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                clearInterval(cancellation);
                if (error) reject(error); else resolve({data: data, requested: page, actual: request.page});
            }

            timeout = setTimeout(function () {
                finish(problem('Каталог не відповів за 20 секунд. Спробуйте ще раз.'));
            }, REQUEST_TIMEOUT);
            cancellation = setInterval(function () {
                if (job && job.cancelled) finish(problem('Сортування скасовано.', true));
            }, 100);
            try {
                provider.list(request, function (data) {
                    if (job && job.cancelled) finish(problem('Сортування скасовано.', true));
                    else finish(null, data);
                }, function () {
                    finish(problem('Не вдалося завантажити всі сторінки каталогу. Спробуйте ще раз.'));
                });
            } catch (_) {
                finish(problem('Помилка завантаження каталогу. Спробуйте ще раз.'));
            }
        });
    }

    function validate(response) {
        const data = response.data;
        if (!data || typeof data !== 'object' || data.success === false || data.secuses === false ||
            !Array.isArray(data.results) || !Number.isSafeInteger(data.page) || data.page < 1 ||
            !Number.isSafeInteger(data.total_pages) || data.total_pages < 0 ||
            (data.total_results !== undefined && (!Number.isSafeInteger(data.total_results) || data.total_results < 0))) {
            throw problem('Каталог повернув некоректну відповідь. Неповне сортування не показано.');
        }
        const maxAdvance = sourceName === 'tmdb' ? 5 : 0;
        if (!Number.isSafeInteger(response.actual) || response.actual < response.requested ||
            response.actual > response.requested + maxAdvance || data.page !== response.actual ||
            (data.total_pages > 0 && data.page > data.total_pages) ||
            (data.total_pages === 0 && (data.page !== 1 || data.results.length || data.total_results > 0)) ||
            (data.total_results === 0 && data.results.length)) {
            throw problem('Порушено пагінацію каталогу. Спробуйте повторити сортування.');
        }
        return data;
    }

    function parseDay(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
        const time = Date.parse(value + 'T00:00:00Z');
        if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) return null;
        return Math.floor(time / DAY);
    }

    function boundedRange(parts) {
        const match = /^discover\/(movie|tv)$/.exec(parts.path);
        if (!match) throw problem('Для великої вибірки TMDB потрібен фільтр року або дат.');
        const field = match[1] === 'movie' ? 'primary_release_date' : 'first_air_date';
        const yearField = match[1] === 'movie' ? 'primary_release_year' : 'first_air_date_year';
        const values = [field + '.gte', field + '.lte', yearField];
        values.forEach(function (key) {
            if (parts.query.getAll(key).length > 1) {
                throw problem('Неоднозначний фільтр дат. Повторно виберіть рік.');
            }
        });
        const lower = parts.query.get(field + '.gte');
        const upper = parts.query.get(field + '.lte');
        let start = lower === null ? null : parseDay(lower);
        let end = upper === null ? null : parseDay(upper);
        if ((lower !== null && start === null) || (upper !== null && end === null)) {
            throw problem('Некоректний діапазон дат у фільтрі.');
        }
        const year = parts.query.get(yearField);
        if (year !== null) {
            if (!/^\d{4}$/.test(year) || Number(year) < 1) throw problem('Некоректний рік у фільтрі.');
            const yearStart = parseDay(year + '-01-01');
            const yearEnd = parseDay(year + '-12-31');
            start = start === null ? yearStart : Math.max(start, yearStart);
            end = end === null ? yearEnd : Math.min(end, yearEnd);
        }
        if (start === null || end === null || start > end) {
            throw problem('TMDB має понад 500 сторінок. Виберіть рік або повний діапазон дат і повторіть сортування.');
        }
        return {field: field, start: start, end: end};
    }

    function divide(url) {
        const parts = splitUrl(url);
        const range = boundedRange(parts);
        if (range.start === range.end) {
            throw problem('Навіть за один день TMDB має понад 500 сторінок. Звузьте фільтр жанром або мовою.');
        }
        const middle = Math.floor((range.start + range.end) / 2);
        return [[range.start, middle], [middle + 1, range.end]].map(function (span) {
            const query = new URLSearchParams(parts.query.toString());
            query.set(range.field + '.gte', new Date(span[0] * DAY).toISOString().slice(0, 10));
            query.set(range.field + '.lte', new Date(span[1] * DAY).toISOString().slice(0, 10));
            return joinUrl({path: parts.path, query: query});
        });
    }

    checkCancelled();
    if ((sourceName !== 'tmdb' && sourceName !== 'cub') || !provider || typeof provider.list !== 'function') {
        throw problem('Це джерело каталогу не підтримує сортування за лайками.');
    }
    const initial = splitUrl(params.url);
    if (params.filter) Object.keys(params.filter).forEach(function (key) {
        if (key === 'page') return;
        const value = String(params.filter[key]);
        if (initial.query.has(key) && initial.query.get(key) !== value) {
            throw problem('Суперечливі параметри фільтра. Повторно виберіть фільтри.');
        }
        initial.query.set(key, value);
    });
    initial.query.delete('page');
    const pending = [joinUrl(initial)];

    while (pending.length) {
        checkCancelled();
        const url = pending.shift();
        const rangeQuery = splitUrl(url).query;
        const dateField = url.indexOf('discover/tv') === 0 ? 'first_air_date' : 'primary_release_date';
        currentRange = [rangeQuery.get(dateField + '.gte'), rangeQuery.get(dateField + '.lte')].filter(Boolean).join(' — ');
        const currentCards = new Map();
        const fingerprints = new Set();
        let nextPage = 1;
        let totalPages = 1;
        let divided = false;
        do {
            checkCancelled();
            const response = await requestPage(url, nextPage);
            checkCancelled();
            const data = validate(response);
            if (!checkedReactions && data.results.length && job.checkReactions) {
                await job.checkReactions(data.results[0]);
                checkCancelled();
                checkedReactions = true;
            }
            // Split before collecting a page from an overlarge shard, including
            // the case where its page count grows while it is being loaded.
            if (sourceName === 'tmdb' && data.total_pages > 500) {
                pending.unshift.apply(pending, divide(url));
                shardsPending = pending.length;
                divided = true;
                report(data.page, data.total_pages);
                break;
            }
            totalPages = Math.max(totalPages, data.total_pages);
            const keys = data.results.map(function (card) { return cardKey(card, url); });
            if (keys.length) {
                const fingerprint = keys.slice().sort().join('|');
                if (fingerprints.has(fingerprint)) {
                    throw problem('Каталог повторив ту саму сторінку. Неповне сортування не показано.');
                }
                fingerprints.add(fingerprint);
            }
            data.results.forEach(function (card, index) {
                if (!currentCards.has(keys[index])) currentCards.set(keys[index], card);
            });
            report(data.page, data.total_pages, currentCards);
            nextPage = data.page + 1;
        } while (nextPage <= totalPages);
        if (!divided) {
            currentCards.forEach(function (card, key) {
                if (!allCards.has(key)) allCards.set(key, card);
            });
            shardsCompleted++;
            shardsPending = pending.length;
            report(nextPage - 1, totalPages);
        }
    }
    checkCancelled();
    return Array.from(allCards.values());
}

    // Only this filter's newly created activity gets a data loader. Lampa still
    // builds the query, cards, navigation and pagination itself.
    let reactionSortInstalled = false;
    let armedSort = false;
    let filterMenu = null;
    let ratingMenu = null;
    const LIKE_SORT = '__positiveReactions';

    function installReactionSort() {
        if (reactionSortInstalled) return true;
        const L = window.Lampa;
        if (!L || !L.Select || !L.Select.listener || !L.Listener || !L.Maker) return false;
        reactionSortInstalled = true;
        L.Listener.follow('activity', function (event) {
            const object = event.object;
            if (event.type !== 'init' || !object || object.component !== 'category_full' ||
                !(armedSort || object.reactions_positive)) return;
            if (!/^(discover\/(movie|tv)\?|\?cat=)/.test(object.url || '')) return;
            armedSort = false;
            const component = object.activity && object.activity.component;
            const loader = component && component.components && component.components.find(function (module) {
                return typeof module.onCreate === 'function' && typeof module.onNext === 'function' &&
                    typeof module.onInstance === 'function';
            });
            if (!loader || !component.unuse) {
                L.Noty.show('Ця версія Lampa не підтримує сортування за лайками. Залишено звичайний порядок.');
                delete object.reactions_positive;
                return;
            }
            object.reactions_positive = true;
            object.page = 1;
            if (object.title.indexOf('👍 >') < 0) object.title += ' · 👍 >';
            component.unuse(loader);
            attachReactionSort(component, object, loader.onInstance);
        });
        L.Select.listener.follow('preshow', function (event) {
            const menu = event.active;
            if (!menu || !Array.isArray(menu.items)) return;
            const search = menu.items.find(function (item) { return item.search === true; });
            const type = menu.items.find(function (item) {
                return item.items && item.items.some(function (entry) { return entry.cat === 'movie'; });
            });
            const rating = menu.items.find(function (item) {
                return item.items && item.items.some(function (entry) { return entry.start === 8; }) &&
                    item.items.some(function (entry) { return entry.voite === '1-3'; });
            });
            if (search && type && rating && typeof menu.onSelect === 'function') {
                filterMenu = menu;
                ratingMenu = rating;
                if (!rating.items.some(function (entry) { return entry[LIKE_SORT]; })) {
                    const choice = {title: '👍 >', subtitle: 'Позитивні реакції: від більшого до меншого'};
                    choice[LIKE_SORT] = true;
                    rating.items.splice(1, 0, choice);
                }
                const original = menu.onSelect;
                menu.onSelect = function (item) {
                    const sort = item.search && rating.items.some(function (entry) {
                        return entry[LIKE_SORT] && entry.selected;
                    });
                    armedSort = !!sort;
                    try { return original.apply(this, arguments); }
                    finally { armedSort = false; }
                };
            } else if (ratingMenu && menu.items === ratingMenu.items && typeof menu.onSelect === 'function') {
                const original = menu.onSelect;
                menu.onSelect = function (item) {
                    if (!item[LIKE_SORT]) return original.apply(this, arguments);
                    menu.items.forEach(function (entry) { entry.selected = entry === item; });
                    const search = filterMenu.items.find(function (entry) { return entry.search; });
                    filterMenu.onSelect(search);
                };
            }
        });
        return true;
    }

    // Keep one completed catalogue in this Lampa session, so Refresh retries
    // missing reactions instead of downloading thousands of catalogue pages again.
    let reactionResume = null;
    let reactionSessionNumber = 0;
    function attachReactionSort(component, object, onInstance) {
        if (!object.reactions_session) object.reactions_session = String(Date.now()) + '_' + (++reactionSessionNumber);
        const resumeKey = object.source + ':' + object.url + ':' + object.reactions_session;
        if (!reactionResume || reactionResume.key !== resumeKey) reactionResume = {key: resumeKey, cards: null};
        const resume = reactionResume;
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
            report(resume.cards ? 'Продовження отримання реакцій…' : 'Завантаження всіх результатів фільтра…');
            let done = 0;
            let total = 0;
            try {
                current.checkReactions = async function (card) {
                    report('Перевірка доступності реакцій CUB…');
                    if (!await fetchCardTotals(getMethod(card), card.id, current)) {
                        throw new Error('CUB не відповідає. Завантаження всього каталогу не розпочато. Спробуйте пізніше.');
                    }
                };
                const cards = resume.cards || await loadReactionCatalog(object, current, function (state) {
                    report('Каталог: ' + state.loaded + ' карток. ' +
                        (state.range ? 'Діапазон ' + state.range + '. ' : '') + 'Сторінка ' + state.page + ' / ' + state.totalPages + '.');
                });
                if (current.cancelled || job !== current) return;
                resume.cards = cards;
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
