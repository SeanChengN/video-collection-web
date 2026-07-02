function loadTags() {
    return callApi(event_map.get_tags)
        .then(result => {
            if (result.success) {
                const addTagsDiv = document.getElementById('add-tags');
                addTagsDiv.innerHTML = '';
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
                dimensionSelect.innerHTML = '<option value="">全部维度</option>';
                
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
                tagsFilter.innerHTML = ''; // 清空现有标签
                
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

const SEARCH_URL_KEYS = ['q', 'rating', 'min', 'tags', 'rec', 'page', 'searched'];
let searchRequestSequence = 0;

function normalizeSearchPage(page, fallback = 1) {
    const requestedPage = Number(page);
    return Number.isFinite(requestedPage) && requestedPage > 0
        ? Math.floor(requestedPage)
        : fallback;
}

// 获取已选中的标签
function getSelectedTags() {
    const tagsFilter = document.getElementById('tags-filter');
    if (!tagsFilter) return [];
    return Array.from(tagsFilter.getElementsByClassName('is-selected'))
                .map(tag => tag.textContent);
}

function normalizeRecommendedFilter(value) {
    const normalized = String(value ?? '').trim();
    return normalized === '1' || normalized === '0' ? normalized : '';
}

function getRecommendedFilterValue() {
    const selected = document.querySelector('#recommended-filter .tag.is-selected');
    return normalizeRecommendedFilter(selected?.dataset.recommendedValue);
}

function setRecommendedFilterValue(value) {
    const normalized = normalizeRecommendedFilter(value);
    let foundSelected = false;

    document.querySelectorAll('#recommended-filter .tag').forEach(tag => {
        const isSelected = normalizeRecommendedFilter(tag.dataset.recommendedValue) === normalized;
        tag.classList.toggle('is-selected', isSelected);
        foundSelected = foundSelected || isSelected;
    });

    if (!foundSelected) {
        const defaultTag = document.querySelector('#recommended-filter .tag[data-recommended-value=""]');
        if (defaultTag) defaultTag.classList.add('is-selected');
    }
}

function toggleRecommendedFilter(tagElement) {
    if (!tagElement) return;
    document.querySelectorAll('#recommended-filter .tag').forEach(tag => {
        tag.classList.toggle('is-selected', tag === tagElement);
    });
    searchFromControls();
}

function getSearchControlsState(page = currentPage) {
    return {
        page: normalizeSearchPage(page, 1),
        title: document.getElementById('search-input')?.value.trim() || '',
        ratingDimension: document.getElementById('rating-dimension-filter')?.value || '',
        minRating: document.getElementById('min-rating-filter')?.value || '',
        recommended: getRecommendedFilterValue(),
        selectedTags: getSelectedTags()
    };
}

function applySearchControlsState(state = {}) {
    const searchInput = document.getElementById('search-input');
    const ratingSelect = document.getElementById('rating-dimension-filter');
    const minRatingSelect = document.getElementById('min-rating-filter');

    if (searchInput) {
        searchInput.value = state.title || '';
    }
    if (ratingSelect) {
        const ratingValue = String(state.ratingDimension || '');
        ratingSelect.value = [...ratingSelect.options].some(option => option.value === ratingValue)
            ? ratingValue
            : '';
    }
    if (minRatingSelect) {
        const minValue = String(state.minRating || '');
        minRatingSelect.value = [...minRatingSelect.options].some(option => option.value === minValue)
            ? minValue
            : '';
    }
    setRecommendedFilterValue(state.recommended);

    const selectedTagSet = new Set(state.selectedTags || []);
    document.querySelectorAll('#tags-filter .tag').forEach(tag => {
        tag.classList.toggle('is-selected', selectedTagSet.has(tag.textContent));
    });

    currentPage = normalizeSearchPage(state.page, 1);
}

function readSearchStateFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return {
        page: normalizeSearchPage(params.get('page'), 1),
        title: params.get('q') || '',
        ratingDimension: params.get('rating') || '',
        minRating: params.get('min') || '',
        recommended: normalizeRecommendedFilter(params.get('rec')),
        selectedTags: (params.get('tags') || '')
            .split(',')
            .map(tag => tag.trim())
            .filter(Boolean)
    };
}

function hasSearchStateInUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('searched') === '1' || SEARCH_URL_KEYS
        .filter(key => key !== 'searched')
        .some(key => params.has(key));
}

function hasActiveSearchState() {
    return hasSearchStateInUrl() || allMovies.length > 0 || totalPages > 0;
}

function clearSearchView() {
    searchRequestSequence += 1;
    allMovies = [];
    totalPages = 0;
    clearElement(document.getElementById('search-message'));
    clearElement(document.getElementById('search-results'));
    clearElement(document.getElementById('pagination'));
}

function syncSearchStateToUrl(state = getSearchControlsState()) {
    if (!window.history || !window.history.replaceState) return;

    const url = new URL(window.location.href);
    const selectedTags = Array.isArray(state.selectedTags) ? state.selectedTags : [];
    const page = normalizeSearchPage(state.page, 1);
    SEARCH_URL_KEYS.forEach(key => url.searchParams.delete(key));

    if (state.title) {
        url.searchParams.set('q', state.title);
    }
    if (state.ratingDimension) {
        url.searchParams.set('rating', state.ratingDimension);
    }
    if (state.minRating) {
        url.searchParams.set('min', state.minRating);
    }
    if (selectedTags.length > 0) {
        url.searchParams.set('tags', selectedTags.join(','));
    }
    if (state.recommended === '1' || state.recommended === '0') {
        url.searchParams.set('rec', state.recommended);
    }
    if (page > 1) {
        url.searchParams.set('page', String(page));
    }
    url.searchParams.set('searched', '1');

    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState({}, '', nextUrl);
}

function searchFromControls() {
    searchMovies(1);
}

function searchCurrentPage(options = {}) {
    searchMovies(currentPage, options);
}

function refreshAfterMovieDelete() {
    if (hasActiveSearchState()) {
        searchCurrentPage({ fallbackToPreviousPage: true });
    }
}

// 按要求搜索电影
function searchMovies(page = 1, options = {}) {
    const requestedPage = normalizeSearchPage(page, 1);
    currentPage = requestedPage;

    const state = getSearchControlsState(currentPage);
    const messageDiv = document.getElementById('search-message');
    const resultsDiv = document.getElementById('search-results');
    const paginationDiv = document.getElementById('pagination');
    const requestId = ++searchRequestSequence;

    const searchParams = {
        title: state.title,
        rating_dimension: state.ratingDimension,
        min_rating: state.minRating,
        recommended: state.recommended,
        tags: state.selectedTags.join(','),
        page: state.page,
        per_page: itemsPerPage
    };

    if (options.showLoading !== false) {
        clearElement(messageDiv);
        renderSearchLoadingSkeleton();
    }

    callApi(event_map.search_movies, searchParams, 'GET')
        .then(result => {
            if (requestId !== searchRequestSequence) return;

            if (result.success) {
                const pagination = result.pagination || {};
                allMovies = Array.isArray(result.data) ? result.data : [];
                currentPage = normalizeSearchPage(pagination.page, currentPage);
                totalPages = Number(pagination.total_pages) || 0;

                if (
                    allMovies.length === 0 &&
                    options.fallbackToPreviousPage &&
                    state.page > 1 &&
                    totalPages > 0
                ) {
                    searchMovies(state.page - 1, { fallbackToPreviousPage: false });
                    return;
                }

                if (options.syncUrl !== false) {
                    syncSearchStateToUrl(getSearchControlsState(currentPage));
                }

                if (allMovies.length === 0) {
                    setNotification(messageDiv, 'info', '未找到电影');
                    clearElement(resultsDiv);
                    clearElement(paginationDiv);
                    return;
                }

                displayCurrentPage();
                clearElement(messageDiv);
            } else {
                setNotification(messageDiv, 'warning', result.message || '搜索失败');
                clearElement(resultsDiv);
                clearElement(paginationDiv);
            }
        })
        .catch(error => {
            if (requestId !== searchRequestSequence) return;
            setNotification(messageDiv, 'danger', `搜索出错: ${error.message}`);
            clearElement(resultsDiv);
            clearElement(paginationDiv);
        });
}

function displayPagination() {
    updatePagination();
}

function generatePaginationItems() {
    return '';
}
function changePage(page) {
    if (page >= 1 && page <= totalPages) {
        searchMovies(page);
    }
}

const debouncedSearchFromInput = debounce(searchFromControls, 350);

function closeModal() {
    ModalManager.close('editModal');
    updateThumbnailSelectionControls();
}

// 动态加载非关键资源
function loadNonCriticalResources() {
    // 只加载实际存在的资源文件
    const resources = [
        // 示例: 如果有额外的JavaScript文件
        // { type: 'script', src: '../static/extra-features.js' },
        // 示例: 如果有额外的CSS文件
        // { type: 'style', href: '../static/extra-styles.css' }
    ];
    
    // 如果没有需要延迟加载的资源，可以直接返回
    if (resources.length === 0) return;
    
    resources.forEach(resource => {
        if (resource.type === 'script') {
            const script = document.createElement('script');
            script.src = resource.src;
            script.async = true;
            document.body.appendChild(script);
        } else if (resource.type === 'style') {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = resource.href;
            document.head.appendChild(link);
        }
    });
}

// 页面加载完成后执行
document.addEventListener('DOMContentLoaded', () => {
    initStaticEventDelegates();
    initDynamicEventDelegates();
    loadTags();
    loadNonCriticalResources();
    loadRatingsDimensions();
    setupDropdownPositioning();
    initImageUpload();
});

// 全局变量
