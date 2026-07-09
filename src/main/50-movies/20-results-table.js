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

    return createEl('div', { className: 'rating-item vc-rating-item' }, [
        createRatingNameElement(dimension.name, 'span', 'dimension-name'),
        createEl('span', { className: 'stars vc-rating-stars' }, [createStarsFragment(rating.value)])
    ]);
}

function appendRatingItems(container, ratings) {
    ratings.forEach(rating => {
        const item = createRatingItem(rating);
        if (item) container.appendChild(item);
    });
}

function createMovieCardTextBlock(value, className, emptyText) {
    const text = value || '';
    return createEl('section', { className: `movie-card-section ${className}${text ? '' : ' is-empty'}` }, [
        createEl('p', {
            className: 'movie-card-section-text',
            text: text || emptyText,
            attrs: text ? { title: text } : {}
        })
    ]);
}

function createMovieCardTags(tagNames) {
    const tags = (tagNames || '')
        .split(',')
        .map(tag => tag.trim())
        .filter(Boolean);
    const content = tags.length
        ? tags.map(tag => createEl('span', { className: 'movie-card-tag', text: tag }))
        : [createEl('span', { className: 'movie-card-empty-text', text: '暂无标签' })];

    return createEl('section', { className: `movie-card-section movie-card-tags${tags.length ? '' : ' is-empty'}` }, [
        createEl('div', { className: 'movie-card-tags-list' }, content)
    ]);
}

function createMovieCardRatings(movie) {
    const ratings = parseMovieRatings(movie);
    const content = createEl('div', {
        className: `movie-card-ratings-list vc-rating-list${ratings.length ? '' : ' is-empty'}`
    });

    if (ratings.length > 0) {
        appendRatingItems(content, ratings);
    } else {
        content.appendChild(createEl('span', { className: 'movie-card-empty-text', text: '暂无评分' }));
    }

    return createEl('section', { className: `movie-card-section movie-card-ratings${ratings.length ? '' : ' is-empty'}` }, [
        content
    ]);
}

function createMovieCardCover(movie) {
    const title = movie.title || '';
    const imageFilename = movie.image_filename || '';
    const firstImageFilename = imageFilename ? imageFilename.split(',')[0].trim() : '';
    const firstImageUrl = firstImageFilename ? buildImageUrl(firstImageFilename) : '';

    if (!firstImageUrl) {
        return createEl('div', { className: 'movie-card-cover is-empty' }, [
            createSpriteSvg('thumbnail-icon', { width: 34, height: 34, ariaLabel: '暂无封面' }),
            createEl('span', { text: '暂无封面' })
        ]);
    }

    const cover = createEl('button', {
        className: 'movie-card-cover',
        attrs: { type: 'button', 'aria-label': `预览 ${title}` },
        dataset: {
            action: 'open-image-viewer',
            images: imageFilename,
            title
        }
    });
    cover.appendChild(createEl('img', {
        attrs: { src: firstImageUrl, alt: title || '电影封面' }
    }));
    return cover;
}

function createMovieCardEditButton(movieIndex) {
    return createEl('button', {
        className: 'movie-card-edit-btn',
        attrs: { type: 'button', 'aria-label': '编辑电影', title: '编辑电影' },
        dataset: { action: 'edit-movie', movieIndex }
    }, [
        createSpriteSvg('edit-btn-icon', { width: 16, height: 16, ariaLabel: '编辑电影' })
    ]);
}

function createSkeletonBlock(className) {
    return createEl('span', { className: `skeleton-block ${className}` });
}

function createMovieRecommendBadge() {
    return createEl('div', { className: 'movie-card-recommend-badge', attrs: { 'aria-label': '推荐' } }, [
        createSpriteSvg('recommend-light-icon', { width: 18, height: 18, ariaLabel: '推荐' })
    ]);
}

function createMovieCard(movie, movieIndex) {
    const title = movie.title || '未命名电影';
    const recommended = Boolean(movie.recommended);
    const card = createEl('article', {
        className: `movie-result-card${recommended ? ' is-recommended' : ''}`,
        dataset: { movieIndex }
    });

    if (recommended) {
        card.appendChild(createMovieRecommendBadge());
    }

    appendChildren(card, [
        createMovieCardEditButton(movieIndex),
        createMovieCardCover(movie),
        createEl('div', { className: 'movie-card-body' }, [
            createEl('h3', { className: 'movie-card-title', text: title, attrs: { title } }),
            createMovieCardTextBlock(movie.review, 'movie-card-review', '暂无评价'),
            createMovieCardTags(movie.tag_names),
            createMovieCardRatings(movie)
        ])
    ]);

    return card;
}

function createSearchSkeletonCard() {
    return createEl('article', { className: 'movie-result-card search-skeleton-card' }, [
        createEl('span', { className: 'skeleton-button movie-card-edit-placeholder' }),
        createSkeletonBlock('skeleton-cover'),
        createEl('div', { className: 'movie-card-body' }, [
            createSkeletonBlock('skeleton-line skeleton-line-wide'),
            createSkeletonBlock('skeleton-panel'),
            createSkeletonBlock('skeleton-panel skeleton-panel-small'),
            createSkeletonBlock('skeleton-panel skeleton-panel-small')
        ])
    ]);
}

function renderSearchLoadingSkeleton(rowCount = itemsPerPage) {
    const resultsDiv = document.getElementById('search-results');
    const paginationDiv = document.getElementById('pagination');
    if (!resultsDiv) return;

    clearElement(resultsDiv);
    clearElement(paginationDiv);
    searchResultTotal = 0;

    const grid = createEl('div', { className: 'movie-results-grid search-skeleton' });
    for (let index = 0; index < rowCount; index++) {
        grid.appendChild(createSearchSkeletonCard());
    }

    resultsDiv.appendChild(grid);
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

    resultsDiv.appendChild(createResultsCountSummary(searchResultTotal, '部电影', 'movie-results-count'));

    const grid = createEl('div', { className: 'movie-results-grid' });
    allMovies.forEach((movie, index) => {
        grid.appendChild(createMovieCard(movie, index));
    });

    resultsDiv.appendChild(grid);
    scheduleRatingNameScrollSync(grid);

    updatePagination();
    setupDropdownPositioning();
}

function setupDropdownPositioning() {
    document.addEventListener('mouseover', function(e) {
        const dropdown = e.target.closest('.dropdown');
        if (!dropdown) return;

        const menu = dropdown.querySelector('.dropdown-menu');
        if (!menu) return;

        const viewportHeight = window.innerHeight;
        const dropdownRect = dropdown.getBoundingClientRect();
        const menuHeight = menu.offsetHeight;
        const spaceBelow = viewportHeight - dropdownRect.bottom;

        menu.style.bottom = 'auto';
        menu.style.top = 'auto';

        if (spaceBelow < menuHeight && dropdownRect.top > menuHeight) {
            menu.style.bottom = '100%';
            menu.style.marginBottom = '5px';
        } else {
            menu.style.top = '100%';
            menu.style.marginTop = '5px';
        }

        menu.style.left = '0';
        menu.style.right = 'auto';

        const menuRect = menu.getBoundingClientRect();
        if (menuRect.right > window.innerWidth) {
            menu.style.left = 'auto';
            menu.style.right = '0';
        }
    });
}
