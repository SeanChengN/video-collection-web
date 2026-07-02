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

