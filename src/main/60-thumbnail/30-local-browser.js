function loadThumbnailDirectory(path = '') {
    const safePath = path || '';
    thumbnailState.source = 'local';
    syncThumbnailSourceControls();
    const requestToken = ++thumbnailState.directoryRequestToken;
    setThumbnailFileListLoading();
    callApi(event_map.list_video_files, { path: safePath })
        .then(result => {
            if (requestToken !== thumbnailState.directoryRequestToken) return;
            if (!result.success) {
                throw new Error(result.message || '读取视频目录失败');
            }
            thumbnailState.currentPath = result.path || '';
            thumbnailState.currentListing = result;
            renderThumbnailBrowser(result);
            if (result.message) {
                setThumbnailStatus(result.message);
            }
        })
        .catch(error => {
            if (requestToken !== thumbnailState.directoryRequestToken) return;
            renderThumbnailBrowser({
                path: safePath,
                parent: getThumbnailParentPath(safePath),
                directories: [],
                files: []
            });
            setThumbnailStatus(error.message || '读取视频目录失败');
        });
}

function setThumbnailFileListLoading(message = '正在读取...') {
    const list = document.getElementById('thumbnail-file-list');
    if (list) {
        const empty = document.createElement('div');
        empty.className = 'thumbnail-empty';
        empty.textContent = message;
        list.replaceChildren(empty);
    }
}

function renderThumbnailBrowser(data) {
    syncThumbnailSourceControls();
    renderThumbnailBreadcrumbs(data.path || '');
    const upButton = document.getElementById('thumbnail-up-button');
    if (upButton) {
        upButton.disabled = !(data.path || '');
    }

    const list = document.getElementById('thumbnail-file-list');
    if (!list) return;
    clearElement(list);

    const directories = data.directories || [];
    const files = data.files || [];
    if (!directories.length && !files.length) {
        const empty = document.createElement('div');
        empty.className = 'thumbnail-empty';
        empty.textContent = '当前目录没有可播放的视频文件';
        list.appendChild(empty);
        return;
    }

    directories.forEach(directory => {
        list.appendChild(createThumbnailDirectoryRow(directory));
    });
    files.forEach(file => {
        list.appendChild(createThumbnailFileRow(file));
    });
}

function renderThumbnailBreadcrumbs(path) {
    const breadcrumbs = document.getElementById('thumbnail-breadcrumbs');
    if (!breadcrumbs) return;
    clearElement(breadcrumbs);

    const rootButton = document.createElement('button');
    rootButton.type = 'button';
    rootButton.textContent = 'videos';
    rootButton.addEventListener('click', () => loadThumbnailDirectory(''));
    breadcrumbs.appendChild(rootButton);

    let acc = '';
    path.split('/').filter(Boolean).forEach(part => {
        acc = acc ? `${acc}/${part}` : part;
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = part;
        const targetPath = acc;
        button.addEventListener('click', () => loadThumbnailDirectory(targetPath));
        breadcrumbs.appendChild(button);
    });
}

function createThumbnailDirectoryRow(directory) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'thumbnail-file-row';
    if (directory.name.length > 18) {
        row.classList.add('is-long-name');
    }
    appendChildren(row, [
        createEl('span', { className: 'thumbnail-file-name' }, [
            createEl('span', { className: 'thumbnail-file-name-text', text: `/${directory.name}` })
        ]),
        createEl('span', { className: 'thumbnail-file-meta', text: '目录' })
    ]);
    row.title = directory.name;
    row.addEventListener('click', () => loadThumbnailDirectory(directory.path));
    return row;
}

function createThumbnailFileRow(file) {
    const videoFile = {
        ...file,
        source: file.source || 'local'
    };
    const row = document.createElement('div');
    row.className = 'thumbnail-file-row has-copy';
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    if (videoFile.name.length > 18) {
        row.classList.add('is-long-name');
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
            text: formatThumbnailBytes(videoFile.size)
        }),
        createThumbnailCopyNameButton('复制文件名')
    ]);
    row.title = videoFile.name;
    row.addEventListener('click', () => selectThumbnailVideo(videoFile));
    row.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectThumbnailVideo(videoFile);
        }
    });
    row.querySelector('.thumbnail-copy-name')?.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        copyThumbnailVideoFileName(videoFile.name, event.currentTarget);
    });
    return row;
}

function createThumbnailCopyNameButton(ariaLabel) {
    return createEl('button', {
        className: 'thumbnail-copy-name',
        attrs: { type: 'button', 'aria-label': ariaLabel }
    }, [
        createSpriteSvg('copy-btn-icon', {
            fill: 'currentColor',
            ariaLabel: '复制'
        })
    ]);
}

async function copyThumbnailVideoFileName(fileName, button) {
    const setCopyIcon = (symbolId, stateClass) => {
        if (!button) return;
        button.classList.remove('is-success', 'is-danger');
        if (stateClass) button.classList.add(stateClass);
        button.replaceChildren(createSpriteSvg(symbolId, {
            fill: 'currentColor',
            ariaLabel: '复制'
        }));
    };

    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(fileName);
        } else {
            const textarea = document.createElement('textarea');
            textarea.value = fileName;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        }
        setCopyIcon('copy-success-btn-icon', 'is-success');
        setThumbnailStatus(`已复制文件名：${fileName}`);
    } catch (error) {
        setCopyIcon('copy-fail-btn-icon', 'is-danger');
        setThumbnailStatus('复制文件名失败');
    } finally {
        setTimeout(() => setCopyIcon('copy-btn-icon', ''), 1200);
    }
}

