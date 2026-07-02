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

