(() => {
    'use strict';
    const hasBridge = typeof window.markmapSend === 'function';
    const send = window.markmapSend || (() => {});
    const error = document.getElementById('error');
    const svg = document.getElementById('markmap-svg');
    const selection = d3.select(svg);
    const rgb = getComputedStyle(document.body).backgroundColor.match(/\d+/g)?.map(Number) || [255, 255, 255];
    const dark = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 < 128;
    const baseOptions = {
        wrapWidth: 350, duration: 300, colorScheme: dark ? 'dark' : 'light',
        plugins: [...markmap.defaultContentPlugins, markmap.mathContent],
    };
    const map = markmap.Markmap.create(svg, undefined, baseOptions);
    map.zoomBehavior.wheelDelta(event => -event.deltaY
        * (event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002)
        * (event.ctrlKey ? 10 : event.momentum === true ? 1.2 : 2.4));
    let root, active, highlighted, currentContent = '', images = new Set();
    let renderedDocument = { content: '', options: {}, customCSS: '' };
    let firstRender = true, activeLine = 0, contentVersion = 0;
    let rendering = Promise.resolve(), pendingContent, pendingCursor, updatesScheduled = false, cursorFrame;
    let pinch, pinchTransform, viewportFrame, suppressPinchWheelUntil = 0;

    // Keep native macOS pinch anchored under the gesture, using the view's public zoom behavior.
    function flushViewport() {
        viewportFrame = undefined;
        if (!pinchTransform) return;
        const transform = pinchTransform;
        pinchTransform = undefined;
        selection.interrupt().call(map.zoomBehavior.transform, transform);
    }
    function scheduleViewport() {
        if (viewportFrame === undefined) viewportFrame = requestAnimationFrame(flushViewport);
    }
    window.beginNativePinch = (x, y) => {
        if (map.options.zoom === false || !Number.isFinite(x) || !Number.isFinite(y)) return;
        flushViewport();
        pinch = { base: d3.zoomTransform(svg), x: x * svg.clientWidth, y: y * svg.clientHeight };
    };
    window.updateNativePinch = factor => {
        if (!pinch || map.options.zoom === false || !Number.isFinite(factor) || factor <= 0) return;
        const { base, x, y } = pinch;
        const [min, max] = map.scaleLimits;
        const scale = Math.max(Math.max(min, Number.EPSILON), Math.min(max, base.k * factor));
        const ratio = scale / base.k;
        pinchTransform = d3.zoomIdentity.translate(x - (x - base.x) * ratio, y - (y - base.y) * ratio).scale(scale);
        scheduleViewport();
    };
    window.endNativePinch = () => { pinch = undefined; suppressPinchWheelUntil = Date.now() + 200; };
    svg.addEventListener('wheel', event => {
        if (event.ctrlKey) {
            if (pinch || Date.now() < suppressPinchWheelUntil) {
                event.preventDefault(); event.stopImmediatePropagation();
            }
            return;
        }
    }, { capture: true, passive: false });

    function walk(node, fn) {
        if (!node) return;
        fn(node);
        node.children?.forEach(child => walk(child, fn));
    }
    async function resolveImages(tree, found) {
        const pending = [];
        function visit(value) {
            if (!value || typeof value !== 'object') return;
            if (value.type === 'image' && typeof value.url === 'string') {
                const src = value.url;
                if (/^(?:https?:|data:image\/)/i.test(src)) return;
                if (!/^(?:[a-z][\w+.-]*:|\/\/|\/|\\)/i.test(src) && window.markmapResolveImage) {
                    pending.push(Promise.resolve(window.markmapResolveImage(src)).then(resolved => {
                        value.url = resolved || '';
                        if (resolved) found.add(src);
                    }));
                } else value.url = '';
                return;
            }
            for (const child of Object.values(value)) {
                if (Array.isArray(child)) child.forEach(visit);
                else if (child && typeof child === 'object') visit(child);
            }
        }
        visit(tree);
        await Promise.all(pending);
    }
    function offsetForLine(line) {
        if (line <= 0) return 0;
        let offset = 0;
        for (let i = 0; i < line; i++) {
            const next = currentContent.indexOf('\n', offset);
            if (next < 0) return currentContent.length;
            offset = next + 1;
        }
        return offset;
    }
    function findNode(line) {
        const startOfLine = offsetForLine(line);
        const nextNewline = currentContent.indexOf('\n', startOfLine);
        const offset = nextNewline < 0 ? currentContent.length : nextNewline;
        let found, best = -1;
        walk(root, node => {
            const start = node.position?.start;
            if (Number.isInteger(start) && start <= offset && start >= best) { best = start; found = node; }
        });
        return found || root;
    }
    function lineForNode(node) {
        if (!node?.position) return undefined;
        return (currentContent.slice(0, node.position.start).match(/\n/g) || []).length;
    }
    function markActive() {
        svg.querySelectorAll('[data-markmap-active]').forEach(el => el.removeAttribute('data-markmap-active'));
        if (!active) return;
        svg.querySelectorAll('[data-key^="node:"]').forEach(el => {
            if (el.getAttribute('data-node-id') === active.id) el.setAttribute('data-markmap-active', '');
        });
    }
    map.on('render', markActive);
    function selectLine(line, reveal = false) {
        active = findNode(line);
        if (reveal && active && active.id !== highlighted) map.focusNode(active.id);
        highlighted = active?.id;
        markActive();
    }
    async function renderContent({ content, options, customCSS, version }) {
        if (!content.trim()) {
            root = active = undefined;
            highlighted = undefined;
            currentContent = content;
            images = new Set();
            map.setTree({ id: '__empty__', type: 'heading', content: [], notes: [], data: {}, children: [] },
                { ...baseOptions, duration: 0 });
            map.backend.draw([]);
            renderedDocument = { content, options, customCSS };
            firstRender = true;
            error.textContent = '';
            return;
        }
        if (content === renderedDocument.content && customCSS === renderedDocument.customCSS
            && JSON.stringify(options) === JSON.stringify(renderedDocument.options)) return;
        const result = markmap.parse(content, { plugins: [markmap.remarkMath] });
        const nextImages = new Set();
        await resolveImages(result.root, nextImages);
        if (version !== contentVersion) return;
        const resolved = markmap.resolveViewOptions(baseOptions, { ...options, ...(result.frontmatter?.markmap || {}) });
        document.getElementById('custom-css').textContent = customCSS;
        map.setTree(result.root, resolved.options);
        root = result.root;
        currentContent = content;
        images = nextImages;
        highlighted = undefined;
        renderedDocument = { content, options, customCSS };
        selectLine(activeLine);
        if (firstRender) { map.fit(); firstRender = false; }
        error.textContent = resolved.warnings.join('\n');
    }
    function scheduleUpdates() {
        if (updatesScheduled) return;
        updatesScheduled = true;
        rendering = rendering.catch(() => {}).then(async () => {
            try {
                while (pendingContent || pendingCursor !== undefined) {
                    if (pendingContent) {
                        const latest = pendingContent; pendingContent = undefined;
                        try { await renderContent(latest); }
                        catch (e) { error.textContent = `Unable to render mind map: ${e.message}`; }
                    } else {
                        const line = pendingCursor; pendingCursor = undefined;
                        try { selectLine(line, true); } catch (e) { console.error(e); }
                    }
                }
            } finally { updatesScheduled = false; }
        });
    }
    window.setMarkmapContent = (content, options = {}, customCSS = '') => {
        pendingContent = { content, options, customCSS, version: ++contentVersion };
        scheduleUpdates();
    };
    window.setMarkmapCursor = line => {
        if (line === activeLine) return;
        activeLine = line; pendingCursor = line;
        if (cursorFrame !== undefined) return;
        cursorFrame = requestAnimationFrame(() => { cursorFrame = undefined; scheduleUpdates(); });
    };
    window.centerMap = () => map.fit();
    window.zoomIn = () => map.zoomIn();
    window.zoomOut = () => map.zoomOut();
    window.setFoldLevel = level => {
        if (level !== null && (!Number.isInteger(level) || level < 0)) return;
        rendering = rendering.then(() => {
            if (!root) return;
            if (level === null) map.expandAll(); else map.foldToLevel(level);
            map.fit();
        }).catch(e => console.error(e));
    };
    window.toggleActive = recursive => {
        rendering = rendering.then(() => {
            if (!active) return;
            if (!recursive) map.toggle(active.id);
            else {
                const branches = [];
                active.children?.forEach(child => walk(child, node => {
                    if (node.children?.length) branches.push(node.id);
                }));
                if (!branches.length) {
                    map.toggle(active.id);
                } else if (map.foldedIds.has(active.id) || branches.every(id => map.foldedIds.has(id))) {
                    map.expandAll(active.id);
                } else {
                    const folded = new Set(map.foldedIds);
                    branches.forEach(id => folded.add(id));
                    folded.delete(active.id);
                    map.setFoldedIds(folded);
                }
            }
        }).catch(e => console.error(e));
    };
    window.exportSvg = () => rendering.then(async () => {
        if (!root || !map.result) return;
        if (map.result.pending) { await map.result.pending; map.render({ animate: false }); }
        const serialized = markmap.toSVGString(map.result, { colorScheme: map.options.colorScheme });
        const documentSvg = new DOMParser().parseFromString(serialized, 'image/svg+xml');
        const style = documentSvg.createElementNS('http://www.w3.org/2000/svg', 'style');
        style.textContent = renderedDocument.customCSS;
        documentSvg.documentElement.prepend(style);
        send({ type: 'svg', value: new XMLSerializer().serializeToString(documentSvg.documentElement) });
    });
    window.exportPng = () => rendering.then(async () => {
        if (!root || !map.result) throw new Error('There is no mind map to export');
        if (map.result.pending) { await map.result.pending; map.render({ animate: false }); }
        const colorScheme = map.options.colorScheme === 'auto'
            ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
            : map.options.colorScheme;
        const blob = await markmap.toPNG(map.result, { background: true, colorScheme });
        const value = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1]);
            reader.onerror = () => reject(reader.error || new Error('Cannot read PNG image'));
            reader.readAsDataURL(blob);
        });
        send({ type: 'png', value });
    }).catch(e => send({ type: 'exportError', value: e.message || 'Cannot export PNG' }));
    window.requestHtmlExport = () => rendering.then(() => send({
        type: 'htmlReady', value: { ...renderedDocument, images: [...images] },
    }));
    function hit(event) { return map.hitAt(...map.layoutPoint(event.clientX, event.clientY)); }
    svg.addEventListener('dblclick', event => {
        const target = hit(event);
        const id = event.target.closest('[data-key^="node:"]')?.getAttribute('data-node-id') || target?.nodeId;
        if (!id) return;
        let found;
        walk(root, node => { if (node.id === id) found = node; });
        const line = lineForNode(found);
        if (line !== undefined) send({ type: 'focus', value: line });
    }, true);
    function openLink(href) {
        if (href.startsWith('#')) {
            let wanted;
            try { wanted = decodeURIComponent(href.slice(1)).toLowerCase(); } catch (_) { return; }
            let found;
            function textOf(items) { return (items || []).map(item => item.value || item.alt || textOf(item.children)).join(''); }
            walk(root, node => {
                if (!found && node.type === 'heading' && textOf(node.content).trim().toLowerCase()
                    .replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-') === wanted) found = node;
            });
            if (found) { active = found; highlighted = found.id; map.focusNode(found.id); markActive(); }
        } else send({ type: 'link', value: href });
    }
    svg.addEventListener('click', event => {
        const target = hit(event);
        if (target?.nodeId && target.kind !== 'link' && target.kind !== 'action') {
            let selected;
            walk(root, node => { if (node.id === target.nodeId) selected = node; });
            if (selected) { active = selected; highlighted = selected.id; markActive(); }
        }
        if (target?.kind !== 'link') return;
        if (!hasBridge && !target.href.startsWith('#')) return;
        event.preventDefault(); event.stopImmediatePropagation();
        openLink(target.href);
    }, true);
    document.addEventListener('click', event => {
        const link = event.target.closest('a[href]');
        if (!link || svg.contains(link)) return;
        if (!hasBridge && !link.getAttribute('href').startsWith('#')) return;
        event.preventDefault(); event.stopPropagation();
        openLink(link.getAttribute('href'));
    }, true);
    send({ type: 'ready' });
})();
