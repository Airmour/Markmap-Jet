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
    const transformer = new markmap.Transformer();
    const map = markmap.Markmap.create(document.getElementById('markmap-svg'), {
        maxWidth: 300, initialExpandLevel: -1, duration: 300, fitRatio: 0.95,
    });

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
        activeLine = line;
        const match = findNode(line);
        active = match?.node;
        if (match && reveal) {
            let changed = false;
            match.parents.forEach(node => { if (node.payload?.fold) { node.payload.fold = 0; changed = true; } });
            if (changed) await map.renderData();
        }
        await map.setHighlight(active);
        if (active && reveal) await map.ensureVisible(active);
    }
    window.setMarkmapContent = (content, options = {}, customCSS = '') => {
        rendering = rendering.catch(() => {}).then(async () => {
            if (!content.trim()) {
                root = undefined;
                active = undefined;
                resolvedImages = new Set();
                map.state.data = undefined;
                map.state.highlight = undefined;
                map.g.selectAll('*').remove();
                renderedDocument = { content, options, customCSS };
                firstRender = true;
                error.textContent = '';
                return;
            }
            const folded = new Map();
            foldState(root, 'root', folded);
            const result = transformer.transform(content);
            root = result.root;
            const images = new Set();
            await resolveImages(root, images);
            applyFoldState(root, 'root', folded);
            document.getElementById('custom-css').textContent = customCSS;
            const documentOptions = result.frontmatter?.markmap || {};
            await map.setData(root, { ...markmap.defaultOptions, ...markmap.deriveOptions({
                maxWidth: 300, initialExpandLevel: -1, duration: 300, fitRatio: 0.95,
                ...options, ...documentOptions,
            }) });
            resolvedImages = images;
            root = map.state.data;
            renderedDocument = { content, options, customCSS };
            await selectLine(activeLine);
            if (firstRender) { await map.fit(); firstRender = false; }
            error.textContent = '';
        }).catch(e => { error.textContent = `Unable to render mind map: ${e.message}`; });
    };
    window.setMarkmapCursor = line => {
        rendering = rendering.then(() => selectLine(line, true)).catch(e => console.error(e));
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
