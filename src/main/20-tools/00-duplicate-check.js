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