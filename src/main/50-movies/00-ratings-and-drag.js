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
    addRatingsContainer.classList.add('vc-rating-list');
    clearElement(addRatingsContainer);
    ratingsDimensions.forEach(dimension => {
        // 为添加电影 表单创建评分字段
        const addField = createRatingField(dimension, false);
        addRatingsContainer.appendChild(addField);
    });
    scheduleRatingNameScrollSync(addRatingsContainer);
}


// 创建评分字段
function createRatingNameElement(name, tagName = 'span', extraClassName = '') {
    const safeName = name || '';
    const className = `vc-rating-name${extraClassName ? ` ${extraClassName}` : ''}`;
    return createEl(tagName, {
        className,
        attrs: {
            tabindex: '0',
            title: safeName
        }
    }, [
        createEl('span', { className: 'vc-rating-name-text', text: safeName })
    ]);
}

function syncRatingNameScrollState(root = document) {
    const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
    scope.querySelectorAll('.vc-rating-name').forEach(nameEl => {
        const textEl = nameEl.querySelector('.vc-rating-name-text');
        if (!textEl) return;

        nameEl.removeAttribute('data-overflowing');
        nameEl.style.removeProperty('--vc-rating-name-scroll-distance');
        nameEl.style.removeProperty('--vc-rating-name-scroll-duration');

        const overflowDistance = Math.ceil(textEl.scrollWidth - nameEl.clientWidth);
        if (overflowDistance > 1) {
            nameEl.dataset.overflowing = 'true';
            nameEl.style.setProperty('--vc-rating-name-scroll-distance', `-${overflowDistance}px`);
            nameEl.style.setProperty(
                '--vc-rating-name-scroll-duration',
                `${Math.max(3.2, Math.min(8, overflowDistance / 18)).toFixed(2)}s`
            );
        }
    });
}

function scheduleRatingNameScrollSync(root = document) {
    requestAnimationFrame(() => syncRatingNameScrollState(root));
}

window.addEventListener('resize', () => scheduleRatingNameScrollSync());

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
    const field = createEl('div', { className: 'field vc-rating-item' }, [
        createRatingNameElement(dimension.name, 'label', 'label'),
        createEl('div', { className: 'control vc-rating-stars' }, [rating])
    ]);
    // 为新创建的评分字段绑定点击事件
    const stars = field.querySelectorAll('.rating svg');
    stars.forEach(star => {
        star.addEventListener('click', function() {
            const input = this.previousElementSibling;
            if (input) {
                input.checked = true;
                input.dispatchEvent(new Event('change', { bubbles: true }));
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
