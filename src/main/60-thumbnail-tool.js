const thumbnailState = {
    source: 'local',
    currentPath: '',
    currentListing: null,
    embyQuery: '',
    embyResults: [],
    selectedVideo: null,
    captures: [],
    selectedCaptureIds: new Set(),
    initialized: false,
    isBatchRunning: false,
    abortBatch: false,
    fpsProbeToken: 0,
    adaptiveFps: 30,
    directoryRequestToken: 0,
    embyRequestToken: 0,
    sessionToken: 0,
    seekToken: 0,
    stepSeekToken: 0,
    stepSeekTimer: null,
    pendingStepTarget: null,
    pendingStepShouldResume: false
};

function openThumbnailModal() {
    if (ModalManager.minimizedModals.has('thumbnailModal')) {
        ModalManager.restoreModal('thumbnailModal');
    } else {
        ModalManager.open('thumbnailModal');
    }
    initThumbnailTool();
    syncThumbnailSourceControls();
    if (thumbnailState.source === 'emby') {
        renderThumbnailEmbyResults(thumbnailState.embyResults);
    } else if (!thumbnailState.currentListing) {
        loadThumbnailDirectory('');
    }
}

function closeThumbnailModal() {
    resetThumbnailToolState();
    ModalManager.close('thumbnailModal');
}

function resetThumbnailToolState() {
    thumbnailState.abortBatch = true;
    thumbnailState.isBatchRunning = false;
    thumbnailState.directoryRequestToken += 1;
    thumbnailState.fpsProbeToken += 1;
    thumbnailState.sessionToken += 1;
    thumbnailState.seekToken += 1;
    thumbnailState.stepSeekToken += 1;
    thumbnailState.embyRequestToken += 1;
    clearTimeout(thumbnailState.stepSeekTimer);
    thumbnailState.stepSeekTimer = null;
    thumbnailState.pendingStepTarget = null;
    thumbnailState.pendingStepShouldResume = false;

    const video = document.getElementById('thumbnail-video');
    if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
    }

    thumbnailState.source = 'local';
    thumbnailState.currentPath = '';
    thumbnailState.currentListing = null;
    thumbnailState.embyQuery = '';
    thumbnailState.embyResults = [];
    thumbnailState.selectedVideo = null;
    thumbnailState.adaptiveFps = 30;
    thumbnailState.captures.forEach(capture => URL.revokeObjectURL(capture.url));
    thumbnailState.captures = [];
    thumbnailState.selectedCaptureIds.clear();
    clearThumbnailDragCache();

    const list = document.getElementById('thumbnail-file-list');
    if (list) clearElement(list);

    const breadcrumbs = document.getElementById('thumbnail-breadcrumbs');
    if (breadcrumbs) clearElement(breadcrumbs);

    const embyInput = document.getElementById('thumbnail-emby-search-input');
    if (embyInput) embyInput.value = '';

    setThumbnailStatus('请选择视频文件');
    updateThumbnailProgress(0);
    setThumbnailBatchControls(false);

    const summary = document.getElementById('thumbnail-batch-summary');
    if (summary) summary.textContent = '';

    renderThumbnailCaptures();
    syncThumbnailSourceControls();
    syncThumbnailPercentPreset();
    updateThumbnailBatchSummary();
    updateThumbnailSelectionControls();
}

function initThumbnailTool() {
    if (thumbnailState.initialized) return;

    const modal = document.getElementById('thumbnailModal');
    if (!modal) return;

    const video = document.getElementById('thumbnail-video');
    const localSourceButton = document.getElementById('thumbnail-source-local');
    const embySourceButton = document.getElementById('thumbnail-source-emby');
    const embySearchInput = document.getElementById('thumbnail-emby-search-input');
    const embySearchButton = document.getElementById('thumbnail-emby-search-button');
    const upButton = document.getElementById('thumbnail-up-button');
    const refreshButton = document.getElementById('thumbnail-refresh-button');
    const frameBack = document.getElementById('thumbnail-frame-back');
    const frameForward = document.getElementById('thumbnail-frame-forward');
    const secondBack = document.getElementById('thumbnail-second-back');
    const secondForward = document.getElementById('thumbnail-second-forward');
    const fiveSecondBack = document.getElementById('thumbnail-five-second-back');
    const fiveSecondForward = document.getElementById('thumbnail-five-second-forward');
    const fiveMinuteBack = document.getElementById('thumbnail-five-minute-back');
    const fiveMinuteForward = document.getElementById('thumbnail-five-minute-forward');
    const minuteBack = document.getElementById('thumbnail-minute-back');
    const minuteForward = document.getElementById('thumbnail-minute-forward');
    const captureButton = document.getElementById('thumbnail-capture-current');
    const batchButton = document.getElementById('thumbnail-batch-capture');
    const clearButton = document.getElementById('thumbnail-clear-captures');
    const selectAllButton = document.getElementById('thumbnail-select-all');
    const sendAddButton = document.getElementById('thumbnail-send-add');
    const sendEditButton = document.getElementById('thumbnail-send-edit');
    const downloadSelectedButton = document.getElementById('thumbnail-download-selected');
    const percentInput = document.getElementById('thumbnail-percent-step');
    const presetButtons = modal.querySelectorAll('.thumbnail-percent-preset');

    localSourceButton?.addEventListener('click', () => setThumbnailSource('local'));
    embySourceButton?.addEventListener('click', () => setThumbnailSource('emby'));
    embySearchButton?.addEventListener('click', searchThumbnailEmby);
    embySearchInput?.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            searchThumbnailEmby();
        }
    });

    upButton?.addEventListener('click', () => {
        if (thumbnailState.currentPath) {
            loadThumbnailDirectory(getThumbnailParentPath(thumbnailState.currentPath));
        }
    });
    refreshButton?.addEventListener('click', () => loadThumbnailDirectory(thumbnailState.currentPath));
    frameBack?.addEventListener('click', () => stepThumbnailVideo(-getThumbnailFrameStep()));
    frameForward?.addEventListener('click', () => stepThumbnailVideo(getThumbnailFrameStep()));
    secondBack?.addEventListener('click', () => stepThumbnailVideo(-getThumbnailSecondStep()));
    secondForward?.addEventListener('click', () => stepThumbnailVideo(getThumbnailSecondStep()));
    fiveSecondBack?.addEventListener('click', () => stepThumbnailVideo(-5));
    fiveSecondForward?.addEventListener('click', () => stepThumbnailVideo(5));
    fiveMinuteBack?.addEventListener('click', () => stepThumbnailVideo(-300));
    fiveMinuteForward?.addEventListener('click', () => stepThumbnailVideo(300));
    minuteBack?.addEventListener('click', () => stepThumbnailVideo(-60));
    minuteForward?.addEventListener('click', () => stepThumbnailVideo(60));
    captureButton?.addEventListener('click', () => captureCurrentThumbnail());
    batchButton?.addEventListener('click', () => {
        if (thumbnailState.isBatchRunning) {
            thumbnailState.abortBatch = true;
            setThumbnailStatus('正在停止批量截图...');
            return;
        }
        batchCaptureThumbnails();
    });
    clearButton?.addEventListener('click', clearThumbnailCaptures);
    selectAllButton?.addEventListener('click', toggleAllThumbnailCaptures);
    sendAddButton?.addEventListener('click', () => sendSelectedThumbnailCapturesToUploadArea('image-upload-area', '添加电影'));
    sendEditButton?.addEventListener('click', () => sendSelectedThumbnailCapturesToUploadArea('edit-image-upload-area', '编辑电影'));
    downloadSelectedButton?.addEventListener('click', downloadSelectedThumbnailCaptures);
    percentInput?.addEventListener('input', () => {
        syncThumbnailPercentPreset();
        updateThumbnailBatchSummary();
    });
    presetButtons.forEach(button => {
        button.addEventListener('click', () => {
            if (percentInput) {
                percentInput.value = button.dataset.thumbnailPercent || '2';
            }
            syncThumbnailPercentPreset();
            updateThumbnailBatchSummary();
        });
    });

    video?.addEventListener('loadedmetadata', () => {
        resetThumbnailVideoControls();
        autoDetectThumbnailFps(video);
        updateThumbnailStatusForVideo();
        updateThumbnailBatchSummary();
    });
    video?.addEventListener('durationchange', updateThumbnailBatchSummary);
    video?.addEventListener('error', () => {
        setThumbnailStatus('视频无法播放，浏览器可能不支持该编码或封装格式。');
    });

    thumbnailState.initialized = true;
    syncThumbnailSourceControls();
    syncThumbnailPercentPreset();
    updateThumbnailBatchSummary();
    renderThumbnailCaptures();
}

function setThumbnailSource(source) {
    const nextSource = source === 'emby' ? 'emby' : 'local';
    const sourceChanged = thumbnailState.source !== nextSource;
    thumbnailState.source = nextSource;
    syncThumbnailSourceControls();

    if (nextSource === 'local') {
        thumbnailState.embyRequestToken += 1;
        if (thumbnailState.currentListing) {
            renderThumbnailBrowser(thumbnailState.currentListing);
        } else {
            loadThumbnailDirectory(thumbnailState.currentPath || '');
        }
        return;
    }

    thumbnailState.directoryRequestToken += 1;
    renderThumbnailEmbyResults(thumbnailState.embyResults);
    if (sourceChanged) {
        document.getElementById('thumbnail-emby-search-input')?.focus();
    }
}

function syncThumbnailSourceControls() {
    const isEmby = thumbnailState.source === 'emby';
    const localSourceButton = document.getElementById('thumbnail-source-local');
    const embySourceButton = document.getElementById('thumbnail-source-emby');
    const browserActions = document.querySelector('#thumbnailModal .thumbnail-browser-actions');
    const breadcrumbs = document.getElementById('thumbnail-breadcrumbs');
    const embySearch = document.querySelector('#thumbnailModal .thumbnail-emby-search');
    const embyInput = document.getElementById('thumbnail-emby-search-input');

    if (localSourceButton) {
        localSourceButton.classList.toggle('is-info', !isEmby);
        localSourceButton.classList.toggle('is-light', isEmby);
        localSourceButton.setAttribute('aria-pressed', isEmby ? 'false' : 'true');
    }
    if (embySourceButton) {
        embySourceButton.classList.toggle('is-info', isEmby);
        embySourceButton.classList.toggle('is-light', !isEmby);
        embySourceButton.setAttribute('aria-pressed', isEmby ? 'true' : 'false');
    }
    if (browserActions) browserActions.hidden = isEmby;
    if (breadcrumbs) breadcrumbs.hidden = isEmby;
    if (embySearch) embySearch.hidden = !isEmby;
    if (embyInput && embyInput.value !== thumbnailState.embyQuery) {
        embyInput.value = thumbnailState.embyQuery;
    }
}

function searchThumbnailEmby() {
    const input = document.getElementById('thumbnail-emby-search-input');
    const query = (input?.value || '').trim();
    thumbnailState.source = 'emby';
    thumbnailState.embyQuery = query;
    syncThumbnailSourceControls();

    if (!query) {
        thumbnailState.embyResults = [];
        renderThumbnailEmbyResults([]);
        setThumbnailStatus('请输入关键词搜索 Emby 视频');
        return;
    }

    const requestToken = ++thumbnailState.embyRequestToken;
    setThumbnailFileListLoading('正在搜索 Emby...');
    callApi(event_map.search_emby, { query })
        .then(result => {
            if (requestToken !== thumbnailState.embyRequestToken) return;
            if (!result.success) {
                throw new Error(result.message || 'Emby 搜索失败');
            }
            const items = result.data?.items || [];
            thumbnailState.embyResults = items;
            renderThumbnailEmbyResults(items);
            setThumbnailStatus(items.length ? `找到 ${items.length} 个 Emby 视频` : '未找到匹配的 Emby 视频');
        })
        .catch(error => {
            if (requestToken !== thumbnailState.embyRequestToken) return;
            thumbnailState.embyResults = [];
            const message = error.message || 'Emby 搜索失败';
            setThumbnailFileListLoading(message);
            setThumbnailStatus(message);
        });
}

function renderThumbnailEmbyResults(items = thumbnailState.embyResults) {
    syncThumbnailSourceControls();
    const list = document.getElementById('thumbnail-file-list');
    if (!list) return;
    clearElement(list);

    if (!thumbnailState.embyQuery) {
        const empty = document.createElement('div');
        empty.className = 'thumbnail-empty';
        empty.textContent = '输入关键词搜索 Emby 视频';
        list.appendChild(empty);
        return;
    }

    if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'thumbnail-empty';
        empty.textContent = '未找到匹配的 Emby 视频';
        list.appendChild(empty);
        return;
    }

    items.forEach(item => {
        list.appendChild(createThumbnailEmbyRow(item));
    });
}

function createThumbnailEmbyRow(item) {
    const videoFile = toThumbnailEmbyVideo(item);
    const row = document.createElement('div');
    row.className = 'thumbnail-file-row thumbnail-emby-row has-copy';
    row.setAttribute('role', 'button');
    row.tabIndex = videoFile.url ? 0 : -1;
    if (videoFile.name.length > 18) {
        row.classList.add('is-long-name');
    }
    if (!videoFile.url) {
        row.classList.add('is-disabled');
        row.setAttribute('aria-disabled', 'true');
    }
    if (isThumbnailVideoSelected(videoFile)) {
        row.classList.add('is-selected');
    }

    appendChildren(row, [
        createEl('span', { className: 'thumbnail-file-name' }, [
            createEl('span', { className: 'thumbnail-file-name-text', text: videoFile.name })
        ]),
        createEl('span', {
            className: 'thumbnail-file-meta',
            text: formatThumbnailEmbyMeta(item, videoFile)
        }),
        createThumbnailCopyNameButton('复制片名')
    ]);
    row.title = videoFile.name;

    const selectEmbyVideo = () => {
        if (!videoFile.url) {
            setThumbnailStatus('这个 Emby 条目没有可用播放地址');
            return;
        }
        selectThumbnailVideo(videoFile);
    };
    row.addEventListener('click', selectEmbyVideo);
    row.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectEmbyVideo();
        }
    });
    row.querySelector('.thumbnail-copy-name')?.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        copyThumbnailVideoFileName(videoFile.name, event.currentTarget);
    });
    return row;
}

function toThumbnailEmbyVideo(item) {
    const id = String(item?.id || '');
    const name = item?.name || 'Emby video';
    return {
        source: 'emby',
        id,
        name,
        path: id ? `emby:${id}` : `emby:${name}`,
        url: item?.streamUrl || '',
        runtimeTicks: item?.runtimeTicks || 0,
        imageUrl: item?.imageUrl || ''
    };
}

function formatThumbnailEmbyMeta(item, videoFile) {
    if (!videoFile.url) return 'Emby · 不可播放';
    const runtime = formatRuntime(item?.runtimeTicks);
    return runtime ? `Emby · ${runtime}` : 'Emby';
}

function isThumbnailVideoSelected(file) {
    const selected = thumbnailState.selectedVideo;
    if (!selected || !file) return false;
    const selectedSource = selected.source || 'local';
    const fileSource = file.source || 'local';
    if (selectedSource !== fileSource) return false;
    if (fileSource === 'emby') {
        return Boolean(selected.id && file.id && selected.id === file.id);
    }
    return Boolean(selected.path && file.path && selected.path === file.path);
}

function renderThumbnailCurrentSourceList() {
    if (thumbnailState.source === 'emby') {
        renderThumbnailEmbyResults(thumbnailState.embyResults);
    } else {
        renderThumbnailBrowser(thumbnailState.currentListing || { path: thumbnailState.currentPath, directories: [], files: [] });
    }
}

function loadThumbnailDirectory(path = '') {
    const safePath = path || '';
    thumbnailState.source = 'local';
    syncThumbnailSourceControls();
    const requestToken = ++thumbnailState.directoryRequestToken;
    setThumbnailFileListLoading();
    callApi(event_map.list_video_files, { path: safePath })
        .then(result => {
            if (requestToken !== thumbnailState.directoryRequestToken) return;
            if (!result.success) {
                throw new Error(result.message || '读取视频目录失败');
            }
            thumbnailState.currentPath = result.path || '';
            thumbnailState.currentListing = result;
            renderThumbnailBrowser(result);
            if (result.message) {
                setThumbnailStatus(result.message);
            }
        })
        .catch(error => {
            if (requestToken !== thumbnailState.directoryRequestToken) return;
            renderThumbnailBrowser({
                path: safePath,
                parent: getThumbnailParentPath(safePath),
                directories: [],
                files: []
            });
            setThumbnailStatus(error.message || '读取视频目录失败');
        });
}

function setThumbnailFileListLoading(message = '正在读取...') {
    const list = document.getElementById('thumbnail-file-list');
    if (list) {
        const empty = document.createElement('div');
        empty.className = 'thumbnail-empty';
        empty.textContent = message;
        list.replaceChildren(empty);
    }
}

function renderThumbnailBrowser(data) {
    syncThumbnailSourceControls();
    renderThumbnailBreadcrumbs(data.path || '');
    const upButton = document.getElementById('thumbnail-up-button');
    if (upButton) {
        upButton.disabled = !(data.path || '');
    }

    const list = document.getElementById('thumbnail-file-list');
    if (!list) return;
    clearElement(list);

    const directories = data.directories || [];
    const files = data.files || [];
    if (!directories.length && !files.length) {
        const empty = document.createElement('div');
        empty.className = 'thumbnail-empty';
        empty.textContent = '当前目录没有可播放的视频文件';
        list.appendChild(empty);
        return;
    }

    directories.forEach(directory => {
        list.appendChild(createThumbnailDirectoryRow(directory));
    });
    files.forEach(file => {
        list.appendChild(createThumbnailFileRow(file));
    });
}

function renderThumbnailBreadcrumbs(path) {
    const breadcrumbs = document.getElementById('thumbnail-breadcrumbs');
    if (!breadcrumbs) return;
    clearElement(breadcrumbs);

    const rootButton = document.createElement('button');
    rootButton.type = 'button';
    rootButton.textContent = 'videos';
    rootButton.addEventListener('click', () => loadThumbnailDirectory(''));
    breadcrumbs.appendChild(rootButton);

    let acc = '';
    path.split('/').filter(Boolean).forEach(part => {
        acc = acc ? `${acc}/${part}` : part;
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = part;
        const targetPath = acc;
        button.addEventListener('click', () => loadThumbnailDirectory(targetPath));
        breadcrumbs.appendChild(button);
    });
}

function createThumbnailDirectoryRow(directory) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'thumbnail-file-row';
    if (directory.name.length > 18) {
        row.classList.add('is-long-name');
    }
    appendChildren(row, [
        createEl('span', { className: 'thumbnail-file-name' }, [
            createEl('span', { className: 'thumbnail-file-name-text', text: `/${directory.name}` })
        ]),
        createEl('span', { className: 'thumbnail-file-meta', text: '目录' })
    ]);
    row.title = directory.name;
    row.addEventListener('click', () => loadThumbnailDirectory(directory.path));
    return row;
}

function createThumbnailFileRow(file) {
    const videoFile = {
        ...file,
        source: file.source || 'local'
    };
    const row = document.createElement('div');
    row.className = 'thumbnail-file-row has-copy';
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    if (videoFile.name.length > 18) {
        row.classList.add('is-long-name');
    }
    if (isThumbnailVideoSelected(videoFile)) {
        row.classList.add('is-selected');
    }
    appendChildren(row, [
        createEl('span', { className: 'thumbnail-file-name' }, [
            createEl('span', { className: 'thumbnail-file-name-text', text: videoFile.name })
        ]),
        createEl('span', {
            className: 'thumbnail-file-meta',
            text: formatThumbnailBytes(videoFile.size)
        }),
        createThumbnailCopyNameButton('复制文件名')
    ]);
    row.title = videoFile.name;
    row.addEventListener('click', () => selectThumbnailVideo(videoFile));
    row.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectThumbnailVideo(videoFile);
        }
    });
    row.querySelector('.thumbnail-copy-name')?.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        copyThumbnailVideoFileName(videoFile.name, event.currentTarget);
    });
    return row;
}

function createThumbnailCopyNameButton(ariaLabel) {
    return createEl('button', {
        className: 'thumbnail-copy-name',
        attrs: { type: 'button', 'aria-label': ariaLabel }
    }, [
        createSpriteSvg('copy-btn-icon', {
            fill: 'currentColor',
            ariaLabel: '复制'
        })
    ]);
}

async function copyThumbnailVideoFileName(fileName, button) {
    const setCopyIcon = (symbolId, stateClass) => {
        if (!button) return;
        button.classList.remove('is-success', 'is-danger');
        if (stateClass) button.classList.add(stateClass);
        button.replaceChildren(createSpriteSvg(symbolId, {
            fill: 'currentColor',
            ariaLabel: '复制'
        }));
    };

    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(fileName);
        } else {
            const textarea = document.createElement('textarea');
            textarea.value = fileName;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        }
        setCopyIcon('copy-success-btn-icon', 'is-success');
        setThumbnailStatus(`已复制文件名：${fileName}`);
    } catch (error) {
        setCopyIcon('copy-fail-btn-icon', 'is-danger');
        setThumbnailStatus('复制文件名失败');
    } finally {
        setTimeout(() => setCopyIcon('copy-btn-icon', ''), 1200);
    }
}

function selectThumbnailVideo(file) {
    const videoFile = {
        ...file,
        source: file.source || 'local'
    };
    thumbnailState.selectedVideo = videoFile;
    const video = document.getElementById('thumbnail-video');
    if (!video) return;

    thumbnailState.seekToken += 1;
    thumbnailState.stepSeekToken += 1;
    clearTimeout(thumbnailState.stepSeekTimer);
    thumbnailState.stepSeekTimer = null;
    thumbnailState.pendingStepTarget = null;
    thumbnailState.pendingStepShouldResume = false;
    video.pause();
    video.preload = 'metadata';
    video.src = videoFile.url;
    video.load();
    setThumbnailStatus(`已选择：${videoFile.name}`);
    renderThumbnailCurrentSourceList();
}

function updateThumbnailStatusForVideo() {
    const video = document.getElementById('thumbnail-video');
    if (!video || !thumbnailState.selectedVideo) return;
    setThumbnailStatus(`${thumbnailState.selectedVideo.name} · ${formatThumbnailTime(video.duration)}`);
}

function setThumbnailStatus(message) {
    const status = document.getElementById('thumbnail-status');
    if (status) {
        status.textContent = message;
    }
}

function getThumbnailParentPath(path) {
    const parts = (path || '').split('/').filter(Boolean);
    parts.pop();
    return parts.join('/');
}

function getThumbnailSecondStep() {
    return 1;
}

function getThumbnailFrameStep() {
    const fps = thumbnailState.adaptiveFps || 30;
    return Number.isFinite(fps) && fps > 0 ? 1 / fps : 1 / 30;
}

function getThumbnailPercentStep() {
    const value = parseFloat(document.getElementById('thumbnail-percent-step')?.value || '2');
    return Number.isFinite(value) && value > 0 && value <= 100 ? value : 2;
}

function resetThumbnailVideoControls() {
    thumbnailState.adaptiveFps = 30;
    syncThumbnailPercentPreset();
}

function autoDetectThumbnailFps(video) {
    thumbnailState.fpsProbeToken += 1;
    const probeToken = thumbnailState.fpsProbeToken;
    thumbnailState.adaptiveFps = 30;

    if (!video || typeof video.requestVideoFrameCallback !== 'function') {
        return;
    }

    const samples = [];
    let lastMediaTime = null;
    let isDone = false;

    const finish = () => {
        if (isDone || probeToken !== thumbnailState.fpsProbeToken) return;
        isDone = true;
        if (samples.length < 2) {
            thumbnailState.adaptiveFps = 30;
            return;
        }

        const averageDelta = samples.reduce((sum, delta) => sum + delta, 0) / samples.length;
        if (averageDelta > 0) {
            thumbnailState.adaptiveFps = Math.max(1, Math.round(1 / averageDelta));
        }
    };

    const sampleFrame = (now, metadata) => {
        if (probeToken !== thumbnailState.fpsProbeToken || isDone) return;
        if (lastMediaTime !== null) {
            const delta = metadata.mediaTime - lastMediaTime;
            if (delta > 0 && delta < 1) {
                samples.push(delta);
            }
        }
        lastMediaTime = metadata.mediaTime;
        if (samples.length >= 6) {
            finish();
        } else {
            video.requestVideoFrameCallback(sampleFrame);
        }
    };

    video.requestVideoFrameCallback(sampleFrame);
    setTimeout(finish, 1200);
}

function getThumbnailBatchTargets() {
    const video = document.getElementById('thumbnail-video');
    if (!isThumbnailVideoReady(video)) return [];

    const percentStep = getThumbnailPercentStep();
    const targets = [];
    for (let percent = percentStep; percent <= 100 + 0.0001; percent += percentStep) {
        targets.push(clampThumbnailTime(video.duration * Math.min(percent, 100) / 100, video.duration));
    }
    return targets;
}

function updateThumbnailBatchSummary() {
    const summary = document.getElementById('thumbnail-batch-summary');
    if (summary) {
        summary.textContent = '';
    }
    updateThumbnailBatchButtonLabel();
}

function getThumbnailBatchCount() {
    const video = document.getElementById('thumbnail-video');
    if (!isThumbnailVideoReady(video)) {
        return 0;
    }
    return getThumbnailBatchTargets().length;
}

function updateThumbnailBatchButtonLabel() {
    if (thumbnailState.isBatchRunning) return;
    const batchButton = document.getElementById('thumbnail-batch-capture');
    if (!batchButton) return;
    const batchCount = getThumbnailBatchCount();
    batchButton.textContent = batchCount > 0 ? `批量截图 ${batchCount} 张` : '批量截图';
}

function syncThumbnailPercentPreset() {
    const percentStep = getThumbnailPercentStep();
    document.querySelectorAll('.thumbnail-percent-preset').forEach(button => {
        const presetValue = parseFloat(button.dataset.thumbnailPercent || '0');
        button.classList.toggle('is-info', Math.abs(presetValue - percentStep) < 0.0001);
    });
}

async function stepThumbnailVideo(delta) {
    const video = document.getElementById('thumbnail-video');
    if (!isThumbnailVideoReady(video)) {
        setThumbnailStatus('请先选择可播放的视频');
        return;
    }
    const shouldResume = thumbnailState.pendingStepShouldResume || (!video.paused && !video.ended);
    const baseTime = Number.isFinite(thumbnailState.pendingStepTarget)
        ? thumbnailState.pendingStepTarget
        : video.currentTime;
    const target = clampThumbnailTime(baseTime + delta, video.duration);
    const stepToken = ++thumbnailState.stepSeekToken;

    thumbnailState.pendingStepTarget = target;
    thumbnailState.pendingStepShouldResume = shouldResume;
    clearTimeout(thumbnailState.stepSeekTimer);
    setThumbnailStatus(`准备定位：${formatThumbnailTime(target)} / ${formatThumbnailTime(video.duration)}`);

    thumbnailState.stepSeekTimer = setTimeout(() => {
        flushThumbnailStepSeek(stepToken);
    }, 60);
}

async function flushThumbnailStepSeek(stepToken) {
    if (stepToken !== thumbnailState.stepSeekToken) return;

    const video = document.getElementById('thumbnail-video');
    if (!isThumbnailVideoReady(video) || !Number.isFinite(thumbnailState.pendingStepTarget)) return;

    const target = thumbnailState.pendingStepTarget;
    const shouldResume = thumbnailState.pendingStepShouldResume;
    thumbnailState.stepSeekTimer = null;

    try {
        const completed = await seekThumbnailVideo(target);
        if (stepToken !== thumbnailState.stepSeekToken) return;
        if (thumbnailState.pendingStepTarget === target) {
            thumbnailState.pendingStepTarget = null;
        }
        thumbnailState.pendingStepShouldResume = false;
        if (shouldResume && completed) {
            video.play().catch(() => {});
        }
        setThumbnailStatus(`当前时间：${formatThumbnailTime(video.currentTime)} / ${formatThumbnailTime(video.duration)}`);
    } catch (error) {
        if (stepToken === thumbnailState.stepSeekToken) {
            thumbnailState.pendingStepTarget = null;
            thumbnailState.pendingStepShouldResume = false;
            setThumbnailStatus(error.message || '视频定位失败');
        }
    }
}

function isThumbnailVideoReady(video) {
    return Boolean(video && video.src && Number.isFinite(video.duration) && video.duration > 0);
}

function clampThumbnailTime(time, duration) {
    const maxTime = Math.max(0, duration - 0.1);
    return Math.min(Math.max(0, time), maxTime);
}

function seekThumbnailVideo(time) {
    const video = document.getElementById('thumbnail-video');
    const seekToken = ++thumbnailState.seekToken;
    return new Promise((resolve, reject) => {
        if (!video) {
            reject(new Error('视频元素不存在'));
            return;
        }
        if (Math.abs(video.currentTime - time) < 0.03) {
            resolve(true);
            return;
        }

        let timeoutId;
        const isStale = () => seekToken !== thumbnailState.seekToken;
        const cleanup = () => {
            clearTimeout(timeoutId);
            video.removeEventListener('seeked', onSeeked);
            video.removeEventListener('error', onError);
        };
        const onSeeked = () => {
            cleanup();
            resolve(!isStale());
        };
        const onError = () => {
            cleanup();
            if (isStale()) {
                resolve(false);
                return;
            }
            reject(new Error('视频定位失败'));
        };

        timeoutId = setTimeout(() => {
            cleanup();
            if (isStale()) {
                resolve(false);
                return;
            }
            reject(new Error('视频定位超时'));
        }, 8000);

        video.addEventListener('seeked', onSeeked, { once: true });
        video.addEventListener('error', onError, { once: true });
        if (typeof video.fastSeek === 'function') {
            try {
                video.fastSeek(time);
            } catch (error) {
                video.currentTime = time;
            }
        } else {
            video.currentTime = time;
        }
    });
}

function captureCurrentThumbnail(options = {}) {
    const video = document.getElementById('thumbnail-video');
    if (!isThumbnailVideoReady(video) || !video.videoWidth || !video.videoHeight) {
        if (!options.silent) {
            setThumbnailStatus('请先选择并加载可截图的视频');
        }
        return Promise.resolve(null);
    }

    const sessionToken = thumbnailState.sessionToken;
    return new Promise(resolve => {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext('2d');
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(blob => {
            if (sessionToken !== thumbnailState.sessionToken) {
                resolve(null);
                return;
            }
            if (!blob) {
                setThumbnailStatus('截图失败');
                resolve(null);
                return;
            }

            const currentTime = video.currentTime;
            const fileName = createThumbnailFileName(currentTime);
            const file = new File([blob], fileName, {
                type: 'image/jpeg',
                lastModified: Date.now()
            });
            const capture = {
                id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                file,
                url: URL.createObjectURL(file),
                time: currentTime,
                name: fileName
            };
            thumbnailState.captures.push(capture);
            renderThumbnailCaptures();
            setThumbnailStatus(`已截图：${formatThumbnailTime(currentTime)}`);
            resolve(capture);
        }, 'image/jpeg', 0.9);
    });
}

async function batchCaptureThumbnails() {
    const video = document.getElementById('thumbnail-video');
    if (!isThumbnailVideoReady(video)) {
        setThumbnailStatus('请先选择可播放的视频');
        return;
    }
    if (thumbnailState.isBatchRunning) return;

    const targets = getThumbnailBatchTargets();
    if (!targets.length) return;

    const batchSessionToken = thumbnailState.sessionToken;
    thumbnailState.isBatchRunning = true;
    thumbnailState.abortBatch = false;
    setThumbnailBatchControls(true);
    video.pause();

    try {
        for (let i = 0; i < targets.length; i++) {
            if (thumbnailState.abortBatch || batchSessionToken !== thumbnailState.sessionToken) break;
            await seekThumbnailVideo(targets[i]);
            if (thumbnailState.abortBatch || batchSessionToken !== thumbnailState.sessionToken) break;
            await captureCurrentThumbnail({ silent: true });
            if (thumbnailState.abortBatch || batchSessionToken !== thumbnailState.sessionToken) break;
            updateThumbnailProgress((i + 1) / targets.length * 100);
            setThumbnailStatus(`批量截图 ${i + 1} / ${targets.length}`);
        }
    } catch (error) {
        if (batchSessionToken === thumbnailState.sessionToken) {
            setThumbnailStatus(error.message || '批量截图失败');
        }
    } finally {
        thumbnailState.isBatchRunning = false;
        thumbnailState.abortBatch = false;
        if (batchSessionToken === thumbnailState.sessionToken) {
            setThumbnailBatchControls(false);
        }
    }
}

function setThumbnailBatchControls(isRunning) {
    const batchButton = document.getElementById('thumbnail-batch-capture');
    const progress = document.getElementById('thumbnail-batch-progress');

    if (batchButton) {
        batchButton.disabled = false;
        batchButton.classList.toggle('is-primary', !isRunning);
        batchButton.classList.toggle('is-warning', isRunning);
        if (isRunning) {
            batchButton.textContent = '停止截图';
        } else {
            updateThumbnailBatchButtonLabel();
        }
    }
    if (progress) {
        progress.style.display = isRunning ? 'block' : 'none';
        progress.value = 0;
    }
}

function updateThumbnailProgress(value) {
    const progress = document.getElementById('thumbnail-batch-progress');
    if (progress) {
        progress.value = Math.max(0, Math.min(100, value));
    }
}

function renderThumbnailCaptures() {
    const grid = document.getElementById('thumbnail-grid');
    if (!grid) return;
    clearElement(grid);

    if (!thumbnailState.captures.length) {
        const empty = document.createElement('div');
        empty.className = 'thumbnail-empty';
        empty.textContent = '截图将显示在这里';
        grid.appendChild(empty);
        updateThumbnailSelectionControls();
        return;
    }

    thumbnailState.captures.forEach(capture => {
        const isSelected = thumbnailState.selectedCaptureIds.has(capture.id);
        const item = document.createElement('div');
        item.className = `thumbnail-item${isSelected ? ' is-selected' : ''}`;
        item.draggable = true;
        item.dataset.id = capture.id;

        const image = document.createElement('img');
        image.src = capture.url;
        image.alt = capture.name;

        const timeBadge = document.createElement('span');
        timeBadge.className = 'thumbnail-item-time';
        timeBadge.textContent = formatThumbnailTime(capture.time);

        const selectButton = document.createElement('button');
        selectButton.className = 'thumbnail-select-toggle';
        selectButton.type = 'button';
        selectButton.setAttribute('aria-label', isSelected ? '取消选择' : '选择缩略图');
        selectButton.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
        selectButton.textContent = '✓';
        selectButton.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            toggleThumbnailCaptureSelection(capture.id);
        });

        const deleteButton = document.createElement('button');
        deleteButton.className = 'thumbnail-delete';
        deleteButton.type = 'button';
        deleteButton.setAttribute('aria-label', '删除');
        deleteButton.appendChild(createSpriteSvg('close-icon', {
            width: 12,
            height: 12,
            fill: 'currentColor',
            ariaLabel: '删除'
        }));
        deleteButton.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            deleteThumbnailCapture(capture.id);
        });

        item.append(image, selectButton, timeBadge, deleteButton);
        item.addEventListener('click', () => jumpThumbnailVideoToCapture(capture));
        item.addEventListener('dragstart', event => startThumbnailDrag(event, capture, item));
        item.addEventListener('dragend', () => {
            setThumbnailDraggingState([], false);
            setTimeout(clearThumbnailDragCache, 0);
        });
        grid.appendChild(item);
    });
    updateThumbnailSelectionControls();
}

function startThumbnailDrag(event, capture, item) {
    const captures = getThumbnailDragCaptures(capture);
    setThumbnailDraggingState(captures.map(item => item.id), true);
    window.currentDraggedThumbnailFiles = captures.map(item => item.file);
    window.currentDraggedThumbnailFile = captures.length === 1 ? captures[0].file : null;
    event.dataTransfer.effectAllowed = 'copy';
    captures.forEach(item => {
        try {
            event.dataTransfer.items.add(item.file);
        } catch (error) {
            // Some browsers do not allow adding File objects during dragstart.
        }
    });
    event.dataTransfer.setData('text/plain', captures.map(item => item.name).join('\n'));
    event.dataTransfer.setData('text/uri-list', captures.map(item => item.url).join('\n'));
    event.dataTransfer.setData('DownloadURL', `${captures[0].file.type}:${captures[0].name}:${captures[0].url}`);
}

function toggleThumbnailCaptureSelection(captureId) {
    if (thumbnailState.selectedCaptureIds.has(captureId)) {
        thumbnailState.selectedCaptureIds.delete(captureId);
    } else {
        thumbnailState.selectedCaptureIds.add(captureId);
    }
    renderThumbnailCaptures();
}

function toggleAllThumbnailCaptures() {
    if (!thumbnailState.captures.length) return;

    const allSelected = thumbnailState.captures.every(capture => thumbnailState.selectedCaptureIds.has(capture.id));
    thumbnailState.selectedCaptureIds.clear();
    if (!allSelected) {
        thumbnailState.captures.forEach(capture => thumbnailState.selectedCaptureIds.add(capture.id));
    }
    renderThumbnailCaptures();
}

function updateThumbnailSelectionControls() {
    const clearButton = document.getElementById('thumbnail-clear-captures');
    const selectAllButton = document.getElementById('thumbnail-select-all');
    const selectedCount = document.getElementById('thumbnail-selected-count');
    const sendAddButton = document.getElementById('thumbnail-send-add');
    const sendEditButton = document.getElementById('thumbnail-send-edit');
    const downloadSelectedButton = document.getElementById('thumbnail-download-selected');
    const totalCount = thumbnailState.captures.length;
    const validIds = new Set(thumbnailState.captures.map(capture => capture.id));

    thumbnailState.selectedCaptureIds.forEach(id => {
        if (!validIds.has(id)) {
            thumbnailState.selectedCaptureIds.delete(id);
        }
    });

    const selectedTotal = thumbnailState.selectedCaptureIds.size;
    const hasSelected = selectedTotal > 0;
    const allSelected = totalCount > 0 && selectedTotal === totalCount;
    if (clearButton) {
        clearButton.disabled = totalCount === 0;
    }
    if (selectAllButton) {
        selectAllButton.disabled = totalCount === 0;
        selectAllButton.textContent = allSelected ? '取消全选' : '全选';
        selectAllButton.classList.toggle('is-light', !allSelected);
    }
    if (selectedCount) {
        selectedCount.textContent = `已选 ${selectedTotal} 张`;
    }
    if (sendAddButton) {
        sendAddButton.disabled = !hasSelected || typeof window['addimage-upload-areaFiles'] !== 'function';
    }
    if (sendEditButton) {
        const editModalOpen = isThumbnailEditModalOpen();
        sendEditButton.disabled = !hasSelected || !editModalOpen || typeof window['addedit-image-upload-areaFiles'] !== 'function';
        sendEditButton.title = editModalOpen ? '' : '请先打开编辑电影窗口';
    }
    if (downloadSelectedButton) {
        downloadSelectedButton.disabled = !hasSelected;
    }
}

function getSelectedThumbnailCaptures() {
    return thumbnailState.captures.filter(capture => thumbnailState.selectedCaptureIds.has(capture.id));
}

function isThumbnailEditModalOpen() {
    return document.getElementById('editModal')?.classList.contains('is-active') || false;
}

function sendSelectedThumbnailCapturesToUploadArea(areaId, label) {
    const selectedCaptures = getSelectedThumbnailCaptures();
    if (!selectedCaptures.length) {
        showAlert({
            title: '请选择缩略图',
            message: '请先选中需要复用的缩略图。',
            type: 'warning',
            showCancel: false
        });
        return;
    }

    if (areaId === 'edit-image-upload-area' && !isThumbnailEditModalOpen()) {
        showAlert({
            title: '编辑窗口未打开',
            message: '请先打开要编辑的电影，再把缩略图加入编辑电影图片区。',
            type: 'warning',
            showCancel: false
        });
        updateThumbnailSelectionControls();
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
        updateThumbnailSelectionControls();
        return;
    }

    addFiles(selectedCaptures.map(capture => capture.file));
    setThumbnailStatus(`已加入 ${selectedCaptures.length} 张缩略图到${label}图片区`);
    showAlert({
        title: '已加入',
        message: `已将 ${selectedCaptures.length} 张缩略图加入${label}图片区。`,
        type: 'success',
        showCancel: false
    });
}

function downloadSelectedThumbnailCaptures() {
    const selectedCaptures = getSelectedThumbnailCaptures();
    if (!selectedCaptures.length) {
        showAlert({
            title: '请选择缩略图',
            message: '请先选中需要下载的缩略图。',
            type: 'warning',
            showCancel: false
        });
        return;
    }

    selectedCaptures.forEach(capture => {
        const link = document.createElement('a');
        link.href = capture.url;
        link.download = capture.name;
        document.body.appendChild(link);
        link.click();
        link.remove();
    });

    setThumbnailStatus(`已开始下载 ${selectedCaptures.length} 张缩略图`);
    showAlert({
        title: '开始下载',
        message: `已触发 ${selectedCaptures.length} 张缩略图下载，移动端浏览器可能会逐个确认或保存。`,
        type: 'success',
        showCancel: false
    });
}

function getThumbnailDragCaptures(capture) {
    if (thumbnailState.selectedCaptureIds.has(capture.id)) {
        const selectedCaptures = thumbnailState.captures.filter(item => thumbnailState.selectedCaptureIds.has(item.id));
        return selectedCaptures.length ? selectedCaptures : [capture];
    }
    return [capture];
}

function setThumbnailDraggingState(captureIds, isDragging) {
    document.querySelectorAll('.thumbnail-item.dragging').forEach(item => {
        item.classList.remove('dragging');
    });
    if (!isDragging) return;

    const idSet = new Set(captureIds);
    document.querySelectorAll('.thumbnail-item').forEach(item => {
        item.classList.toggle('dragging', idSet.has(item.dataset.id));
    });
}

function clearThumbnailDragCache() {
    window.currentDraggedThumbnailFile = null;
    window.currentDraggedThumbnailFiles = [];
}

async function jumpThumbnailVideoToCapture(capture) {
    const video = document.getElementById('thumbnail-video');
    if (!capture || !isThumbnailVideoReady(video)) return;

    video.pause();
    try {
        await seekThumbnailVideo(clampThumbnailTime(capture.time, video.duration));
        setThumbnailStatus(`已跳转：${formatThumbnailTime(video.currentTime)} / ${formatThumbnailTime(video.duration)}`);
    } catch (error) {
        setThumbnailStatus(error.message || '视频定位失败');
    }
}

function deleteThumbnailCapture(captureId) {
    const index = thumbnailState.captures.findIndex(capture => capture.id === captureId);
    if (index === -1) return;
    URL.revokeObjectURL(thumbnailState.captures[index].url);
    thumbnailState.captures.splice(index, 1);
    thumbnailState.selectedCaptureIds.delete(captureId);
    renderThumbnailCaptures();
}

function clearThumbnailCaptures() {
    thumbnailState.captures.forEach(capture => URL.revokeObjectURL(capture.url));
    thumbnailState.captures = [];
    thumbnailState.selectedCaptureIds.clear();
    clearThumbnailDragCache();
    renderThumbnailCaptures();
}

function createThumbnailFileName(time) {
    const sourceName = thumbnailState.selectedVideo?.name || 'video';
    const baseName = sourceName.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_');
    return `${baseName}_${time.toFixed(2)}s.jpg`;
}

function formatThumbnailBytes(bytes) {
    if (!Number.isFinite(bytes)) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatThumbnailTime(value) {
    if (!Number.isFinite(value)) return '00:00';
    const totalSeconds = Math.max(0, value);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const fraction = Math.floor((totalSeconds % 1) * 100);
    const base = hours > 0
        ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
        : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    return `${base}.${String(fraction).padStart(2, '0')}`;
}

