function initImageUpload() {
    // 为添加和编辑表单分别初始化上传区域
    initUploadArea('image-upload-area', 'image-input');
    initUploadArea('edit-image-upload-area', 'edit-image-input');
}

function initUploadArea(areaId, inputId) {
    const uploadArea = document.getElementById(areaId);
    if (!uploadArea) return; // 确保元素存在

    const imageInput = document.getElementById(inputId);
    const previewContainer = uploadArea.querySelector('.image-preview-container');
    const uploadPlaceholder = uploadArea.querySelector('.upload-placeholder');
    let uploadedFiles = []; // 存储文件对象
    let isPreviewDragging = false; // 预览图拖拽状态标记
    
    // 更新上传区域显示状态
    function updateUploadArea() {
        uploadPlaceholder.style.display = uploadedFiles.length > 0 ? 'none' : 'block';
    }

    // 更新所有预览项的索引
    function updatePreviewIndexes() {
        const items = previewContainer.querySelectorAll('.preview-item');
        items.forEach((item, index) => {
            item.dataset.index = index;
        });
    }

    // 处理新文件
    function handleNewFiles(newFiles) {
        // 图片文件验证
        const validFiles = newFiles.filter(file => file.type.startsWith('image/'));
        
        if (validFiles.length === 0) {
            showAlert({
                title: '操作失败',
                message: '请选择图片文件',
                type: 'warning',
                showCancel: false
            });
            return;
        }
        
        // 过滤掉重复文件
        const fileIdentifiers = uploadedFiles.map(f => `${f.name}-${f.size}-${f.type}`);
        const uniqueFiles = validFiles.filter(file => 
            !fileIdentifiers.includes(`${file.name}-${file.size}-${file.type}`)
        );
        
        if (uniqueFiles.length === 0) {
            showAlert({
                title: '操作失败',
                message: '所选图片已存在',
                type: 'warning',
                showCancel: false
            });
            return;
        }

        uniqueFiles.forEach(file => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const index = uploadedFiles.length;
                uploadedFiles.push(file);
                addImagePreview(e.target.result, uploadArea, index);
                updatePreviewIndexes();
                updateUploadArea();
            };
            reader.readAsDataURL(file);
        });
    }

    /* PC端使用的是HTML5原生拖放API(dragstart、dragover、drop等事件)。
    在uploadArea的drop事件处理中已经包含了文件数组顺序的更新逻辑。 
    而移动端使用的是触摸事件(touchstart、touchmove、touchend)来模拟拖放行为。
    在touchmove(handleDragOver)中只改变了DOM元素的位置，没有同步更新文件数组的顺序。
    所以需要在touchend中添加文件数组顺序更新的逻辑，使移动端的行为与PC端保持一致。*/

    // 预览图拖拽事件 - 开始
    previewContainer.addEventListener('dragstart', (e) => {
        if (e.target.closest('.preview-item')) {
            isPreviewDragging = true;
            e.target.closest('.preview-item').classList.add('dragging');
        }
    });
    // 移动端预览图拖拽事件 - 开始
    previewContainer.addEventListener('touchstart', (e) => {
        if (e.target.closest('.preview-item')) {
            isPreviewDragging = true;
            e.target.closest('.preview-item').classList.add('dragging');
        }
    }, { passive: true });
    // 预览图拖拽事件 - 结束
    previewContainer.addEventListener('dragend', () => {
        isPreviewDragging = false;
        const dragItem = previewContainer.querySelector('.dragging');
        if (dragItem) dragItem.classList.remove('dragging');
    });
    // 移动端预览图拖拽事件 - 结束
    previewContainer.addEventListener('touchend', () => {
        isPreviewDragging = false;
        const dragItem = previewContainer.querySelector('.dragging');
        if (dragItem) {
            dragItem.classList.remove('dragging');
            // 确保在触摸结束时再次同步文件顺序
            const items = [...previewContainer.querySelectorAll('.preview-item')];
            const finalUploadedFiles = [];
            items.forEach(item => {
                const oldIndex = parseInt(item.dataset.index);
                if (uploadedFiles[oldIndex]) {
                    finalUploadedFiles.push(uploadedFiles[oldIndex]);
                }
            });
            uploadedFiles = finalUploadedFiles;
            updatePreviewIndexes();
        }
    }, { passive: true });
    // 预览图拖拽事件 - 移动
    previewContainer.addEventListener('dragover', handleDragOver);
    // 移动端预览图拖拽事件 - 移动
    previewContainer.addEventListener('touchmove', handleDragOver);

    function handleDragOver(e) {
        e.preventDefault();
        if (!isPreviewDragging) return;
    
        const clientX = e.clientX || e.touches[0].clientX;
        const clientY = e.clientY || e.touches[0].clientY;
    
        const draggingItem = previewContainer.querySelector('.dragging');
        if (!draggingItem) return;
    
        const afterElement = getDragAfterElement(previewContainer, clientX, clientY);
        if (afterElement) {
            previewContainer.insertBefore(draggingItem, afterElement);
        } else {
            previewContainer.appendChild(draggingItem);
        }
    }

    // 删除预览图片的处理
    previewContainer.addEventListener('click', (e) => {
        // 检查点击的是否是删除按钮或其子元素(SVG图标)
        const deleteButton = e.target.closest('.delete-image');
        if (!deleteButton) return;

        e.preventDefault();  // 阻止默认行为
        e.stopPropagation(); // 阻止事件冒泡
        const previewItem = deleteButton.closest('.preview-item');
        if (previewItem) {
            // 更新uploadedFiles数组
            const index = Array.from(previewContainer.children).indexOf(previewItem);
            uploadedFiles.splice(index, 1);
            previewItem.remove();
            updatePreviewIndexes();
            updateUploadArea();
        }
    });

    // 点击上传
    uploadArea.addEventListener('click', () => {
        imageInput.click();
    });

    // 拖放处理
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!isPreviewDragging) {
            uploadArea.classList.add('dragover');
        }
    });
    
    uploadArea.addEventListener('dragleave', () => {
        if (!isPreviewDragging) {
            uploadArea.classList.remove('dragover');
        }
    });
    
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        if (isPreviewDragging) {
            const draggingItem = previewContainer.querySelector('.dragging');
            if (!draggingItem) return;

            const fromIndex = parseInt(draggingItem.dataset.index);
            const items = [...previewContainer.querySelectorAll('.preview-item')];
            const toIndex = items.indexOf(draggingItem);

            if (fromIndex !== toIndex) {
                const [movedFile] = uploadedFiles.splice(fromIndex, 1);
                uploadedFiles.splice(toIndex, 0, movedFile);

                items.forEach((item, index) => {
                    item.dataset.index = index;
                });
            }
        } else {
            uploadArea.classList.remove('dragover');
            if (Array.isArray(window.currentDraggedThumbnailFiles) && window.currentDraggedThumbnailFiles.length) {
                handleNewFiles(window.currentDraggedThumbnailFiles);
                return;
            }
            if (window.currentDraggedThumbnailFile) {
                handleNewFiles([window.currentDraggedThumbnailFile]);
                return;
            }
            handleNewFiles(Array.from(e.dataTransfer.files)); // 排除重复文件
        }
    });
    
    // 文件选择处理
    imageInput.addEventListener('change', () => {
        // 排除重复文件
        handleNewFiles(Array.from(imageInput.files));
    });
    
    // 重置函数
    window[`reset${areaId}`] = () => {
        uploadedFiles = [];
        clearElement(previewContainer);
        uploadPlaceholder.style.display = 'block';
        imageInput.value = '';
    };

    // 将uploadedFiles暴露给表单使用
    window[`get${areaId}Files`] = () => uploadedFiles;
    window[`add${areaId}Files`] = (files) => handleNewFiles(Array.from(files || []));
}

// 添加预览图片
function addImagePreview(imageData, uploadArea, index) {
    const previewContainer = uploadArea.querySelector('.image-preview-container');
    const previewItem = document.createElement('div');
    previewItem.className = 'preview-item';
    previewItem.dataset.index = index;
    previewItem.draggable = true; // 允许拖拽

    appendChildren(previewItem, [
        createEl('img', { attrs: { src: imageData, alt: '预览图' } }),
        createEl('button', {
            className: 'delete-image',
            attrs: { type: 'button' }
        }, [
            createSpriteSvg('close-icon', {
                width: 12,
                height: 12,
                fill: 'currentColor',
                ariaLabel: '删除'
            })
        ])
    ]);
    
    // 拖拽事件
    previewItem.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', index);
        previewItem.classList.add('dragging');
    });

    previewItem.addEventListener('dragend', () => {
        previewItem.classList.remove('dragging');
    });

    previewContainer.appendChild(previewItem);
}

// 添加图片查看器相关函数
let currentImageIndex = 0;
let currentImages = [];
const IMAGE_VIEWER_WIDTH_RATIO = 3 / 5;
const IMAGE_VIEWER_MAX_HEIGHT_RATIO = 0.9;
const IMAGE_VIEWER_MOBILE_BREAKPOINT = 768;

function setImageViewerModalWidth() {
    const modal = document.getElementById('imageViewerModal');
    const modalCard = modal?.querySelector('.modal-card');
    if (!modalCard) return;

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    modalCard.style.width = viewportWidth <= IMAGE_VIEWER_MOBILE_BREAKPOINT
        ? '90%'
        : `${Math.round(viewportWidth * IMAGE_VIEWER_WIDTH_RATIO)}px`;
    modalCard.style.height = 'auto';
    modalCard.style.maxHeight = `${Math.round(viewportHeight * IMAGE_VIEWER_MAX_HEIGHT_RATIO)}px`;
    modalCard.style.overflow = 'hidden';
    modalCard.style.overflowY = 'hidden';
}

function centerImageViewerModal() {
    const modal = document.getElementById('imageViewerModal');
    const modalCard = modal?.querySelector('.modal-card');
    if (!modalCard || !modal.classList.contains('is-active')) return;

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const modalWidth = modalCard.offsetWidth;
    const modalHeight = modalCard.offsetHeight;

    modalCard.style.left = `${Math.max(0, (viewportWidth - modalWidth) / 2)}px`;
    modalCard.style.top = `${Math.max(0, (viewportHeight - modalHeight) / 2)}px`;
}

function getImageViewerMaxBodyHeight(modal, modalCard) {
    const header = modal.querySelector('.modal-card-head');
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const maxModalHeight = Math.round(viewportHeight * IMAGE_VIEWER_MAX_HEIGHT_RATIO);
    const headerHeight = header ? header.offsetHeight : 0;

    modalCard.style.maxHeight = `${maxModalHeight}px`;
    modalCard.style.overflow = 'hidden';
    modalCard.style.overflowY = 'hidden';

    return Math.max(1, maxModalHeight - headerHeight);
}

function resizeImageViewerImage() {
    const modal = document.getElementById('imageViewerModal');
    const modalCard = modal?.querySelector('.modal-card');
    const modalBody = modal?.querySelector('.modal-card-body');
    const viewer = modal?.querySelector('.viewer-image');
    const container = modal?.querySelector('.image-viewer-container');
    const scrollContainer = modal?.querySelector('.image-viewer-scroll');

    if (!modalCard || !modalBody || !viewer || !container || !scrollContainer || !viewer.naturalWidth || !viewer.naturalHeight) return;

    const displayWidth = scrollContainer.clientWidth || container.clientWidth || modalCard.clientWidth;
    if (!displayWidth) return;

    const idealImageHeight = Math.round(displayWidth * viewer.naturalHeight / viewer.naturalWidth);
    const bodyHeight = Math.min(idealImageHeight, getImageViewerMaxBodyHeight(modal, modalCard));

    modalBody.style.height = `${bodyHeight}px`;
    modalBody.style.maxHeight = `${bodyHeight}px`;
    container.style.height = `${bodyHeight}px`;
    scrollContainer.style.height = '100%';
    viewer.style.width = '100%';
    viewer.style.height = `${idealImageHeight}px`;
    centerImageViewerModal();
}

function resetImageViewerScroll() {
    const scrollContainer = document.getElementById('imageViewerModal')?.querySelector('.image-viewer-scroll');
    if (scrollContainer) {
        scrollContainer.scrollTop = 0;
        scrollContainer.scrollLeft = 0;
    }
}

function scheduleImageViewerResize() {
    requestAnimationFrame(() => {
        resizeImageViewerImage();
        requestAnimationFrame(resizeImageViewerImage);
    });
}

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
    
    if (currentImages.length > 1) {
        updateImageCounter();
    }
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
