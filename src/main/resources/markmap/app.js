(() => {
    'use strict';
    const send = window.markmapSend || (() => {});
    const error = document.getElementById('error');
    let root;
    let active;
    let activeLine = 0;
    let resolvedImages = new Set();
    let renderedDocument = { content: '', options: {}, customCSS: '' };
    let firstRender = true;
    let rendering = Promise.resolve();
    let pendingContent;
    let pendingCursor;
    let contentVersion = 0;
    let updatesScheduled = false;
    let cursorFrame;
    let highlightedNode;
    let revealedNode;
    let parsedHtml = '';
    const transformer = new markmap.Transformer();
    // Reuse exactly the HTML rendered by transform(), including frontmatter offsets.
    const renderMarkdown = transformer.md.render.bind(transformer.md);
    transformer.md.render = (...args) => {
        parsedHtml = renderMarkdown(...args);
        return parsedHtml;
    };
    const map = markmap.Markmap.create(document.getElementById('markmap-svg'), {
        maxWidth: 300, initialExpandLevel: -1, duration: 300, fitRatio: 0.95,
    });

    const svgElement = document.getElementById('markmap-svg');
    let viewportFrame;
    let pinch;
    let pinchTransform;
    let suppressPinchWheelUntil = 0;

    function flushViewport() {
        viewportFrame = undefined;
        if (!pinchTransform) return;
        const transform = pinchTransform;
        pinchTransform = undefined;
        // Direct manipulation must not wait for an earlier fit/reveal transition.
        map.svg.interrupt().call(map.zoom.transform, transform);
    }
    function scheduleViewport() {
        if (viewportFrame === undefined) viewportFrame = requestAnimationFrame(flushViewport);
    }
    window.beginNativePinch = (x, y) => {
        if (!map.options.zoom || !Number.isFinite(x) || !Number.isFinite(y)) return;
        // Finish the previous gesture before capturing the new initial transform.
        flushViewport();
        pinch = { base: d3.zoomTransform(svgElement), x: x * svgElement.clientWidth, y: y * svgElement.clientHeight };
    };
    window.updateNativePinch = factor => {
        if (!pinch || !map.options.zoom || !Number.isFinite(factor) || factor <= 0) return;
        const { base, x, y } = pinch;
        const [min, max] = map.zoom.scaleExtent();
        const scale = Math.max(Math.max(min, Number.EPSILON), Math.min(max, base.k * factor));
        const ratio = scale / base.k;
        pinchTransform = d3.zoomIdentity.translate(x - (x - base.x) * ratio, y - (y - base.y) * ratio).scale(scale);
        scheduleViewport();
    };
    window.endNativePinch = () => {
        pinch = undefined;
        // Some JCEF versions also emit ctrl+wheel at the end of a native gesture.
        suppressPinchWheelUntil = Date.now() + 200;
    };
    svgElement.addEventListener('wheel', event => {
        if (event.ctrlKey) {
            if (pinch || Date.now() < suppressPinchWheelUntil) {
                event.preventDefault();
                event.stopImmediatePropagation();
            }
            return; // Let D3 handle browser-generated pinch events when no native gesture is active.
        }
        if (!map.options.pan || !map.options.scrollForPan) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (pinch) return;
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? svgElement.clientHeight : 1;
        if (!event.deltaX && !event.deltaY) return;
        flushViewport();
        const current = d3.zoomTransform(svgElement);
        // Match D3's drag path: update immediately instead of adding another frame of latency.
        map.svg.interrupt().call(map.zoom.transform, current.translate(
            -event.deltaX * unit / current.k,
            -event.deltaY * unit / current.k,
        ));
    }, { capture: true, passive: false });

    async function resolveImages(node, images) {
        if (!node) return;
        if (node.content) node.content = window.markmapSanitize(node.content);
        if (node.content?.includes('<img')) {
            const container = document.createElement('div');
            container.innerHTML = node.content;
            await Promise.all([...container.querySelectorAll('img')].map(async img => {
                const src = img.getAttribute('src');
                if (!src || /^(?:https?:|data:)/i.test(src)) return;
                if (!/^(?:[a-z][\w+.-]*:|\/\/|\/|\\)/i.test(src) && window.markmapResolveImage) {
                    const resolved = await window.markmapResolveImage(src);
                    if (resolved) {
                        img.setAttribute('src', resolved);
                        images.add(src);
                        return;
                    }
                }
                img.removeAttribute('src');
            }));
            node.content = container.innerHTML;
        }
        await Promise.all((node.children || []).map(child => resolveImages(child, images)));
    }

    function foldState(node, key, result) {
        if (!node) return;
        result.set(key, node.payload?.fold);
        node.children?.forEach((child, i) => foldState(child, `${key}/${i}:${child.content}`, result));
    }
    function applyFoldState(node, key, state) {
        if (!node) return;
        if (state.has(key) && state.get(key) !== undefined) {
            node.payload = node.payload || {};
            node.payload.fold = state.get(key);
        }
        node.children?.forEach((child, i) => applyFoldState(child, `${key}/${i}:${child.content}`, state));
    }
    function restoreListItems(root, html) {
        const parsed = new DOMParser().parseFromString(html, 'text/html');
        const headings = [];
        function collectHeadings(node) {
            if (/^h[1-6]$/.test(node.payload?.tag || '')) headings.push(node);
            node.children?.forEach(collectHeadings);
        }
        collectHeadings(root);

        const lineStart = element => Number(element.getAttribute('data-lines')?.split(',')[0]);
        parsed.querySelectorAll('ol, ul').forEach(list => {
            if (list.parentElement?.closest('li')) return;
            const listLine = lineStart(list);
            const heading = headings
                .filter(node => Number(node.payload.lines.split(',')[0]) < listLine)
                .at(-1);
            if (!heading) return;

            const items = [...list.children].filter(child => child.tagName === 'LI');
            const firstItemLine = items.length ? lineStart(items[0]) : listLine;
            const existing = heading.children || (heading.children = []);
            const alreadyRepresented = existing.some(node => {
                const [start] = String(node.payload?.lines || '').split(',').map(Number);
                return node.payload?.tag === 'li' && start === firstItemLine;
            });
            if (alreadyRepresented) return;

            items.forEach((item, index) => {
                const text = item.cloneNode(true);
                text.querySelectorAll('ol, ul').forEach(nested => nested.remove());
                const value = text.textContent.trim();
                if (!value) return;
                const number = list.tagName === 'OL'
                    ? Number(list.getAttribute('start') || 1) + index
                    : null;
                const [start, end] = (item.getAttribute('data-lines') || '').split(',').map(Number);
                existing.push({
                    content: number === null ? value : `${number}. ${value}`,
                    children: [],
                    payload: { tag: 'li', lines: `${start},${end}` },
                });
            });
            existing.sort((a, b) => {
                const lineA = Number(String(a.payload?.lines || '').split(',')[0]);
                const lineB = Number(String(b.payload?.lines || '').split(',')[0]);
                return lineA - lineB;
            });
        });
    }
    function findNode(line) {
        let found;
        function visit(node, parents) {
            const [start, end] = String(node.payload?.lines || '').split(',').map(Number);
            if (Number.isFinite(start) && Number.isFinite(end) && start <= line && line < end) {
                found = { node, parents };
            }
            node.children?.forEach(child => visit(child, [...parents, node]));
        }
        if (root) visit(root, []);
        return found;
    }
    function findHeading(fragment) {
        let wanted;
        try { wanted = decodeURIComponent(fragment).toLowerCase(); } catch (_) { return; }
        let result;
        function visit(node, parents) {
            if (result) return;
            if (/^h[1-6]$/.test(node.payload?.tag || '')) {
                const element = document.createElement('div');
                element.innerHTML = node.content;
                const id = element.textContent.trim().toLowerCase()
                    .replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
                if (id === wanted) result = { node, parents };
            }
            node.children?.forEach(child => visit(child, [...parents, node]));
        }
        if (root) visit(root, []);
        return result;
    }
    async function selectLine(line, reveal = false) {
        const match = findNode(line);
        active = match?.node;
        if (match && reveal && active !== revealedNode) {
            let changed = false;
            match.parents.forEach(node => { if (node.payload?.fold) { node.payload.fold = 0; changed = true; } });
            if (changed) await map.renderData();
            if (activeLine !== line || pendingContent) return;
            await map.ensureVisible(active);
            revealedNode = active;
        }
        if (active !== highlightedNode) {
            await map.setHighlight(active);
            highlightedNode = active;
        }
    }
    async function renderContent({ content, options, customCSS, version }) {
        if (!content.trim()) {
            root = undefined;
            active = undefined;
            highlightedNode = undefined;
            revealedNode = undefined;
            resolvedImages = new Set();
            map.state.data = undefined;
            map.state.highlight = undefined;
            map.g.selectAll('*').remove();
            renderedDocument = { content, options, customCSS };
            firstRender = true;
            error.textContent = '';
            return;
        }
        if (content === renderedDocument.content && customCSS === renderedDocument.customCSS
            && JSON.stringify(options) === JSON.stringify(renderedDocument.options)) return;
        const folded = new Map();
        foldState(root, 'root', folded);
        const result = transformer.transform(content);
        const nextRoot = result.root;
        restoreListItems(nextRoot, parsedHtml);
        const images = new Set();
        await resolveImages(nextRoot, images);
        // Work already in progress cannot always be cancelled; never commit stale preparation.
        if (version !== contentVersion) return;
        applyFoldState(nextRoot, 'root', folded);
        document.getElementById('custom-css').textContent = customCSS;
        const documentOptions = result.frontmatter?.markmap || {};
        await map.setData(nextRoot, { ...markmap.defaultOptions, ...markmap.deriveOptions({
            maxWidth: 300, initialExpandLevel: -1, duration: 300, fitRatio: 0.95,
            ...options, ...documentOptions,
        }) });
        root = map.state.data;
        highlightedNode = undefined;
        revealedNode = undefined;
        resolvedImages = images;
        renderedDocument = { content, options, customCSS };
        if (version !== contentVersion) return;
        await selectLine(activeLine);
        if (firstRender) { await map.fit(); firstRender = false; }
        error.textContent = '';
    }
    function scheduleUpdates() {
        if (updatesScheduled) return;
        updatesScheduled = true;
        rendering = rendering.catch(() => {}).then(async () => {
            try {
                while (pendingContent || pendingCursor !== undefined) {
                    if (pendingContent) {
                        const latest = pendingContent;
                        pendingContent = undefined;
                        try { await renderContent(latest); }
                        catch (e) { error.textContent = `Unable to render mind map: ${e.message}`; }
                    } else {
                        const line = pendingCursor;
                        pendingCursor = undefined;
                        try { await selectLine(line, true); }
                        catch (e) { console.error(e); }
                    }
                }
            } finally {
                updatesScheduled = false;
            }
        });
    }
    window.setMarkmapContent = (content, options = {}, customCSS = '') => {
        pendingContent = { content, options, customCSS, version: ++contentVersion };
        scheduleUpdates();
    };
    window.setMarkmapCursor = line => {
        if (line === activeLine) return;
        activeLine = line;
        pendingCursor = line;
        if (cursorFrame !== undefined) return;
        cursorFrame = requestAnimationFrame(() => {
            cursorFrame = undefined;
            scheduleUpdates();
        });
    };
    window.centerMap = () => map.fit();
    window.zoomIn = () => map.rescale(1.2);
    window.zoomOut = () => map.rescale(1 / 1.2);
    window.toggleActive = recursive => {
        rendering = rendering.then(() => active && map.toggleNode(active, recursive)).catch(e => console.error(e));
    };
    window.exportSvg = () => {
        rendering.then(() => {
            const svg = map.svg.node().cloneNode(true);
            svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
            style.textContent = [...document.querySelectorAll('style')].map(node => node.textContent).join('\n');
            svg.prepend(style);
            send({ type: 'svg', value: new XMLSerializer().serializeToString(svg) });
        });
    };
    window.requestHtmlExport = () => rendering.then(() => send({
        type: 'htmlReady', value: { ...renderedDocument, images: [...resolvedImages] },
    }));
    document.getElementById('markmap-svg').addEventListener('dblclick', event => {
        const node = event.target.closest('.markmap-node');
        const data = node && d3.select(node).datum();
        const line = Number(String(data?.payload?.lines || '').split(',')[0]);
        if (Number.isInteger(line) && data?.payload?.lines) send({ type: 'focus', value: line });
    }, true);
    document.getElementById('markmap-svg').addEventListener('click', event => {
        const link = event.target.closest('a');
        if (!link) return;
        const href = link.getAttribute('href');
        if (href?.startsWith('#')) {
            event.preventDefault();
            rendering = rendering.then(async () => {
                const match = findHeading(href.slice(1));
                if (!match) return;
                match.parents.forEach(node => { if (node.payload?.fold) node.payload.fold = 0; });
                await map.renderData();
                active = match.node;
                await map.setHighlight(active);
                await map.ensureVisible(active);
            }).catch(e => console.error(e));
        } else if (href && window.markmapSend) {
            event.preventDefault();
            send({ type: 'link', value: href });
        }
    });
    send({ type: 'ready' });
})();
