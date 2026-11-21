(function () {
    'use strict';

    window.__lampaPosterReactionsLoaded = true;

    const ICONS = {
        fire: '🔥',
        shit: '💩',
        nice: '👍',
        think: '🤔',
        bore: '😴'
    };

    const cache = {};
    const queue = [];
    let isProcessing = false;

    function addStyles() {
        const old = document.getElementById('lampa-poster-reactions-style');
        if (old) old.remove();

        const style = document.createElement('style');
        style.id = 'lampa-poster-reactions-style';
        style.textContent = `
            .lampa-poster-reactions {
                position: absolute;
                left: 8px;
                bottom: 8px;
                z-index: 30;
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                gap: 5px;
                pointer-events: none;
                max-width: calc(100% - 76px);
            }
            .lampa-poster-reactions__row {
                display: flex;
                flex-wrap: wrap;
                gap: 5px;
            }
            .lampa-poster-reactions__item {
                background: rgba(15, 15, 15, 0.88);
                color: #fff;
                font-size: 15px;
                font-weight: 700;
                line-height: 1.2;
                padding: 5px 8px;
                border-radius: 8px;
                display: inline-flex;
                align-items: center;
                gap: 4px;
                white-space: nowrap;
                box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45);
            }
        `;
        document.head.appendChild(style);
    }

    function formatCount(num) {
        if (typeof num !== 'number') return num;
        if (num >= 1000) {
            return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
        }
        return String(num);
    }

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

    function renderBadge(cardEl, list) {
        if (!cardEl || !cardEl.isConnected) return;

        const oldBadge = cardEl.querySelector('.lampa-poster-reactions');
        if (oldBadge) oldBadge.remove();

        if (!Array.isArray(list) || !list.length) return;

        const top = list
            .filter(item => item && item.counter > 0 && ICONS[item.type])
            .sort((a, b) => b.counter - a.counter)
            .slice(0, 3);

        if (!top.length) return;

        const target = cardEl.querySelector('.card__view') || cardEl;
        if (window.getComputedStyle(target).position === 'static') {
            target.style.position = 'relative';
        }

        const badge = document.createElement('div');
        badge.className = 'lampa-poster-reactions';

        const row = document.createElement('div');
        row.className = 'lampa-poster-reactions__row';

        top.forEach(item => {
            const pill = document.createElement('span');
            pill.className = 'lampa-poster-reactions__item';
            pill.textContent = `${ICONS[item.type]} ${formatCount(item.counter)}`;
            row.appendChild(pill);
        });

        badge.appendChild(row);
        target.appendChild(badge);
    }

    async function fetchReactions(method, id) {
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
                    const result = Array.isArray(data && data.result) ? data.result : [];
                    cache[key] = result;
                    return result;
                }
            } catch (_) {}
        }

        cache[key] = [];
        return [];
    }

    function processQueue() {
        if (isProcessing || queue.length === 0) return;
        isProcessing = true;

        const task = queue.shift();
        const key = `${task.method}_${task.id}`;

        const done = (list) => {
            renderBadge(task.el, list);
            setTimeout(() => {
                isProcessing = false;
                processQueue();
            }, 120);
        };

        if (Object.prototype.hasOwnProperty.call(cache, key)) {
            done(cache[key]);
            return;
        }

        fetchReactions(task.method, task.id).then(done);
    }

    function enqueueCard(cardEl, explicitData) {
        if (!cardEl || !(cardEl instanceof HTMLElement)) return;
        const data = explicitData || getCardData(cardEl);
        if (!data || !data.id) return;

        cardEl.dataset.reactionsQueued = '1';
        queue.push({
            el: cardEl,
            method: getMethod(data),
            id: data.id
        });
        processQueue();
    }

    function scanCards() {
        const cards = document.querySelectorAll('.card');
        cards.forEach(el => enqueueCard(el));
    }

    function init() {
        addStyles();
        scanCards();

        if (window.Lampa && Lampa.Listener) {
            Lampa.Listener.follow('card', (e) => {
                if (e.type === 'build' && e.object) {
                    const el = e.object.card && e.object.card[0] ? e.object.card[0] : e.object.card;
                    enqueueCard(el, e.object.data);
                }
            });
        }

        if (!window.__lampaReactionsObserver) {
            window.__lampaReactionsObserver = new MutationObserver((mutations) => {
                for (const m of mutations) {
                    for (const node of m.addedNodes) {
                        if (!(node instanceof HTMLElement)) continue;
                        if (node.classList && node.classList.contains('card')) {
                            enqueueCard(node);
                        } else if (node.querySelectorAll) {
                            node.querySelectorAll('.card').forEach(c => enqueueCard(c));
                        }
                    }
                }
            });
            window.__lampaReactionsObserver.observe(document.body, { childList: true, subtree: true });
        }
    }

    init();
})();
