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

