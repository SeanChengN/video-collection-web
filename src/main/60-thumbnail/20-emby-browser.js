function searchThumbnailEmby() {
    const input = document.getElementById('thumbnail-emby-search-input');
    const query = (input?.value || '').trim();
    thumbnailState.source = 'emby';
    thumbnailState.embyQuery = query;
    syncThumbnailSourceControls();

    if (!query) {
        thumbnailState.embyResults = [];
        renderThumbnailEmbyResults([]);
        setThumbnailStatus('请输入关键词搜索 Emby 视频');
        return;
    }

    const requestToken = ++thumbnailState.embyRequestToken;
    setThumbnailFileListLoading('正在搜索 Emby...');
    callApi(event_map.search_emby, { query })
        .then(result => {
            if (requestToken !== thumbnailState.embyRequestToken) return;
            if (!result.success) {
                throw new Error(result.message || 'Emby 搜索失败');
            }
            const items = result.data?.items || [];
            thumbnailState.embyResults = items;
            renderThumbnailEmbyResults(items);
            setThumbnailStatus(items.length ? `找到 ${items.length} 个 Emby 视频` : '未找到匹配的 Emby 视频');
        })
        .catch(error => {
            if (requestToken !== thumbnailState.embyRequestToken) return;
            thumbnailState.embyResults = [];
            const message = error.message || 'Emby 搜索失败';
            setThumbnailFileListLoading(message);
            setThumbnailStatus(message);
        });
}

function renderThumbnailEmbyResults(items = thumbnailState.embyResults) {
    syncThumbnailSourceControls();
    const list = document.getElementById('thumbnail-file-list');
    if (!list) return;
    clearElement(list);

    if (!thumbnailState.embyQuery) {
        const empty = document.createElement('div');
        empty.className = 'thumbnail-empty';
        empty.textContent = '输入关键词搜索 Emby 视频';
        list.appendChild(empty);
        return;
    }

    if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'thumbnail-empty';
        empty.textContent = '未找到匹配的 Emby 视频';
        list.appendChild(empty);
        return;
    }

    items.forEach(item => {
        list.appendChild(createThumbnailEmbyRow(item));
    });
}

function createThumbnailEmbyRow(item) {
    const videoFile = toThumbnailEmbyVideo(item);
    const row = document.createElement('div');
    row.className = 'thumbnail-file-row thumbnail-emby-row has-copy';
    row.setAttribute('role', 'button');
    row.tabIndex = videoFile.url ? 0 : -1;
    if (videoFile.name.length > 18) {
        row.classList.add('is-long-name');
    }
    if (!videoFile.url) {
        row.classList.add('is-disabled');
        row.setAttribute('aria-disabled', 'true');
    }
    if (isThumbnailVideoSelected(videoFile)) {
        row.classList.add('is-selected');
    }

    appendChildren(row, [
        createEl('span', { className: 'thumbnail-file-name' }, [
            createEl('span', { className: 'thumbnail-file-name-text', text: videoFile.name })
        ]),
        createEl('span', {
            className: 'thumbnail-file-meta',
            text: formatThumbnailEmbyMeta(item, videoFile)
        }),
        createThumbnailCopyNameButton('复制片名')
    ]);
    row.title = videoFile.name;

    const selectEmbyVideo = () => {
        if (!videoFile.url) {
            setThumbnailStatus('这个 Emby 条目没有可用播放地址');
            return;
        }
        selectThumbnailVideo(videoFile);
    };
    row.addEventListener('click', selectEmbyVideo);
    row.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectEmbyVideo();
        }
    });
    row.querySelector('.thumbnail-copy-name')?.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        copyThumbnailVideoFileName(videoFile.name, event.currentTarget);
    });
    return row;
}

function toThumbnailEmbyVideo(item) {
    const id = String(item?.id || '');
    const name = item?.name || 'Emby video';
    return {
        source: 'emby',
        id,
        name,
        path: id ? `emby:${id}` : `emby:${name}`,
        url: item?.streamUrl || '',
        runtimeTicks: item?.runtimeTicks || 0,
        imageUrl: item?.imageUrl || ''
    };
}

function formatThumbnailEmbyMeta(item, videoFile) {
    if (!videoFile.url) return 'Emby · 不可播放';
    const runtime = formatRuntime(item?.runtimeTicks);
    return runtime ? `Emby · ${runtime}` : 'Emby';
}

function isThumbnailVideoSelected(file) {
    const selected = thumbnailState.selectedVideo;
    if (!selected || !file) return false;
    const selectedSource = selected.source || 'local';
    const fileSource = file.source || 'local';
    if (selectedSource !== fileSource) return false;
    if (fileSource === 'emby') {
        return Boolean(selected.id && file.id && selected.id === file.id);
    }
    return Boolean(selected.path && file.path && selected.path === file.path);
}

function renderThumbnailCurrentSourceList() {
    if (thumbnailState.source === 'emby') {
        renderThumbnailEmbyResults(thumbnailState.embyResults);
    } else {
        renderThumbnailBrowser(thumbnailState.currentListing || { path: thumbnailState.currentPath, directories: [], files: [] });
    }
}

