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
    searchResultTotal = 0;
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
