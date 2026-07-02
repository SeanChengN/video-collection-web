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

