const WTL_MODAL_DEFAULT_HEIGHT_RATIO = 0.3;
const WTL_MODAL_MAX_HEIGHT_RATIO = 0.9;
const wtlState = {
    screenshots: [],
    selectedScreenshotUrls: new Set(),
    isImporting: false
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

function searchWtl() {
    const query = document.getElementById('wtl-input').value;
    const resultsDiv = document.getElementById('wtl-results');
    
    if (!query.trim()) {
        resetWtlModalHeight();
        setNotification(resultsDiv, 'warning', '请输入链接');
        return;
    }
    
    setNotification(resultsDiv, 'info', '正在查询...');
    
    resetWtlSelection();
    fetch(`https://whatslink.info/api/v1/link?url=${encodeURIComponent(query)}`)
        .then(response => response.json())
        .then(data => {
            clearElement(resultsDiv);
            resultsDiv.appendChild(createWtlResultBox(data));
            resultsDiv.querySelectorAll('img').forEach(img => {
                if (!img.complete) {
                    img.addEventListener('load', resizeWtlModalForResults, { once: true });
                    img.addEventListener('error', resizeWtlModalForResults, { once: true });
                }
            });
            resizeWtlModalForResults();
        })
        .catch(error => {
            resetWtlModalHeight();
            setNotification(resultsDiv, 'danger', '查询失败，请检查链接是否正确');
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
        throw new Error('Invalid imported image data');
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
    box.appendChild(createEl('div', { className: 'content' }, [
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
