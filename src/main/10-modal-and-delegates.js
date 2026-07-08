function openStaticModalById(modalId) {
    const modalOpeners = {
        duplicateModal: openDuplicateModal,
        jackettModal: openJackettModal,
        wtlModal: openWtlModal,
        thunderModal: openThunderModal,
        embyModal: openEmbyModal,
        thumbnailModal: openThumbnailModal,
        settingsModal: openSettingsModal
    };
    const opener = modalOpeners[modalId];
    if (opener) {
        opener();
    }
}

function initStaticEventDelegates() {
    if (staticDelegatesInitialized) return;
    staticDelegatesInitialized = true;

    const actionHandlers = {
        'close-edit-modal': closeModal,
        'update-movie': updateMovie,
        'delete-movie': deleteMovie,
        'close-wtl-modal': closeWtlModal,
        'search-wtl': searchWtl,
        'refresh-wtl-status': refreshWtlStatus,
        'close-jackett-modal': closeJackettModal,
        'close-thunder-modal': closeThunderModal,
        'close-emby-modal': closeEmbyModal,
        'search-emby': searchEmby,
        'close-emby-player-modal': closeEmbyPlayerModal,
        'close-thumbnail-modal': closeThumbnailModal,
        'close-duplicate-modal': closeDuplicateModal,
        'check-duplicates': checkDuplicates,
        'close-settings-modal': closeSettingsModal,
        'add-new-tag': addNewTag,
        'add-new-rating': addNewRating,
        'close-image-viewer': closeImageViewer,
        'show-prev-image': showPrevImage,
        'show-next-image': showNextImage
    };

    document.addEventListener('click', event => {
        const actionElement = event.target.closest('[data-action]');
        if (!actionElement) return;

        const action = actionElement.dataset.action;
        if (action === 'open-modal') {
            event.preventDefault();
            openStaticModalById(actionElement.dataset.modalId);
            return;
        }

        if (action === 'minimize-modal') {
            event.preventDefault();
            minimizeModal(actionElement.dataset.modalId);
            return;
        }

        const handler = actionHandlers[action];
        if (!handler) return;

        event.preventDefault();
        handler();
    });
}

function initDynamicEventDelegates() {
    if (dynamicDelegatesInitialized) return;
    dynamicDelegatesInitialized = true;

    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal) {
        settingsModal.addEventListener('click', event => {
            const actionElement = event.target.closest('[data-action]');
            if (!actionElement || !settingsModal.contains(actionElement)) return;

            const row = actionElement.closest('tr');
            switch (actionElement.dataset.action) {
                case 'start-setting-edit':
                    startEdit(actionElement);
                    break;
                case 'cancel-setting-edit':
                    cancelEdit(actionElement);
                    break;
                case 'save-tag':
                    saveTagEdit(actionElement, row ? row.dataset.name : '');
                    break;
                case 'save-rating':
                    saveRatingEdit(actionElement, row ? row.dataset.name : '');
                    break;
                case 'delete-tag':
                    deleteTag(actionElement);
                    break;
                case 'delete-rating-dimension':
                    deleteRatingDimension(actionElement);
                    break;
                case 'refresh-db-backups':
                    loadDatabaseBackups();
                    break;
                case 'create-db-backup':
                    createDatabaseBackup();
                    break;
                case 'restore-db-backup':
                    restoreDatabaseBackup(actionElement);
                    break;
                case 'delete-db-backup':
                    deleteDatabaseBackup(actionElement);
                    break;
            }
        });
    }

    const searchResults = document.getElementById('search-results');
    if (searchResults) {
        searchResults.addEventListener('click', event => {
            const actionElement = event.target.closest('[data-action]');
            if (!actionElement || !searchResults.contains(actionElement)) return;

            if (actionElement.dataset.action === 'edit-movie') {
                const index = Number(actionElement.dataset.movieIndex);
                if (Number.isInteger(index) && allMovies[index]) {
                    openModal(allMovies[index]);
                }
            }

            if (actionElement.dataset.action === 'open-image-viewer') {
                openImageViewer(actionElement.dataset.images || '', actionElement.dataset.title || '');
            }
        });

        searchResults.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            const actionElement = event.target.closest('[data-action="open-image-viewer"]');
            if (!actionElement || !searchResults.contains(actionElement)) return;
            event.preventDefault();
            openImageViewer(actionElement.dataset.images || '', actionElement.dataset.title || '');
        });
    }

    const pagination = document.getElementById('pagination');
    if (pagination) {
        pagination.addEventListener('click', event => {
            const pageElement = event.target.closest('[data-action="change-page"]');
            if (!pageElement || !pagination.contains(pageElement)) return;
            event.preventDefault();
            if (pageElement.hasAttribute('disabled') || pageElement.getAttribute('aria-disabled') === 'true') return;
            changePage(Number(pageElement.dataset.page));
        });
    }

    const duplicateTable = document.getElementById('duplicate-table');
    if (duplicateTable) {
        duplicateTable.addEventListener('click', event => {
            const copyButton = event.target.closest('[data-action="copy-extra"]');
            if (!copyButton || !duplicateTable.contains(copyButton)) return;
            copyToClipboard(copyButton.dataset.copyValue || '', copyButton);
        });
    }
}

let serviceConfig = {};

// 页面加载时获取所有服务配置
callApi(event_map.get_services_config)
    .then(result => {
        if (result.success) {
            serviceConfig = result.data;
        }
    });


// 窗口拖拽相关代码
let zIndexCounter = 1000;

function makeDraggable(modal) {
    const modalCard = modal.querySelector('.modal-card');
    const modalHead = modal.querySelector('.modal-card-head');
    let isDragging = false;
    let initialX;
    let initialY;
    let currentX;
    let currentY;
    let animationFrameId = null; // 用于requestAnimationFrame
    
    // 为整个模态框添加点击事件
    modal.addEventListener('mousedown', () => {
        zIndexCounter += 1;
        modal.style.zIndex = zIndexCounter;
        modalCard.style.zIndex = zIndexCounter;
    });

    function dragStart(e) {
        if (e.target.closest('.modal-card-controls')) {
            return; // 如果点击的是控制按钮，不启动拖拽
        }
        
        if (e.target === modalHead || e.target.closest('.modal-card-head')) {
            isDragging = true;
            
            // 获取当前位置
            const rect = modalCard.getBoundingClientRect();
            currentX = rect.left;
            currentY = rect.top;
            
            initialX = e.clientX - currentX;
            initialY = e.clientY - currentY;

            // 添加拖拽时的样式
            modalCard.classList.add('dragging');
            document.body.style.cursor = 'move';

            zIndexCounter += 1;
            modal.style.zIndex = zIndexCounter;
            modalCard.style.zIndex = zIndexCounter;
        }
    }

    function drag(e) {
        if (!isDragging) return;
        e.preventDefault();

        // 计算新位置
        const newX = e.clientX - initialX;
        const newY = e.clientY - initialY;

        // 保存当前位置
        currentX = newX;
        currentY = newY;

        // 使用 requestAnimationFrame 更新位置
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }

        animationFrameId = requestAnimationFrame(() => {
            modalCard.style.position = 'fixed'; // 使用 fixed 定位
            modalCard.style.left = `${newX}px`;
            modalCard.style.top = `${newY}px`;
        });
    }

    function dragEnd() {
        if (!isDragging) return;
        isDragging = false;

        // 清除拖拽时的样式
        document.body.style.cursor = '';
        modalCard.classList.remove('dragging');

        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
    }
    
    // 鼠标事件不需要passive, 因为它们不会阻止默认行为
    modalHead.addEventListener('mousedown', dragStart);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', dragEnd);

    // 清理函数
    return function cleanup() {
        modalHead.removeEventListener('mousedown', dragStart);
        document.removeEventListener('mousemove', drag);
        document.removeEventListener('mouseup', dragEnd);
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }
    };
}

// 为每个模态框添加拖拽功能
document.addEventListener('DOMContentLoaded', () => {
    const modals = [
        'duplicateModal',
        'jackettModal',
        'wtlModal',
        'thunderModal',
        'embyModal',
        'thumbnailModal',
        'embyPlayerModal',
        'editModal',
        'settingsModal',
        'imageViewerModal'
    ];
    
    modals.forEach(modalId => {
        const modal = document.getElementById(modalId);
        makeDraggable(modal);
    });
});
