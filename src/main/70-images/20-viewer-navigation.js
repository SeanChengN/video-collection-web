function openImageViewer(imageFilenames, movieTitle) {
    currentImageIndex = 0;
    currentImages = [];
    
    currentImages = imageFilenames.split(',').filter(name => name.trim());

    const modal = document.getElementById('imageViewerModal');
    setImageViewerModalWidth();
    modal.querySelector('.modal-card-title').textContent = `查看图片：${movieTitle}`;
    
    updateViewerImage();
    ModalManager.open('imageViewerModal');
    scheduleImageViewerResize();
}
function updateViewerImage() {
    const modal = document.getElementById('imageViewerModal');
    const viewer = modal.querySelector('.viewer-image');
    const prevButton = modal.querySelector('.nav-button.prev');
    const nextButton = modal.querySelector('.nav-button.next');
    const counter = modal.querySelector('.image-counter');
    
    viewer.onload = scheduleImageViewerResize;
    resetImageViewerScroll();
    viewer.style.height = 'auto';
    viewer.src = buildImageUrl(currentImages[currentImageIndex]);
    if (viewer.complete) {
        scheduleImageViewerResize();
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
function setImageViewerIndex(index) {
    const nextIndex = Number(index);
    if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= currentImages.length || nextIndex === currentImageIndex) return;
    currentImageIndex = nextIndex;
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
        const thumbnailImage = createEl('img', { attrs: { alt: `Image ${index + 1}` } });
        prepareDeferredImage(thumbnailImage, buildImageUrl(filename, 'cover'));
        const button = createEl('button', {
            className: `image-viewer-thumb${isActive ? ' is-active' : ''}`,
            attrs: {
                type: 'button',
                'aria-label': `Image ${index + 1}`,
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
    ModalManager.close('imageViewerModal');
}
function showPrevImage() {
    if (currentImageIndex > 0) {
        currentImageIndex--;
        updateViewerImage();
    }
}
function showNextImage() {
    if (currentImageIndex < currentImages.length - 1) {
        currentImageIndex++;
        updateViewerImage();
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
        setNotification(messageDiv, 'danger', `添加失败: ${error.message}`);
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
