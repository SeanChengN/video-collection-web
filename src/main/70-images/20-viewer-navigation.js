function openImageViewer(imageFilenames, movieTitle) {
    stopImageViewerEmbyPlayback();
    currentImageIndex = 0;
    currentImages = [];
    currentImageMovieTitle = movieTitle || '';
    
    currentImages = imageFilenames.split(',').filter(name => name.trim());

    const modal = document.getElementById('imageViewerModal');
    setImageViewerModalWidth();
    modal.querySelector('.modal-card-title').textContent = `查看图片：${movieTitle}`;
    
    updateViewerImage();
    ModalManager.open('imageViewerModal');
    scheduleImageViewerResize();
}

function parseImageCaptureTimestamp(filename) {
    const match = String(filename || '').match(/__at-(\d+(?:\.\d{1,2})?)s\.webp$/i);
    if (!match) return null;
    const timestamp = Number(match[1]);
    return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : null;
}

function formatImageCaptureTimestamp(seconds) {
    const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const remainingSeconds = totalSeconds % 60;
    return [hours, minutes, remainingSeconds]
        .map(value => String(value).padStart(2, '0'))
        .join(':');
}

function isImageViewerVideoMode() {
    return document.querySelector('#imageViewerModal .image-viewer-container')?.classList.contains('is-video-mode') || false;
}

function enterImageViewerVideoMode() {
    const modal = document.getElementById('imageViewerModal');
    const container = modal?.querySelector('.image-viewer-container');
    const viewer = modal?.querySelector('.viewer-image');
    const video = modal?.querySelector('.image-viewer-emby-video');
    const timecode = modal?.querySelector('.image-viewer-timecode');
    const returnButton = modal?.querySelector('.image-viewer-video-return');
    if (!container || !viewer || !video) return;

    container.classList.add('is-video-mode');
    viewer.hidden = true;
    video.hidden = false;
    if (timecode) timecode.hidden = true;
    if (returnButton) returnButton.hidden = false;
    scheduleImageViewerResize();
}

function leaveImageViewerVideoMode() {
    const modal = document.getElementById('imageViewerModal');
    const container = modal?.querySelector('.image-viewer-container');
    const viewer = modal?.querySelector('.viewer-image');
    const video = modal?.querySelector('.image-viewer-emby-video');
    const returnButton = modal?.querySelector('.image-viewer-video-return');
    container?.classList.remove('is-video-mode');
    if (viewer) viewer.hidden = false;
    if (video) video.hidden = true;
    if (returnButton) returnButton.hidden = true;
}

function stopImageViewerEmbyPlayback() {
    const video = document.querySelector('#imageViewerModal .image-viewer-emby-video');
    releaseEmbyVideo(video);
    if (currentEmbyPlaybackContext?.target === 'viewer') {
        currentEmbyPlaybackContext = null;
    }
    leaveImageViewerVideoMode();
}

function exitImageViewerVideoMode() {
    stopImageViewerEmbyPlayback();
    updateViewerImage();
}

function seekImageViewerEmbyPlayback(timestamp) {
    const context = currentEmbyPlaybackContext;
    if (!context || context.target !== 'viewer' || !context.video) return false;
    context.startTimestamp = Math.max(0, Number(timestamp) || 0);
    const duration = Number(context.video.duration);
    context.video.currentTime = Number.isFinite(duration)
        ? Math.min(context.startTimestamp, Math.max(0, duration))
        : context.startTimestamp;
    context.video.play().catch(() => {});
    return true;
}

async function playImageCaptureInEmby() {
    const timecode = document.querySelector('#imageViewerModal .image-viewer-timecode');
    const timestamp = Number(timecode?.dataset.timestamp);
    if (!currentImageMovieTitle || !Number.isFinite(timestamp) || timestamp < 0 || !timecode) return;

    timecode.disabled = true;
    try {
        const result = await callApi(event_map.resolve_movie_emby_playback, {
            title: currentImageMovieTitle
        });
        if (!result.success) throw new Error(result.message || '无法获取 Emby 播放信息。');

        const data = result.data || {};
        if (data.status === 'linked' && data.playback?.streamUrl) {
            rememberMovieEmbyLink(currentImageMovieTitle, data.playback.id);
            openImageViewerEmbyPlayer(data.playback.streamUrl, data.playback.name || currentImageMovieTitle, timestamp, {
                movieTitle: currentImageMovieTitle,
                itemId: data.playback.id
            });
            return;
        }
        if (data.status === 'candidates') {
            rememberMovieEmbyLink(currentImageMovieTitle, null);
            openEmbyLinkSelection(currentImageMovieTitle, timestamp, data.candidates || [], {
                playbackTarget: 'viewer'
            });
            return;
        }
        throw new Error('未找到匹配的 Emby 电影。');
    } catch (error) {
        showAlert({
            title: 'Emby',
            message: error.message || '无法启动 Emby 播放。',
            type: 'warning',
            showCancel: false
        });
    } finally {
        timecode.disabled = false;
    }
}

function updateViewerImage() {
    const modal = document.getElementById('imageViewerModal');
    const viewer = modal.querySelector('.viewer-image');
    const prevButton = modal.querySelector('.nav-button.prev');
    const nextButton = modal.querySelector('.nav-button.next');
    const counter = modal.querySelector('.image-counter');
    const timecode = modal.querySelector('.image-viewer-timecode');
    
    viewer.onload = scheduleImageViewerResize;
    resetImageViewerScroll();
    viewer.style.height = 'auto';
    viewer.src = buildImageUrl(currentImages[currentImageIndex]);
    if (viewer.complete) {
        scheduleImageViewerResize();
    }

    const captureTimestamp = parseImageCaptureTimestamp(currentImages[currentImageIndex]);
    if (timecode) {
        timecode.hidden = captureTimestamp === null;
        timecode.disabled = false;
        if (captureTimestamp !== null) {
            timecode.dataset.timestamp = String(captureTimestamp);
            timecode.textContent = formatImageCaptureTimestamp(captureTimestamp);
        } else {
            delete timecode.dataset.timestamp;
            clearElement(timecode);
        }
    }
    
    // 只有多张图片时才显示计数器
    counter.style.display = currentImages.length > 1 ? 'block' : 'none';
    
    // 根据图片位置和数量控制导航按钮
    prevButton.style.display = currentImages.length > 1 && currentImageIndex > 0 ? 'flex' : 'none';
    nextButton.style.display = currentImages.length > 1 && currentImageIndex < currentImages.length - 1 ? 'flex' : 'none';
    renderImageViewerStrip();
    
    if (currentImages.length > 1) {
        updateImageCounter();
    }
}

function updateImageViewerNavigationState() {
    const modal = document.getElementById('imageViewerModal');
    const prevButton = modal?.querySelector('.nav-button.prev');
    const nextButton = modal?.querySelector('.nav-button.next');
    const counter = modal?.querySelector('.image-counter');
    if (!prevButton || !nextButton || !counter) return;
    counter.style.display = currentImages.length > 1 ? 'block' : 'none';
    prevButton.style.display = currentImages.length > 1 && currentImageIndex > 0 ? 'flex' : 'none';
    nextButton.style.display = currentImages.length > 1 && currentImageIndex < currentImages.length - 1 ? 'flex' : 'none';
    if (currentImages.length > 1) updateImageCounter();
}

function setImageViewerIndex(index) {
    const nextIndex = Number(index);
    if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= currentImages.length || nextIndex === currentImageIndex) return;
    currentImageIndex = nextIndex;
    const captureTimestamp = parseImageCaptureTimestamp(currentImages[currentImageIndex]);
    if (isImageViewerVideoMode() && captureTimestamp !== null && seekImageViewerEmbyPlayback(captureTimestamp)) {
        renderImageViewerStrip();
        updateImageViewerNavigationState();
        return;
    }
    if (isImageViewerVideoMode()) {
        stopImageViewerEmbyPlayback();
    }
    updateViewerImage();
}
function renderImageViewerStrip() {
    const modal = document.getElementById('imageViewerModal');
    const strip = modal?.querySelector('.image-viewer-strip');
    if (!strip) return;

    clearElement(strip);
    const hasNavigation = currentImages.length > 1;
    strip.hidden = !hasNavigation;
    if (!hasNavigation) return;

    currentImages.forEach((filename, index) => {
        const isActive = index === currentImageIndex;
        const thumbnailImage = createEl('img', { attrs: { alt: `图片 ${index + 1}` } });
        prepareDeferredImage(thumbnailImage, buildImageUrl(filename, 'cover'));
        const button = createEl('button', {
            className: `image-viewer-thumb${isActive ? ' is-active' : ''}`,
            attrs: {
                type: 'button',
                'aria-label': `查看图片 ${index + 1}`,
                'aria-current': isActive ? 'true' : 'false'
            },
            dataset: { index: String(index) }
        }, [thumbnailImage]);
        button.addEventListener('click', () => setImageViewerIndex(index));
        strip.appendChild(button);
    });

    requestAnimationFrame(() => {
        strip.querySelector('.image-viewer-thumb.is-active')?.scrollIntoView({
            block: 'nearest',
            inline: 'center'
        });
    });
}
function updateImageCounter() {
    const counter = document.getElementById('imageViewerModal').querySelector('.image-counter');
    counter.textContent = `${currentImageIndex + 1} / ${currentImages.length}`;
}
function closeImageViewer() {
    stopImageViewerEmbyPlayback();
    currentImageMovieTitle = '';
    ModalManager.close('imageViewerModal');
}
function showPrevImage() {
    if (currentImageIndex > 0) {
        setImageViewerIndex(currentImageIndex - 1);
    }
}
function showNextImage() {
    if (currentImageIndex < currentImages.length - 1) {
        setImageViewerIndex(currentImageIndex + 1);
    }
}

// 添加电影的表单提交处理
document.getElementById('add-movie-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    const formData = new FormData(this);
    const messageDiv = document.getElementById('add-movie-message');
    
    try {
        const files = window[`getimage-upload-areaFiles`]() || [];
        const uploadedFiles = [];

        // 获取当前预览容器中的顺序
        const previewItems = document.querySelectorAll('#image-upload-area .preview-item');
        for(const item of previewItems) {
            const index = parseInt(item.dataset.index);
            const file = files[index];

            // 上传所有图片并收集文件名
            const imageFormData = new FormData();
            imageFormData.append('image', file);
            imageFormData.append('title', formData.get('title'));
            appendCaptureTimestampToUpload(imageFormData, file);
            
            const result = await fetch('/api', {
                method: 'POST',
                headers: window.getCsrfHeaders ? window.getCsrfHeaders() : {},
                body: imageFormData
            }).then(res => res.json());

            if(result.success) {
                uploadedFiles.push(result.filename);
            } else {
                showAlert({
                    title: '上传失败',
                    message: result.message || '图片上传失败',
                    type: 'error',
                    showCancel: false
                });
            }
        }

        // 构建提交数据
        const data = {
            title: formData.get('title'),
            recommended: formData.get('recommended') === '1',
            review: formData.get('review'),
            tags: Array.from(document.querySelectorAll('#add-tags .tag.is-selected'))
                        .map(tag => tag.textContent).join(','),
            ratings: collectRatings(),
            image_filenames: uploadedFiles.join(',')
        };

        // API提交电影信息
        const result = await callApi(event_map.add_movie, data);

        // 清除表单
        if (result.message) {
            setNotification(messageDiv, 'success', result.message);
            this.reset();
            document.querySelectorAll('#add-tags .tag').forEach(tag => 
                tag.classList.remove('is-selected'));
            // 重置图片上传区
            window['resetimage-upload-area']();
            //searchMovies(); 不自动搜索电影
            // 成功消息定时清除
            setTimeout(() => {
                clearElement(messageDiv);
            }, 3000);
        } else {
            setNotification(messageDiv, 'danger', result.error || '添加失败');
        }
    } catch (error) {
        setNotification(messageDiv, 'danger', normalizeUiMessage(error.message, '添加失败，请稍后重试。'));
    }
});

// 在页面加载时初始化
document.addEventListener('DOMContentLoaded', function() {
    const searchInput = document.getElementById('search-input');
    const ratingDimensionFilter = document.getElementById('rating-dimension-filter');
    const minRatingFilter = document.getElementById('min-rating-filter');
    const searchButton = document.getElementById('search-button');
    
    // 添加事件监听
    ratingDimensionFilter.addEventListener('change', searchFromControls);
    minRatingFilter.addEventListener('change', searchFromControls);
    document.querySelectorAll('#recommended-filter .tag').forEach(tag => {
        tag.addEventListener('click', () => toggleRecommendedFilter(tag));
    });
    searchButton.addEventListener('click', () => {
        debouncedSearchFromInput.cancel();
        searchFromControls();
    });
    searchInput.addEventListener('input', debouncedSearchFromInput);

    loadFilters().then(() => {
        applySearchControlsState(readSearchStateFromUrl());
        if (hasSearchStateInUrl()) {
            searchCurrentPage();
        } else {
            clearSearchView();
        }
    });

    // 快捷键监听
    searchInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            debouncedSearchFromInput.cancel();
            searchFromControls();
        }
    });
    document.getElementById('wtl-input').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            searchWtl();
        }
    });
    document.getElementById('emby-search-input').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            searchEmby();
        }
    });
    document.getElementById('duplicate-input').addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.key === 'Enter') {
            checkDuplicates();
        }
    });

    // ----  添加电影折叠框相关监听 ---- //
    const form = document.querySelector('#add-movie-form');
    const movieNameInput = form.querySelector('input[name="title"]'); // 修改为正确的选择器
    const collapsibleBoxes = form.querySelectorAll('.collapsible-box');

    // 点击标题栏控制折叠展开
    collapsibleBoxes.forEach(box => {
        const header = box.querySelector('.box-header');
        header.addEventListener('click', () => {
            const content = box.querySelector('.box-content');
            const icon = box.querySelector('.collapse-icon');
            
            content.classList.toggle('expanded');
            icon.classList.toggle('collapsed');
        });
    });

    // 监听输入框变化
    if (movieNameInput) {  // 添加检查
        movieNameInput.addEventListener('input', function() {
            const hasContent = this.value.trim() !== '';
            collapsibleBoxes.forEach(box => {
                const content = box.querySelector('.box-content');
                const icon = box.querySelector('.collapse-icon');
                
                if (hasContent) {
                    content.classList.add('expanded');
                    icon.classList.remove('collapsed');
                } else {
                    content.classList.remove('expanded');
                    icon.classList.add('collapsed');
                }
            });
        });
    }
});
