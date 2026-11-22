function injectIntoOpenSelectbox(rootNode) {
        const scope = rootNode && rootNode.querySelectorAll ? rootNode : document;

        // Шукаємо відкриті списки вибору або області, де з'являються пункти рейтингу
        const candidates = Array.from(scope.querySelectorAll(
            '.selectbox__body, .selectbox, .select, [class*="selectbox"], [class*="select__"], .scroll__body'
        )).filter(el => {
            if (!(el instanceof HTMLElement)) return false;
            if (el.offsetParent === null) return false;
            return true;
        });

        // Додаємо document.body про всяк випадок, якщо панель рендериться без проміжної обгортки
        if (!candidates.includes(document.body)) {
            candidates.push(document.body);
        }

        for (const box of candidates) {
            if (box.querySelector('.lampa-fire-sort-option')) continue;

            // Шукаємо елементи списку, які виглядають як варіанти рейтингу
            const items = Array.from(box.querySelectorAll('div, li, button, a')).filter(el => {
                if (!(el instanceof HTMLElement)) return false;
                if (el.offsetParent === null) return false;
                if (el.classList.contains('lampa-fire-sort-option')) return false;
                // Беремо лише "листові" або майже листові пункти списку, не великі контейнери
                if (el.children.length > 2) return false;

                const txt = (el.textContent || '').trim().toLowerCase();
                if (!txt || txt.length > 30) return false;

                return (
                    txt === 'будь-який' ||
                    txt === 'любой' ||
                    txt === 'any' ||
                    /^від\s+\d+/.test(txt) ||
                    /^от\s+\d+/.test(txt) ||
                    /^from\s+\d+/.test(txt)
                );
            });

            if (!items.length) continue;

            const sample = items[items.length - 1];
            const parent = sample.parentElement;
            if (!parent || parent.querySelector('.lampa-fire-sort-option')) continue;

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
                }, 50);
            };

            opt.addEventListener('click', onPick, true);
            opt.addEventListener('hover:enter', onPick, true);

            parent.appendChild(opt);
            break;
        }
    }
