const WTL_MODAL_DEFAULT_HEIGHT_RATIO = 0.3;
const WTL_MODAL_MAX_HEIGHT_RATIO = 0.9;
const WTL_SEARCH_CACHE_STORAGE_KEY = 'vc-wtl-search-cache-v1';
const WTL_SEARCH_CACHE_LIMIT = 5;
const wtlState = {
    screenshots: [],
    selectedScreenshotUrls: new Set(),
    isImporting: false,
    serviceStatus: 'idle',
    serviceMessage: '',
    serviceLatencyMs: null,
    serviceCached: false,
    serviceCheckedAt: null,
    searchCache: [],
    searchCacheLoaded: false
};

function resetWtlSelection() {
    wtlState.screenshots = [];
    wtlState.selectedScreenshotUrls.clear();
    wtlState.isImporting = false;
}

function centerWtlModal() {
    const modal = document.getElementById('wtlModal');
    const modalCard = modal?.querySelector('.modal-card');
    if (!modalCard || !modal.classList.contains('is-active')) return;

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const modalWidth = modalCard.offsetWidth;
    const modalHeight = modalCard.offsetHeight;

    modalCard.style.left = `${Math.max(0, (viewportWidth - modalWidth) / 2)}px`;
    modalCard.style.top = `${Math.max(0, (viewportHeight - modalHeight) / 2)}px`;
}

function resetWtlModalHeight() {
    const modal = document.getElementById('wtlModal');
    const modalCard = modal?.querySelector('.modal-card');
    const modalBody = modal?.querySelector('.modal-card-body');
    if (!modalCard) return;

    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    modalCard.style.height = `${Math.round(viewportHeight * WTL_MODAL_DEFAULT_HEIGHT_RATIO)}px`;
    modalCard.style.maxHeight = `${Math.round(viewportHeight * WTL_MODAL_MAX_HEIGHT_RATIO)}px`;
    modalCard.style.overflow = 'hidden';
    modalCard.style.overflowY = 'hidden';
    if (modalBody) {
        modalBody.scrollTop = 0;
    }
    centerWtlModal();
}

function resizeWtlModalForResults() {
    const modal = document.getElementById('wtlModal');
    const modalCard = modal?.querySelector('.modal-card');
    const modalHead = modal?.querySelector('.modal-card-head');
    const modalBody = modal?.querySelector('.modal-card-body');
    if (!modalCard || !modalHead || !modalBody) return;

    requestAnimationFrame(() => {
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        const minHeight = Math.round(viewportHeight * WTL_MODAL_DEFAULT_HEIGHT_RATIO);
        const maxHeight = Math.round(viewportHeight * WTL_MODAL_MAX_HEIGHT_RATIO);
        const contentHeight = modalHead.offsetHeight + modalBody.scrollHeight;
        const targetHeight = Math.min(Math.max(contentHeight, minHeight), maxHeight);

        modalCard.style.height = `${targetHeight}px`;
        modalCard.style.maxHeight = `${maxHeight}px`;
        modalCard.style.overflow = 'hidden';
        modalCard.style.overflowY = 'hidden';
        centerWtlModal();
    });
}

function getWtlSearchButton() {
    return document.querySelector('#wtlModal [data-action="search-wtl"]');
}

function setWtlSearchDisabled(disabled) {
    const searchButton = getWtlSearchButton();
    if (!searchButton) return;
    searchButton.disabled = disabled;
    searchButton.setAttribute('aria-disabled', disabled ? 'true' : 'false');
}

function formatWtlStatusMeta() {
    if (Number.isFinite(wtlState.serviceLatencyMs)) {
        return `${wtlState.serviceLatencyMs} ms`;
    }
    return '';
}

function updateWtlStatusPanel() {
    const panel = document.getElementById('wtl-status-panel');
    if (!panel) return;

    const text = document.getElementById('wtl-status-text');
    const meta = document.getElementById('wtl-status-meta');
    panel.dataset.state = wtlState.serviceStatus;
    if (text) text.textContent = normalizeUiMessage(wtlState.serviceMessage, '状态未检测');
    if (meta) meta.textContent = formatWtlStatusMeta();
    panel.disabled = wtlState.serviceStatus === 'checking';
    panel.setAttribute('aria-disabled', wtlState.serviceStatus === 'checking' ? 'true' : 'false');
}

function setWtlStatus(status, options = {}) {
    wtlState.serviceStatus = status;
    wtlState.serviceMessage = normalizeUiMessage(options.message, '');
    wtlState.serviceLatencyMs = Number.isFinite(options.latencyMs) ? options.latencyMs : null;
    wtlState.serviceCached = Boolean(options.cached);
    wtlState.serviceCheckedAt = options.checkedAt || null;
    updateWtlStatusPanel();
    setWtlSearchDisabled(status === 'checking');
}

async function checkWtlStatus(options = {}) {
    setWtlStatus('checking', { message: '检测中' });
    try {
        const result = await callApi(event_map.check_wtl_status, { force: Boolean(options.force) }, 'GET');
        const status = result.online ? 'online' : 'offline';
        setWtlStatus(status, {
            message: result.online ? '服务在线' : (result.message || '服务不可达'),
            latencyMs: Number(result.latency_ms),
            cached: Boolean(result.cached),
            checkedAt: result.checked_at
        });
        return result;
    } catch (error) {
        setWtlStatus('offline', { message: error.message || '检测失败' });
        return { success: false, online: false, message: error.message };
    }
}

function refreshWtlStatus() {
    return checkWtlStatus({ force: true });
}

function markWtlApiFailure(statusCode, message) {
    const isLimited = statusCode === 403 || statusCode === 429 || (statusCode >= 500 && statusCode < 600) || !statusCode;
    setWtlStatus(isLimited ? 'limited' : 'online', {
        message: isLimited ? 'API 受限或查询失败' : (message || '查询失败')
    });
}

function getWtlSearchCacheKey(query) {
    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery) return '';

    try {
        const url = new URL(normalizedQuery);
        if (url.protocol.toLowerCase() === 'magnet:') {
            const exactTopic = url.searchParams.getAll('xt')
                .find(value => /^urn:btih:[a-z0-9]+$/i.test(value));
            if (exactTopic) {
                return `btih:${exactTopic.slice('urn:btih:'.length).toLowerCase()}`;
            }
        }
    } catch (error) {
        // Non-URL values keep exact trimmed matching for compatibility.
    }

    return `query:${normalizedQuery}`;
}

function sanitizeWtlSearchResult(data) {
    const name = String(data?.name || '').trim();
    if (!name) return null;

    const size = Number(data?.size);
    const count = Number(data?.count);
    const screenshots = Array.isArray(data?.screenshots)
        ? data.screenshots
            .map(shot => String(shot?.screenshot || '').trim())
            .filter(Boolean)
            .map(screenshot => ({ screenshot }))
        : [];

    return {
        file_type: String(data?.file_type || ''),
        name,
        size: Number.isFinite(size) ? size : 0,
        count: Number.isFinite(count) ? count : 0,
        screenshots
    };
}

function initializeWtlSearchCache() {
    if (wtlState.searchCacheLoaded) return;
    wtlState.searchCacheLoaded = true;
    wtlState.searchCache = [];

    try {
        const storedValue = window.localStorage.getItem(WTL_SEARCH_CACHE_STORAGE_KEY);
        if (!storedValue) return;
        const parsed = JSON.parse(storedValue);
        if (!Array.isArray(parsed)) throw new Error('Invalid WTL cache');

        const seenKeys = new Set();
        wtlState.searchCache = parsed
            .map(record => {
                const query = String(record?.query || '').trim();
                const cacheKey = getWtlSearchCacheKey(query);
                const data = sanitizeWtlSearchResult(record?.data);
                if (!query || !cacheKey || !data) return null;
                return {
                    query,
                    cacheKey,
                    data,
                    lastUsedAt: Number(record?.lastUsedAt) || 0
                };
            })
            .filter(Boolean)
            .sort((left, right) => right.lastUsedAt - left.lastUsedAt)
            .filter(record => {
                if (seenKeys.has(record.cacheKey)) return false;
                seenKeys.add(record.cacheKey);
                return true;
            })
            .slice(0, WTL_SEARCH_CACHE_LIMIT);
    } catch (error) {
        wtlState.searchCache = [];
        try {
            window.localStorage.removeItem(WTL_SEARCH_CACHE_STORAGE_KEY);
        } catch (storageError) {
            // Keep the empty in-memory cache when storage is unavailable.
        }
    }
}

function persistWtlSearchCache() {
    try {
        window.localStorage.setItem(
            WTL_SEARCH_CACHE_STORAGE_KEY,
            JSON.stringify(wtlState.searchCache)
        );
    } catch (error) {
        // The in-memory cache remains usable for the current page.
    }
}

function findWtlCachedSearch(query, options = {}) {
    initializeWtlSearchCache();
    const cacheKey = getWtlSearchCacheKey(query);
    const index = wtlState.searchCache.findIndex(record => record.cacheKey === cacheKey);
    if (index < 0) return null;

    const record = wtlState.searchCache[index];
    if (options.touch !== false) {
        record.lastUsedAt = Date.now();
        wtlState.searchCache.splice(index, 1);
        wtlState.searchCache.unshift(record);
        persistWtlSearchCache();
        renderWtlRecentSearches();
    }
    return record;
}

function cacheSuccessfulWtlSearch(query, data) {
    initializeWtlSearchCache();
    const normalizedQuery = String(query || '').trim();
    const cacheKey = getWtlSearchCacheKey(normalizedQuery);
    const safeData = sanitizeWtlSearchResult(data);
    if (!normalizedQuery || !cacheKey || !safeData) return null;

    wtlState.searchCache = wtlState.searchCache
        .filter(record => record.cacheKey !== cacheKey);
    const record = {
        query: normalizedQuery,
        cacheKey,
        data: safeData,
        lastUsedAt: Date.now()
    };
    wtlState.searchCache.unshift(record);
    wtlState.searchCache = wtlState.searchCache.slice(0, WTL_SEARCH_CACHE_LIMIT);
    persistWtlSearchCache();
    renderWtlRecentSearches();
    return record;
}

function clearWtlSearchCache() {
    wtlState.searchCacheLoaded = true;
    wtlState.searchCache = [];
    try {
        window.localStorage.removeItem(WTL_SEARCH_CACHE_STORAGE_KEY);
    } catch (error) {
        // Clearing the in-memory records is still sufficient for this page.
    }
    renderWtlRecentSearches();
}

function loadWtlCachedRecord(record) {
    if (!record) return;
    const input = document.getElementById('wtl-input');
    if (input) input.value = record.query;
    const touchedRecord = findWtlCachedSearch(record.query) || record;
    renderWtlSearchResult(touchedRecord.data, {
        cached: true,
        query: touchedRecord.query
    });
}

function refreshWtlCachedRecord(record) {
    loadWtlCachedRecord(record);
    return searchWtl({ force: true, query: record.query });
}

function renderWtlRecentSearches() {
    initializeWtlSearchCache();
    const panel = document.getElementById('wtl-recent-searches');
    const list = document.getElementById('wtl-recent-list');
    if (!panel || !list) return;

    clearElement(list);
    panel.hidden = wtlState.searchCache.length === 0;
    if (panel.hidden) return;

    wtlState.searchCache.forEach(record => {
        const loadButton = createEl('button', {
            className: 'wtl-recent-load',
            attrs: {
                type: 'button',
                title: record.data.name
            }
        }, [
            createEl('span', { className: 'wtl-recent-name', text: record.data.name })
        ]);
        loadButton.addEventListener('click', () => loadWtlCachedRecord(record));

        const refreshButton = createEl('button', {
            className: 'wtl-recent-refresh',
            attrs: {
                type: 'button',
                title: '重新查询',
                'aria-label': `重新查询 ${record.data.name}`
            }
        }, [
            createSpriteSvg('search-btn-icon', {
                width: 13,
                height: 13,
                fill: 'currentColor',
                ariaLabel: '重新查询'
            })
        ]);
        refreshButton.addEventListener('click', () => refreshWtlCachedRecord(record));

        list.appendChild(createEl('div', {
            className: 'wtl-recent-item',
            attrs: { role: 'listitem' }
        }, [loadButton, refreshButton]));
    });
}

function createWtlCacheNotice(query) {
    const refreshButton = createEl('button', {
        className: 'wtl-cache-refresh',
        attrs: { type: 'button' },
        text: '重新查询'
    });
    refreshButton.addEventListener('click', () => searchWtl({ force: true, query }));
    return createEl('div', { className: 'wtl-cache-notice' }, [
        createEl('span', { text: '缓存结果' }),
        refreshButton
    ]);
}

function renderWtlSearchResult(data, options = {}) {
    const resultsDiv = document.getElementById('wtl-results');
    if (!resultsDiv) return;
    resetWtlSelection();
    clearElement(resultsDiv);
    if (options.cached) {
        resultsDiv.appendChild(createWtlCacheNotice(options.query || ''));
    }
    resultsDiv.appendChild(createWtlResultBox(data));
    resultsDiv.querySelectorAll('img').forEach(img => {
        if (!img.complete) {
            img.addEventListener('load', resizeWtlModalForResults, { once: true });
            img.addEventListener('error', resizeWtlModalForResults, { once: true });
        }
    });
    resizeWtlModalForResults();
}

function searchWtl(options = {}) {
    const input = document.getElementById('wtl-input');
    const query = String(options.query ?? input?.value ?? '').trim();
    const resultsDiv = document.getElementById('wtl-results');
    const forceRefresh = options.force === true;
    if (input) input.value = query;

    if (!query) {
        resetWtlModalHeight();
        setNotification(resultsDiv, 'warning', '请输入链接');
        return;
    }

    const cachedRecord = findWtlCachedSearch(query, { touch: !forceRefresh });
    if (cachedRecord && !forceRefresh) {
        renderWtlSearchResult(cachedRecord.data, {
            cached: true,
            query: cachedRecord.query
        });
        return;
    }

    if (wtlState.serviceStatus === 'checking') {
        if (!forceRefresh || !cachedRecord) {
            setNotification(resultsDiv, 'warning', 'WTL 服务仍在检测中，请稍后再试');
        }
        return;
    }
    if (wtlState.serviceStatus === 'offline' || wtlState.serviceStatus === 'limited') {
        if (!forceRefresh || !cachedRecord) {
            setNotification(resultsDiv, 'warning', wtlState.serviceMessage || 'WTL 服务当前不可用，请稍后刷新状态');
        }
        return;
    }

    if (!forceRefresh || !cachedRecord) {
        setNotification(resultsDiv, 'info', '正在查询...');
    }

    return fetch(`https://whatslink.info/api/v1/link?url=${encodeURIComponent(query)}`)
        .then(response => {
            if (!response.ok) {
                markWtlApiFailure(response.status, `WTL API HTTP ${response.status}`);
                throw new Error(`WTL API HTTP ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            const record = cacheSuccessfulWtlSearch(query, data);
            if (!record) {
                throw new Error('WTL API 返回了无效结果');
            }
            setWtlStatus('online', { message: '服务在线' });
            renderWtlSearchResult(record.data);
        })
        .catch(error => {
            if (!forceRefresh || !cachedRecord) {
                resetWtlModalHeight();
            }
            if (wtlState.serviceStatus !== 'limited') {
                markWtlApiFailure(0, error.message);
            }
            if (!forceRefresh || !cachedRecord) {
                setNotification(resultsDiv, 'danger', '查询失败，请检查链接是否正确');
            }
            showAlert({
                title: '查询失败',
                message: error.message || '查询过程出错',
                type: 'error',
                showCancel: false
            });
        });
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function createWtlInfoRow(label, value) {
    return createEl('p', {}, [
        createEl('strong', { text: `${label}:` }),
        ` ${value ?? ''}`
    ]);
}

function createWtlScreenshotsLegacy(screenshots) {
    if (!Array.isArray(screenshots) || screenshots.length === 0) return null;
    const container = createEl('div', { className: 'screenshots' });
    screenshots.forEach(shot => {
        const imageUrl = shot?.screenshot || '';
        if (!imageUrl) return;
        container.appendChild(createEl('div', { className: 'screenshot-item' }, [
            createEl('img', { attrs: { src: imageUrl, alt: '截图' } })
        ]));
    });
    return container;
}

function normalizeWtlScreenshots(screenshots) {
    if (!Array.isArray(screenshots)) return [];
    return screenshots
        .map((shot, index) => ({
            url: String(shot?.screenshot || '').trim(),
            index
        }))
        .filter(shot => shot.url);
}

function isWtlEditUploadAvailable() {
    return document.getElementById('editModal')?.classList.contains('is-active')
        && typeof window['addedit-image-upload-areaFiles'] === 'function';
}

function getSelectedWtlScreenshots() {
    return wtlState.screenshots.filter(shot => wtlState.selectedScreenshotUrls.has(shot.url));
}

function getWtlDragScreenshots(shot) {
    if (wtlState.selectedScreenshotUrls.has(shot.url)) {
        const selected = getSelectedWtlScreenshots();
        return selected.length ? selected : [shot];
    }
    return [shot];
}

function updateWtlScreenshotControls(container = document.getElementById('wtl-results')) {
    const selectedCount = getSelectedWtlScreenshots().length;
    container?.querySelectorAll('.wtl-screenshot-item').forEach(item => {
        const isSelected = wtlState.selectedScreenshotUrls.has(item.dataset.url || '');
        item.classList.toggle('is-selected', isSelected);
        item.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    });

    const count = container?.querySelector('.wtl-selected-count');
    if (count) count.textContent = `已选 ${selectedCount} 张`;

    const selectAllButton = container?.querySelector('[data-wtl-action="select-all"]');
    if (selectAllButton) {
        const allSelected = selectedCount > 0 && selectedCount === wtlState.screenshots.length;
        selectAllButton.textContent = allSelected ? '取消全选' : '全选';
        selectAllButton.disabled = wtlState.isImporting || wtlState.screenshots.length === 0;
    }

    const addButton = container?.querySelector('[data-wtl-action="add"]');
    if (addButton) addButton.disabled = wtlState.isImporting || selectedCount === 0;

    const editButton = container?.querySelector('[data-wtl-action="edit"]');
    if (editButton) {
        editButton.disabled = wtlState.isImporting || selectedCount === 0 || !isWtlEditUploadAvailable();
        editButton.title = isWtlEditUploadAvailable() ? '' : '请先打开编辑电影窗口';
    }
}

function toggleWtlScreenshotSelection(url, container) {
    if (!url || wtlState.isImporting) return;
    if (wtlState.selectedScreenshotUrls.has(url)) {
        wtlState.selectedScreenshotUrls.delete(url);
    } else {
        wtlState.selectedScreenshotUrls.add(url);
    }
    updateWtlScreenshotControls(container);
}

function toggleAllWtlScreenshots(container) {
    if (wtlState.isImporting || !wtlState.screenshots.length) return;
    const allSelected = wtlState.selectedScreenshotUrls.size === wtlState.screenshots.length;
    wtlState.selectedScreenshotUrls.clear();
    if (!allSelected) {
        wtlState.screenshots.forEach(shot => wtlState.selectedScreenshotUrls.add(shot.url));
    }
    updateWtlScreenshotControls(container);
}

function wtlDataUrlToFile(dataUrl, filename) {
    const [header, encoded] = String(dataUrl || '').split(',');
    const match = /^data:([^;]+);base64$/.exec(header || '');
    if (!match || !encoded) {
        throw new Error('导入的图片数据无效。');
    }
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return new File([bytes], filename || `wtl-screenshot-${Date.now()}.jpg`, { type: match[1] || 'image/jpeg' });
}

function clearWtlDragCache() {
    window.currentDraggedThumbnailFile = null;
    window.currentDraggedThumbnailFiles = [];
    window.currentDraggedThumbnailFilesPromise = null;
}

async function fetchWtlScreenshotFile(shot) {
    const result = await callApi(event_map.fetch_external_image, { url: shot.url });
    if (!result.success) {
        throw new Error(result.message || 'WTL 截图导入失败');
    }
    return wtlDataUrlToFile(
        result.data_url,
        result.filename || `wtl-screenshot-${shot.index + 1}.jpg`
    );
}

function prepareWtlScreenshotDragFiles(shots) {
    const filesPromise = Promise.all(shots.map(shot => fetchWtlScreenshotFile(shot)))
        .then(files => {
            window.currentDraggedThumbnailFiles = files;
            window.currentDraggedThumbnailFile = files.length === 1 ? files[0] : null;
            return files;
        });

    window.currentDraggedThumbnailFilesPromise = filesPromise;
    filesPromise.catch(() => {
        window.currentDraggedThumbnailFile = null;
        window.currentDraggedThumbnailFiles = [];
    });
    return filesPromise;
}

function setWtlScreenshotDraggingState(urls, isDragging) {
    const urlSet = new Set(urls);
    document.querySelectorAll('#wtlModal .wtl-screenshot-item.dragging').forEach(item => {
        item.classList.remove('dragging');
    });
    if (!isDragging) return;

    document.querySelectorAll('#wtlModal .wtl-screenshot-item').forEach(item => {
        item.classList.toggle('dragging', urlSet.has(item.dataset.url || ''));
    });
}

function startWtlScreenshotDrag(event, shot, item) {
    const screenshots = getWtlDragScreenshots(shot);
    setWtlScreenshotDraggingState(screenshots.map(entry => entry.url), true);
    prepareWtlScreenshotDragFiles(screenshots);
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('text/plain', screenshots.map(entry => entry.url).join('\n'));
    event.dataTransfer.setData('text/uri-list', screenshots.map(entry => entry.url).join('\n'));
    item.classList.add('dragging');
}

async function addSelectedWtlScreenshotsToUploadArea(areaId, label, container) {
    const selected = getSelectedWtlScreenshots();
    if (!selected.length || wtlState.isImporting) return;

    if (areaId === 'edit-image-upload-area' && !isWtlEditUploadAvailable()) {
        showAlert({
            title: '编辑窗口未打开',
            message: '请先打开要编辑的电影，再把 WTL 截图加入编辑电影图片区。',
            type: 'warning',
            showCancel: false
        });
        updateWtlScreenshotControls(container);
        return;
    }

    const addFiles = window[`add${areaId}Files`];
    if (typeof addFiles !== 'function') {
        showAlert({
            title: '加入失败',
            message: `${label}图片区还没有准备好，请稍后再试。`,
            type: 'error',
            showCancel: false
        });
        return;
    }

    wtlState.isImporting = true;
    updateWtlScreenshotControls(container);
    try {
        const files = [];
        for (const shot of selected) {
            files.push(await fetchWtlScreenshotFile(shot));
        }
        addFiles(files);
        showAlert({
            title: '已加入',
            message: `已将 ${files.length} 张 WTL 截图加入${label}图片区。`,
            type: 'success',
            showCancel: false
        });
    } catch (error) {
        showAlert({
            title: 'WTL 截图导入失败',
            message: error.message || '无法导入所选截图',
            type: 'error',
            showCancel: false
        });
    } finally {
        wtlState.isImporting = false;
        updateWtlScreenshotControls(container);
    }
}

function createWtlScreenshotActions(container) {
    const controls = createEl('div', { className: 'wtl-screenshot-actions' });
    const selectedCount = createEl('span', { className: 'wtl-selected-count', text: '已选 0 张' });
    const selectAll = createActionButton({
        className: 'button is-small is-light wtl-screenshot-action',
        text: '全选',
        action: ''
    });
    selectAll.dataset.wtlAction = 'select-all';
    selectAll.removeAttribute('data-action');
    selectAll.addEventListener('click', () => toggleAllWtlScreenshots(container));

    const addButton = createActionButton({
        className: 'button is-small is-info wtl-screenshot-action',
        text: '加入添加电影',
        action: ''
    });
    addButton.dataset.wtlAction = 'add';
    addButton.removeAttribute('data-action');
    addButton.addEventListener('click', () => addSelectedWtlScreenshotsToUploadArea('image-upload-area', '添加电影', container));

    const editButton = createActionButton({
        className: 'button is-small is-link wtl-screenshot-action',
        text: '加入编辑电影',
        action: ''
    });
    editButton.dataset.wtlAction = 'edit';
    editButton.removeAttribute('data-action');
    editButton.addEventListener('click', () => addSelectedWtlScreenshotsToUploadArea('edit-image-upload-area', '编辑电影', container));

    appendChildren(controls, [selectedCount, selectAll, addButton, editButton]);
    return controls;
}

function createWtlScreenshots(screenshots) {
    wtlState.screenshots = normalizeWtlScreenshots(screenshots);
    wtlState.selectedScreenshotUrls.clear();
    if (wtlState.screenshots.length === 0) return null;

    const wrapper = createEl('div', { className: 'wtl-screenshots-panel' });
    wrapper.appendChild(createEl('div', { className: 'wtl-screenshots-title', text: '截图' }));
    wrapper.appendChild(createWtlScreenshotActions(wrapper));

    const container = createEl('div', { className: 'screenshots wtl-screenshots' });
    wtlState.screenshots.forEach(shot => {
        const item = createEl('button', {
            className: 'screenshot-item wtl-screenshot-item',
            attrs: {
                type: 'button',
                draggable: 'true',
                'aria-pressed': 'false'
            },
            dataset: { url: shot.url }
        }, [
            createEl('img', { attrs: { src: shot.url, alt: '截图' } }),
            createEl('span', { className: 'wtl-screenshot-check', text: '✓' })
        ]);
        item.addEventListener('click', () => toggleWtlScreenshotSelection(shot.url, wrapper));
        item.addEventListener('dragstart', event => startWtlScreenshotDrag(event, shot, item));
        item.addEventListener('dragend', () => {
            setWtlScreenshotDraggingState([], false);
            setTimeout(clearWtlDragCache, 0);
        });
        container.appendChild(item);
    });

    wrapper.appendChild(container);
    updateWtlScreenshotControls(wrapper);
    return wrapper;
}

function createWtlResultBox(data) {
    const box = createEl('div', { className: 'box' });
    box.appendChild(createEl('div', { className: 'content wtl-result-info' }, [
        createWtlInfoRow('文件类型', data.file_type),
        createWtlInfoRow('资源名称', data.name),
        createWtlInfoRow('总文件大小', formatFileSize(data.size)),
        createWtlInfoRow('文件数量', data.count)
    ]));
    const screenshots = createWtlScreenshots(data.screenshots);
    if (screenshots) box.appendChild(screenshots);
    return box;
}

function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}
