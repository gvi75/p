function injectIntoOpenSelectbox(rootNode) {
        const scope = rootNode && rootNode.querySelectorAll ? rootNode : document;

        const scrollBodies = Array.from(scope.querySelectorAll('.scroll__body')).filter(el => {
            if (!(el instanceof HTMLElement)) return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        });

        for (const scrollBody of scrollBodies) {
            if (scrollBody.querySelector('.lampa-fire-sort-option')) continue;

            const items = Array.from(scrollBody.querySelectorAll('.selectbox-item'));
            if (!items.length) continue;

            const isRatingMenu = items.some(item => {
                const txt = (item.textContent || '').trim().toLowerCase();
                return (
                    txt === 'будь-який' ||
                    txt === 'любой' ||
                    txt === 'any' ||
                    /^від\s+\d+/.test(txt) ||
                    /^от\s+\d+/.test(txt) ||
                    /^from\s+\d+/.test(txt)
                );
            });

            if (!isRatingMenu) continue;

            const sample = items[items.length - 1];
            const opt = sample.cloneNode(true);
            opt.classList.remove('active', 'focus', 'selected');
            opt.classList.add('lampa-fire-sort-option');

            const titleTarget = opt.querySelector('[class*="title"], span, div') || opt;
            titleTarget.textContent = '🔥 >';
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

            scrollBody.appendChild(opt);
        }
    }
