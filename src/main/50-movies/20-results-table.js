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
    searchResultTotal = 0;

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

    resultsDiv.appendChild(createResultsCountSummary(searchResultTotal, '部电影', 'movie-results-count'));

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
