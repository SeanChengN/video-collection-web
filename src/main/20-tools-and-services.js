function openDuplicateModal() {
    if (ModalManager.minimizedModals.has('duplicateModal')) {
        ModalManager.restoreModal('duplicateModal');
    } else {
        ModalManager.open('duplicateModal');
    }
}

function closeDuplicateModal() {
    // 清空输入框
    document.getElementById('duplicate-input').value = '';
    // 清空结果区域
    const resultDiv = document.getElementById('check-result');
    clearElement(resultDiv);
    resultDiv.appendChild(createEl('span', { className: 'has-text-grey-light', text: '等待核对...' }));
    // 清空表格区域
    clearElement(document.getElementById('duplicate-table'));
    // 关闭模态框
    ModalManager.close('duplicateModal');
}

function setDuplicateInlineStatus(container, className, message) {
    clearElement(container);
    container.appendChild(createEl('span', { className, text: message }));
}

function renderDuplicateSummary(container, duplicateCount, newMovieCount) {
    clearElement(container);
    container.appendChild(createEl('div', { className: 'notification is-success' }, [
        createEl('p', { text: '核对完成！' }),
        createEl('p', {}, [
            '发现 ',
            createEl('strong', { text: String(duplicateCount) }),
            ' 个重复项'
        ]),
        createEl('p', {}, [
            '剩余 ',
            createEl('strong', { text: String(newMovieCount) }),
            ' 个未收录项'
        ])
    ]));
}

function createDuplicateCopyButton(value) {
    return createEl('button', {
        className: 'button is-small copy-btn',
        attrs: { type: 'button' },
        dataset: {
            action: 'copy-extra',
            copyValue: value
        }
    }, [
        createIconSpan('copy-btn-icon', {
            width: 20,
            height: 20,
            fill: '#888888',
            ariaLabel: '复制'
        })
    ]);
}

function createDuplicateMovieRow(movie, className = '') {
    const row = createEl('tr', { className });
    const title = movie.title || '';
    const matchedTitle = movie.matchedTitle || '';
    const extra = movie.extra || '';
    appendChildren(row, [
        createEl('td', { text: title, attrs: { title } }),
        createEl('td', { text: matchedTitle, attrs: { title: matchedTitle } }),
        createEl('td', { text: extra, attrs: { title: extra } }),
        createEl('td', {}, [createDuplicateCopyButton(extra)])
    ]);
    return row;
}

function renderDuplicateTable(container, newMovies, duplicateMovies) {
    clearElement(container);
    const table = createEl('table', { className: 'table is-fullwidth is-striped is-hoverable' });
    const colgroup = createEl('colgroup');
    ['15%', '15%', '62%', '8%'].forEach(width => {
        colgroup.appendChild(createEl('col', { attrs: { style: `width: ${width}` } }));
    });
    const headerRow = createEl('tr', {}, [
        createEl('th', { text: '电影名称' }),
        createEl('th', { text: '匹配名称' }),
        createEl('th', { text: '磁力链接' }),
        createEl('th', { text: '操作' })
    ]);
    const tbody = createEl('tbody');
    newMovies.forEach(movie => {
        tbody.appendChild(createDuplicateMovieRow(movie));
    });
    if (duplicateMovies.length > 0) {
        tbody.appendChild(createEl('tr', { className: 'duplicate-separator' }, [
            createEl('td', { text: '以下为重复项', attrs: { colspan: '4' } })
        ]));
        duplicateMovies.forEach(movie => {
            tbody.appendChild(createDuplicateMovieRow(movie, 'is-duplicate'));
        });
    }
    appendChildren(table, [
        colgroup,
        createEl('thead', {}, [headerRow]),
        tbody
    ]);
    container.appendChild(table);
}

function cloneButtonContents(button) {
    return Array.from(button.childNodes).map(node => node.cloneNode(true));
}

function restoreButtonContents(button, contents) {
    button.replaceChildren(...contents.map(node => node.cloneNode(true)));
}

function checkDuplicates() {
    const input = document.getElementById('duplicate-input');
    const resultDiv = document.getElementById('check-result');
    const tableDiv = document.getElementById('duplicate-table');
    const movies = input.value.split('\n').filter(line => line.trim());
    
    if (movies.length === 0) {
        setDuplicateInlineStatus(resultDiv, 'has-text-danger', '请输入电影列表');
        clearElement(tableDiv);
        return;
    }
    
    const button = document.querySelector('#duplicateModal .dupStart-btn');
    const originalButtonContent = cloneButtonContents(button);
    button.disabled = true;
    setDuplicateInlineStatus(resultDiv, 'has-text-info', '正在核对...');
    
    // 解析每行内容,分离电影名和其他信息
    const movieData = movies.map(line => {
        const parts = line.trim().split(' ');
        return {
            title: parts[0],
            extra: parts.slice(1).join(' ')
        };
    });

    callApi(event_map.check_duplicates, { titles: movieData.map(m => m.title) })
        .then(result => {
            if (result.success) {
                const duplicateCount = result.duplicates.length;
                const newMovies = movieData.filter(movie => 
                    !result.duplicates.includes(movie.title)
                ).map(movie => ({
                    ...movie,
                    matchedTitle: ''  // 非重复项无匹配名称
                }));

                const duplicateMovies = movieData
                .filter(movie => result.duplicates.includes(movie.title))
                .map(movie => ({
                    ...movie,
                    matchedTitle: result.matched_titles[movie.title] || movie.title
                }));

                renderDuplicateSummary(resultDiv, duplicateCount, newMovies.length);
                renderDuplicateTable(tableDiv, newMovies, duplicateMovies);
            }
        })
        .catch(error => {
            clearElement(resultDiv);
            resultDiv.appendChild(createEl('div', {
                className: 'notification is-danger is-light',
                text: '核对过程出错，请重试'
            }));
            showAlert({
                title: '核对失败',
                message: error.message || '核对过程出错',
                type: 'error',
                showCancel: false
            });
        })
        .finally(() => {
            restoreButtonContents(button, originalButtonContent);
            button.disabled = false;
        });
}

// 复制内容到剪贴板
async function copyToClipboard(text, button) {
    // 创建临时文本框
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);

    try {
        textarea.select();
        document.execCommand('copy');
        // 修改按钮显示成功
        button.replaceChildren(createIconSpan('copy-success-btn-icon', {
            width: 20,
            height: 20,
            fill: '#fff'
        }));
        button.classList.add('is-success'); // 添加成功样式
    } catch (err) {
        // 修改按钮显示失败
        button.replaceChildren(createIconSpan('copy-fail-btn-icon', {
            width: 20,
            height: 20,
            fill: '#fff'
        }));
        button.classList.add('is-danger'); // 添加失败样式
    }
    
    // 清理临时元素
    document.body.removeChild(textarea);
    
    // 复制按钮保持结果状态，直到列表刷新。
}

// Emby搜索相关代码
function openEmbyModal() {
    if (ModalManager.minimizedModals.has('embyModal')) {
        ModalManager.restoreModal('embyModal');
    } else {
        ModalManager.open('embyModal');
    }
}

function closeEmbyModal() {
    ModalManager.close('embyModal');
    clearEmbyModalState();
}

const EMBY_MODAL_DEFAULT_HEIGHT_RATIO = 0.3;
const EMBY_MODAL_MAX_HEIGHT_RATIO = 0.9;
let embySearchRequestId = 0;

function centerEmbyModal() {
    const modal = document.getElementById('embyModal');
    const modalCard = modal?.querySelector('.modal-card');
    if (!modalCard || !modal.classList.contains('is-active')) return;

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const modalWidth = modalCard.offsetWidth;
    const modalHeight = modalCard.offsetHeight;

    modalCard.style.left = `${Math.max(0, (viewportWidth - modalWidth) / 2)}px`;
    modalCard.style.top = `${Math.max(0, (viewportHeight - modalHeight) / 2)}px`;
}

function resetEmbyModalHeight() {
    const modal = document.getElementById('embyModal');
    const modalCard = modal?.querySelector('.modal-card');
    const modalBody = modal?.querySelector('.modal-card-body');
    if (!modalCard) return;

    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    modalCard.style.height = `${Math.round(viewportHeight * EMBY_MODAL_DEFAULT_HEIGHT_RATIO)}px`;
    modalCard.style.maxHeight = `${Math.round(viewportHeight * EMBY_MODAL_MAX_HEIGHT_RATIO)}px`;
    modalCard.style.overflow = 'hidden';
    modalCard.style.overflowY = 'hidden';
    if (modalBody) {
        modalBody.scrollTop = 0;
    }
    centerEmbyModal();
}

function clearEmbyModalState() {
    embySearchRequestId += 1;
    const input = document.getElementById('emby-search-input');
    const resultsDiv = document.getElementById('emby-results');
    const modalBody = document.querySelector('#embyModal .modal-card-body');

    if (input) {
        input.value = '';
    }
    if (resultsDiv) {
        clearElement(resultsDiv);
    }
    if (modalBody) {
        modalBody.scrollTop = 0;
    }
    resetEmbyModalHeight();
}

function resizeEmbyModalForResults() {
    const modal = document.getElementById('embyModal');
    const modalCard = modal?.querySelector('.modal-card');
    const modalHead = modal?.querySelector('.modal-card-head');
    const modalBody = modal?.querySelector('.modal-card-body');
    if (!modalCard || !modalHead || !modalBody) return;

    modalBody.scrollTop = 0;

    requestAnimationFrame(() => {
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        const minHeight = Math.round(viewportHeight * EMBY_MODAL_DEFAULT_HEIGHT_RATIO);
        const maxHeight = Math.round(viewportHeight * EMBY_MODAL_MAX_HEIGHT_RATIO);
        const contentHeight = modalHead.offsetHeight + modalBody.scrollHeight;
        const targetHeight = Math.min(Math.max(contentHeight, minHeight), maxHeight);

        modalCard.style.height = `${targetHeight}px`;
        modalCard.style.maxHeight = `${maxHeight}px`;
        modalCard.style.overflow = 'hidden';
        modalCard.style.overflowY = 'hidden';
        centerEmbyModal();
    });
}

function openEmbyPlayer(streamUrl, title) {
    const modal = document.getElementById('embyPlayerModal');
    const video = document.getElementById('emby-player-video');
    const titleElement = modal?.querySelector('.modal-card-title');
    if (!modal || !video || !streamUrl) return;

    if (titleElement) {
        titleElement.textContent = title ? `Emby: ${title}` : 'Emby Player';
    }

    video.pause();
    video.removeAttribute('src');
    video.load();
    video.src = streamUrl;

    ModalManager.open('embyPlayerModal');
    requestAnimationFrame(() => {
        video.play().catch(() => {});
    });
}

function closeEmbyPlayerModal() {
    const video = document.getElementById('emby-player-video');
    if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
    }
    ModalManager.close('embyPlayerModal');
}

function searchEmby() {
    const query = document.getElementById('emby-search-input').value;
    const resultsDiv = document.getElementById('emby-results');
    const requestId = ++embySearchRequestId;
    
    if (!query.trim()) {
        resetEmbyModalHeight();
        setNotification(resultsDiv, 'warning', '请输入搜索内容');
        return;
    }
    
    setNotification(resultsDiv, 'info', '正在搜索...');
    
    callApi(event_map.search_emby, { query })
        .then(result => {
            if (requestId !== embySearchRequestId) return;

            if (!result.success) {
                throw new Error(result.message || 'Emby search failed');
            }

            const items = result.data?.items || [];
            if (items.length === 0) {
                resetEmbyModalHeight();
                setNotification(resultsDiv, 'info', '未找到相关影片');
                return;
            }
            
            const fragment = document.createDocumentFragment();
            const container = createEl('div', { className: 'columns is-multiline' });
            
            items.forEach(movie => {
                const movieName = movie.name || '';
                const imageUrl = movie.imageUrl || '';
                const streamUrl = movie.streamUrl || '';
                const column = createEl('div', { className: 'column emby-result-column' });
                const card = createEl('div', {
                    className: streamUrl ? 'card movie-card emby-playable-card' : 'card movie-card emby-unplayable-card',
                    attrs: streamUrl
                        ? { role: 'button', tabindex: '0', 'aria-label': `播放 ${movieName}` }
                        : { 'aria-disabled': 'true' }
                }, [
                    createEl('div', { className: 'card-image' }, [
                        createEl('figure', { className: 'image is-2by3' }, [
                            createEl('img', {
                                attrs: {
                                    alt: movieName,
                                    src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
                                },
                                dataset: { src: imageUrl }
                            }),
                            createEl('div', { className: 'runtime-badge', text: formatRuntime(movie.runtimeTicks) })
                        ])
                    ]),
                    createEl('div', { className: 'card-content fixed-height emby-card-content' }, [
                        createEl('p', {
                            className: 'title is-6 movie-title',
                            text: movieName,
                            dataset: { fullTitle: movieName }
                        })
                    ])
                ]);
                column.appendChild(card);
                
                // 为新加载的图片添加懒加载观察
                const img = column.querySelector('img');
                if (img && imageUrl) {
                    imageObserver.observe(img);
                }
                const movieCard = column.querySelector('.movie-card');
                if (movieCard && streamUrl) {
                    const playMovie = () => openEmbyPlayer(streamUrl, movieName);
                    movieCard.addEventListener('click', playMovie);
                    movieCard.addEventListener('keydown', event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            playMovie();
                        }
                    });
                }
                
                container.appendChild(column);
            });
            
            fragment.appendChild(container);
            clearElement(resultsDiv);
            resultsDiv.appendChild(fragment);
            resizeEmbyModalForResults();
        })
        .catch(error => {
            if (requestId !== embySearchRequestId) return;

            resetEmbyModalHeight();
            setNotification(resultsDiv, 'danger', '搜索出错，请稍后重试');
            showAlert({
                title: '搜索出错',
                message: error.message || '搜索过程出错',
                type: 'error',
                showCancel: false
            });
        });
}

function formatRuntime(ticks) {
    if (!ticks) return '';
    const minutes = Math.floor(ticks / (10000000 * 60));
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return hours > 0 ? 
        `${hours}时${remainingMinutes}分` : 
        `${remainingMinutes}分钟`;
}

function openJackettModal() {
    if (ModalManager.minimizedModals.has('jackettModal')) {
        ModalManager.restoreModal('jackettModal');
    } else {
        ModalManager.open('jackettModal');
        const route = serviceConfig.service_routes?.jackett || '/services/jackett';
        document.querySelector('#jackettModal iframe').src = `${route}?path=${encodeURIComponent('/UI/Dashboard#search')}`;
    }
}

function closeJackettModal() {
    ModalManager.close('jackettModal');
}

function openThunderModal() {
    if (ModalManager.minimizedModals.has('thunderModal')) {
        ModalManager.restoreModal('thunderModal');
    } else {
        ModalManager.open('thunderModal');
        const route = serviceConfig.service_routes?.thunder || '/services/thunder';
        document.querySelector('#thunderModal iframe').src = route;
    }
}

function closeThunderModal() {
    ModalManager.close('thunderModal');
}

// What's the link?查询相关代码
function openWtlModal() {
    if (ModalManager.minimizedModals.has('wtlModal')) {
        ModalManager.restoreModal('wtlModal');
    } else {
        ModalManager.open('wtlModal');
        document.getElementById('wtl-input').value = '';
        clearElement(document.getElementById('wtl-results'));
        resetWtlModalHeight();
    }
}

function closeWtlModal() {
    ModalManager.close('wtlModal');
}

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