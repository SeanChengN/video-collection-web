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
            fragment.appendChild(createResultsCountSummary(items.length, '个结果', 'emby-results-count'));
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
