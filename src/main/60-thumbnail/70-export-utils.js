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

