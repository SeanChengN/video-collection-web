function setEditMovieEmbyFeedback(message = '', state = '') {
    const feedback = document.getElementById('edit-emby-link-feedback');
    if (!feedback) return;
    feedback.textContent = message;
    feedback.hidden = !message;
    feedback.dataset.state = state;
}

function syncEditMovieEmbyState(movieTitle, itemId, options = {}) {
    const modal = document.getElementById('editModal');
    const titleInput = document.getElementById('edit-title');
    const panel = document.querySelector('#edit-emby-link-field .edit-emby-link-panel');
    const status = document.getElementById('edit-emby-link-status');
    const button = document.querySelector('#edit-emby-link-field .edit-emby-link-action');
    const buttonText = button?.querySelector('.edit-emby-link-action-text');
    if (!modal || !panel || !status || !button || !buttonText) return;
    if (movieTitle && titleInput?.value && movieTitle !== titleInput.value) return;

    const normalizedItemId = String(itemId || '').trim();
    const isLinked = Boolean(normalizedItemId);
    modal.dataset.embyItemId = normalizedItemId;
    panel.dataset.linked = String(isLinked);
    status.textContent = isLinked ? '已绑定' : '未绑定';
    buttonText.textContent = isLinked ? '播放' : '绑定';
    button.setAttribute('aria-label', isLinked ? '播放 Emby' : '绑定 Emby');
    button.title = isLinked ? '播放 Emby' : '绑定 Emby';
    button.classList.toggle('is-success', isLinked);
    button.classList.toggle('is-info', !isLinked);
    if (!options.preserveFeedback) setEditMovieEmbyFeedback();
}

function openModal(movie) {
    document.querySelector('.modal-card-title').textContent = `编辑电影：${movie.title}`;
    const modal = document.getElementById('editModal');
    const dirtyTrackingSession = beginEditMovieDirtyTracking();
    
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
    const embyLinkField = document.getElementById('edit-emby-link-field');
    if (embyLinkField) dateField.before(embyLinkField);
    syncEditMovieEmbyState(movie.title, movie.emby_item_id);
    
    // 设置推荐状态
    const recommendedRadio = document.getElementById('edit-recommended').checked = movie.recommended === 1;
    if (recommendedRadio) {
        recommendedRadio.checked = true;
    }
    
    // 设置评价
    document.getElementById('edit-review').value = movie.review || '';
    
    // 加载标签
    const tagsReady = loadEditTags().then(() => {
        // 设置已选中的标签
        const tagElements = document.querySelectorAll('#edit-tags .tag');
        const movieTags = String(movie.tag_names || '')
            .split(',')
            .map(tag => tag.trim())
            .filter(Boolean);
        tagElements.forEach(tag => {
            tag.classList.toggle('is-selected', movieTags.includes(tag.textContent.trim()));
        });
    });
    
    // 加载评分维度
    const ratingsReady = loadEditRatings().then(() => {
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
                const imageUrl = buildImageUrl(trimmedFilename, 'cover');
                const imageWrapper = document.createElement('div');
                imageWrapper.className = 'existing-image-item';
                imageWrapper.draggable = true; // 添加可拖拽属性
                imageWrapper.dataset.index = index; // 添加索引用于排序
                const previewImage = createEl('img', { attrs: { alt: '预览图' } });
                prepareDeferredImage(previewImage, imageUrl);
                appendChildren(imageWrapper, [
                    previewImage,
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
    Promise.allSettled([tagsReady, ratingsReady]).then(() => {
        completeEditMovieDirtyTracking(dirtyTrackingSession, movie);
    });
}
