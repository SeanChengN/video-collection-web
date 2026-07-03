const WTL_MODAL_DEFAULT_HEIGHT_RATIO = 0.3;
const WTL_MODAL_MAX_HEIGHT_RATIO = 0.9;

function centerWtlModal() {
    const modal = document.getElementById('wtlModal');
    const modalCard = modal?.querySelector('.modal-card');
    if (!modalCard || !modal.classList.contains('is-active')) return;

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const modalWidth = modalCard.offsetWidth;
    const modalHeight = modalCard.offsetHeight;

    modalCard.style.left = `${Math.max(0, (viewportWidth - modalWidth) / 2)}px`;
    modalCard.style.top = `${Math.max(0, (viewportHeight - modalHeight) / 2)}px`;
}

function resetWtlModalHeight() {
    const modal = document.getElementById('wtlModal');
    const modalCard = modal?.querySelector('.modal-card');
    const modalBody = modal?.querySelector('.modal-card-body');
    if (!modalCard) return;

    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    modalCard.style.height = `${Math.round(viewportHeight * WTL_MODAL_DEFAULT_HEIGHT_RATIO)}px`;
    modalCard.style.maxHeight = `${Math.round(viewportHeight * WTL_MODAL_MAX_HEIGHT_RATIO)}px`;
    modalCard.style.overflow = 'hidden';
    modalCard.style.overflowY = 'hidden';
    if (modalBody) {
        modalBody.scrollTop = 0;
    }
    centerWtlModal();
}

function resizeWtlModalForResults() {
    const modal = document.getElementById('wtlModal');
    const modalCard = modal?.querySelector('.modal-card');
    const modalHead = modal?.querySelector('.modal-card-head');
    const modalBody = modal?.querySelector('.modal-card-body');
    if (!modalCard || !modalHead || !modalBody) return;

    requestAnimationFrame(() => {
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        const minHeight = Math.round(viewportHeight * WTL_MODAL_DEFAULT_HEIGHT_RATIO);
        const maxHeight = Math.round(viewportHeight * WTL_MODAL_MAX_HEIGHT_RATIO);
        const contentHeight = modalHead.offsetHeight + modalBody.scrollHeight;
        const targetHeight = Math.min(Math.max(contentHeight, minHeight), maxHeight);

        modalCard.style.height = `${targetHeight}px`;
        modalCard.style.maxHeight = `${maxHeight}px`;
        modalCard.style.overflow = 'hidden';
        modalCard.style.overflowY = 'hidden';
        centerWtlModal();
    });
}

function searchWtl() {
    const query = document.getElementById('wtl-input').value;
    const resultsDiv = document.getElementById('wtl-results');
    
    if (!query.trim()) {
        resetWtlModalHeight();
        setNotification(resultsDiv, 'warning', '请输入链接');
        return;
    }
    
    setNotification(resultsDiv, 'info', '正在查询...');
    
    fetch(`https://whatslink.info/api/v1/link?url=${encodeURIComponent(query)}`)
        .then(response => response.json())
        .then(data => {
            clearElement(resultsDiv);
            resultsDiv.appendChild(createWtlResultBox(data));
            resultsDiv.querySelectorAll('img').forEach(img => {
                if (!img.complete) {
                    img.addEventListener('load', resizeWtlModalForResults, { once: true });
                    img.addEventListener('error', resizeWtlModalForResults, { once: true });
                }
            });
            resizeWtlModalForResults();
        })
        .catch(error => {
            resetWtlModalHeight();
            setNotification(resultsDiv, 'danger', '查询失败，请检查链接是否正确');
            showAlert({
                title: '查询失败',
                message: error.message || '查询过程出错',
                type: 'error',
                showCancel: false
            });
        });
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function createWtlInfoRow(label, value) {
    return createEl('p', {}, [
        createEl('strong', { text: `${label}:` }),
        ` ${value ?? ''}`
    ]);
}

function createWtlScreenshots(screenshots) {
    if (!Array.isArray(screenshots) || screenshots.length === 0) return null;
    const container = createEl('div', { className: 'screenshots' });
    screenshots.forEach(shot => {
        const imageUrl = shot?.screenshot || '';
        if (!imageUrl) return;
        container.appendChild(createEl('div', { className: 'screenshot-item' }, [
            createEl('img', { attrs: { src: imageUrl, alt: '截图' } })
        ]));
    });
    return container;
}

function createWtlResultBox(data) {
    const box = createEl('div', { className: 'box' });
    box.appendChild(createEl('div', { className: 'content' }, [
        createWtlInfoRow('文件类型', data.file_type),
        createWtlInfoRow('资源名称', data.name),
        createWtlInfoRow('总文件大小', formatFileSize(data.size)),
        createWtlInfoRow('文件数量', data.count)
    ]));
    const screenshots = createWtlScreenshots(data.screenshots);
    if (screenshots) box.appendChild(screenshots);
    return box;
}

function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}
