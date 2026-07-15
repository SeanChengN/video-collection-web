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
let embyLinkSelectionContext = null;
let currentEmbyPlaybackContext = null;

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
    embyLinkSelectionContext = null;
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

function rememberMovieEmbyLink(movieTitle, itemId) {
    const normalizedItemId = itemId || null;
    const movie = Array.isArray(allMovies)
        ? allMovies.find(candidate => candidate.title === movieTitle)
        : null;
    const movieChanged = Boolean(movie && movie.emby_item_id !== normalizedItemId);
    if (movieChanged) {
        movie.emby_item_id = normalizedItemId;
    }
    if (typeof syncEditMovieEmbyState === 'function') {
        syncEditMovieEmbyState(movieTitle, normalizedItemId, { preserveFeedback: true });
    }
    if (movieChanged && document.getElementById('search-results')) {
        displayCurrentPage();
    }
}

function releaseEmbyVideo(video) {
    if (!video) return;
    video.onerror = null;
    video.pause();
    video.removeAttribute('src');
    video.load();
}

function getEmbyPlaybackVideo(target) {
    return target === 'viewer'
        ? document.querySelector('#imageViewerModal .image-viewer-emby-video')
        : document.getElementById('emby-player-video');
}

function startEmbyPlayback(streamUrl, title, startTimestamp = 0, playbackContext = {}) {
    const target = playbackContext.target === 'viewer' ? 'viewer' : 'modal';
    const video = getEmbyPlaybackVideo(target);
    if (!video || !streamUrl) return;

    if (currentEmbyPlaybackContext?.video && currentEmbyPlaybackContext.video !== video) {
        releaseEmbyVideo(currentEmbyPlaybackContext.video);
    }
    if (target === 'viewer') {
        ModalManager.close('embyPlayerModal');
        enterImageViewerVideoMode();
    } else {
        if (currentEmbyPlaybackContext?.target === 'viewer') {
            leaveImageViewerVideoMode();
        }
        const modal = document.getElementById('embyPlayerModal');
        const titleElement = modal?.querySelector('.modal-card-title');
        if (titleElement) {
            titleElement.textContent = title ? `Emby: ${title}` : 'Emby Player';
        }
        ModalManager.open('embyPlayerModal');
    }

    const context = {
        target,
        video,
        movieTitle: playbackContext.movieTitle || '',
        itemId: playbackContext.itemId || '',
        startTimestamp: Math.max(0, Number(startTimestamp) || 0),
        recoveryAttempted: Boolean(playbackContext.recoveryAttempted)
    };
    currentEmbyPlaybackContext = context;
    releaseEmbyVideo(video);
    video.src = streamUrl;
    video.onerror = () => handleEmbyPlaybackError(context);
    video.addEventListener('loadedmetadata', () => {
        if (currentEmbyPlaybackContext !== context) return;
        if (context.startTimestamp > 0) {
            const duration = Number(video.duration);
            video.currentTime = Number.isFinite(duration)
                ? Math.min(context.startTimestamp, Math.max(0, duration))
                : context.startTimestamp;
        }
        video.play().catch(() => {});
    }, { once: true });
}

function openEmbyPlayer(streamUrl, title, startTimestamp = 0, playbackContext = {}) {
    startEmbyPlayback(streamUrl, title, startTimestamp, {
        ...playbackContext,
        target: playbackContext.target || 'modal'
    });
}

function openImageViewerEmbyPlayer(streamUrl, title, startTimestamp = 0, playbackContext = {}) {
    startEmbyPlayback(streamUrl, title, startTimestamp, {
        ...playbackContext,
        target: 'viewer'
    });
}

function closeEmbyPlayerModal() {
    const video = document.getElementById('emby-player-video');
    releaseEmbyVideo(video);
    if (currentEmbyPlaybackContext?.target === 'modal') {
        currentEmbyPlaybackContext = null;
    }
    ModalManager.close('embyPlayerModal');
}

async function handleEmbyPlaybackError(context) {
    if (currentEmbyPlaybackContext !== context || !context.movieTitle || context.recoveryAttempted) {
        return;
    }
    context.recoveryAttempted = true;
    try {
        const result = await callApi(event_map.resolve_movie_emby_playback, {
            title: context.movieTitle,
            refresh: true
        });
        if (!result.success) {
            throw new Error(result.message || 'Emby playback could not be recovered');
        }
        const data = result.data || {};
        if (data.status === 'linked' && data.playback?.streamUrl) {
            if (data.playback.id === context.itemId) {
                throw new Error('The linked Emby item is available, but playback failed');
            }
            rememberMovieEmbyLink(context.movieTitle, data.playback.id);
            startEmbyPlayback(data.playback.streamUrl, data.playback.name || context.movieTitle, context.startTimestamp, {
                target: context.target,
                movieTitle: context.movieTitle,
                itemId: data.playback.id,
                recoveryAttempted: true
            });
            return;
        }
        if (data.status === 'candidates') {
            rememberMovieEmbyLink(context.movieTitle, null);
            if (context.target === 'viewer') {
                exitImageViewerVideoMode();
            } else {
                closeEmbyPlayerModal();
            }
            openEmbyLinkSelection(context.movieTitle, context.startTimestamp, data.candidates || [], {
                playbackTarget: context.target
            });
            return;
        }
        throw new Error('No matching Emby movie was found');
    } catch (error) {
        showAlert({
            title: 'Emby',
            message: error.message || 'Emby playback failed',
            type: 'warning',
            showCancel: false
        });
    }
}

function openEmbyLinkSelection(movieTitle, startTimestamp, candidates = [], options = {}) {
    embyLinkSelectionContext = {
        movieTitle,
        startTimestamp: Math.max(0, Number(startTimestamp) || 0),
        playbackTarget: options.playbackTarget === 'viewer' ? 'viewer' : 'modal',
        linkMode: options.linkMode === 'save-only' ? 'save-only' : 'play'
    };
    openEmbyModal();
    const input = document.getElementById('emby-search-input');
    if (input) input.value = movieTitle;
    renderEmbyLinkCandidates(candidates);
}

function renderEmbyLinkCandidates(candidates) {
    const resultsDiv = document.getElementById('emby-results');
    if (!resultsDiv) return;
    if (!candidates.length) {
        setNotification(resultsDiv, 'info', 'No exact Emby match. Search and select the correct movie.');
        resizeEmbyModalForResults();
        return;
    }

    const fragment = document.createDocumentFragment();
    fragment.appendChild(createResultsCountSummary(candidates.length, '个候选', 'emby-results-count'));
    const container = createEl('div', { className: 'columns is-multiline' });
    candidates.forEach(movie => {
        const movieName = movie.name || '';
        const imageUrl = movie.imageUrl || '';
        const column = createEl('div', { className: 'column emby-result-column' });
        const card = createEl('div', {
            className: 'card movie-card emby-playable-card emby-link-candidate',
            attrs: { role: 'button', tabindex: '0', 'aria-label': `Link ${movieName}` }
        }, [
            createEl('div', { className: 'card-image' }, [
                createEl('figure', { className: 'image is-2by3' }, [
                    createEl('img', {
                        attrs: { alt: movieName, src: IMAGE_LAZY_PLACEHOLDER },
                        dataset: { src: imageUrl }
                    }),
                    createEl('div', { className: 'runtime-badge', text: formatRuntime(movie.runtimeTicks) })
                ])
            ]),
            createEl('div', { className: 'card-content fixed-height emby-card-content' }, [
                createEl('p', { className: 'title is-6 movie-title', text: movieName })
            ])
        ]);
        const selectCandidate = () => linkMovieEmby(movie);
        card.addEventListener('click', selectCandidate);
        card.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                selectCandidate();
            }
        });
        prepareDeferredImage(card.querySelector('img'), imageUrl);
        column.appendChild(card);
        container.appendChild(column);
    });
    fragment.appendChild(container);
    clearElement(resultsDiv);
    resultsDiv.appendChild(fragment);
    resizeEmbyModalForResults();
}

async function linkMovieEmby(movie) {
    const context = embyLinkSelectionContext;
    if (!context || !movie?.id) return;
    try {
        const result = await callApi(event_map.link_movie_emby, {
            title: context.movieTitle,
            emby_item_id: movie.id
        });
        if (!result.success || !result.data?.playback?.streamUrl) {
            throw new Error(result.message || 'Unable to link the Emby movie');
        }
        const playback = result.data.playback;
        const startTimestamp = context.startTimestamp;
        const playbackTarget = context.playbackTarget;
        const saveOnly = context.linkMode === 'save-only';
        rememberMovieEmbyLink(context.movieTitle, playback.id);
        closeEmbyModal();
        if (saveOnly) {
            setEditMovieEmbyFeedback('绑定成功', 'success');
            return;
        }
        startEmbyPlayback(playback.streamUrl, playback.name || context.movieTitle, startTimestamp, {
            target: playbackTarget,
            movieTitle: context.movieTitle,
            itemId: playback.id
        });
    } catch (error) {
        showAlert({
            title: 'Emby',
            message: error.message || 'Unable to link the Emby movie',
            type: 'error',
            showCancel: false
        });
    }
}

async function handleEditMovieEmbyAction() {
    const modal = document.getElementById('editModal');
    const title = document.getElementById('edit-title')?.value.trim();
    const itemId = String(modal?.dataset.embyItemId || '').trim();
    const button = document.querySelector('#edit-emby-link-field .edit-emby-link-action');
    if (!title || !button) return;

    if (itemId) {
        await playMovieEmbyFromSearch({ title, emby_item_id: itemId });
        return;
    }

    button.disabled = true;
    button.classList.add('is-loading');
    setEditMovieEmbyFeedback('正在查找 Emby 电影…', 'pending');
    try {
        const result = await callApi(event_map.resolve_movie_emby_playback, { title });
        if (!result.success) throw new Error(result.message || '无法查找 Emby 电影');

        const data = result.data || {};
        if (data.status === 'linked' && data.playback?.id) {
            rememberMovieEmbyLink(title, data.playback.id);
            setEditMovieEmbyFeedback('绑定成功', 'success');
            return;
        }
        if (data.status === 'candidates') {
            setEditMovieEmbyFeedback('请选择对应的 Emby 电影', 'pending');
            openEmbyLinkSelection(title, 0, data.candidates || [], {
                playbackTarget: 'modal',
                linkMode: 'save-only'
            });
            return;
        }
        throw new Error('未找到可绑定的 Emby 电影');
    } catch (error) {
        setEditMovieEmbyFeedback('绑定失败', 'error');
        showAlert({
            title: 'Emby',
            message: error.message || '无法绑定 Emby 电影',
            type: 'warning',
            showCancel: false
        });
    } finally {
        button.disabled = false;
        button.classList.remove('is-loading');
    }
}

async function playMovieEmbyFromSearch(movie) {
    if (!movie?.title || !movie.emby_item_id) return;
    try {
        const result = await callApi(event_map.resolve_movie_emby_playback, { title: movie.title });
        if (!result.success) throw new Error(result.message || 'Unable to resolve Emby playback');
        const data = result.data || {};
        if (data.status === 'linked' && data.playback?.streamUrl) {
            rememberMovieEmbyLink(movie.title, data.playback.id);
            openEmbyPlayer(data.playback.streamUrl, data.playback.name || movie.title, 0, {
                movieTitle: movie.title,
                itemId: data.playback.id
            });
            return;
        }
        if (data.status === 'candidates') {
            rememberMovieEmbyLink(movie.title, null);
            openEmbyLinkSelection(movie.title, 0, data.candidates || [], { playbackTarget: 'modal' });
            return;
        }
        throw new Error('No matching Emby movie was found');
    } catch (error) {
        showAlert({
            title: 'Emby',
            message: error.message || 'Unable to start Emby playback',
            type: 'warning',
            showCancel: false
        });
    }
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
            const resultUnit = embyLinkSelectionContext ? '个候选' : '个结果';
            fragment.appendChild(createResultsCountSummary(items.length, resultUnit, 'emby-results-count'));
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
                prepareDeferredImage(img, imageUrl);
                const movieCard = column.querySelector('.movie-card');
                if (movieCard && streamUrl) {
                    const playMovie = () => {
                        if (embyLinkSelectionContext) {
                            linkMovieEmby(movie);
                            return;
                        }
                        openEmbyPlayer(streamUrl, movieName);
                    };
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
