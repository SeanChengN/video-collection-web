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
        attrs: { role: 'navigation', 'aria-label': '分页导航' }
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
