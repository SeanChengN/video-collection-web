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
                searchResultTotal = Math.max(0, Number(pagination.total) || 0);

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
                    searchResultTotal = 0;
                    return;
                }

                displayCurrentPage();
                clearElement(messageDiv);
            } else {
                setNotification(messageDiv, 'warning', result.message || '搜索失败');
                clearElement(resultsDiv);
                clearElement(paginationDiv);
                searchResultTotal = 0;
            }
        })
        .catch(error => {
            if (requestId !== searchRequestSequence) return;
            setNotification(messageDiv, 'danger', normalizeUiMessage(error.message, '搜索出错，请稍后重试。'));
            clearElement(resultsDiv);
            clearElement(paginationDiv);
            searchResultTotal = 0;
        });
}
