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
