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
    
    uploadArea.addEventListener('drop', async (e) => {
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
            if (window.currentDraggedThumbnailFilesPromise && typeof window.currentDraggedThumbnailFilesPromise.then === 'function') {
                try {
                    const files = await window.currentDraggedThumbnailFilesPromise;
                    if (Array.isArray(files) && files.length) {
                        handleNewFiles(files);
                    }
                } catch (error) {
                    showAlert({
                        title: '加入失败',
                        message: error.message || '无法导入拖放图片',
                        type: 'error',
                        showCancel: false
                    });
                }
                return;
            }
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
