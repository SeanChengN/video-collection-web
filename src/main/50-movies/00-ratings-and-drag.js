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