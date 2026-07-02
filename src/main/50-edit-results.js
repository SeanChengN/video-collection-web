let ratingsDimensions = [];
const DEFAULT_RATING_VALUE = 3;

// 加载评分维度
function loadRatingsDimensions() {
    return callApi(event_map.get_ratings_dimensions)
        .then(result => {
            if (result.success) {
                ratingsDimensions = result.dimensions;
                // 创建评分表单
                createRatingForms();
            }
        });
}

// 创建评分表单 - 专用于添加电影中创建评分框
function createRatingForms() {
    // 添加电影 表单的评分区域
    const addRatingsContainer = document.getElementById('add-ratings-container');
    if (!addRatingsContainer) return;
    clearElement(addRatingsContainer);
    ratingsDimensions.forEach(dimension => {
        // 为添加电影 表单创建评分字段
        const addField = createRatingField(dimension, false);
        addRatingsContainer.appendChild(addField);
    });
}


// 创建评分字段
function createRatingField(dimension, isEdit) {
    const prefix = isEdit ? 'edit-' : '';
    const dimensionId = String(dimension.id);
    const rating = createEl('div', {
        className: 'rating',
        dataset: { dimensionId }
    });
    for (let value = 5; value >= 1; value--) {
        rating.appendChild(createEl('input', {
            attrs: {
                type: 'radio',
                id: `${prefix}rating-${dimensionId}-${value}`,
                name: `${prefix}rating-${dimensionId}`,
                value: String(value)
            }
        }));
        rating.appendChild(createSpriteSvg('rating-star-icon', {
            width: 16,
            height: 16,
            fill: 'currentColor',
            ariaLabel: value === 5 ? '星级' : '评分'
        }));
    }
    const field = createEl('div', { className: 'field' }, [
        createEl('label', { className: 'label', text: dimension.name || '' }),
        createEl('div', { className: 'control' }, [rating])
    ]);
    // 为新创建的评分字段绑定点击事件
    const stars = field.querySelectorAll('.rating svg');
    stars.forEach(star => {
        star.addEventListener('click', function() {
            const input = this.previousElementSibling;
            if (input) {
                input.checked = true;
                input.dispatchEvent(new Event('change'));
            }
        });
    });

    return field;
}

// 收集评分数据
function collectRatings(isEdit = false) {
    const prefix = isEdit ? 'edit-' : '';
    const ratings = [];
    
    ratingsDimensions.forEach(dimension => {
        const checkedInput = document.querySelector(`input[name="${prefix}rating-${dimension.id}"]:checked`);
        const value = checkedInput ? checkedInput.value : DEFAULT_RATING_VALUE;
        ratings.push(`${dimension.id}:${value}`);
    });
    
    return ratings.join(',');
}

// 精确计算拖放位置
function getDragAfterElement(container, x, y) {
    const draggableElements = [...container.querySelectorAll('.existing-image-item:not(.dragging), .preview-item:not(.dragging)')];
    
    // 获取容器的位置信息
    const containerRect = container.getBoundingClientRect();
    const containerTop = containerRect.top;
    const containerLeft = containerRect.left;
    
    // 计算相对于容器的坐标
    const relativeX = x - containerLeft;
    const relativeY = y - containerTop;
    
    // 计算网格布局信息
    const itemWidth = draggableElements[0]?.getBoundingClientRect().width || 0;
    const itemHeight = draggableElements[0]?.getBoundingClientRect().height || 0;
    const gap = 10; // 图片之间的间距
    
    // 计算目标位置的行和列
    const targetRow = Math.floor(relativeY / (itemHeight + gap));
    const targetCol = Math.floor(relativeX / (itemWidth + gap));
    
    // 计算目标索引
    const itemsPerRow = Math.floor(containerRect.width / (itemWidth + gap));
    const targetIndex = targetRow * itemsPerRow + targetCol;
    
    // 如果目标索引超出范围，返回null表示放置在末尾
    if (targetIndex >= draggableElements.length) {
        return null;
    }
    
    return draggableElements[targetIndex];
}

// 打开编辑模态框
function openModal(movie) {
    document.querySelector('.modal-card-title').textContent = `编辑电影：${movie.title}`;
    const modal = document.getElementById('editModal');
    
    // 清除旧的日期显示
    const oldDateField = document.querySelector('#edit-movie-form div:has(> p.has-text-grey)');
    if (oldDateField) {
        oldDateField.remove();
    }
    
    // 清空旧的图片区域
    window['resetedit-image-upload-area']();

    // 设置基本信息
    document.getElementById('edit-title').value = movie.title;
    
    // 添加新日期显示
    const dateField = document.createElement('div');
    dateField.className = 'field';
    dateField.appendChild(createEl('p', {
        className: 'has-text-grey',
        text: `添加日期: ${formatDate(movie.added_date)}`
    }));
    // 将日期字段插入到表单开头
    const form = document.getElementById('edit-movie-form');
    form.insertBefore(dateField, form.firstChild);
    
    // 设置推荐状态
    const recommendedRadio = document.getElementById('edit-recommended').checked = movie.recommended === 1;
    if (recommendedRadio) {
        recommendedRadio.checked = true;
    }
    
    // 设置评价
    document.getElementById('edit-review').value = movie.review || '';
    
    // 加载标签
    loadEditTags().then(() => {
        // 设置已选中的标签
        const tagElements = document.querySelectorAll('#edit-tags .tag');
        const movieTags = movie.tag_names ? movie.tag_names.split(', ') : [];
        tagElements.forEach(tag => {
            tag.classList.toggle('is-selected', movieTags.includes(tag.textContent.trim()));
        });
    });
    
    // 加载评分维度
    loadEditRatings().then(() => {
        // 设置评分
        if (movie.ratings) {
            const ratings = movie.ratings.split(',');
            ratings.forEach(ratingPair => {
                const [dimensionId, value] = ratingPair.split(':');
                const ratingInput = document.querySelector(`input[name="edit-rating-${dimensionId}"][value="${value}"]`);
                if (ratingInput) {
                    ratingInput.checked = true;
                }
            });
        }
    });
    
    // 检查并显示已有图片
    const existingImagesContainer = modal.querySelector('.existing-images');
    existingImagesContainer.style.display = movie.image_filename ? 'flex' : 'none'; // 如果没有已存在图片，则隐藏容器
    clearElement(existingImagesContainer); // 清空现有内容

    // 数组存储当前显示的图片文件名
    const currentImages = new Set();

    if (movie.image_filename && movie.image_filename.trim()) {
        const images = movie.image_filename.split(',');
        images.forEach((filename, index) => {
            if (filename.trim()) {
                const trimmedFilename = filename.trim();
                const imageUrl = buildImageUrl(trimmedFilename);
                const imageWrapper = document.createElement('div');
                imageWrapper.className = 'existing-image-item';
                imageWrapper.draggable = true; // 添加可拖拽属性
                imageWrapper.dataset.index = index; // 添加索引用于排序
                appendChildren(imageWrapper, [
                    createEl('img', { attrs: { src: imageUrl, alt: '预览图' } }),
                    createEl('button', {
                        className: 'delete-existing-image',
                        attrs: { type: 'button' },
                        dataset: { filename: trimmedFilename }
                    }, [
                        createSpriteSvg('close-icon', { width: 12, height: 12, ariaLabel: '删除' })
                    ])
                ]);

                // 阻止右键菜单弹出
                imageWrapper.addEventListener('contextmenu', e => e.preventDefault());

                // 添加删除按钮点击事件
                const deleteButton = imageWrapper.querySelector('.delete-existing-image');
                deleteButton.addEventListener('click', (e) => {
                    e.preventDefault();
                    imageWrapper.remove();
                    currentImages.delete(trimmedFilename);
                });

                /* PC端的拖拽使用了HTML5的原生拖放API，dragstart只是标记开始拖拽状态，
                真正的排序和索引更新是在container的dragover事件中完成的。
                而移动端没有原生拖放API，所以在touchmove中模拟了拖放行为。*/

                // 图片拖拽事件 - 开始
                imageWrapper.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/plain', index);
                    e.dataTransfer.effectAllowed = 'move';
                    // 设置拖拽图像
                    e.dataTransfer.setDragImage(imageWrapper, imageWrapper.offsetWidth / 2, imageWrapper.offsetHeight / 2);
                    imageWrapper.classList.add('dragging');
                    existingImagesContainer.classList.add('dragging-over');
                });
                // 移动端图片拖拽事件 - 开始
                imageWrapper.addEventListener('touchstart', () => {
                    imageWrapper.classList.add('dragging');
                    existingImagesContainer.classList.add('dragging-over');
                }, { passive: true });
                // 图片拖拽事件 - 结束
                imageWrapper.addEventListener('dragend', () => {
                    imageWrapper.classList.remove('dragging');
                    existingImagesContainer.classList.remove('dragging-over');
                });
                // 移动端图片拖拽事件 - 结束
                imageWrapper.addEventListener('touchend', () => {
                    imageWrapper.classList.remove('dragging');
                    existingImagesContainer.classList.remove('dragging-over');
                }, { passive: true });

                existingImagesContainer.appendChild(imageWrapper);
                currentImages.add(trimmedFilename);
            }
        });

        // 容器图片拖拽事件 - 开始
        existingImagesContainer.addEventListener('dragstart', (e) => {
            const imageWrapper = e.target.closest('.existing-image-item');
            if (imageWrapper) {
                imageWrapper.classList.add('dragging');
                existingImagesContainer.classList.add('dragging-over');
                e.dataTransfer.setData('text/plain', imageWrapper.dataset.index);
            }
        });
        // 移动端容器图片拖拽事件 - 开始
        existingImagesContainer.addEventListener('touchstart', (e) => {
            const imageWrapper = e.target.closest('.existing-image-item');
            if (imageWrapper) {
                imageWrapper.classList.add('dragging');
                existingImagesContainer.classList.add('dragging-over');
            }
        }, { passive: true });
        // 容器图片拖拽事件 - 结束
        existingImagesContainer.addEventListener('dragend', updateImageOrder);
        // 移动端容器图片拖拽事件 - 结束
        existingImagesContainer.addEventListener('touchend', updateImageOrder, { passive: true });

        function updateImageOrder(e) {
            const imageWrapper = e.target.closest('.existing-image-item');
            if (imageWrapper) {
                imageWrapper.classList.remove('dragging');
                existingImagesContainer.classList.remove('dragging-over');

                // 更新索引
                const items = existingImagesContainer.querySelectorAll('.existing-image-item');
                items.forEach((item, idx) => {
                    item.dataset.index = idx;
                });
            }
        }

        existingImagesContainer.addEventListener('dragenter', (e) => {
            e.preventDefault();
            existingImagesContainer.classList.add('dragging-over');
        });
        
        existingImagesContainer.addEventListener('dragleave', (e) => {
            e.preventDefault();
            existingImagesContainer.classList.remove('dragging-over');
        });
        
        existingImagesContainer.addEventListener('drop', (e) => {
            e.preventDefault();
            existingImagesContainer.classList.remove('dragging-over');
        });

        // 容器图片拖拽事件 - 移动
        existingImagesContainer.addEventListener('dragover', handleMove);
        // 移动端容器图片拖拽事件 - 移动
        existingImagesContainer.addEventListener('touchmove', handleMove);

        function handleMove(e) {
            e.preventDefault();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'move';
            }
            existingImagesContainer.classList.add('dragging-over');
        
            const draggingItem = existingImagesContainer.querySelector('.dragging');
            if (!draggingItem) return;
        
            const clientX = e.clientX || e.touches?.[0].clientX;
            const clientY = e.clientY || e.touches?.[0].clientY;
        
            const afterElement = getDragAfterElement(existingImagesContainer, clientX, clientY);
            if (afterElement) {
                existingImagesContainer.insertBefore(draggingItem, afterElement);
            } else {
                existingImagesContainer.appendChild(draggingItem);
            }
        }
    }

    // 将当前图片集合保存到modal元素中，供updateMovie使用
    modal.dataset.currentImages = JSON.stringify(Array.from(currentImages));

    // 显示模态框
    ModalManager.open('editModal');
    updateThumbnailSelectionControls();
}

// 加载编辑标签
async function loadEditTags() {
    try {
        const result = await callApi(event_map.get_tags);
        if (result.success) {
            const editTagsDiv = document.getElementById('edit-tags');
            clearElement(editTagsDiv);
            result.data.forEach(tag => {
                const tagSpan = document.createElement('span');
                tagSpan.className = 'tag';
                tagSpan.textContent = tag;
                tagSpan.onclick = () => toggleTag(tagSpan);
                editTagsDiv.appendChild(tagSpan);
            });
        }
    } catch (error) {
        showAlert({
            title: '加载失败',
            message: error.message || String(error),
            type: 'error',
            showCancel: false
        });
    }
}

// 加载编辑评分 - 专用于编辑窗口中创建评分框
async function loadEditRatings() {
    try {
        const result = await callApi(event_map.get_ratings_dimensions);
        if (result.success) {
            // 创建外层field容器
            const fieldDiv = document.createElement('div');
            fieldDiv.className = 'field';

            // 创建评分框容器
            const ratingsBox = document.createElement('div');
            ratingsBox.className = 'ratings-box';
            
            // 添加标题
            const boxTitle = document.createElement('div');
            boxTitle.className = 'ratings-box-title';
            boxTitle.textContent = '评分';
            
            // 创建评分容器
            const ratingsContainer = document.createElement('div');
            ratingsContainer.id = 'edit-ratings-container';
            
            // 添加评分维度
            result.dimensions.forEach(dimension => {
                const field = createRatingField(dimension, true);
                ratingsContainer.appendChild(field);
            });
            
            ratingsBox.appendChild(boxTitle);
            ratingsBox.appendChild(ratingsContainer);
            fieldDiv.appendChild(ratingsBox);
            
            // 插入到表单中
            const form = document.querySelector('#edit-movie-form');
            const imageBox = form.querySelector('.image-box').closest('.field');

            // 移除所有已存在的评分框
            const oldRatingsBoxes = form.querySelectorAll('.ratings-box');
            oldRatingsBoxes.forEach(box => {
                const fieldParent = box.closest('.field');
                if (fieldParent) fieldParent.remove();
            });

            // 插入到图片框之前
            form.insertBefore(fieldDiv, imageBox);
        }
    } catch (error) {
        showAlert({
            title: '加载失败',
            message: error.message || String(error),
            type: 'error',
            showCancel: false
        });
    }
}

// 删除电影相关代码
function deleteMovie() {
    showAlert({
        title: '确认删除',
        message: '确定要删除这部电影吗？此操作无法撤销。数据库中的图像文件也会被删除。',
        type: 'warning',
        confirmText: '删除',
        cancelText: '取消',
        onConfirm: () => {
            // 保存当前的搜索状态
            saveSearchState();
            
            const title = document.getElementById('edit-title').value;
            callApi(event_map.delete_movie, { title }, 'DELETE')
                .then(result => {
                    if (result.success){
                        closeModal();
                        // 恢复搜索状态并重新搜索
                        restoreSearchState();
                        refreshAfterMovieDelete();
                        showAlert({
                            title: '删除成功',
                            message: result.message || '电影已删除',
                            type: 'success',
                            showCancel: false
                        });
                    } else {
                        showAlert({
                            title: '删除失败',
                            message: result.message || '删除失败',
                            type: 'error',
                            showCancel: false
                        });
                    }
                });
        }
    });
}

// 搜索状态的全局函数
let searchState = {
    page: 1,
    title: '',
    ratingDimension: '',
    minRating: '',
    selectedTags: []
};

// 保存搜索状态的函数
function saveSearchState() {
    searchState = getSearchControlsState(currentPage);
}

// 恢复搜索状态的函数
function restoreSearchState() {
    applySearchControlsState(searchState);
}

// 更新电影信息
async function updateMovie() {
    try {
        const form = document.getElementById('edit-movie-form');
        const title = document.getElementById('edit-title').value;
        const modal = document.getElementById('editModal');
        
        // 保存当前的搜索状态
        saveSearchState();

        // 获取当前保留的现有图片
        const currentImages = Array.from(modal.querySelectorAll('.existing-image-item'))
            .sort((a, b) => parseInt(a.dataset.index) - parseInt(b.dataset.index))
            .map(item => item.querySelector('.delete-existing-image').dataset.filename);

        // 处理新上传的图片
        const uploadedFiles = window[`getedit-image-upload-areaFiles`]() || [];
        const uploadResults = await Promise.all(uploadedFiles.map(async file => {
            const formData = new FormData();
            formData.append('image', file);
            const response = await fetch('/api', { 
                method: 'POST', 
                headers: window.getCsrfHeaders ? window.getCsrfHeaders() : {},
                body: formData 
            }).then(res => res.json());
            return response;
        }));

        // 合并现有图片和新上传图片的文件名
        const newFilenames = uploadResults
            .filter(result => result.success)
            .map(result => result.filename);

        const allFilenames = [...currentImages, ...newFilenames].join(',');

        const data = {
            title: title,
            recommended: document.getElementById('edit-recommended').checked ? 1 : 0,
            review: form.querySelector('[id="edit-review"]').value,
            tags: Array.from(document.querySelectorAll('#edit-tags .tag.is-selected')).map(tag => tag.textContent).join(','),
            ratings: collectRatings(true),
            image_filenames: allFilenames,
            // 原始图片列表，用于后端对比删除的图片
            original_images: modal.dataset.currentImages
        };

        const result = await callApi(event_map.update_movie, data, 'PUT');
        if (result.message) {
            ModalManager.close('editModal');
            updateThumbnailSelectionControls();
            // 恢复搜索状态并重新搜索
            restoreSearchState();
            if (hasActiveSearchState()) {
                searchCurrentPage();
            }
        } else {
            showAlert({
                title: '更新失败',
                message: result.error,
                type: 'error',
                showCancel: false
            });
        }
    } catch (error) {
        showAlert({
            title: '更新失败',
            message: error.message || String(error),
            type: 'error',
            showCancel: false
        });
    }
}

// 搜索结果显示
function parseMovieRatings(movie) {
    return movie.ratings
        ? movie.ratings.split(',').map(ratingPair => {
            const [dimensionId, value] = ratingPair.split(':');
            return {
                dimensionId: String(dimensionId),
                value: parseInt(value, 10)
            };
        }).filter(rating => rating.value > 0)
        : [];
}

function createRatingItem(rating) {
    const dimension = ratingsDimensions.find(d => d.id.toString() === rating.dimensionId);
    if (!dimension) return null;

    return createEl('div', { className: 'rating-item' }, [
        createEl('span', { className: 'dimension-name', text: `${dimension.name}:` }),
        createEl('span', { className: 'stars' }, [createStarsFragment(rating.value)])
    ]);
}

function appendRatingItems(container, ratings) {
    ratings.forEach(rating => {
        const item = createRatingItem(rating);
        if (item) container.appendChild(item);
    });
}

function createRatingsCell(movie) {
    const ratingsCell = createEl('td', {
        className: 'ratings-cell',
        attrs: { 'data-label': '评分' }
    });
    const movieRatings = parseMovieRatings(movie);

    if (movieRatings.length > 0) {
        const dropdownContent = createEl('div', { className: 'dropdown-content' });
        appendRatingItems(dropdownContent, movieRatings);

        const dropdown = createEl('div', { className: 'dropdown is-hoverable desktop-ratings-dropdown' }, [
            createEl('div', { className: 'dropdown-trigger' }, [
                createEl('button', {
                    className: 'button is-small',
                    attrs: { type: 'button' }
                }, [createEl('span', { text: '查看评分' })])
            ]),
            createEl('div', { className: 'dropdown-menu', attrs: { role: 'menu' } }, [dropdownContent])
        ]);

        const mobileRatings = createEl('div', { className: 'mobile-ratings-list' });
        appendRatingItems(mobileRatings, movieRatings);
        appendChildren(ratingsCell, [dropdown, mobileRatings]);
    } else {
        appendChildren(ratingsCell, [
            createEl('button', {
                className: 'button is-small desktop-ratings-empty',
                attrs: { type: 'button', disabled: true }
            }, ['暂无评分']),
            createEl('div', { className: 'mobile-ratings-list is-empty', text: '暂无评分' })
        ]);
    }

    return ratingsCell;
}

function createMovieTitleCell(movie, movieIndex) {
    const cell = createEl('td', {
        className: 'movie-title-cell hoverable',
        attrs: { 'data-label': '电影名称' }
    });
    const title = movie.title || '';
    const imageFilename = movie.image_filename || '';

    if (imageFilename) {
        const firstImageFilename = imageFilename.split(',')[0].trim();
        const firstImageUrl = firstImageFilename ? buildImageUrl(firstImageFilename) : '';
        const preview = createEl('div', {
            className: 'movie-preview-image',
            attrs: { role: 'button', tabindex: '0', 'aria-label': `预览 ${title}` },
            dataset: {
                action: 'open-image-viewer',
                images: imageFilename,
                title
            }
        });

        if (firstImageUrl) {
            preview.appendChild(createEl('img', {
                attrs: { src: firstImageUrl, alt: '预览图' }
            }));
        }

        cell.appendChild(createEl('div', { className: 'movie-title-with-image' }, [
            preview,
            createEl('span', {
                className: 'movie-title-text',
                text: title,
                attrs: { title }
            })
        ]));
    } else {
        cell.appendChild(createEl('span', {
            className: 'movie-title-text',
            text: title,
            attrs: { title }
        }));
    }

    return cell;
}

function createRecommendedCell(movie) {
    const recommended = Boolean(movie.recommended);
    return createEl('td', {
        className: 'movie-recommended-cell',
        attrs: { 'data-label': '推荐' }
    }, [
        createEl('span', {
            className: `movie-recommended-chip${recommended ? ' is-recommended' : ''}`
        }, [
            createSpriteSvg(recommended ? 'recommend-light-icon' : 'recommend-icon', {
                width: 20,
                height: 20,
                fill: recommended ? '#ff7b00' : '#515151',
                ariaLabel: recommended ? '推荐' : '未推荐'
            }),
            createEl('span', {
                className: 'movie-recommended-text',
                text: recommended ? '推荐' : '未推荐'
            })
        ])
    ]);
}

function createMovieTextCell({ className, label, value, textClass }) {
    const text = value || '';
    return createEl('td', {
        className,
        attrs: { 'data-label': label, title: text }
    }, [
        createEl('span', {
            className: `${textClass}${text ? '' : ' is-empty'}`,
            text
        })
    ]);
}

function createMovieActionCell(movieIndex) {
    return createEl('td', {
        className: 'movie-action-cell',
        attrs: { 'data-label': '操作' }
    }, [
        createActionButton({
            className: 'button is-small is-info edit-btn',
            text: '编辑',
            action: 'edit-movie',
            dataset: { movieIndex }
        })
    ]);
}

function createMovieRow(movie, movieIndex) {
    const tr = createEl('tr');
    appendChildren(tr, [
        createMovieTitleCell(movie, movieIndex),
        createRecommendedCell(movie),
        createMovieTextCell({
            className: 'hoverable review-cell',
            label: '评价',
            value: movie.review,
            textClass: 'movie-review-text'
        }),
        createMovieTextCell({
            className: 'hoverable tags-cell',
            label: '标签',
            value: movie.tag_names,
            textClass: 'movie-tags-text'
        }),
        createRatingsCell(movie),
        createMovieActionCell(movieIndex)
    ]);
    return tr;
}

const MOVIE_RESULT_COLUMNS = [
    ['title', '电影名称', '23%'],
    ['recommended', '推荐', '4.5%'],
    ['review', '评价', '36%'],
    ['tags', '标签', '15.5%'],
    ['ratings', '评分', '10.5%'],
    ['action', '操作', '10.5%']
];

function createMovieResultsHeaderRow() {
    const headerRow = createEl('tr');
    MOVIE_RESULT_COLUMNS.forEach(([column, label, width]) => {
        headerRow.appendChild(createEl('th', {
            text: label,
            attrs: { 'data-column': column, style: `width: ${width}` }
        }));
    });
    return headerRow;
}

function createSkeletonBlock(className) {
    return createEl('span', { className: `skeleton-block ${className}` });
}

function createSearchSkeletonRow() {
    return createEl('tr', { className: 'search-skeleton-row' }, [
        createEl('td', {
            className: 'movie-title-cell skeleton-cell',
            attrs: { 'data-label': '电影名称' }
        }, [
            createEl('div', { className: 'movie-title-with-image' }, [
                createSkeletonBlock('skeleton-thumb'),
                createEl('div', { className: 'skeleton-title-lines' }, [
                    createSkeletonBlock('skeleton-line skeleton-line-wide'),
                    createSkeletonBlock('skeleton-line skeleton-line-medium')
                ])
            ])
        ]),
        createEl('td', {
            className: 'movie-recommended-cell skeleton-cell',
            attrs: { 'data-label': '推荐' }
        }, [createSkeletonBlock('skeleton-pill')]),
        createEl('td', {
            className: 'review-cell skeleton-cell',
            attrs: { 'data-label': '评价' }
        }, [
            createSkeletonBlock('skeleton-line skeleton-line-wide'),
            createSkeletonBlock('skeleton-line skeleton-line-medium')
        ]),
        createEl('td', {
            className: 'tags-cell skeleton-cell',
            attrs: { 'data-label': '标签' }
        }, [createSkeletonBlock('skeleton-line skeleton-line-short')]),
        createEl('td', {
            className: 'ratings-cell skeleton-cell',
            attrs: { 'data-label': '评分' }
        }, [createSkeletonBlock('skeleton-line skeleton-line-medium')]),
        createEl('td', {
            className: 'movie-action-cell skeleton-cell',
            attrs: { 'data-label': '操作' }
        }, [createSkeletonBlock('skeleton-button')])
    ]);
}

function renderSearchLoadingSkeleton(rowCount = Math.min(itemsPerPage, 6)) {
    const resultsDiv = document.getElementById('search-results');
    const paginationDiv = document.getElementById('pagination');
    if (!resultsDiv) return;

    clearElement(resultsDiv);
    clearElement(paginationDiv);

    const tableContainer = createEl('div', { className: 'table-container search-skeleton' });
    const table = createEl('table', { className: 'table is-fullwidth is-striped movie-results-table' });
    table.appendChild(createEl('thead', {}, [createMovieResultsHeaderRow()]));

    const tbody = createEl('tbody');
    for (let index = 0; index < rowCount; index++) {
        tbody.appendChild(createSearchSkeletonRow());
    }

    table.appendChild(tbody);
    tableContainer.appendChild(table);
    resultsDiv.appendChild(tableContainer);
}

// 搜索结果显示
function displayCurrentPage() {
    const resultsDiv = document.getElementById('search-results');
    clearElement(resultsDiv);
    
    if (allMovies.length === 0) {
        resultsDiv.appendChild(createNotification('info', '没有找到电影'));
        clearElement(document.getElementById('pagination'));
        return;
    }

    const tableContainer = createEl('div', { className: 'table-container' });
    const table = createEl('table', { className: 'table is-fullwidth is-striped is-hoverable movie-results-table' });
    table.appendChild(createEl('thead', {}, [createMovieResultsHeaderRow()]));
    const tbody = createEl('tbody');
    allMovies.forEach((movie, index) => {
        tbody.appendChild(createMovieRow(movie, index));
    });

    table.appendChild(tbody);
    tableContainer.appendChild(table);
    resultsDiv.appendChild(tableContainer);

    updatePagination();
    setupDropdownPositioning();
}
function setupDropdownPositioning() {
    document.addEventListener('mouseover', function(e) {
        const dropdown = e.target.closest('.dropdown');
        if (!dropdown) return;

        const menu = dropdown.querySelector('.dropdown-menu');
        if (!menu) return;

        // 获取视口和元素位置信息
        const viewportHeight = window.innerHeight;
        const dropdownRect = dropdown.getBoundingClientRect();
        const menuHeight = menu.offsetHeight;

        // 计算下方剩余空间
        const spaceBelow = viewportHeight - dropdownRect.bottom;
        
        // 重置之前的样式
        menu.style.bottom = 'auto';
        menu.style.top = 'auto';

        // 根据可用空间决定显示位置
        if (spaceBelow < menuHeight && dropdownRect.top > menuHeight) {
            // 如果下方空间不足且上方空间足够，向上显示
            menu.style.bottom = '100%';
            menu.style.marginBottom = '5px';
        } else {
            // 否则向下显示
            menu.style.top = '100%';
            menu.style.marginTop = '5px';
        }

        // 确保水平对齐
        menu.style.left = '0';
        menu.style.right = 'auto';
        
        // 防止菜单超出右侧边界
        const menuRect = menu.getBoundingClientRect();
        if (menuRect.right > window.innerWidth) {
            menu.style.left = 'auto';
            menu.style.right = '0';
        }
    });
}

// 辅助函数：日期格式
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }).replace(/\//g, '-');
}

// 辅助函数：渲染星星
function renderStars(rating) {
    return createStarsFragment(rating);
}
// 辅助函数：获取星星颜色
function getStarColor(rating) {
    const ratingElement = document.querySelector('.rating');
    const styles = getComputedStyle(ratingElement);
    return styles.getPropertyValue(`--star-${rating}`).trim(); // 动态获取变量中保存的颜色
}

// 更新分页控件
function createPaginationAnchor(label, page, options = {}) {
    const {
        className = 'pagination-link',
        current = false,
        disabled = false
    } = options;
    const attrs = {};
    const dataset = { action: 'change-page', page };

    if (current) {
        attrs['aria-current'] = 'page';
    }
    if (disabled) {
        attrs.disabled = true;
        attrs['aria-disabled'] = 'true';
    }

    return createEl('a', {
        className: `${className}${current ? ' is-current' : ''}`,
        text: label,
        attrs,
        dataset
    });
}

function createPaginationEllipsis() {
    return createEl('li', {}, [
        createEl('span', { className: 'pagination-ellipsis' }, ['…'])
    ]);
}

// 更新分页控件
function updatePagination() {
    const paginationDiv = document.getElementById('pagination');
    if (!paginationDiv) return;
    clearElement(paginationDiv);
    if (totalPages <= 0) return;

    const nav = createEl('nav', {
        className: 'pagination is-centered',
        attrs: { role: 'navigation', 'aria-label': 'pagination' }
    });

    nav.appendChild(createPaginationAnchor('上一页', currentPage - 1, {
        className: 'pagination-previous',
        disabled: currentPage <= 1
    }));
    nav.appendChild(createPaginationAnchor('下一页', currentPage + 1, {
        className: 'pagination-next',
        disabled: currentPage >= totalPages
    }));

    const pageList = createEl('ul', { className: 'pagination-list' });
    const delta = 2;

    if (currentPage > delta + 1) {
        pageList.appendChild(createEl('li', {}, [createPaginationAnchor('1', 1)]));
        if (currentPage > delta + 2) {
            pageList.appendChild(createPaginationEllipsis());
        }
    }

    for (let i = Math.max(1, currentPage - delta); i <= Math.min(totalPages, currentPage + delta); i++) {
        pageList.appendChild(createEl('li', {}, [
            createPaginationAnchor(String(i), i, { current: i === currentPage })
        ]));
    }

    if (currentPage < totalPages - delta) {
        if (currentPage < totalPages - delta - 1) {
            pageList.appendChild(createPaginationEllipsis());
        }
        pageList.appendChild(createEl('li', {}, [createPaginationAnchor(String(totalPages), totalPages)]));
    }

    nav.appendChild(pageList);
    paginationDiv.appendChild(nav);
}

// 图片上传相关代码
