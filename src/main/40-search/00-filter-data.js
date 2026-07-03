function loadTags() {
    return callApi(event_map.get_tags)
        .then(result => {
            if (result.success) {
                const addTagsDiv = document.getElementById('add-tags');
                clearElement(addTagsDiv);
                result.data.forEach(tag => {
                    const tagSpan = document.createElement('span');
                    tagSpan.className = 'tag';
                    tagSpan.textContent = tag;
                    tagSpan.onclick = () => toggleTag(tagSpan);
                    addTagsDiv.appendChild(tagSpan);
                });
            }
        });
}

function toggleTag(tagElement) {
    tagElement.classList.toggle('is-selected');
}

function debounce(func, wait) {
    let timeout;
    function debounced(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    }
    debounced.cancel = () => {
        clearTimeout(timeout);
    };
    return debounced;
}

// 加载标签和评分维度
function loadFilters() {
    const dimensionSelect = document.getElementById('rating-dimension-filter');
    const previousRatingDimension = dimensionSelect ? dimensionSelect.value : '';
    const previousSelectedTags = getSelectedTags();

    // 加载评分维度
    const ratingsRequest = callApi(event_map.get_ratings_dimensions)
        .then(data => {
            if (data.success) {
                clearElement(dimensionSelect);
                dimensionSelect.appendChild(createEl('option', {
                    text: '全部维度',
                    attrs: { value: '' }
                }));
                
                data.dimensions.forEach(dimension => {
                    const option = document.createElement('option');
                    option.value = dimension.id;
                    option.textContent = dimension.name;
                    dimensionSelect.appendChild(option);
                });
                if ([...dimensionSelect.options].some(option => option.value === previousRatingDimension)) {
                    dimensionSelect.value = previousRatingDimension;
                }
            }
        })
        .catch(error => {
            showAlert({
                title: '加载失败',
                message: error.message || String(error),
                type: 'error',
                showCancel: false
            });
        });

    // 加载标签
    const tagsRequest = callApi(event_map.get_tags)
        .then(data => {
            if (data.success) {
                const tagsFilter = document.getElementById('tags-filter');
                clearElement(tagsFilter); // 清空现有标签
                
                data.data.forEach(tagName => {
                    const tagSpan = document.createElement('span');
                    tagSpan.className = 'tag';
                    tagSpan.textContent = tagName;
                    tagSpan.classList.toggle('is-selected', previousSelectedTags.includes(tagName));
                    tagSpan.addEventListener('click', () => toggleFilterTag(tagSpan));
                    tagsFilter.appendChild(tagSpan);
                });
            }
        })
        .catch(error => {
            showAlert({
                title: '加载失败',
                message: error.message || String(error),
                type: 'error',
                showCancel: false
            });
        });

    return Promise.all([ratingsRequest, tagsRequest]);
}

// 切换标签选中状态
function toggleFilterTag(tagElement) {
    tagElement.classList.toggle('is-selected');
    searchFromControls();
}
