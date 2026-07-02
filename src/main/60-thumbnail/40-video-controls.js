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

