// 全局错误处理
window.onerror = function(msg, url, lineNo, columnNo, error) {
    console.error('Error: ', msg, '\nURL: ', url, '\nLine: ', lineNo, '\nColumn: ', columnNo, '\nError object: ', error);
    return false;
};

// API 请求错误处理封装
async function safeApiFetch(url, options = {}) {
    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('API request failed:', error);
        throw error;
    }
}

// 缓存优化
const cache = new Map();

async function cachedFetch(url, options = {}) {
    const cacheKey = url + JSON.stringify(options);
    if (cache.has(cacheKey)) {
        return cache.get(cacheKey);
    }
    
    const response = await safeApiFetch(url, options);
    cache.set(cacheKey, response);
    return response;
}


// 图片懒加载观察器
function clearElement(element) {
    if (!element) return;
    while (element.firstChild) {
        element.removeChild(element.firstChild);
    }
}

function appendChildren(parent, children = []) {
    children.forEach(child => {
        if (child === null || child === undefined || child === false) return;
        parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return parent;
}

function createEl(tagName, options = {}, children = []) {
    const element = document.createElement(tagName);
    const {
        className,
        text,
        attrs = {},
        dataset = {},
        props = {}
    } = options;

    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    Object.entries(attrs).forEach(([name, value]) => {
        if (value === false || value === null || value === undefined) return;
        if (value === true) {
            element.setAttribute(name, '');
        } else {
            element.setAttribute(name, String(value));
        }
    });
    Object.entries(dataset).forEach(([name, value]) => {
        if (value !== null && value !== undefined) {
            element.dataset[name] = String(value);
        }
    });
    Object.entries(props).forEach(([name, value]) => {
        element[name] = value;
    });

    return appendChildren(element, children);
}

function createSpriteSvg(iconId, options = {}) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const {
        width = 14,
        height = 14,
        fill = 'currentColor',
        ariaLabel = ''
    } = options;

    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('fill', fill);
    svg.setAttribute('stroke', 'none');
    if (ariaLabel) {
        svg.setAttribute('aria-label', ariaLabel);
    }

    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `../static/sprite.svg#${iconId}`);
    svg.appendChild(use);
    return svg;
}

function createActionButton({ className, text, action, dataset = {}, children = [] }) {
    const button = createEl('button', {
        className,
        attrs: { type: 'button' },
        dataset: { action, ...dataset }
    });

    if (children.length) {
        appendChildren(button, children);
    } else {
        button.appendChild(createEl('span', { text }));
    }
    return button;
}

function createNotification(type, message) {
    return createEl('div', {
        className: `notification is-${type}`,
        text: message
    });
}

function setNotification(container, type, message) {
    if (!container) return;
    clearElement(container);
    container.appendChild(createNotification(type, message));
}

function createStarsFragment(rating) {
    const fragment = document.createDocumentFragment();
    const safeRating = Number(rating) || 0;
    for (let i = 1; i <= 5; i++) {
        fragment.appendChild(createSpriteSvg('rating-star-icon', {
            width: 16,
            height: 16,
            fill: i <= safeRating ? getStarColor(safeRating) : '#d3d3d3',
            ariaLabel: '星级'
        }));
    }
    return fragment;
}

const imageObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const img = entry.target;
            if (!img.src || img.src === 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7') {
                img.src = img.dataset.src;
                observer.unobserve(img);
            }
        }
    });
}, {
    rootMargin: '50px 0px', // 提前50px加载
    threshold: 0.1
});

// alert弹窗封装
function showAlert(options = {}) {
    const {
        title = '提示',
        message = '',
        type = 'info', // success, error, warning, info
        confirmText = '确认',
        cancelText = '取消',
        showCancel = true,
        onConfirm = () => {},
        onCancel = () => {}
    } = options;

    const container = document.getElementById('alert-container');
    const icon = container.querySelector('.alert-icon');
    const iconSvg = icon.querySelector('svg use');
    const titleEl = container.querySelector('.alert-title');
    const messageEl = container.querySelector('.alert-message');
    const confirmBtn = container.querySelector('.confirm-btn');
    const cancelBtn = container.querySelector('.cancel-btn');

    // 设置图标类型样式
    icon.className = `alert-icon ${type}`;
    iconSvg.setAttribute('href', `../static/sprite.svg#alert-${type}-icon`);

    // 设置按钮样式
    confirmBtn.className = `confirm-btn ${type}`;
    
    // 设置内容
    titleEl.textContent = title;
    messageEl.textContent = message;
    confirmBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;
    
    // 显示/隐藏取消按钮
    cancelBtn.style.display = showCancel ? 'block' : 'none';
    
    // 绑定事件
    confirmBtn.onclick = () => {
        onConfirm();
        container.style.display = 'none';
    };
    
    cancelBtn.onclick = () => {
        onCancel();
        container.style.display = 'none';
    };

    // 显示alert
    container.style.display = 'flex';
}

// 模态框管理器
const ModalManager = {
    activeModals: new Map(),
    minimizedModals: new Set(),
    baseZIndex: 1000, // 基础层级值

    open(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;

        requestAnimationFrame(() => {
            const modalCard = modal.querySelector('.modal-card');
            const toolbarButton = this.getToolbarButton(modalId);

            // 如果窗口最小化状态，则直接还原窗口
            if (toolbarButton && this.minimizedModals.has(modalId)) {
                this.restoreModal(modalId);
                return;
            }

            // 获取所有模态框(包括最小化的)的最大z-index
            const allModals = document.querySelectorAll('.modal');
            const maxZIndex = Math.max(
                this.baseZIndex,
                ...Array.from(allModals).map(m => 
                    parseInt(window.getComputedStyle(m).zIndex) || 0
                )
            );

            // 计算并设置新窗口的z-index
            const newZIndex = maxZIndex + 10;
            modal.style.zIndex = newZIndex;
            modal.classList.add('is-active');

            // 重置模态框位置
            if (modalCard) {
                // 清除可能影响定位的样式
                modalCard.style.visibility = 'hidden';
                modalCard.style.position = 'absolute';
                modalCard.style.transform = 'none';
                modalCard.style.margin = '0';

                // 确保模态窗口内容可以滚动
                modalCard.style.maxHeight = '90vh';
                modalCard.style.overflowY = 'auto';

                // 计算窗口位置
                const viewportWidth = window.innerWidth;
                const viewportHeight = window.innerHeight;
                const modalWidth = modalCard.offsetWidth;
                const modalHeight = modalCard.offsetHeight;

                // 设置初始位置在屏幕中心
                modalCard.style.left = `${Math.max(0, (viewportWidth - modalWidth) / 2)}px`;
                modalCard.style.top = `${Math.max(0, (viewportHeight - modalHeight) / 2)}px`;
                modalCard.style.visibility = 'visible';                            
            }

            // 激活对应的工具栏按钮
            if (toolbarButton) {
                toolbarButton.classList.add('is-active');
            }

            this.activeModals.set(modalId, { 
                isMinimized: false,
                zIndex: newZIndex
            });
        });
    },

    // 最小化窗口
    minimize(modalId) {
        const modal = document.getElementById(modalId);
        const modalCard = modal.querySelector('.modal-card');
        const toolbarButton = this.getToolbarButton(modalId);
        
        if (modal && toolbarButton) {
            // 保存当前窗口位置和大小
            const rect = modalCard.getBoundingClientRect();
            this.activeModals.set(modalId, {
                isMinimized: true,
                rect: rect
            });

            // 获取工具栏按钮的位置
            const buttonRect = toolbarButton.getBoundingClientRect();
            
            // 使用 transform3d 触发 GPU 加速
            modalCard.style.transform = `translate3d(0, 0, 0)`;
            modalCard.classList.add('minimizing');
            
            requestAnimationFrame(() => {
                const scaleX = buttonRect.width / rect.width;
                const scaleY = buttonRect.height / rect.height;
                const translateX = buttonRect.left - rect.left;
                const translateY = buttonRect.top - rect.top;

                modalCard.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) scale(${scaleX}, ${scaleY})`;
                modalCard.style.opacity = '0';
            });

            setTimeout(() => {
                modal.classList.remove('is-active');
                modalCard.classList.remove('minimizing');
                this.minimizedModals.add(modalId);
            }, 300);
        }
    },

    // 还原窗口
    restoreModal(modalId) {
        const modal = document.getElementById(modalId);
        const modalCard = modal.querySelector('.modal-card');
        const savedState = this.activeModals.get(modalId);
        
        if (modal && savedState && savedState.rect) {
            // 计算新的最高层级
            const allModals = document.querySelectorAll('.modal');
            const maxZIndex = Math.max(
                this.baseZIndex,
                ...Array.from(allModals).map(m => 
                    parseInt(window.getComputedStyle(m).zIndex) || 0
                )
            );
            const newZIndex = maxZIndex + 10;
            modal.style.zIndex = newZIndex;

            // 还原窗口动画
            modal.classList.add('is-active');
            modalCard.classList.add('minimizing');
            
            const toolbarButton = this.getToolbarButton(modalId);
            const buttonRect = toolbarButton.getBoundingClientRect();
            
            requestAnimationFrame(() => {
                modalCard.style.transform = `translate3d(${buttonRect.left - savedState.rect.left}px, ${buttonRect.top - savedState.rect.top}px, 0) scale(${buttonRect.width / savedState.rect.width}, ${buttonRect.height / savedState.rect.height})`;
                modalCard.style.opacity = '0';
                
                // 强制重排
                modalCard.offsetHeight;
                
                requestAnimationFrame(() => {
                    modalCard.style.transform = 'translate3d(0, 0, 0)';
                    modalCard.style.opacity = '1';
                });
            });

            setTimeout(() => {
                modalCard.classList.remove('minimizing');
                this.minimizedModals.delete(modalId);

                // 更新状态
                this.activeModals.set(modalId, {
                    isMinimized: false,
                    zIndex: newZIndex,
                    rect: savedState.rect  // 保留位置信息
                });
            }, 300);
        }
    },

    // 关闭窗口
    close(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('is-active');
            const toolbarButton = this.getToolbarButton(modalId);
            if (toolbarButton) {
                toolbarButton.classList.remove('is-active');
            }
        }
        this.activeModals.delete(modalId);
        this.minimizedModals.delete(modalId);
    },
    
    getToolbarButton(modalId) {
        // 获取对应的工具栏按钮
        const buttonMap = {
            'duplicateModal': '[onclick*="openDuplicateModal"]',
            'jackettModal': '[onclick*="openJackettModal"]',
            'wtlModal': '[onclick*="openWtlModal"]',
            'thunderModal': '[onclick*="openThunderModal"]',
            'embyModal': '[onclick*="openEmbyModal"]',
            'thumbnailModal': '[onclick*="openThumbnailModal"]',
            'settingsModal': '[onclick*="openSettingsModal"]'
        };
        const selector = buttonMap[modalId];
        return selector ? document.querySelector(selector) : null;
    }
};

// 最小化模态框
function minimizeModal(modalId) {
    ModalManager.minimize(modalId);
}

// 延迟加载非关键CSS
function loadDeferredStyles() {
    const stylesheets = [
        '../static/styles.min.css',
        'https://cdn.jsdelivr.net/npm/bulma@0.9.4/css/bulma.min.css'
    ];
    
    stylesheets.forEach(href => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        document.head.appendChild(link);
    });
}

// 在页面加载完成后执行
if (window.addEventListener) {
    window.addEventListener('load', loadDeferredStyles);
} else {
    window.attachEvent('onload', loadDeferredStyles);
}

const itemsPerPage = 10; // 每页显示10条
let currentPage = 1;
let totalPages = 0;
function buildImageUrl(filename) {
    const parts = String(filename || '')
        .trim()
        .split('/')
        .filter(part => part);
    if (parts.length === 0) {
        return '';
    }
    return `../images/${parts.map(part => encodeURIComponent(part)).join('/')}`;
}
let allMovies = []; // 存储所有搜索结果

// 定义全局配置变量
let dynamicDelegatesInitialized = false;

function initDynamicEventDelegates() {
    if (dynamicDelegatesInitialized) return;
    dynamicDelegatesInitialized = true;

    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal) {
        settingsModal.addEventListener('click', event => {
            const actionElement = event.target.closest('[data-action]');
            if (!actionElement || !settingsModal.contains(actionElement)) return;

            const row = actionElement.closest('tr');
            switch (actionElement.dataset.action) {
                case 'start-setting-edit':
                    startEdit(actionElement);
                    break;
                case 'cancel-setting-edit':
                    cancelEdit(actionElement);
                    break;
                case 'save-tag':
                    saveTagEdit(actionElement, row ? row.dataset.name : '');
                    break;
                case 'save-rating':
                    saveRatingEdit(actionElement, row ? row.dataset.name : '');
                    break;
                case 'delete-tag':
                    deleteTag(actionElement);
                    break;
                case 'delete-rating-dimension':
                    deleteRatingDimension(actionElement);
                    break;
            }
        });
    }

    const searchResults = document.getElementById('search-results');
    if (searchResults) {
        searchResults.addEventListener('click', event => {
            const actionElement = event.target.closest('[data-action]');
            if (!actionElement || !searchResults.contains(actionElement)) return;

            if (actionElement.dataset.action === 'edit-movie') {
                const index = Number(actionElement.dataset.movieIndex);
                if (Number.isInteger(index) && allMovies[index]) {
                    openModal(allMovies[index]);
                }
            }

            if (actionElement.dataset.action === 'open-image-viewer') {
                openImageViewer(actionElement.dataset.images || '', actionElement.dataset.title || '');
            }
        });

        searchResults.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            const actionElement = event.target.closest('[data-action="open-image-viewer"]');
            if (!actionElement || !searchResults.contains(actionElement)) return;
            event.preventDefault();
            openImageViewer(actionElement.dataset.images || '', actionElement.dataset.title || '');
        });
    }

    const pagination = document.getElementById('pagination');
    if (pagination) {
        pagination.addEventListener('click', event => {
            const pageElement = event.target.closest('[data-action="change-page"]');
            if (!pageElement || !pagination.contains(pageElement)) return;
            event.preventDefault();
            if (pageElement.hasAttribute('disabled') || pageElement.getAttribute('aria-disabled') === 'true') return;
            changePage(Number(pageElement.dataset.page));
        });
    }

    const duplicateTable = document.getElementById('duplicate-table');
    if (duplicateTable) {
        duplicateTable.addEventListener('click', event => {
            const copyButton = event.target.closest('[data-action="copy-extra"]');
            if (!copyButton || !duplicateTable.contains(copyButton)) return;
            copyToClipboard(copyButton.dataset.copyValue || '', copyButton);
        });
    }
}

let serviceConfig = {};

// 页面加载时获取所有服务配置
callApi(event_map.get_services_config)
    .then(result => {
        if (result.success) {
            serviceConfig = result.data;
        }
    });


// 窗口拖拽相关代码
let zIndexCounter = 1000;

function makeDraggable(modal) {
    const modalCard = modal.querySelector('.modal-card');
    const modalHead = modal.querySelector('.modal-card-head');
    let isDragging = false;
    let initialX;
    let initialY;
    let currentX;
    let currentY;
    let animationFrameId = null; // 用于requestAnimationFrame
    
    // 为整个模态框添加点击事件
    modal.addEventListener('mousedown', () => {
        zIndexCounter += 1;
        modal.style.zIndex = zIndexCounter;
        modalCard.style.zIndex = zIndexCounter;
    });

    function dragStart(e) {
        if (e.target.closest('.modal-card-controls')) {
            return; // 如果点击的是控制按钮，不启动拖拽
        }
        
        if (e.target === modalHead || e.target.closest('.modal-card-head')) {
            isDragging = true;
            
            // 获取当前位置
            const rect = modalCard.getBoundingClientRect();
            currentX = rect.left;
            currentY = rect.top;
            
            initialX = e.clientX - currentX;
            initialY = e.clientY - currentY;

            // 添加拖拽时的样式
            modalCard.classList.add('dragging');
            document.body.style.cursor = 'move';

            zIndexCounter += 1;
            modal.style.zIndex = zIndexCounter;
            modalCard.style.zIndex = zIndexCounter;
        }
    }

    function drag(e) {
        if (!isDragging) return;
        e.preventDefault();

        // 计算新位置
        const newX = e.clientX - initialX;
        const newY = e.clientY - initialY;

        // 保存当前位置
        currentX = newX;
        currentY = newY;

        // 使用 requestAnimationFrame 更新位置
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }

        animationFrameId = requestAnimationFrame(() => {
            modalCard.style.position = 'fixed'; // 使用 fixed 定位
            modalCard.style.left = `${newX}px`;
            modalCard.style.top = `${newY}px`;
        });
    }

    function dragEnd() {
        if (!isDragging) return;
        isDragging = false;

        // 清除拖拽时的样式
        document.body.style.cursor = '';
        modalCard.classList.remove('dragging');

        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
    }
    
    // 鼠标事件不需要passive, 因为它们不会阻止默认行为
    modalHead.addEventListener('mousedown', dragStart);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', dragEnd);

    // 清理函数
    return function cleanup() {
        modalHead.removeEventListener('mousedown', dragStart);
        document.removeEventListener('mousemove', drag);
        document.removeEventListener('mouseup', dragEnd);
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }
    };
}

// 为每个模态框添加拖拽功能
document.addEventListener('DOMContentLoaded', () => {
    const modals = [
        'duplicateModal',
        'jackettModal',
        'wtlModal',
        'thunderModal',
        'embyModal',
        'thumbnailModal',
        'embyPlayerModal',
        'editModal',
        'settingsModal',
        'imageViewerModal'
    ];
    
    modals.forEach(modalId => {
        const modal = document.getElementById(modalId);
        makeDraggable(modal);
    });
});

// 查重核对相关代码
function openDuplicateModal() {
    if (ModalManager.minimizedModals.has('duplicateModal')) {
        ModalManager.restoreModal('duplicateModal');
    } else {
        ModalManager.open('duplicateModal');
    }
}

function closeDuplicateModal() {
    // 清空输入框
    document.getElementById('duplicate-input').value = '';
    // 清空结果区域
    document.getElementById('check-result').innerHTML = '<span class="has-text-grey-light">等待核对...</span>';
    // 清空表格区域
    document.getElementById('duplicate-table').innerHTML = '';
    // 关闭模态框
    ModalManager.close('duplicateModal');
}

function checkDuplicates() {
    const input = document.getElementById('duplicate-input');
    const resultDiv = document.getElementById('check-result');
    const tableDiv = document.getElementById('duplicate-table');
    const movies = input.value.split('\n').filter(line => line.trim());
    
    if (movies.length === 0) {
        resultDiv.innerHTML = '<span class="has-text-danger">请输入电影列表</span>';
        tableDiv.innerHTML = '';
        return;
    }
    
    const button = document.querySelector('#duplicateModal .dupStart-btn');
    const originalHtml = button.innerHTML; 
    button.disabled = true;
    resultDiv.innerHTML = '<span class="has-text-info">正在核对...</span>';
    
    // 解析每行内容,分离电影名和其他信息
    const movieData = movies.map(line => {
        const parts = line.trim().split(' ');
        return {
            title: parts[0],
            extra: parts.slice(1).join(' ')
        };
    });

    callApi(event_map.check_duplicates, { titles: movieData.map(m => m.title) })
        .then(result => {
            if (result.success) {
                const duplicateCount = result.duplicates.length;
                const newMovies = movieData.filter(movie => 
                    !result.duplicates.includes(movie.title)
                ).map(movie => ({
                    ...movie,
                    matchedTitle: ''  // 非重复项无匹配名称
                }));

                const duplicateMovies = movieData
                .filter(movie => result.duplicates.includes(movie.title))
                .map(movie => ({
                    ...movie,
                    matchedTitle: result.matched_titles[movie.title] || movie.title
                }));

                // 更新统计信息
                resultDiv.innerHTML = `
                    <div class="notification is-success">
                        <p>核对完成！</p>
                        <p>发现 <strong>${duplicateCount}</strong> 个重复项</p>
                        <p>剩余 <strong>${newMovies.length}</strong> 个未收录项</p>
                    </div>
                `;
                
                // 更新表格内容
                tableDiv.innerHTML = `
                <table class="table is-fullwidth is-striped is-hoverable">
                    <colgroup>
                        <col style="width: 15%">
                        <col style="width: 15%">
                        <col style="width: 62%">
                        <col style="width: 8%">
                    </colgroup>
                    <thead>
                        <tr>
                            <th>电影名称</th>
                            <th>匹配名称</th>
                            <th>磁力链接</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${newMovies.map(movie => `
                            <tr>
                                <td title="${escapeHtml(movie.title)}">${escapeHtml(movie.title)}</td>
                                <td title="${escapeHtml(movie.matchedTitle || '')}">${escapeHtml(movie.matchedTitle || '')}</td>
                                <td title="${escapeHtml(movie.extra)}">${escapeHtml(movie.extra)}</td>
                                <td>
                                    <button class="button is-small copy-btn" type="button" data-action="copy-extra" data-copy-value="${escapeHtml(movie.extra)}">
                                        <span class="icon">
                                            <svg width="20" height="20" fill="#888888" stroke="none" aria-label="复制">
                                                <use href="../static/sprite.svg#copy-btn-icon"></use>
                                            </svg>
                                        </span>
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                        ${result.duplicates.length > 0 ? `
                            <tr class="duplicate-separator">
                                <td colspan="4">以下为重复项</td>
                            </tr>
                            ${duplicateMovies.map(movie => `
                                <tr class="is-duplicate">
                                    <td title="${escapeHtml(movie.title)}">${escapeHtml(movie.title)}</td>
                                    <td title="${escapeHtml(movie.matchedTitle)}">${escapeHtml(movie.matchedTitle)}</td>
                                    <td title="${escapeHtml(movie.extra)}">${escapeHtml(movie.extra)}</td>
                                    <td>
                                        <button class="button is-small copy-btn" type="button" data-action="copy-extra" data-copy-value="${escapeHtml(movie.extra)}">
                                            <span class="icon">
                                                <svg width="20" height="20" fill="#888888" stroke="none" aria-label="复制">
                                                    <use href="../static/sprite.svg#copy-btn-icon"></use>
                                                </svg>
                                            </span>
                                        </button>
                                    </td>
                                </tr>
                            `).join('')}
                        ` : ''}
                    </tbody>
                </table>
            `;
            }
        })
        .catch(error => {
            resultDiv.innerHTML = '<div class="notification is-danger is-light">核对过程出错，请重试</div>';
            showAlert({
                title: '核对失败',
                message: error.message || '核对过程出错',
                type: 'error',
                showCancel: false
            });
        })
        .finally(() => {
            button.innerHTML = originalHtml;
            button.disabled = false;
        });
}

// 复制内容到剪贴板
async function copyToClipboard(text, button) {
    //const originalHtml = button.innerHTML;

    // 创建临时文本框
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);

    try {
        textarea.select();
        document.execCommand('copy');
        // 修改按钮显示成功
        button.innerHTML = '<span class="icon"><svg width="20" height="20" fill="#fff"><use href="../static/sprite.svg#copy-success-btn-icon"></use></svg></span>';
        button.classList.add('is-success'); // 添加成功样式
    } catch (err) {
        // 修改按钮显示失败
        button.innerHTML = '<span class="icon"><svg width="20" height="20" fill="#fff"><use href="../static/sprite.svg#copy-fail-btn-icon"></use></svg></span>';
        button.classList.add('is-danger'); // 添加失败样式
    }
    
    // 清理临时元素
    document.body.removeChild(textarea);
    
    // 5秒后恢复按钮原样
    //setTimeout(() => {
    //    button.innerHTML = originalHtml;
    //}, 5000);
}

// Emby搜索相关代码
function openEmbyModal() {
    if (ModalManager.minimizedModals.has('embyModal')) {
        ModalManager.restoreModal('embyModal');
    } else {
        ModalManager.open('embyModal');
    }
}

function closeEmbyModal() {
    ModalManager.close('embyModal');
    clearEmbyModalState();
}

const EMBY_MODAL_DEFAULT_HEIGHT_RATIO = 0.3;
const EMBY_MODAL_MAX_HEIGHT_RATIO = 0.9;
let embySearchRequestId = 0;

function centerEmbyModal() {
    const modal = document.getElementById('embyModal');
    const modalCard = modal?.querySelector('.modal-card');
    if (!modalCard || !modal.classList.contains('is-active')) return;

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const modalWidth = modalCard.offsetWidth;
    const modalHeight = modalCard.offsetHeight;

    modalCard.style.left = `${Math.max(0, (viewportWidth - modalWidth) / 2)}px`;
    modalCard.style.top = `${Math.max(0, (viewportHeight - modalHeight) / 2)}px`;
}

function resetEmbyModalHeight() {
    const modal = document.getElementById('embyModal');
    const modalCard = modal?.querySelector('.modal-card');
    const modalBody = modal?.querySelector('.modal-card-body');
    if (!modalCard) return;

    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    modalCard.style.height = `${Math.round(viewportHeight * EMBY_MODAL_DEFAULT_HEIGHT_RATIO)}px`;
    modalCard.style.maxHeight = `${Math.round(viewportHeight * EMBY_MODAL_MAX_HEIGHT_RATIO)}px`;
    modalCard.style.overflow = 'hidden';
    modalCard.style.overflowY = 'hidden';
    if (modalBody) {
        modalBody.scrollTop = 0;
    }
    centerEmbyModal();
}

function clearEmbyModalState() {
    embySearchRequestId += 1;
    const input = document.getElementById('emby-search-input');
    const resultsDiv = document.getElementById('emby-results');
    const modalBody = document.querySelector('#embyModal .modal-card-body');

    if (input) {
        input.value = '';
    }
    if (resultsDiv) {
        resultsDiv.innerHTML = '';
    }
    if (modalBody) {
        modalBody.scrollTop = 0;
    }
    resetEmbyModalHeight();
}

function resizeEmbyModalForResults() {
    const modal = document.getElementById('embyModal');
    const modalCard = modal?.querySelector('.modal-card');
    const modalHead = modal?.querySelector('.modal-card-head');
    const modalBody = modal?.querySelector('.modal-card-body');
    if (!modalCard || !modalHead || !modalBody) return;

    modalBody.scrollTop = 0;

    requestAnimationFrame(() => {
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        const minHeight = Math.round(viewportHeight * EMBY_MODAL_DEFAULT_HEIGHT_RATIO);
        const maxHeight = Math.round(viewportHeight * EMBY_MODAL_MAX_HEIGHT_RATIO);
        const contentHeight = modalHead.offsetHeight + modalBody.scrollHeight;
        const targetHeight = Math.min(Math.max(contentHeight, minHeight), maxHeight);

        modalCard.style.height = `${targetHeight}px`;
        modalCard.style.maxHeight = `${maxHeight}px`;
        modalCard.style.overflow = 'hidden';
        modalCard.style.overflowY = 'hidden';
        centerEmbyModal();
    });
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

function openEmbyPlayer(streamUrl, title) {
    const modal = document.getElementById('embyPlayerModal');
    const video = document.getElementById('emby-player-video');
    const titleElement = modal?.querySelector('.modal-card-title');
    if (!modal || !video || !streamUrl) return;

    if (titleElement) {
        titleElement.textContent = title ? `Emby: ${title}` : 'Emby Player';
    }

    video.pause();
    video.removeAttribute('src');
    video.load();
    video.src = streamUrl;

    ModalManager.open('embyPlayerModal');
    requestAnimationFrame(() => {
        video.play().catch(() => {});
    });
}

function closeEmbyPlayerModal() {
    const video = document.getElementById('emby-player-video');
    if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
    }
    ModalManager.close('embyPlayerModal');
}

function searchEmby() {
    const query = document.getElementById('emby-search-input').value;
    const resultsDiv = document.getElementById('emby-results');
    const requestId = ++embySearchRequestId;
    
    if (!query.trim()) {
        resetEmbyModalHeight();
        resultsDiv.innerHTML = '<div class="notification is-warning">请输入搜索内容</div>';
        return;
    }
    
    resultsDiv.innerHTML = '<div class="notification is-info">正在搜索...</div>';
    
    callApi(event_map.search_emby, { query })
        .then(result => {
            if (requestId !== embySearchRequestId) return;

            if (!result.success) {
                throw new Error(result.message || 'Emby search failed');
            }

            const items = result.data?.items || [];
            if (items.length === 0) {
                resetEmbyModalHeight();
                resultsDiv.innerHTML = '<div class="notification is-info">未找到相关影片</div>';
                return;
            }
            
            const fragment = document.createDocumentFragment();
            const container = document.createElement('div');
            container.className = 'columns is-multiline';
            
            items.forEach(movie => {
                const column = document.createElement('div');
                column.className = 'column emby-result-column';
                const movieName = movie.name || '';
                const imageUrl = movie.imageUrl || '';
                const streamUrl = movie.streamUrl || '';
                const cardClass = streamUrl ? 'card movie-card emby-playable-card' : 'card movie-card emby-unplayable-card';
                const cardAttributes = streamUrl
                    ? `role="button" tabindex="0" aria-label="播放 ${escapeHtml(movieName)}"`
                    : 'aria-disabled="true"';
                column.innerHTML = `
                    <div class="${cardClass}" ${cardAttributes}>
                        <div class="card-image">
                            <figure class="image is-2by3">
                                <img data-src="${escapeHtml(imageUrl)}"
                                     alt="${escapeHtml(movieName)}"
                                     src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
                                <div class="runtime-badge">${formatRuntime(movie.runtimeTicks)}</div>
                            </figure>
                        </div>
                        <div class="card-content fixed-height emby-card-content">
                            <p class="title is-6 movie-title" data-full-title="${escapeHtml(movieName)}">${escapeHtml(movieName)}</p>
                        </div>
                    </div>
                `;
                
                // 为新加载的图片添加懒加载观察
                const img = column.querySelector('img');
                if (img && imageUrl) {
                    imageObserver.observe(img);
                }
                const movieCard = column.querySelector('.movie-card');
                if (movieCard && streamUrl) {
                    const playMovie = () => openEmbyPlayer(streamUrl, movieName);
                    movieCard.addEventListener('click', playMovie);
                    movieCard.addEventListener('keydown', event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            playMovie();
                        }
                    });
                }
                
                container.appendChild(column);
            });
            
            fragment.appendChild(container);
            resultsDiv.innerHTML = '';
            resultsDiv.appendChild(fragment);
            resizeEmbyModalForResults();
        })
        .catch(error => {
            if (requestId !== embySearchRequestId) return;

            resetEmbyModalHeight();
            resultsDiv.innerHTML = '<div class="notification is-danger">搜索出错，请稍后重试</div>';
            showAlert({
                title: '搜索出错',
                message: error.message || '搜索过程出错',
                type: 'error',
                showCancel: false
            });
        });
}

function formatRuntime(ticks) {
    if (!ticks) return '';
    const minutes = Math.floor(ticks / (10000000 * 60));
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return hours > 0 ? 
        `${hours}时${remainingMinutes}分` : 
        `${remainingMinutes}分钟`;
}

function openJackettModal() {
    if (ModalManager.minimizedModals.has('jackettModal')) {
        ModalManager.restoreModal('jackettModal');
    } else {
        ModalManager.open('jackettModal');
        const route = serviceConfig.service_routes?.jackett || '/services/jackett';
        document.querySelector('#jackettModal iframe').src = `${route}?path=${encodeURIComponent('/UI/Dashboard#search')}`;
    }
}

function closeJackettModal() {
    ModalManager.close('jackettModal');
}

function openThunderModal() {
    if (ModalManager.minimizedModals.has('thunderModal')) {
        ModalManager.restoreModal('thunderModal');
    } else {
        ModalManager.open('thunderModal');
        const route = serviceConfig.service_routes?.thunder || '/services/thunder';
        document.querySelector('#thunderModal iframe').src = route;
    }
}

function closeThunderModal() {
    ModalManager.close('thunderModal');
}

// What's the link?查询相关代码
function openWtlModal() {
    if (ModalManager.minimizedModals.has('wtlModal')) {
        ModalManager.restoreModal('wtlModal');
    } else {
        ModalManager.open('wtlModal');
        document.getElementById('wtl-input').value = '';
        document.getElementById('wtl-results').innerHTML = '';
        resetWtlModalHeight();
    }
}

function closeWtlModal() {
    ModalManager.close('wtlModal');
}

const WTL_MODAL_DEFAULT_HEIGHT_RATIO = 0.3;
const WTL_MODAL_MAX_HEIGHT_RATIO = 0.9;

function centerWtlModal() {
    const modal = document.getElementById('wtlModal');
    const modalCard = modal?.querySelector('.modal-card');
    if (!modalCard || !modal.classList.contains('is-active')) return;

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const modalWidth = modalCard.offsetWidth;
    const modalHeight = modalCard.offsetHeight;

    modalCard.style.left = `${Math.max(0, (viewportWidth - modalWidth) / 2)}px`;
    modalCard.style.top = `${Math.max(0, (viewportHeight - modalHeight) / 2)}px`;
}

function resetWtlModalHeight() {
    const modal = document.getElementById('wtlModal');
    const modalCard = modal?.querySelector('.modal-card');
    const modalBody = modal?.querySelector('.modal-card-body');
    if (!modalCard) return;

    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    modalCard.style.height = `${Math.round(viewportHeight * WTL_MODAL_DEFAULT_HEIGHT_RATIO)}px`;
    modalCard.style.maxHeight = `${Math.round(viewportHeight * WTL_MODAL_MAX_HEIGHT_RATIO)}px`;
    modalCard.style.overflow = 'hidden';
    modalCard.style.overflowY = 'hidden';
    if (modalBody) {
        modalBody.scrollTop = 0;
    }
    centerWtlModal();
}

function resizeWtlModalForResults() {
    const modal = document.getElementById('wtlModal');
    const modalCard = modal?.querySelector('.modal-card');
    const modalHead = modal?.querySelector('.modal-card-head');
    const modalBody = modal?.querySelector('.modal-card-body');
    if (!modalCard || !modalHead || !modalBody) return;

    requestAnimationFrame(() => {
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        const minHeight = Math.round(viewportHeight * WTL_MODAL_DEFAULT_HEIGHT_RATIO);
        const maxHeight = Math.round(viewportHeight * WTL_MODAL_MAX_HEIGHT_RATIO);
        const contentHeight = modalHead.offsetHeight + modalBody.scrollHeight;
        const targetHeight = Math.min(Math.max(contentHeight, minHeight), maxHeight);

        modalCard.style.height = `${targetHeight}px`;
        modalCard.style.maxHeight = `${maxHeight}px`;
        modalCard.style.overflow = 'hidden';
        modalCard.style.overflowY = 'hidden';
        centerWtlModal();
    });
}

function searchWtl() {
    const query = document.getElementById('wtl-input').value;
    const resultsDiv = document.getElementById('wtl-results');
    
    if (!query.trim()) {
        resetWtlModalHeight();
        resultsDiv.innerHTML = '<div class="notification is-warning">请输入链接</div>';
        return;
    }
    
    resultsDiv.innerHTML = '<div class="notification is-info">正在查询...</div>';
    
    fetch(`https://whatslink.info/api/v1/link?url=${encodeURIComponent(query)}`)
        .then(response => response.json())
        .then(data => {
            resultsDiv.innerHTML = `
                <div class="box">
                    <div class="content">
                        <p><strong>文件类型:</strong> ${data.file_type}</p>
                        <p><strong>资源名称:</strong> ${data.name}</p>
                        <p><strong>总文件大小:</strong> ${formatFileSize(data.size)}</p>
                        <p><strong>文件数量:</strong> ${data.count}</p>
                    </div>
                    ${renderScreenshots(data.screenshots)}
                </div>
            `;
            resultsDiv.querySelectorAll('img').forEach(img => {
                if (!img.complete) {
                    img.addEventListener('load', resizeWtlModalForResults, { once: true });
                    img.addEventListener('error', resizeWtlModalForResults, { once: true });
                }
            });
            resizeWtlModalForResults();
        })
        .catch(error => {
            resetWtlModalHeight();
            resultsDiv.innerHTML = '<div class="notification is-danger">查询失败，请检查链接是否正确</div>';
            showAlert({
                title: '查询失败',
                message: error.message || '查询过程出错',
                type: 'error',
                showCancel: false
            });
        });
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function renderScreenshots(screenshots) {
    if (!screenshots || screenshots.length === 0) return '';
    
    return `
        <div class="screenshots">
            ${screenshots.map(shot => `
                <div class="screenshot-item">
                    <img src="${shot.screenshot}" alt="截图">
                </div>
            `).join('')}
        </div>
    `;
}

function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}


// 设置功能相关代码
function openSettingsModal() {
    ModalManager.open('settingsModal');
    loadSettings();
}

function closeSettingsModal() {
    ModalManager.close('settingsModal');
    refreshMainSettingsData();
}

function refreshMainSettingsData() {
    Promise.all([
        loadTags(),
        loadRatingsDimensions(),
        loadFilters()
    ]).then(() => {
        if (allMovies.length > 0) {
            searchMovies(currentPage);
        }
    });
}

document.addEventListener('DOMContentLoaded', function() {
    // 标签页切换
    const tabs = document.querySelector('.settings-tabs');
    const contents = document.querySelectorAll('.settings-content');
    
    tabs.addEventListener('click', e => {
        const tab = e.target.closest('[data-tab]');
        if (!tab) return;
        
        // 更新标签页状态
        tabs.querySelectorAll('li').forEach(li => li.classList.remove('is-active'));
        tab.classList.add('is-active');
        
        // 显示对应内容
        const targetId = tab.dataset.tab + 'Settings';
        contents.forEach(content => {
            content.style.display = content.id === targetId ? '' : 'none';
        });
    });
});

// 加载设置内容
function loadSettings() {
    return Promise.all([
        loadSettingsTags(),
        loadSettingsRatingDimensions()
    ]);
}

// 开始编辑
function startEdit(button) {
    const tr = button.closest('tr');  // 现在是找最近的 tr 元素
    const nameDiv = tr.querySelector('.tag-name, .rating-name');
    const editForm = tr.querySelector('.edit-form');
    
    nameDiv.style.display = 'none';
    editForm.style.display = 'flex';
    editForm.querySelector('input').focus();
}

// 取消编辑
function cancelEdit(button) {
    const tr = button.closest('tr');  // 现在是找最近的 tr 元素
    const nameDiv = tr.querySelector('.tag-name, .rating-name');
    const editForm = tr.querySelector('.edit-form');
    
    nameDiv.style.display = 'block';
    editForm.style.display = 'none';
}

// 保存标签编辑
function saveTagEdit(button, oldName) {
    const tr = button.closest('tr');  // 现在是找最近的 tr 元素
    const input = tr.querySelector('input');
    const newName = input.value.trim();
    const nameDiv = tr.querySelector('.tag-name');
    
    if (!newName || newName === oldName) {
        cancelEdit(button);
        return;
    }
    
    callApi(event_map.update_tag, { 
        old_name: oldName, 
        new_name: newName 
    })
    .then(result => {
        if (result.success) {
            // 只更新表格中的显示
            nameDiv.textContent = newName;
            // 更新编辑表单中的值
            input.value = newName;
            tr.dataset.name = newName;
            // 隐藏编辑表单
            cancelEdit(button);
        } else {
            showAlert({
                title: '更新失败',
                message: result.message,
                type: 'error',
                showCancel: false
            });
        }
    });
}

// 保存评分维度编辑
function saveRatingEdit(button, oldName) {
    const tr = button.closest('tr');  // 现在是找最近的 tr 元素
    const input = tr.querySelector('input');
    const newName = input.value.trim();
    const nameDiv = tr.querySelector('.rating-name');
    
    if (!newName || newName === oldName) {
        cancelEdit(button);
        return;
    }
    
    callApi(event_map.update_rating_dimension, {
        old_name: oldName,
        new_name: newName
    })
    .then(result => {
        if (result.success) {
            // 只更新表格中的显示
            nameDiv.textContent = newName;
            // 更新编辑表单中的值
            input.value = newName;
            tr.dataset.name = newName;
            // 隐藏编辑表单
            cancelEdit(button);
        } else {
            showAlert({
                title: '更新失败',
                message: result.message,
                type: 'error',
                showCancel: false
            });
        }
    });
}

// 添加新标签
function addNewTag() {
    const input = document.getElementById('newTagInput');
    const tagName = input.value.trim();
    
    if (!tagName) {
        showAlert({
            title: '操作失败',
            message: '请输入标签名称',
            type: 'warning',
            showCancel: false
        });
        return;
    }
    
    callApi(event_map.add_tag, { name: tagName })
        .then(result => {
            if (result.success) {
                input.value = '';
                loadSettings(); // 重新加载列表
                loadTags(); // 重新加载主页面的标签
            } else {
                showAlert({
                    title: '添加失败',
                    message: result.message,
                    type: 'error',
                    showCancel: false
                });
            }
        });
}

// 添加新评分维度
function addNewRating() {
    const input = document.getElementById('newRatingInput');
    const ratingName = input.value.trim();
    
    if (!ratingName) {
        showAlert({
            title: '操作失败',
            message: '请输入评分维度名称',
            type: 'warning',
            showCancel: false
        });
        return;
    }
    
    callApi(event_map.add_rating_dimension, { name: ratingName })
        .then(result => {
            if (result.success) {
                input.value = '';
                loadSettings(); // 重新加载列表
            } else {
                showAlert({
                    title: '添加失败',
                    message: result.message,
                    type: 'error',
                    showCancel: false
                });
            }
        });
}

// 加载设置界面的标签列表
function createSettingSaveButton(action) {
    return createActionButton({
        className: 'button is-success is-small save-btn-small',
        action,
        children: [
            createEl('span', { className: 'icon' }, [
                createSpriteSvg('save-btn-icon', { width: 10, height: 10, ariaLabel: '保存' })
            ]),
            createEl('span', { text: '保存' })
        ]
    });
}

function createSettingRow({ name, id = null, type }) {
    const isTag = type === 'tag';
    const tr = createEl('tr', { dataset: { name } });
    if (id !== null && id !== undefined) {
        tr.dataset.id = String(id);
    }

    const nameClass = isTag ? 'tag-name' : 'rating-name';
    const saveAction = isTag ? 'save-tag' : 'save-rating';
    const deleteAction = isTag ? 'delete-tag' : 'delete-rating-dimension';

    const input = createEl('input', {
        className: 'input',
        attrs: { type: 'text' },
        props: { value: name }
    });

    const editForm = createEl('div', { className: 'edit-form' }, [
        input,
        createSettingSaveButton(saveAction),
        createActionButton({
            className: 'button is-light is-small',
            text: '取消',
            action: 'cancel-setting-edit'
        })
    ]);

    const contentCell = createEl('td', {}, [
        createEl('div', { className: 'item-content' }, [
            createEl('div', { className: nameClass, text: name }),
            editForm
        ])
    ]);

    const actionsCell = createEl('td', { className: 'settings-actions-column' }, [
        createEl('div', { className: 'settings-actions' }, [
            createActionButton({
                className: 'button is-info is-small edit-btn settings-action-btn',
                text: '编辑',
                action: 'start-setting-edit'
            }),
            createActionButton({
                className: 'button is-danger is-small settings-action-btn settings-delete-btn',
                text: '删除',
                action: deleteAction
            })
        ])
    ]);

    appendChildren(tr, [contentCell, actionsCell]);
    return tr;
}

// 加载设置界面的标签列表
function loadSettingsTags() {
    return callApi(event_map.get_tags)
        .then(result => {
            if (result.success) {
                const tagsList = document.getElementById('tagsList');
                const tags = result.data || [];
                clearElement(tagsList);
                tags.forEach(tag => {
                    tagsList.appendChild(createSettingRow({ name: tag, type: 'tag' }));
                });

                document.querySelector('.tag-counter').textContent = tags.length;
            }
        });
}

// 加载设置界面的评分维度列表
function loadSettingsRatingDimensions() {
    return callApi(event_map.get_ratings_dimensions)
        .then(result => {
            if (result.success) {
                const ratingsList = document.getElementById('ratingsList');
                const dimensions = result.dimensions || [];
                clearElement(ratingsList);
                dimensions.forEach(dimension => {
                    ratingsList.appendChild(createSettingRow({
                        name: dimension.name,
                        id: dimension.id,
                        type: 'rating'
                    }));
                });
                
                document.querySelector('.rating-counter').textContent = dimensions.length;
            }
        });
}
function deleteTag(button) {
    const tr = button.closest('tr');
    const name = tr?.dataset.name || '';
    if (!name) return;

    callApi(event_map.delete_tag, { name, preview: true }, 'DELETE')
        .then(result => {
            if (!result.success) {
                showAlert({
                    title: '删除失败',
                    message: result.message || '标签不存在',
                    type: 'error',
                    showCancel: false
                });
                return;
            }

            const usageCount = result.usage_count || 0;
            showAlert({
                title: '删除标签',
                message: usageCount > 0
                    ? `标签“${name}”正在被 ${usageCount} 部电影使用。确认删除并清除这些关联吗？`
                    : `确认删除标签“${name}”吗？`,
                type: 'warning',
                confirmText: '删除',
                cancelText: '取消',
                onConfirm: () => confirmDeleteTag(name)
            });
        });
}

function confirmDeleteTag(name) {
    callApi(event_map.delete_tag, { name, confirm: true }, 'DELETE')
        .then(result => {
            if (result.success) {
                loadSettings();
            } else {
                showAlert({
                    title: '删除失败',
                    message: result.message || '标签删除失败',
                    type: 'error',
                    showCancel: false
                });
            }
        });
}

function deleteRatingDimension(button) {
    const tr = button.closest('tr');
    const dimensionId = tr?.dataset.id || '';
    const name = tr?.dataset.name || '';
    if (!dimensionId) return;

    callApi(event_map.delete_rating_dimension, { id: dimensionId, preview: true }, 'DELETE')
        .then(result => {
            if (!result.success) {
                showAlert({
                    title: '删除失败',
                    message: result.message || '评分维度不存在',
                    type: 'error',
                    showCancel: false
                });
                return;
            }

            const usageCount = result.usage_count || 0;
            showAlert({
                title: '删除评分维度',
                message: usageCount > 0
                    ? `评分维度“${name}”正在被 ${usageCount} 部电影使用。确认删除并清除这些评分吗？`
                    : `确认删除评分维度“${name}”吗？`,
                type: 'warning',
                confirmText: '删除',
                cancelText: '取消',
                onConfirm: () => confirmDeleteRatingDimension(dimensionId)
            });
        });
}

function confirmDeleteRatingDimension(dimensionId) {
    callApi(event_map.delete_rating_dimension, { id: dimensionId, confirm: true }, 'DELETE')
        .then(result => {
            if (result.success) {
                loadSettings();
            } else {
                showAlert({
                    title: '删除失败',
                    message: result.message || '评分维度删除失败',
                    type: 'error',
                    showCancel: false
                });
            }
        });
}

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

const debounce = (func, wait) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
};

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
                    tagSpan.onclick = () => toggleFilterTag(tagSpan);
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
    searchMovies(); // 当标签选择变化时自动触发搜索
}

// 获取已选中的标签
function getSelectedTags() {
    const tagsFilter = document.getElementById('tags-filter');
    return Array.from(tagsFilter.getElementsByClassName('is-selected'))
                .map(tag => tag.textContent);
}

// 按要求搜索电影
function searchMovies(page = 1) {
    const requestedPage = Number(page);
    currentPage = Number.isFinite(requestedPage) && requestedPage > 0 ? Math.floor(requestedPage) : 1;

    const title = document.getElementById('search-input').value.trim();
    const ratingDimension = document.getElementById('rating-dimension-filter').value;
    const minRating = document.getElementById('min-rating-filter').value;
    const selectedTags = getSelectedTags();
    const messageDiv = document.getElementById('search-message');
    const resultsDiv = document.getElementById('search-results');

    const searchParams = {
        title,
        rating_dimension: ratingDimension,
        min_rating: minRating,
        tags: selectedTags.join(','),
        page: currentPage,
        per_page: itemsPerPage
    };

    callApi(event_map.search_movies, searchParams, 'GET')
        .then(result => {
            if (result.success) {
                const pagination = result.pagination || {};
                allMovies = Array.isArray(result.data) ? result.data : [];
                currentPage = pagination.page || currentPage;
                totalPages = pagination.total_pages || 0;

                if (allMovies.length === 0) {
                    setNotification(messageDiv, 'info', '未找到电影');
                    clearElement(resultsDiv);
                    clearElement(document.getElementById('pagination'));
                    return;
                }

                displayCurrentPage();
                clearElement(messageDiv);
            } else {
                setNotification(messageDiv, 'warning', result.message || '搜索失败');
            }
        })
        .catch(error => {
            setNotification(messageDiv, 'danger', `搜索出错: ${error.message}`);
            clearElement(resultsDiv);
            clearElement(document.getElementById('pagination'));
        });
}function displayPagination() {
    updatePagination();
}

function generatePaginationItems() {
    return '';
}
function changePage(page) {
    if (page >= 1 && page <= totalPages) {
        currentPage = page;
        searchMovies(page);
    }
}

function closeModal() {
    ModalManager.close('editModal');
    updateThumbnailSelectionControls();
}

document.getElementById('search-input').addEventListener('input', debounce(searchMovies, 300));

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
    initDynamicEventDelegates();
    loadTags();
    loadNonCriticalResources();
    loadRatingsDimensions();
    setupDropdownPositioning();
    initImageUpload();
});

// 全局变量
let ratingsDimensions = [];

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
    addRatingsContainer.innerHTML = '';
    ratingsDimensions.forEach(dimension => {
        // 为添加电影 表单创建评分字段
        const addField = createRatingField(dimension, false);
        addRatingsContainer.appendChild(addField);
    });
}


// 创建评分字段
function createRatingField(dimension, isEdit) {
    const prefix = isEdit ? 'edit-' : '';
    const field = document.createElement('div');
    field.className = 'field';
    field.innerHTML = `
        <label class="label">${dimension.name}</label>
        <div class="control">
            <div class="rating" data-dimension-id="${dimension.id}">
                <input type="radio" id="${prefix}rating-${dimension.id}-5" name="${prefix}rating-${dimension.id}" value="5">
                <svg width="16" height="16" fill="currentColor" stroke="none" aria-label="星级">
                    <use href="../static/sprite.svg#rating-star-icon"></use>
                </svg>
                <input type="radio" id="${prefix}rating-${dimension.id}-4" name="${prefix}rating-${dimension.id}" value="4">
                <svg width="16" height="16" fill="currentColor" stroke="none" aria-label="评分">
                    <use href="../static/sprite.svg#rating-star-icon"></use>
                </svg>
                <input type="radio" id="${prefix}rating-${dimension.id}-3" name="${prefix}rating-${dimension.id}" value="3">
                <svg width="16" height="16" fill="currentColor" stroke="none" aria-label="评分">
                    <use href="../static/sprite.svg#rating-star-icon"></use>
                </svg>
                <input type="radio" id="${prefix}rating-${dimension.id}-2" name="${prefix}rating-${dimension.id}" value="2">
                <svg width="16" height="16" fill="currentColor" stroke="none" aria-label="评分">
                    <use href="../static/sprite.svg#rating-star-icon"></use>
                </svg>
                <input type="radio" id="${prefix}rating-${dimension.id}-1" name="${prefix}rating-${dimension.id}" value="1">
                <svg width="16" height="16" fill="currentColor" stroke="none" aria-label="评分">
                    <use href="../static/sprite.svg#rating-star-icon"></use>
                </svg>
            </div>
        </div>
    `;
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
        if (checkedInput) {
            ratings.push(`${dimension.id}:${checkedInput.value}`);
        }
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

// 打开编辑模态框
function openModal(movie) {
    document.querySelector('.modal-card-title').textContent = `编辑电影：${movie.title}`;
    const modal = document.getElementById('editModal');
    
    // 清除旧的日期显示
    const oldDateField = document.querySelector('#edit-movie-form div:has(> p.has-text-grey)');
    if (oldDateField) {
        oldDateField.remove();
    }
    
    // 清空旧的图片区域
    window['resetedit-image-upload-area']();

    // 设置基本信息
    document.getElementById('edit-title').value = movie.title;
    
    // 添加新日期显示
    const dateField = document.createElement('div');
    dateField.className = 'field';
    dateField.innerHTML = `
        <p class="has-text-grey">
            添加日期: ${formatDate(movie.added_date)}
        </p>
    `;
    // 将日期字段插入到表单开头
    const form = document.getElementById('edit-movie-form');
    form.insertBefore(dateField, form.firstChild);
    
    // 设置推荐状态
    const recommendedRadio = document.getElementById('edit-recommended').checked = movie.recommended === 1;
    if (recommendedRadio) {
        recommendedRadio.checked = true;
    }
    
    // 设置评价
    document.getElementById('edit-review').value = movie.review || '';
    
    // 加载标签
    loadEditTags().then(() => {
        // 设置已选中的标签
        const tagElements = document.querySelectorAll('#edit-tags .tag');
        const movieTags = movie.tag_names ? movie.tag_names.split(', ') : [];
        tagElements.forEach(tag => {
            tag.classList.toggle('is-selected', movieTags.includes(tag.textContent.trim()));
        });
    });
    
    // 加载评分维度
    loadEditRatings().then(() => {
        // 设置评分
        if (movie.ratings) {
            const ratings = movie.ratings.split(',');
            ratings.forEach(ratingPair => {
                const [dimensionId, value] = ratingPair.split(':');
                const ratingInput = document.querySelector(`input[name="edit-rating-${dimensionId}"][value="${value}"]`);
                if (ratingInput) {
                    ratingInput.checked = true;
                }
            });
        }
    });
    
    // 检查并显示已有图片
    const existingImagesContainer = modal.querySelector('.existing-images');
    existingImagesContainer.style.display = movie.image_filename ? 'flex' : 'none'; // 如果没有已存在图片，则隐藏容器
    clearElement(existingImagesContainer); // 清空现有内容

    // 数组存储当前显示的图片文件名
    const currentImages = new Set();

    if (movie.image_filename && movie.image_filename.trim()) {
        const images = movie.image_filename.split(',');
        images.forEach((filename, index) => {
            if (filename.trim()) {
                const trimmedFilename = filename.trim();
                const imageUrl = buildImageUrl(trimmedFilename);
                const imageWrapper = document.createElement('div');
                imageWrapper.className = 'existing-image-item';
                imageWrapper.draggable = true; // 添加可拖拽属性
                imageWrapper.dataset.index = index; // 添加索引用于排序
                appendChildren(imageWrapper, [
                    createEl('img', { attrs: { src: imageUrl, alt: '预览图' } }),
                    createEl('button', {
                        className: 'delete-existing-image',
                        attrs: { type: 'button' },
                        dataset: { filename: trimmedFilename }
                    }, [
                        createSpriteSvg('close-icon', { width: 12, height: 12, ariaLabel: '删除' })
                    ])
                ]);

                // 阻止右键菜单弹出
                imageWrapper.addEventListener('contextmenu', e => e.preventDefault());

                // 添加删除按钮点击事件
                const deleteButton = imageWrapper.querySelector('.delete-existing-image');
                deleteButton.addEventListener('click', (e) => {
                    e.preventDefault();
                    imageWrapper.remove();
                    currentImages.delete(trimmedFilename);
                });

                /* PC端的拖拽使用了HTML5的原生拖放API，dragstart只是标记开始拖拽状态，
                真正的排序和索引更新是在container的dragover事件中完成的。
                而移动端没有原生拖放API，所以在touchmove中模拟了拖放行为。*/

                // 图片拖拽事件 - 开始
                imageWrapper.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/plain', index);
                    e.dataTransfer.effectAllowed = 'move';
                    // 设置拖拽图像
                    e.dataTransfer.setDragImage(imageWrapper, imageWrapper.offsetWidth / 2, imageWrapper.offsetHeight / 2);
                    imageWrapper.classList.add('dragging');
                    existingImagesContainer.classList.add('dragging-over');
                });
                // 移动端图片拖拽事件 - 开始
                imageWrapper.addEventListener('touchstart', () => {
                    imageWrapper.classList.add('dragging');
                    existingImagesContainer.classList.add('dragging-over');
                }, { passive: true });
                // 图片拖拽事件 - 结束
                imageWrapper.addEventListener('dragend', () => {
                    imageWrapper.classList.remove('dragging');
                    existingImagesContainer.classList.remove('dragging-over');
                });
                // 移动端图片拖拽事件 - 结束
                imageWrapper.addEventListener('touchend', () => {
                    imageWrapper.classList.remove('dragging');
                    existingImagesContainer.classList.remove('dragging-over');
                }, { passive: true });

                existingImagesContainer.appendChild(imageWrapper);
                currentImages.add(trimmedFilename);
            }
        });

        // 容器图片拖拽事件 - 开始
        existingImagesContainer.addEventListener('dragstart', (e) => {
            const imageWrapper = e.target.closest('.existing-image-item');
            if (imageWrapper) {
                imageWrapper.classList.add('dragging');
                existingImagesContainer.classList.add('dragging-over');
                e.dataTransfer.setData('text/plain', imageWrapper.dataset.index);
            }
        });
        // 移动端容器图片拖拽事件 - 开始
        existingImagesContainer.addEventListener('touchstart', (e) => {
            const imageWrapper = e.target.closest('.existing-image-item');
            if (imageWrapper) {
                imageWrapper.classList.add('dragging');
                existingImagesContainer.classList.add('dragging-over');
            }
        }, { passive: true });
        // 容器图片拖拽事件 - 结束
        existingImagesContainer.addEventListener('dragend', updateImageOrder);
        // 移动端容器图片拖拽事件 - 结束
        existingImagesContainer.addEventListener('touchend', updateImageOrder, { passive: true });

        function updateImageOrder(e) {
            const imageWrapper = e.target.closest('.existing-image-item');
            if (imageWrapper) {
                imageWrapper.classList.remove('dragging');
                existingImagesContainer.classList.remove('dragging-over');

                // 更新索引
                const items = existingImagesContainer.querySelectorAll('.existing-image-item');
                items.forEach((item, idx) => {
                    item.dataset.index = idx;
                });
            }
        }

        existingImagesContainer.addEventListener('dragenter', (e) => {
            e.preventDefault();
            existingImagesContainer.classList.add('dragging-over');
        });
        
        existingImagesContainer.addEventListener('dragleave', (e) => {
            e.preventDefault();
            existingImagesContainer.classList.remove('dragging-over');
        });
        
        existingImagesContainer.addEventListener('drop', (e) => {
            e.preventDefault();
            existingImagesContainer.classList.remove('dragging-over');
        });

        // 容器图片拖拽事件 - 移动
        existingImagesContainer.addEventListener('dragover', handleMove);
        // 移动端容器图片拖拽事件 - 移动
        existingImagesContainer.addEventListener('touchmove', handleMove);

        function handleMove(e) {
            e.preventDefault();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'move';
            }
            existingImagesContainer.classList.add('dragging-over');
        
            const draggingItem = existingImagesContainer.querySelector('.dragging');
            if (!draggingItem) return;
        
            const clientX = e.clientX || e.touches?.[0].clientX;
            const clientY = e.clientY || e.touches?.[0].clientY;
        
            const afterElement = getDragAfterElement(existingImagesContainer, clientX, clientY);
            if (afterElement) {
                existingImagesContainer.insertBefore(draggingItem, afterElement);
            } else {
                existingImagesContainer.appendChild(draggingItem);
            }
        }
    }

    // 将当前图片集合保存到modal元素中，供updateMovie使用
    modal.dataset.currentImages = JSON.stringify(Array.from(currentImages));

    // 显示模态框
    ModalManager.open('editModal');
    updateThumbnailSelectionControls();
}

// 加载编辑标签
async function loadEditTags() {
    try {
        const result = await callApi(event_map.get_tags);
        if (result.success) {
            const editTagsDiv = document.getElementById('edit-tags');
            editTagsDiv.innerHTML = '';
            result.data.forEach(tag => {
                const tagSpan = document.createElement('span');
                tagSpan.className = 'tag';
                tagSpan.textContent = tag;
                tagSpan.onclick = () => toggleTag(tagSpan);
                editTagsDiv.appendChild(tagSpan);
            });
        }
    } catch (error) {
        showAlert({
            title: '加载失败',
            message: error.message || String(error),
            type: 'error',
            showCancel: false
        });
    }
}

// 加载编辑评分 - 专用于编辑窗口中创建评分框
async function loadEditRatings() {
    try {
        const result = await callApi(event_map.get_ratings_dimensions);
        if (result.success) {
            // 创建外层field容器
            const fieldDiv = document.createElement('div');
            fieldDiv.className = 'field';

            // 创建评分框容器
            const ratingsBox = document.createElement('div');
            ratingsBox.className = 'ratings-box';
            
            // 添加标题
            const boxTitle = document.createElement('div');
            boxTitle.className = 'ratings-box-title';
            boxTitle.textContent = '评分';
            
            // 创建评分容器
            const ratingsContainer = document.createElement('div');
            ratingsContainer.id = 'edit-ratings-container';
            
            // 添加评分维度
            result.dimensions.forEach(dimension => {
                const field = createRatingField(dimension, true);
                ratingsContainer.appendChild(field);
            });
            
            ratingsBox.appendChild(boxTitle);
            ratingsBox.appendChild(ratingsContainer);
            fieldDiv.appendChild(ratingsBox);
            
            // 插入到表单中
            const form = document.querySelector('#edit-movie-form');
            const imageBox = form.querySelector('.image-box').closest('.field');

            // 移除所有已存在的评分框
            const oldRatingsBoxes = form.querySelectorAll('.ratings-box');
            oldRatingsBoxes.forEach(box => {
                const fieldParent = box.closest('.field');
                if (fieldParent) fieldParent.remove();
            });

            // 插入到图片框之前
            form.insertBefore(fieldDiv, imageBox);
        }
    } catch (error) {
        showAlert({
            title: '加载失败',
            message: error.message || String(error),
            type: 'error',
            showCancel: false
        });
    }
}

// 删除电影相关代码
function deleteMovie() {
    showAlert({
        title: '确认删除',
        message: '确定要删除这部电影吗？此操作无法撤销。数据库中的图像文件也会被删除。',
        type: 'warning',
        confirmText: '删除',
        cancelText: '取消',
        onConfirm: () => {
            // 保存当前的搜索状态
            saveSearchState();
            
            const title = document.getElementById('edit-title').value;
            callApi(event_map.delete_movie, { title }, 'DELETE')
                .then(result => {
                    if (result.success){
                        closeModal();
                        // 恢复搜索状态并重新搜索
                        restoreSearchState();
                        searchMovies(currentPage);
                        showAlert({
                            title: '删除成功',
                            message: result.message || '电影已删除',
                            type: 'success',
                            showCancel: false
                        });
                    } else {
                        showAlert({
                            title: '删除失败',
                            message: result.message || '删除失败',
                            type: 'error',
                            showCancel: false
                        });
                    }
                });
        }
    });
}

// 搜索状态的全局函数
let searchState = {
    page: 1,
    title: '',
    ratingDimension: '',
    minRating: '',
    selectedTags: []
};

// 保存搜索状态的函数
function saveSearchState() {
    searchState = {
        page: currentPage,
        title: document.getElementById('search-input').value.trim(),
        ratingDimension: document.getElementById('rating-dimension-filter').value,
        minRating: document.getElementById('min-rating-filter').value,
        selectedTags: Array.from(document.querySelectorAll('#tags-filter .tag.is-selected'))
                          .map(tag => tag.textContent)
    };
}

// 恢复搜索状态的函数
function restoreSearchState() {
    // 恢复搜索关键词
    document.getElementById('search-input').value = searchState.title;
    
    // 恢复评分过滤状态
    document.getElementById('rating-dimension-filter').value = searchState.ratingDimension;
    document.getElementById('min-rating-filter').value = searchState.minRating;
    
    // 恢复标签选择状态
    const tagElements = document.querySelectorAll('#tags-filter .tag');
    tagElements.forEach(tag => {
        if (searchState.selectedTags.includes(tag.textContent)) {
            tag.classList.add('is-selected');
        }
    });
    
    currentPage = searchState.page;
}

// 更新电影信息
async function updateMovie() {
    try {
        const form = document.getElementById('edit-movie-form');
        const title = document.getElementById('edit-title').value;
        const modal = document.getElementById('editModal');
        
        // 保存当前的搜索状态
        saveSearchState();

        // 获取当前保留的现有图片
        const currentImages = Array.from(modal.querySelectorAll('.existing-image-item'))
            .sort((a, b) => parseInt(a.dataset.index) - parseInt(b.dataset.index))
            .map(item => item.querySelector('.delete-existing-image').dataset.filename);

        // 处理新上传的图片
        const uploadedFiles = window[`getedit-image-upload-areaFiles`]() || [];
        const uploadResults = await Promise.all(uploadedFiles.map(async file => {
            const formData = new FormData();
            formData.append('image', file);
            const response = await fetch('/api', { 
                method: 'POST', 
                body: formData 
            }).then(res => res.json());
            return response;
        }));

        // 合并现有图片和新上传图片的文件名
        const newFilenames = uploadResults
            .filter(result => result.success)
            .map(result => result.filename);

        const allFilenames = [...currentImages, ...newFilenames].join(',');

        const data = {
            title: title,
            recommended: document.getElementById('edit-recommended').checked ? 1 : 0,
            review: form.querySelector('[id="edit-review"]').value,
            tags: Array.from(document.querySelectorAll('#edit-tags .tag.is-selected')).map(tag => tag.textContent).join(','),
            ratings: collectRatings(true),
            image_filenames: allFilenames,
            // 原始图片列表，用于后端对比删除的图片
            original_images: modal.dataset.currentImages
        };

        const result = await callApi(event_map.update_movie, data, 'PUT');
        if (result.message) {
            ModalManager.close('editModal');
            updateThumbnailSelectionControls();
            // 恢复搜索状态并重新搜索
            restoreSearchState();
            searchMovies(currentPage);
        } else {
            showAlert({
                title: '更新失败',
                message: result.error,
                type: 'error',
                showCancel: false
            });
        }
    } catch (error) {
        showAlert({
            title: '更新失败',
            message: error.message || String(error),
            type: 'error',
            showCancel: false
        });
    }
}

// 搜索结果显示
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

// 搜索结果显示
function displayCurrentPage() {
    const resultsDiv = document.getElementById('search-results');
    clearElement(resultsDiv);
    
    if (allMovies.length === 0) {
        resultsDiv.appendChild(createNotification('info', '没有找到电影'));
        clearElement(document.getElementById('pagination'));
        return;
    }

    const tableContainer = createEl('div', { className: 'table-container' });
    const table = createEl('table', { className: 'table is-fullwidth is-striped is-hoverable movie-results-table' });
    const headerRow = createEl('tr');
    [
        ['title', '电影名称', '23%'],
        ['recommended', '推荐', '4.5%'],
        ['review', '评价', '36%'],
        ['tags', '标签', '15.5%'],
        ['ratings', '评分', '10.5%'],
        ['action', '操作', '10.5%']
    ].forEach(([column, label, width]) => {
        headerRow.appendChild(createEl('th', {
            text: label,
            attrs: { 'data-column': column, style: `width: ${width}` }
        }));
    });

    table.appendChild(createEl('thead', {}, [headerRow]));
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

// 辅助函数：日期格式
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
    const stars = [];
    for(let i = 1; i <= 5; i++) {
        const starColor = i <= rating ? getStarColor(rating) : '#d3d3d3';
        stars.push(`
            <svg width="16" height="16" fill="${starColor}" stroke="none" aria-label="星级">
                <use href="../static/sprite.svg#rating-star-icon"></use>
            </svg>
        `);
    }
    return stars.join('');
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
        attrs: { role: 'navigation', 'aria-label': 'pagination' }
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

// 图片上传相关代码
const thumbnailState = {
    currentPath: '',
    currentListing: null,
    selectedVideo: null,
    captures: [],
    selectedCaptureIds: new Set(),
    initialized: false,
    isBatchRunning: false,
    abortBatch: false,
    fpsProbeToken: 0,
    adaptiveFps: 30,
    directoryRequestToken: 0,
    sessionToken: 0,
    seekToken: 0,
    stepSeekToken: 0,
    stepSeekTimer: null,
    pendingStepTarget: null,
    pendingStepShouldResume: false
};

function openThumbnailModal() {
    if (ModalManager.minimizedModals.has('thumbnailModal')) {
        ModalManager.restoreModal('thumbnailModal');
    } else {
        ModalManager.open('thumbnailModal');
    }
    initThumbnailTool();
    if (!thumbnailState.currentListing) {
        loadThumbnailDirectory('');
    }
}

function closeThumbnailModal() {
    resetThumbnailToolState();
    ModalManager.close('thumbnailModal');
}

function resetThumbnailToolState() {
    thumbnailState.abortBatch = true;
    thumbnailState.isBatchRunning = false;
    thumbnailState.directoryRequestToken += 1;
    thumbnailState.fpsProbeToken += 1;
    thumbnailState.sessionToken += 1;
    thumbnailState.seekToken += 1;
    thumbnailState.stepSeekToken += 1;
    clearTimeout(thumbnailState.stepSeekTimer);
    thumbnailState.stepSeekTimer = null;
    thumbnailState.pendingStepTarget = null;
    thumbnailState.pendingStepShouldResume = false;

    const video = document.getElementById('thumbnail-video');
    if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
    }

    thumbnailState.currentPath = '';
    thumbnailState.currentListing = null;
    thumbnailState.selectedVideo = null;
    thumbnailState.adaptiveFps = 30;
    thumbnailState.captures.forEach(capture => URL.revokeObjectURL(capture.url));
    thumbnailState.captures = [];
    thumbnailState.selectedCaptureIds.clear();
    clearThumbnailDragCache();

    const list = document.getElementById('thumbnail-file-list');
    if (list) list.innerHTML = '';

    const breadcrumbs = document.getElementById('thumbnail-breadcrumbs');
    if (breadcrumbs) breadcrumbs.innerHTML = '';

    setThumbnailStatus('请选择视频文件');
    updateThumbnailProgress(0);
    setThumbnailBatchControls(false);

    const summary = document.getElementById('thumbnail-batch-summary');
    if (summary) summary.textContent = '';

    renderThumbnailCaptures();
    syncThumbnailPercentPreset();
    updateThumbnailBatchSummary();
    updateThumbnailSelectionControls();
}

function initThumbnailTool() {
    if (thumbnailState.initialized) return;

    const modal = document.getElementById('thumbnailModal');
    if (!modal) return;

    const video = document.getElementById('thumbnail-video');
    const upButton = document.getElementById('thumbnail-up-button');
    const refreshButton = document.getElementById('thumbnail-refresh-button');
    const frameBack = document.getElementById('thumbnail-frame-back');
    const frameForward = document.getElementById('thumbnail-frame-forward');
    const secondBack = document.getElementById('thumbnail-second-back');
    const secondForward = document.getElementById('thumbnail-second-forward');
    const fiveSecondBack = document.getElementById('thumbnail-five-second-back');
    const fiveSecondForward = document.getElementById('thumbnail-five-second-forward');
    const fiveMinuteBack = document.getElementById('thumbnail-five-minute-back');
    const fiveMinuteForward = document.getElementById('thumbnail-five-minute-forward');
    const minuteBack = document.getElementById('thumbnail-minute-back');
    const minuteForward = document.getElementById('thumbnail-minute-forward');
    const captureButton = document.getElementById('thumbnail-capture-current');
    const batchButton = document.getElementById('thumbnail-batch-capture');
    const clearButton = document.getElementById('thumbnail-clear-captures');
    const selectAllButton = document.getElementById('thumbnail-select-all');
    const sendAddButton = document.getElementById('thumbnail-send-add');
    const sendEditButton = document.getElementById('thumbnail-send-edit');
    const downloadSelectedButton = document.getElementById('thumbnail-download-selected');
    const percentInput = document.getElementById('thumbnail-percent-step');
    const presetButtons = modal.querySelectorAll('.thumbnail-percent-preset');

    upButton?.addEventListener('click', () => {
        if (thumbnailState.currentPath) {
            loadThumbnailDirectory(getThumbnailParentPath(thumbnailState.currentPath));
        }
    });
    refreshButton?.addEventListener('click', () => loadThumbnailDirectory(thumbnailState.currentPath));
    frameBack?.addEventListener('click', () => stepThumbnailVideo(-getThumbnailFrameStep()));
    frameForward?.addEventListener('click', () => stepThumbnailVideo(getThumbnailFrameStep()));
    secondBack?.addEventListener('click', () => stepThumbnailVideo(-getThumbnailSecondStep()));
    secondForward?.addEventListener('click', () => stepThumbnailVideo(getThumbnailSecondStep()));
    fiveSecondBack?.addEventListener('click', () => stepThumbnailVideo(-5));
    fiveSecondForward?.addEventListener('click', () => stepThumbnailVideo(5));
    fiveMinuteBack?.addEventListener('click', () => stepThumbnailVideo(-300));
    fiveMinuteForward?.addEventListener('click', () => stepThumbnailVideo(300));
    minuteBack?.addEventListener('click', () => stepThumbnailVideo(-60));
    minuteForward?.addEventListener('click', () => stepThumbnailVideo(60));
    captureButton?.addEventListener('click', () => captureCurrentThumbnail());
    batchButton?.addEventListener('click', () => {
        if (thumbnailState.isBatchRunning) {
            thumbnailState.abortBatch = true;
            setThumbnailStatus('正在停止批量截图...');
            return;
        }
        batchCaptureThumbnails();
    });
    clearButton?.addEventListener('click', clearThumbnailCaptures);
    selectAllButton?.addEventListener('click', toggleAllThumbnailCaptures);
    sendAddButton?.addEventListener('click', () => sendSelectedThumbnailCapturesToUploadArea('image-upload-area', '添加电影'));
    sendEditButton?.addEventListener('click', () => sendSelectedThumbnailCapturesToUploadArea('edit-image-upload-area', '编辑电影'));
    downloadSelectedButton?.addEventListener('click', downloadSelectedThumbnailCaptures);
    percentInput?.addEventListener('input', () => {
        syncThumbnailPercentPreset();
        updateThumbnailBatchSummary();
    });
    presetButtons.forEach(button => {
        button.addEventListener('click', () => {
            if (percentInput) {
                percentInput.value = button.dataset.thumbnailPercent || '2';
            }
            syncThumbnailPercentPreset();
            updateThumbnailBatchSummary();
        });
    });

    video?.addEventListener('loadedmetadata', () => {
        resetThumbnailVideoControls();
        autoDetectThumbnailFps(video);
        updateThumbnailStatusForVideo();
        updateThumbnailBatchSummary();
    });
    video?.addEventListener('durationchange', updateThumbnailBatchSummary);
    video?.addEventListener('error', () => {
        setThumbnailStatus('视频无法播放，浏览器可能不支持该编码或封装格式。');
    });

    thumbnailState.initialized = true;
    syncThumbnailPercentPreset();
    updateThumbnailBatchSummary();
    renderThumbnailCaptures();
}

function loadThumbnailDirectory(path = '') {
    const safePath = path || '';
    const requestToken = ++thumbnailState.directoryRequestToken;
    setThumbnailFileListLoading();
    callApi(event_map.list_video_files, { path: safePath })
        .then(result => {
            if (requestToken !== thumbnailState.directoryRequestToken) return;
            if (!result.success) {
                throw new Error(result.message || '读取视频目录失败');
            }
            thumbnailState.currentPath = result.path || '';
            thumbnailState.currentListing = result;
            renderThumbnailBrowser(result);
            if (result.message) {
                setThumbnailStatus(result.message);
            }
        })
        .catch(error => {
            if (requestToken !== thumbnailState.directoryRequestToken) return;
            renderThumbnailBrowser({
                path: safePath,
                parent: getThumbnailParentPath(safePath),
                directories: [],
                files: []
            });
            setThumbnailStatus(error.message || '读取视频目录失败');
        });
}

function setThumbnailFileListLoading() {
    const list = document.getElementById('thumbnail-file-list');
    if (list) {
        list.innerHTML = '<div class="thumbnail-empty">正在读取...</div>';
    }
}

function renderThumbnailBrowser(data) {
    renderThumbnailBreadcrumbs(data.path || '');
    const upButton = document.getElementById('thumbnail-up-button');
    if (upButton) {
        upButton.disabled = !(data.path || '');
    }

    const list = document.getElementById('thumbnail-file-list');
    if (!list) return;
    list.innerHTML = '';

    const directories = data.directories || [];
    const files = data.files || [];
    if (!directories.length && !files.length) {
        const empty = document.createElement('div');
        empty.className = 'thumbnail-empty';
        empty.textContent = '当前目录没有可播放的视频文件';
        list.appendChild(empty);
        return;
    }

    directories.forEach(directory => {
        list.appendChild(createThumbnailDirectoryRow(directory));
    });
    files.forEach(file => {
        list.appendChild(createThumbnailFileRow(file));
    });
}

function renderThumbnailBreadcrumbs(path) {
    const breadcrumbs = document.getElementById('thumbnail-breadcrumbs');
    if (!breadcrumbs) return;
    breadcrumbs.innerHTML = '';

    const rootButton = document.createElement('button');
    rootButton.type = 'button';
    rootButton.textContent = 'videos';
    rootButton.addEventListener('click', () => loadThumbnailDirectory(''));
    breadcrumbs.appendChild(rootButton);

    let acc = '';
    path.split('/').filter(Boolean).forEach(part => {
        acc = acc ? `${acc}/${part}` : part;
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = part;
        const targetPath = acc;
        button.addEventListener('click', () => loadThumbnailDirectory(targetPath));
        breadcrumbs.appendChild(button);
    });
}

function createThumbnailDirectoryRow(directory) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'thumbnail-file-row';
    if (directory.name.length > 18) {
        row.classList.add('is-long-name');
    }
    row.innerHTML = '<span class="thumbnail-file-name"><span class="thumbnail-file-name-text"></span></span><span class="thumbnail-file-meta">目录</span>';
    row.querySelector('.thumbnail-file-name-text').textContent = `/${directory.name}`;
    row.title = directory.name;
    row.addEventListener('click', () => loadThumbnailDirectory(directory.path));
    return row;
}

function createThumbnailFileRow(file) {
    const row = document.createElement('div');
    row.className = 'thumbnail-file-row has-copy';
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    if (file.name.length > 18) {
        row.classList.add('is-long-name');
    }
    if (thumbnailState.selectedVideo?.path === file.path) {
        row.classList.add('is-selected');
    }
    row.innerHTML = `
        <span class="thumbnail-file-name"><span class="thumbnail-file-name-text"></span></span>
        <span class="thumbnail-file-meta"></span>
        <button class="thumbnail-copy-name" type="button" aria-label="复制文件名">
            <svg fill="currentColor" stroke="none" aria-label="复制">
                <use href="../static/sprite.svg#copy-btn-icon"></use>
            </svg>
        </button>
    `;
    row.querySelector('.thumbnail-file-name-text').textContent = file.name;
    row.querySelector('.thumbnail-file-meta').textContent = formatThumbnailBytes(file.size);
    row.title = file.name;
    row.addEventListener('click', () => selectThumbnailVideo(file));
    row.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectThumbnailVideo(file);
        }
    });
    row.querySelector('.thumbnail-copy-name')?.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        copyThumbnailVideoFileName(file.name, event.currentTarget);
    });
    return row;
}

async function copyThumbnailVideoFileName(fileName, button) {
    const setCopyIcon = (symbolId, stateClass) => {
        if (!button) return;
        button.classList.remove('is-success', 'is-danger');
        if (stateClass) button.classList.add(stateClass);
        button.innerHTML = `
            <svg fill="currentColor" stroke="none" aria-label="复制">
                <use href="../static/sprite.svg#${symbolId}"></use>
            </svg>
        `;
    };

    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(fileName);
        } else {
            const textarea = document.createElement('textarea');
            textarea.value = fileName;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        }
        setCopyIcon('copy-success-btn-icon', 'is-success');
        setThumbnailStatus(`已复制文件名：${fileName}`);
    } catch (error) {
        setCopyIcon('copy-fail-btn-icon', 'is-danger');
        setThumbnailStatus('复制文件名失败');
    } finally {
        setTimeout(() => setCopyIcon('copy-btn-icon', ''), 1200);
    }
}

function selectThumbnailVideo(file) {
    thumbnailState.selectedVideo = file;
    const video = document.getElementById('thumbnail-video');
    if (!video) return;

    thumbnailState.seekToken += 1;
    thumbnailState.stepSeekToken += 1;
    clearTimeout(thumbnailState.stepSeekTimer);
    thumbnailState.stepSeekTimer = null;
    thumbnailState.pendingStepTarget = null;
    thumbnailState.pendingStepShouldResume = false;
    video.pause();
    video.src = file.url;
    video.load();
    setThumbnailStatus(`已选择：${file.name}`);
    renderThumbnailBrowser(thumbnailState.currentListing || { path: thumbnailState.currentPath, directories: [], files: [] });
}

function updateThumbnailStatusForVideo() {
    const video = document.getElementById('thumbnail-video');
    if (!video || !thumbnailState.selectedVideo) return;
    setThumbnailStatus(`${thumbnailState.selectedVideo.name} · ${formatThumbnailTime(video.duration)}`);
}

function setThumbnailStatus(message) {
    const status = document.getElementById('thumbnail-status');
    if (status) {
        status.textContent = message;
    }
}

function getThumbnailParentPath(path) {
    const parts = (path || '').split('/').filter(Boolean);
    parts.pop();
    return parts.join('/');
}

function getThumbnailSecondStep() {
    return 1;
}

function getThumbnailFrameStep() {
    const fps = thumbnailState.adaptiveFps || 30;
    return Number.isFinite(fps) && fps > 0 ? 1 / fps : 1 / 30;
}

function getThumbnailPercentStep() {
    const value = parseFloat(document.getElementById('thumbnail-percent-step')?.value || '2');
    return Number.isFinite(value) && value > 0 && value <= 100 ? value : 2;
}

function resetThumbnailVideoControls() {
    thumbnailState.adaptiveFps = 30;
    syncThumbnailPercentPreset();
}

function autoDetectThumbnailFps(video) {
    thumbnailState.fpsProbeToken += 1;
    const probeToken = thumbnailState.fpsProbeToken;
    thumbnailState.adaptiveFps = 30;

    if (!video || typeof video.requestVideoFrameCallback !== 'function') {
        return;
    }

    const samples = [];
    let lastMediaTime = null;
    let isDone = false;

    const finish = () => {
        if (isDone || probeToken !== thumbnailState.fpsProbeToken) return;
        isDone = true;
        if (samples.length < 2) {
            thumbnailState.adaptiveFps = 30;
            return;
        }

        const averageDelta = samples.reduce((sum, delta) => sum + delta, 0) / samples.length;
        if (averageDelta > 0) {
            thumbnailState.adaptiveFps = Math.max(1, Math.round(1 / averageDelta));
        }
    };

    const sampleFrame = (now, metadata) => {
        if (probeToken !== thumbnailState.fpsProbeToken || isDone) return;
        if (lastMediaTime !== null) {
            const delta = metadata.mediaTime - lastMediaTime;
            if (delta > 0 && delta < 1) {
                samples.push(delta);
            }
        }
        lastMediaTime = metadata.mediaTime;
        if (samples.length >= 6) {
            finish();
        } else {
            video.requestVideoFrameCallback(sampleFrame);
        }
    };

    video.requestVideoFrameCallback(sampleFrame);
    setTimeout(finish, 1200);
}

function getThumbnailBatchTargets() {
    const video = document.getElementById('thumbnail-video');
    if (!isThumbnailVideoReady(video)) return [];

    const percentStep = getThumbnailPercentStep();
    const targets = [];
    for (let percent = percentStep; percent <= 100 + 0.0001; percent += percentStep) {
        targets.push(clampThumbnailTime(video.duration * Math.min(percent, 100) / 100, video.duration));
    }
    return targets;
}

function updateThumbnailBatchSummary() {
    const summary = document.getElementById('thumbnail-batch-summary');
    if (summary) {
        summary.textContent = '';
    }
    updateThumbnailBatchButtonLabel();
}

function getThumbnailBatchCount() {
    const video = document.getElementById('thumbnail-video');
    if (!isThumbnailVideoReady(video)) {
        return 0;
    }
    return getThumbnailBatchTargets().length;
}

function updateThumbnailBatchButtonLabel() {
    if (thumbnailState.isBatchRunning) return;
    const batchButton = document.getElementById('thumbnail-batch-capture');
    if (!batchButton) return;
    const batchCount = getThumbnailBatchCount();
    batchButton.textContent = batchCount > 0 ? `批量截图 ${batchCount} 张` : '批量截图';
}

function syncThumbnailPercentPreset() {
    const percentStep = getThumbnailPercentStep();
    document.querySelectorAll('.thumbnail-percent-preset').forEach(button => {
        const presetValue = parseFloat(button.dataset.thumbnailPercent || '0');
        button.classList.toggle('is-info', Math.abs(presetValue - percentStep) < 0.0001);
    });
}

async function stepThumbnailVideo(delta) {
    const video = document.getElementById('thumbnail-video');
    if (!isThumbnailVideoReady(video)) {
        setThumbnailStatus('请先选择可播放的视频');
        return;
    }
    const shouldResume = thumbnailState.pendingStepShouldResume || (!video.paused && !video.ended);
    const baseTime = Number.isFinite(thumbnailState.pendingStepTarget)
        ? thumbnailState.pendingStepTarget
        : video.currentTime;
    const target = clampThumbnailTime(baseTime + delta, video.duration);
    const stepToken = ++thumbnailState.stepSeekToken;

    thumbnailState.pendingStepTarget = target;
    thumbnailState.pendingStepShouldResume = shouldResume;
    clearTimeout(thumbnailState.stepSeekTimer);
    setThumbnailStatus(`准备定位：${formatThumbnailTime(target)} / ${formatThumbnailTime(video.duration)}`);

    thumbnailState.stepSeekTimer = setTimeout(() => {
        flushThumbnailStepSeek(stepToken);
    }, 60);
}

async function flushThumbnailStepSeek(stepToken) {
    if (stepToken !== thumbnailState.stepSeekToken) return;

    const video = document.getElementById('thumbnail-video');
    if (!isThumbnailVideoReady(video) || !Number.isFinite(thumbnailState.pendingStepTarget)) return;

    const target = thumbnailState.pendingStepTarget;
    const shouldResume = thumbnailState.pendingStepShouldResume;
    thumbnailState.stepSeekTimer = null;

    try {
        const completed = await seekThumbnailVideo(target);
        if (stepToken !== thumbnailState.stepSeekToken) return;
        if (thumbnailState.pendingStepTarget === target) {
            thumbnailState.pendingStepTarget = null;
        }
        thumbnailState.pendingStepShouldResume = false;
        if (shouldResume && completed) {
            video.play().catch(() => {});
        }
        setThumbnailStatus(`当前时间：${formatThumbnailTime(video.currentTime)} / ${formatThumbnailTime(video.duration)}`);
    } catch (error) {
        if (stepToken === thumbnailState.stepSeekToken) {
            thumbnailState.pendingStepTarget = null;
            thumbnailState.pendingStepShouldResume = false;
            setThumbnailStatus(error.message || '视频定位失败');
        }
    }
}

function isThumbnailVideoReady(video) {
    return Boolean(video && video.src && Number.isFinite(video.duration) && video.duration > 0);
}

function clampThumbnailTime(time, duration) {
    const maxTime = Math.max(0, duration - 0.1);
    return Math.min(Math.max(0, time), maxTime);
}

function seekThumbnailVideo(time) {
    const video = document.getElementById('thumbnail-video');
    const seekToken = ++thumbnailState.seekToken;
    return new Promise((resolve, reject) => {
        if (!video) {
            reject(new Error('视频元素不存在'));
            return;
        }
        if (Math.abs(video.currentTime - time) < 0.03) {
            resolve(true);
            return;
        }

        let timeoutId;
        const isStale = () => seekToken !== thumbnailState.seekToken;
        const cleanup = () => {
            clearTimeout(timeoutId);
            video.removeEventListener('seeked', onSeeked);
            video.removeEventListener('error', onError);
        };
        const onSeeked = () => {
            cleanup();
            resolve(!isStale());
        };
        const onError = () => {
            cleanup();
            if (isStale()) {
                resolve(false);
                return;
            }
            reject(new Error('视频定位失败'));
        };

        timeoutId = setTimeout(() => {
            cleanup();
            if (isStale()) {
                resolve(false);
                return;
            }
            reject(new Error('视频定位超时'));
        }, 8000);

        video.addEventListener('seeked', onSeeked, { once: true });
        video.addEventListener('error', onError, { once: true });
        if (typeof video.fastSeek === 'function') {
            try {
                video.fastSeek(time);
            } catch (error) {
                video.currentTime = time;
            }
        } else {
            video.currentTime = time;
        }
    });
}

function captureCurrentThumbnail(options = {}) {
    const video = document.getElementById('thumbnail-video');
    if (!isThumbnailVideoReady(video) || !video.videoWidth || !video.videoHeight) {
        if (!options.silent) {
            setThumbnailStatus('请先选择并加载可截图的视频');
        }
        return Promise.resolve(null);
    }

    const sessionToken = thumbnailState.sessionToken;
    return new Promise(resolve => {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext('2d');
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(blob => {
            if (sessionToken !== thumbnailState.sessionToken) {
                resolve(null);
                return;
            }
            if (!blob) {
                setThumbnailStatus('截图失败');
                resolve(null);
                return;
            }

            const currentTime = video.currentTime;
            const fileName = createThumbnailFileName(currentTime);
            const file = new File([blob], fileName, {
                type: 'image/jpeg',
                lastModified: Date.now()
            });
            const capture = {
                id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                file,
                url: URL.createObjectURL(file),
                time: currentTime,
                name: fileName
            };
            thumbnailState.captures.push(capture);
            renderThumbnailCaptures();
            setThumbnailStatus(`已截图：${formatThumbnailTime(currentTime)}`);
            resolve(capture);
        }, 'image/jpeg', 0.9);
    });
}

async function batchCaptureThumbnails() {
    const video = document.getElementById('thumbnail-video');
    if (!isThumbnailVideoReady(video)) {
        setThumbnailStatus('请先选择可播放的视频');
        return;
    }
    if (thumbnailState.isBatchRunning) return;

    const targets = getThumbnailBatchTargets();
    if (!targets.length) return;

    const batchSessionToken = thumbnailState.sessionToken;
    thumbnailState.isBatchRunning = true;
    thumbnailState.abortBatch = false;
    setThumbnailBatchControls(true);
    video.pause();

    try {
        for (let i = 0; i < targets.length; i++) {
            if (thumbnailState.abortBatch || batchSessionToken !== thumbnailState.sessionToken) break;
            await seekThumbnailVideo(targets[i]);
            if (thumbnailState.abortBatch || batchSessionToken !== thumbnailState.sessionToken) break;
            await captureCurrentThumbnail({ silent: true });
            if (thumbnailState.abortBatch || batchSessionToken !== thumbnailState.sessionToken) break;
            updateThumbnailProgress((i + 1) / targets.length * 100);
            setThumbnailStatus(`批量截图 ${i + 1} / ${targets.length}`);
        }
    } catch (error) {
        if (batchSessionToken === thumbnailState.sessionToken) {
            setThumbnailStatus(error.message || '批量截图失败');
        }
    } finally {
        thumbnailState.isBatchRunning = false;
        thumbnailState.abortBatch = false;
        if (batchSessionToken === thumbnailState.sessionToken) {
            setThumbnailBatchControls(false);
        }
    }
}

function setThumbnailBatchControls(isRunning) {
    const batchButton = document.getElementById('thumbnail-batch-capture');
    const progress = document.getElementById('thumbnail-batch-progress');

    if (batchButton) {
        batchButton.disabled = false;
        batchButton.classList.toggle('is-primary', !isRunning);
        batchButton.classList.toggle('is-warning', isRunning);
        if (isRunning) {
            batchButton.textContent = '停止截图';
        } else {
            updateThumbnailBatchButtonLabel();
        }
    }
    if (progress) {
        progress.style.display = isRunning ? 'block' : 'none';
        progress.value = 0;
    }
}

function updateThumbnailProgress(value) {
    const progress = document.getElementById('thumbnail-batch-progress');
    if (progress) {
        progress.value = Math.max(0, Math.min(100, value));
    }
}

function renderThumbnailCaptures() {
    const grid = document.getElementById('thumbnail-grid');
    if (!grid) return;
    grid.innerHTML = '';

    if (!thumbnailState.captures.length) {
        const empty = document.createElement('div');
        empty.className = 'thumbnail-empty';
        empty.textContent = '截图将显示在这里';
        grid.appendChild(empty);
        updateThumbnailSelectionControls();
        return;
    }

    thumbnailState.captures.forEach(capture => {
        const isSelected = thumbnailState.selectedCaptureIds.has(capture.id);
        const item = document.createElement('div');
        item.className = `thumbnail-item${isSelected ? ' is-selected' : ''}`;
        item.draggable = true;
        item.dataset.id = capture.id;

        const image = document.createElement('img');
        image.src = capture.url;
        image.alt = capture.name;

        const timeBadge = document.createElement('span');
        timeBadge.className = 'thumbnail-item-time';
        timeBadge.textContent = formatThumbnailTime(capture.time);

        const selectButton = document.createElement('button');
        selectButton.className = 'thumbnail-select-toggle';
        selectButton.type = 'button';
        selectButton.setAttribute('aria-label', isSelected ? '取消选择' : '选择缩略图');
        selectButton.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
        selectButton.textContent = '✓';
        selectButton.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            toggleThumbnailCaptureSelection(capture.id);
        });

        const deleteButton = document.createElement('button');
        deleteButton.className = 'thumbnail-delete';
        deleteButton.type = 'button';
        deleteButton.setAttribute('aria-label', '删除');
        deleteButton.innerHTML = `
            <svg width="12" height="12" fill="currentColor" stroke="none" aria-label="删除">
                <use href="../static/sprite.svg#close-icon"></use>
            </svg>
        `;
        deleteButton.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            deleteThumbnailCapture(capture.id);
        });

        item.append(image, selectButton, timeBadge, deleteButton);
        item.addEventListener('click', () => jumpThumbnailVideoToCapture(capture));
        item.addEventListener('dragstart', event => startThumbnailDrag(event, capture, item));
        item.addEventListener('dragend', () => {
            setThumbnailDraggingState([], false);
            setTimeout(clearThumbnailDragCache, 0);
        });
        grid.appendChild(item);
    });
    updateThumbnailSelectionControls();
}

function startThumbnailDrag(event, capture, item) {
    const captures = getThumbnailDragCaptures(capture);
    setThumbnailDraggingState(captures.map(item => item.id), true);
    window.currentDraggedThumbnailFiles = captures.map(item => item.file);
    window.currentDraggedThumbnailFile = captures.length === 1 ? captures[0].file : null;
    event.dataTransfer.effectAllowed = 'copy';
    captures.forEach(item => {
        try {
            event.dataTransfer.items.add(item.file);
        } catch (error) {
            // Some browsers do not allow adding File objects during dragstart.
        }
    });
    event.dataTransfer.setData('text/plain', captures.map(item => item.name).join('\n'));
    event.dataTransfer.setData('text/uri-list', captures.map(item => item.url).join('\n'));
    event.dataTransfer.setData('DownloadURL', `${captures[0].file.type}:${captures[0].name}:${captures[0].url}`);
}

function toggleThumbnailCaptureSelection(captureId) {
    if (thumbnailState.selectedCaptureIds.has(captureId)) {
        thumbnailState.selectedCaptureIds.delete(captureId);
    } else {
        thumbnailState.selectedCaptureIds.add(captureId);
    }
    renderThumbnailCaptures();
}

function toggleAllThumbnailCaptures() {
    if (!thumbnailState.captures.length) return;

    const allSelected = thumbnailState.captures.every(capture => thumbnailState.selectedCaptureIds.has(capture.id));
    thumbnailState.selectedCaptureIds.clear();
    if (!allSelected) {
        thumbnailState.captures.forEach(capture => thumbnailState.selectedCaptureIds.add(capture.id));
    }
    renderThumbnailCaptures();
}

function updateThumbnailSelectionControls() {
    const clearButton = document.getElementById('thumbnail-clear-captures');
    const selectAllButton = document.getElementById('thumbnail-select-all');
    const selectedCount = document.getElementById('thumbnail-selected-count');
    const sendAddButton = document.getElementById('thumbnail-send-add');
    const sendEditButton = document.getElementById('thumbnail-send-edit');
    const downloadSelectedButton = document.getElementById('thumbnail-download-selected');
    const totalCount = thumbnailState.captures.length;
    const validIds = new Set(thumbnailState.captures.map(capture => capture.id));

    thumbnailState.selectedCaptureIds.forEach(id => {
        if (!validIds.has(id)) {
            thumbnailState.selectedCaptureIds.delete(id);
        }
    });

    const selectedTotal = thumbnailState.selectedCaptureIds.size;
    const hasSelected = selectedTotal > 0;
    const allSelected = totalCount > 0 && selectedTotal === totalCount;
    if (clearButton) {
        clearButton.disabled = totalCount === 0;
    }
    if (selectAllButton) {
        selectAllButton.disabled = totalCount === 0;
        selectAllButton.textContent = allSelected ? '取消全选' : '全选';
        selectAllButton.classList.toggle('is-light', !allSelected);
    }
    if (selectedCount) {
        selectedCount.textContent = `已选 ${selectedTotal} 张`;
    }
    if (sendAddButton) {
        sendAddButton.disabled = !hasSelected || typeof window['addimage-upload-areaFiles'] !== 'function';
    }
    if (sendEditButton) {
        const editModalOpen = isThumbnailEditModalOpen();
        sendEditButton.disabled = !hasSelected || !editModalOpen || typeof window['addedit-image-upload-areaFiles'] !== 'function';
        sendEditButton.title = editModalOpen ? '' : '请先打开编辑电影窗口';
    }
    if (downloadSelectedButton) {
        downloadSelectedButton.disabled = !hasSelected;
    }
}

function getSelectedThumbnailCaptures() {
    return thumbnailState.captures.filter(capture => thumbnailState.selectedCaptureIds.has(capture.id));
}

function isThumbnailEditModalOpen() {
    return document.getElementById('editModal')?.classList.contains('is-active') || false;
}

function sendSelectedThumbnailCapturesToUploadArea(areaId, label) {
    const selectedCaptures = getSelectedThumbnailCaptures();
    if (!selectedCaptures.length) {
        showAlert({
            title: '请选择缩略图',
            message: '请先选中需要复用的缩略图。',
            type: 'warning',
            showCancel: false
        });
        return;
    }

    if (areaId === 'edit-image-upload-area' && !isThumbnailEditModalOpen()) {
        showAlert({
            title: '编辑窗口未打开',
            message: '请先打开要编辑的电影，再把缩略图加入编辑电影图片区。',
            type: 'warning',
            showCancel: false
        });
        updateThumbnailSelectionControls();
        return;
    }

    const addFiles = window[`add${areaId}Files`];
    if (typeof addFiles !== 'function') {
        showAlert({
            title: '加入失败',
            message: `${label}图片区还没有准备好，请稍后再试。`,
            type: 'error',
            showCancel: false
        });
        updateThumbnailSelectionControls();
        return;
    }

    addFiles(selectedCaptures.map(capture => capture.file));
    setThumbnailStatus(`已加入 ${selectedCaptures.length} 张缩略图到${label}图片区`);
    showAlert({
        title: '已加入',
        message: `已将 ${selectedCaptures.length} 张缩略图加入${label}图片区。`,
        type: 'success',
        showCancel: false
    });
}

function downloadSelectedThumbnailCaptures() {
    const selectedCaptures = getSelectedThumbnailCaptures();
    if (!selectedCaptures.length) {
        showAlert({
            title: '请选择缩略图',
            message: '请先选中需要下载的缩略图。',
            type: 'warning',
            showCancel: false
        });
        return;
    }

    selectedCaptures.forEach(capture => {
        const link = document.createElement('a');
        link.href = capture.url;
        link.download = capture.name;
        document.body.appendChild(link);
        link.click();
        link.remove();
    });

    setThumbnailStatus(`已开始下载 ${selectedCaptures.length} 张缩略图`);
    showAlert({
        title: '开始下载',
        message: `已触发 ${selectedCaptures.length} 张缩略图下载，移动端浏览器可能会逐个确认或保存。`,
        type: 'success',
        showCancel: false
    });
}

function getThumbnailDragCaptures(capture) {
    if (thumbnailState.selectedCaptureIds.has(capture.id)) {
        const selectedCaptures = thumbnailState.captures.filter(item => thumbnailState.selectedCaptureIds.has(item.id));
        return selectedCaptures.length ? selectedCaptures : [capture];
    }
    return [capture];
}

function setThumbnailDraggingState(captureIds, isDragging) {
    document.querySelectorAll('.thumbnail-item.dragging').forEach(item => {
        item.classList.remove('dragging');
    });
    if (!isDragging) return;

    const idSet = new Set(captureIds);
    document.querySelectorAll('.thumbnail-item').forEach(item => {
        item.classList.toggle('dragging', idSet.has(item.dataset.id));
    });
}

function clearThumbnailDragCache() {
    window.currentDraggedThumbnailFile = null;
    window.currentDraggedThumbnailFiles = [];
}

async function jumpThumbnailVideoToCapture(capture) {
    const video = document.getElementById('thumbnail-video');
    if (!capture || !isThumbnailVideoReady(video)) return;

    video.pause();
    try {
        await seekThumbnailVideo(clampThumbnailTime(capture.time, video.duration));
        setThumbnailStatus(`已跳转：${formatThumbnailTime(video.currentTime)} / ${formatThumbnailTime(video.duration)}`);
    } catch (error) {
        setThumbnailStatus(error.message || '视频定位失败');
    }
}

function deleteThumbnailCapture(captureId) {
    const index = thumbnailState.captures.findIndex(capture => capture.id === captureId);
    if (index === -1) return;
    URL.revokeObjectURL(thumbnailState.captures[index].url);
    thumbnailState.captures.splice(index, 1);
    thumbnailState.selectedCaptureIds.delete(captureId);
    renderThumbnailCaptures();
}

function clearThumbnailCaptures() {
    thumbnailState.captures.forEach(capture => URL.revokeObjectURL(capture.url));
    thumbnailState.captures = [];
    thumbnailState.selectedCaptureIds.clear();
    clearThumbnailDragCache();
    renderThumbnailCaptures();
}

function createThumbnailFileName(time) {
    const sourceName = thumbnailState.selectedVideo?.name || 'video';
    const baseName = sourceName.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_');
    return `${baseName}_${time.toFixed(2)}s.jpg`;
}

function formatThumbnailBytes(bytes) {
    if (!Number.isFinite(bytes)) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatThumbnailTime(value) {
    if (!Number.isFinite(value)) return '00:00';
    const totalSeconds = Math.max(0, value);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const fraction = Math.floor((totalSeconds % 1) * 100);
    const base = hours > 0
        ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
        : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    return `${base}.${String(fraction).padStart(2, '0')}`;
}

function initImageUpload() {
    // 为添加和编辑表单分别初始化上传区域
    initUploadArea('image-upload-area', 'image-input');
    initUploadArea('edit-image-upload-area', 'edit-image-input');
}

function initUploadArea(areaId, inputId) {
    const uploadArea = document.getElementById(areaId);
    if (!uploadArea) return; // 确保元素存在

    const imageInput = document.getElementById(inputId);
    const previewContainer = uploadArea.querySelector('.image-preview-container');
    const uploadPlaceholder = uploadArea.querySelector('.upload-placeholder');
    let uploadedFiles = []; // 存储文件对象
    let isPreviewDragging = false; // 预览图拖拽状态标记
    
    // 更新上传区域显示状态
    function updateUploadArea() {
        uploadPlaceholder.style.display = uploadedFiles.length > 0 ? 'none' : 'block';
    }

    // 更新所有预览项的索引
    function updatePreviewIndexes() {
        const items = previewContainer.querySelectorAll('.preview-item');
        items.forEach((item, index) => {
            item.dataset.index = index;
        });
    }

    // 处理新文件
    function handleNewFiles(newFiles) {
        // 图片文件验证
        const validFiles = newFiles.filter(file => file.type.startsWith('image/'));
        
        if (validFiles.length === 0) {
            showAlert({
                title: '操作失败',
                message: '请选择图片文件',
                type: 'warning',
                showCancel: false
            });
            return;
        }
        
        // 过滤掉重复文件
        const fileIdentifiers = uploadedFiles.map(f => `${f.name}-${f.size}-${f.type}`);
        const uniqueFiles = validFiles.filter(file => 
            !fileIdentifiers.includes(`${file.name}-${file.size}-${file.type}`)
        );
        
        if (uniqueFiles.length === 0) {
            showAlert({
                title: '操作失败',
                message: '所选图片已存在',
                type: 'warning',
                showCancel: false
            });
            return;
        }

        uniqueFiles.forEach(file => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const index = uploadedFiles.length;
                uploadedFiles.push(file);
                addImagePreview(e.target.result, uploadArea, index);
                updatePreviewIndexes();
                updateUploadArea();
            };
            reader.readAsDataURL(file);
        });
    }

    /* PC端使用的是HTML5原生拖放API(dragstart、dragover、drop等事件)。
    在uploadArea的drop事件处理中已经包含了文件数组顺序的更新逻辑。 
    而移动端使用的是触摸事件(touchstart、touchmove、touchend)来模拟拖放行为。
    在touchmove(handleDragOver)中只改变了DOM元素的位置，没有同步更新文件数组的顺序。
    所以需要在touchend中添加文件数组顺序更新的逻辑，使移动端的行为与PC端保持一致。*/

    // 预览图拖拽事件 - 开始
    previewContainer.addEventListener('dragstart', (e) => {
        if (e.target.closest('.preview-item')) {
            isPreviewDragging = true;
            e.target.closest('.preview-item').classList.add('dragging');
        }
    });
    // 移动端预览图拖拽事件 - 开始
    previewContainer.addEventListener('touchstart', (e) => {
        if (e.target.closest('.preview-item')) {
            isPreviewDragging = true;
            e.target.closest('.preview-item').classList.add('dragging');
        }
    }, { passive: true });
    // 预览图拖拽事件 - 结束
    previewContainer.addEventListener('dragend', () => {
        isPreviewDragging = false;
        const dragItem = previewContainer.querySelector('.dragging');
        if (dragItem) dragItem.classList.remove('dragging');
    });
    // 移动端预览图拖拽事件 - 结束
    previewContainer.addEventListener('touchend', () => {
        isPreviewDragging = false;
        const dragItem = previewContainer.querySelector('.dragging');
        if (dragItem) {
            dragItem.classList.remove('dragging');
            // 确保在触摸结束时再次同步文件顺序
            const items = [...previewContainer.querySelectorAll('.preview-item')];
            const finalUploadedFiles = [];
            items.forEach(item => {
                const oldIndex = parseInt(item.dataset.index);
                if (uploadedFiles[oldIndex]) {
                    finalUploadedFiles.push(uploadedFiles[oldIndex]);
                }
            });
            uploadedFiles = finalUploadedFiles;
            updatePreviewIndexes();
        }
    }, { passive: true });
    // 预览图拖拽事件 - 移动
    previewContainer.addEventListener('dragover', handleDragOver);
    // 移动端预览图拖拽事件 - 移动
    previewContainer.addEventListener('touchmove', handleDragOver);

    function handleDragOver(e) {
        e.preventDefault();
        if (!isPreviewDragging) return;
    
        const clientX = e.clientX || e.touches[0].clientX;
        const clientY = e.clientY || e.touches[0].clientY;
    
        const draggingItem = previewContainer.querySelector('.dragging');
        if (!draggingItem) return;
    
        const afterElement = getDragAfterElement(previewContainer, clientX, clientY);
        if (afterElement) {
            previewContainer.insertBefore(draggingItem, afterElement);
        } else {
            previewContainer.appendChild(draggingItem);
        }
    }

    // 删除预览图片的处理
    previewContainer.addEventListener('click', (e) => {
        // 检查点击的是否是删除按钮或其子元素(SVG图标)
        const deleteButton = e.target.closest('.delete-image');
        if (!deleteButton) return;

        e.preventDefault();  // 阻止默认行为
        e.stopPropagation(); // 阻止事件冒泡
        const previewItem = deleteButton.closest('.preview-item');
        if (previewItem) {
            // 更新uploadedFiles数组
            const index = Array.from(previewContainer.children).indexOf(previewItem);
            uploadedFiles.splice(index, 1);
            previewItem.remove();
            updatePreviewIndexes();
            updateUploadArea();
        }
    });

    // 点击上传
    uploadArea.addEventListener('click', () => {
        imageInput.click();
    });

    // 拖放处理
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!isPreviewDragging) {
            uploadArea.classList.add('dragover');
        }
    });
    
    uploadArea.addEventListener('dragleave', () => {
        if (!isPreviewDragging) {
            uploadArea.classList.remove('dragover');
        }
    });
    
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        if (isPreviewDragging) {
            const draggingItem = previewContainer.querySelector('.dragging');
            if (!draggingItem) return;

            const fromIndex = parseInt(draggingItem.dataset.index);
            const items = [...previewContainer.querySelectorAll('.preview-item')];
            const toIndex = items.indexOf(draggingItem);

            if (fromIndex !== toIndex) {
                const [movedFile] = uploadedFiles.splice(fromIndex, 1);
                uploadedFiles.splice(toIndex, 0, movedFile);

                items.forEach((item, index) => {
                    item.dataset.index = index;
                });
            }
        } else {
            uploadArea.classList.remove('dragover');
            if (Array.isArray(window.currentDraggedThumbnailFiles) && window.currentDraggedThumbnailFiles.length) {
                handleNewFiles(window.currentDraggedThumbnailFiles);
                return;
            }
            if (window.currentDraggedThumbnailFile) {
                handleNewFiles([window.currentDraggedThumbnailFile]);
                return;
            }
            handleNewFiles(Array.from(e.dataTransfer.files)); // 排除重复文件
        }
    });
    
    // 文件选择处理
    imageInput.addEventListener('change', () => {
        // 排除重复文件
        handleNewFiles(Array.from(imageInput.files));
    });
    
    // 重置函数
    window[`reset${areaId}`] = () => {
        uploadedFiles = [];
        previewContainer.innerHTML = '';
        uploadPlaceholder.style.display = 'block';
        imageInput.value = '';
    };

    // 将uploadedFiles暴露给表单使用
    window[`get${areaId}Files`] = () => uploadedFiles;
    window[`add${areaId}Files`] = (files) => handleNewFiles(Array.from(files || []));
}

// 添加预览图片
function addImagePreview(imageData, uploadArea, index) {
    const previewContainer = uploadArea.querySelector('.image-preview-container');
    const previewItem = document.createElement('div');
    previewItem.className = 'preview-item';
    previewItem.dataset.index = index;
    previewItem.draggable = true; // 允许拖拽

    previewItem.innerHTML = `
        <img src="${imageData}" alt="预览图">
        <button class="delete-image" type="button">
            <svg width="12" height="12" fill="currentColor" stroke="none" aria-label="删除">
                <use href="../static/sprite.svg#close-icon"></use>
            </svg>
        </button>
    `;
    
    // 拖拽事件
    previewItem.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', index);
        previewItem.classList.add('dragging');
    });

    previewItem.addEventListener('dragend', () => {
        previewItem.classList.remove('dragging');
    });

    previewContainer.appendChild(previewItem);
}

// 添加图片查看器相关函数
let currentImageIndex = 0;
let currentImages = [];
const IMAGE_VIEWER_WIDTH_RATIO = 3 / 5;
const IMAGE_VIEWER_MAX_HEIGHT_RATIO = 0.9;
const IMAGE_VIEWER_MOBILE_BREAKPOINT = 768;

function setImageViewerModalWidth() {
    const modal = document.getElementById('imageViewerModal');
    const modalCard = modal?.querySelector('.modal-card');
    if (!modalCard) return;

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    modalCard.style.width = viewportWidth <= IMAGE_VIEWER_MOBILE_BREAKPOINT
        ? '90%'
        : `${Math.round(viewportWidth * IMAGE_VIEWER_WIDTH_RATIO)}px`;
    modalCard.style.height = 'auto';
    modalCard.style.maxHeight = `${Math.round(viewportHeight * IMAGE_VIEWER_MAX_HEIGHT_RATIO)}px`;
    modalCard.style.overflow = 'hidden';
    modalCard.style.overflowY = 'hidden';
}

function centerImageViewerModal() {
    const modal = document.getElementById('imageViewerModal');
    const modalCard = modal?.querySelector('.modal-card');
    if (!modalCard || !modal.classList.contains('is-active')) return;

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const modalWidth = modalCard.offsetWidth;
    const modalHeight = modalCard.offsetHeight;

    modalCard.style.left = `${Math.max(0, (viewportWidth - modalWidth) / 2)}px`;
    modalCard.style.top = `${Math.max(0, (viewportHeight - modalHeight) / 2)}px`;
}

function getImageViewerMaxBodyHeight(modal, modalCard) {
    const header = modal.querySelector('.modal-card-head');
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const maxModalHeight = Math.round(viewportHeight * IMAGE_VIEWER_MAX_HEIGHT_RATIO);
    const headerHeight = header ? header.offsetHeight : 0;

    modalCard.style.maxHeight = `${maxModalHeight}px`;
    modalCard.style.overflow = 'hidden';
    modalCard.style.overflowY = 'hidden';

    return Math.max(1, maxModalHeight - headerHeight);
}

function resizeImageViewerImage() {
    const modal = document.getElementById('imageViewerModal');
    const modalCard = modal?.querySelector('.modal-card');
    const modalBody = modal?.querySelector('.modal-card-body');
    const viewer = modal?.querySelector('.viewer-image');
    const container = modal?.querySelector('.image-viewer-container');
    const scrollContainer = modal?.querySelector('.image-viewer-scroll');

    if (!modalCard || !modalBody || !viewer || !container || !scrollContainer || !viewer.naturalWidth || !viewer.naturalHeight) return;

    const displayWidth = scrollContainer.clientWidth || container.clientWidth || modalCard.clientWidth;
    if (!displayWidth) return;

    const idealImageHeight = Math.round(displayWidth * viewer.naturalHeight / viewer.naturalWidth);
    const bodyHeight = Math.min(idealImageHeight, getImageViewerMaxBodyHeight(modal, modalCard));

    modalBody.style.height = `${bodyHeight}px`;
    modalBody.style.maxHeight = `${bodyHeight}px`;
    container.style.height = `${bodyHeight}px`;
    scrollContainer.style.height = '100%';
    viewer.style.width = '100%';
    viewer.style.height = `${idealImageHeight}px`;
    centerImageViewerModal();
}

function resetImageViewerScroll() {
    const scrollContainer = document.getElementById('imageViewerModal')?.querySelector('.image-viewer-scroll');
    if (scrollContainer) {
        scrollContainer.scrollTop = 0;
        scrollContainer.scrollLeft = 0;
    }
}

function scheduleImageViewerResize() {
    requestAnimationFrame(() => {
        resizeImageViewerImage();
        requestAnimationFrame(resizeImageViewerImage);
    });
}

function openImageViewer(imageFilenames, movieTitle) {
    currentImageIndex = 0;
    currentImages = [];
    
    currentImages = imageFilenames.split(',').filter(name => name.trim());

    const modal = document.getElementById('imageViewerModal');
    setImageViewerModalWidth();
    modal.querySelector('.modal-card-title').textContent = `查看图片：${movieTitle}`;
    
    updateViewerImage();
    ModalManager.open('imageViewerModal');
    scheduleImageViewerResize();
}
function updateViewerImage() {
    const modal = document.getElementById('imageViewerModal');
    const viewer = modal.querySelector('.viewer-image');
    const prevButton = modal.querySelector('.nav-button.prev');
    const nextButton = modal.querySelector('.nav-button.next');
    const counter = modal.querySelector('.image-counter');
    
    viewer.onload = scheduleImageViewerResize;
    resetImageViewerScroll();
    viewer.style.height = 'auto';
    viewer.src = buildImageUrl(currentImages[currentImageIndex]);
    if (viewer.complete) {
        scheduleImageViewerResize();
    }
    
    // 只有多张图片时才显示计数器
    counter.style.display = currentImages.length > 1 ? 'block' : 'none';
    
    // 根据图片位置和数量控制导航按钮
    prevButton.style.display = currentImages.length > 1 && currentImageIndex > 0 ? 'flex' : 'none';
    nextButton.style.display = currentImages.length > 1 && currentImageIndex < currentImages.length - 1 ? 'flex' : 'none';
    
    if (currentImages.length > 1) {
        updateImageCounter();
    }
}
function updateImageCounter() {
    const counter = document.getElementById('imageViewerModal').querySelector('.image-counter');
    counter.textContent = `${currentImageIndex + 1} / ${currentImages.length}`;
}
function closeImageViewer() {
    ModalManager.close('imageViewerModal');
}
function showPrevImage() {
    if (currentImageIndex > 0) {
        currentImageIndex--;
        updateViewerImage();
    }
}
function showNextImage() {
    if (currentImageIndex < currentImages.length - 1) {
        currentImageIndex++;
        updateViewerImage();
    }
}

// 添加电影的表单提交处理
document.getElementById('add-movie-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    const formData = new FormData(this);
    const messageDiv = document.getElementById('add-movie-message');
    
    try {
        const files = window[`getimage-upload-areaFiles`]() || [];
        const uploadedFiles = [];

        // 获取当前预览容器中的顺序
        const previewItems = document.querySelectorAll('#image-upload-area .preview-item');
        for(const item of previewItems) {
            const index = parseInt(item.dataset.index);
            const file = files[index];

            // 上传所有图片并收集文件名
            const imageFormData = new FormData();
            imageFormData.append('image', file);
            imageFormData.append('title', formData.get('title'));
            
            const result = await fetch('/api', {
                method: 'POST',
                body: imageFormData
            }).then(res => res.json());

            if(result.success) {
                uploadedFiles.push(result.filename);
            } else {
                showAlert({
                    title: '上传失败',
                    message: result.message || '图片上传失败',
                    type: 'error',
                    showCancel: false
                });
            }
        }

        // 构建提交数据
        const data = {
            title: formData.get('title'),
            recommended: formData.get('recommended') === '1',
            review: formData.get('review'),
            tags: Array.from(document.querySelectorAll('#add-tags .tag.is-selected'))
                        .map(tag => tag.textContent).join(','),
            ratings: collectRatings(),
            image_filenames: uploadedFiles.join(',')
        };

        // API提交电影信息
        const result = await callApi(event_map.add_movie, data);

        // 清除表单
        if (result.message) {
            messageDiv.innerHTML = `<div class="notification is-success">${result.message}</div>`;
            this.reset();
            document.querySelectorAll('#add-tags .tag').forEach(tag => 
                tag.classList.remove('is-selected'));
            // 重置图片上传区
            window['resetimage-upload-area']();
            //searchMovies(); 不自动搜索电影
            // 成功消息定时清除
            setTimeout(() => {
                messageDiv.innerHTML = '';
            }, 3000);
        } else {
            messageDiv.innerHTML = `<div class="notification is-danger">${result.error || '添加失败'}</div>`;
        }
    } catch (error) {
        messageDiv.innerHTML = `<div class="notification is-danger">添加失败: ${error.message}</div>`;
    }
});

// 在页面加载时初始化
document.addEventListener('DOMContentLoaded', function() {
    loadFilters();
    
    // 添加事件监听
    document.getElementById('rating-dimension-filter').addEventListener('change', searchMovies);
    document.getElementById('min-rating-filter').addEventListener('change', searchMovies);	
    document.getElementById('search-button').addEventListener('click', searchMovies);

    // 快捷键监听
    document.getElementById('search-input').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            searchMovies();
        }
    });
    document.getElementById('wtl-input').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            searchWtl();
        }
    });
    document.getElementById('emby-search-input').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            searchEmby();
        }
    });
    document.getElementById('duplicate-input').addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.key === 'Enter') {
            checkDuplicates();
        }
    });

    // ----  添加电影折叠框相关监听 ---- //
    const form = document.querySelector('#add-movie-form');
    const movieNameInput = form.querySelector('input[name="title"]'); // 修改为正确的选择器
    const collapsibleBoxes = form.querySelectorAll('.collapsible-box');

    // 点击标题栏控制折叠展开
    collapsibleBoxes.forEach(box => {
        const header = box.querySelector('.box-header');
        header.addEventListener('click', () => {
            const content = box.querySelector('.box-content');
            const icon = box.querySelector('.collapse-icon');
            
            content.classList.toggle('expanded');
            icon.classList.toggle('collapsed');
        });
    });

    // 监听输入框变化
    if (movieNameInput) {  // 添加检查
        movieNameInput.addEventListener('input', function() {
            const hasContent = this.value.trim() !== '';
            collapsibleBoxes.forEach(box => {
                const content = box.querySelector('.box-content');
                const icon = box.querySelector('.collapse-icon');
                
                if (hasContent) {
                    content.classList.add('expanded');
                    icon.classList.remove('collapsed');
                } else {
                    content.classList.remove('expanded');
                    icon.classList.add('collapsed');
                }
            });
        });
    }
});
