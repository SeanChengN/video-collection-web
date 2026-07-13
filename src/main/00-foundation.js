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

function createIconSpan(iconId, options = {}) {
    return createEl('span', { className: 'icon' }, [
        createSpriteSvg(iconId, options)
    ]);
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

function createResultsCountSummary(count, unitText, extraClassName = '') {
    const safeCount = Math.max(0, Number(count) || 0);
    const className = ['results-count-summary', extraClassName]
        .filter(Boolean)
        .join(' ');
    return createEl('div', {
        className,
        attrs: { role: 'status', 'aria-live': 'polite' },
        text: `共 ${safeCount} ${unitText}`
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

const IMAGE_LAZY_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const imageObserver = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                loadDeferredImage(entry.target);
                observer.unobserve(entry.target);
            }
        });
    }, {
        rootMargin: '240px 0px',
        threshold: 0.01
    })
    : null;

function loadDeferredImage(image) {
    if (!image?.dataset.src) return;
    if (!image.src || image.src === IMAGE_LAZY_PLACEHOLDER) {
        image.src = image.dataset.src;
    }
    delete image.dataset.src;
}

function prepareDeferredImage(image, source, { eager = false, fetchPriority = 'auto' } = {}) {
    if (!image || !source) return image;
    image.decoding = 'async';
    image.loading = eager ? 'eager' : 'lazy';
    image.fetchPriority = fetchPriority;
    if (eager || !imageObserver) {
        image.src = source;
        return image;
    }

    image.src = IMAGE_LAZY_PLACEHOLDER;
    image.dataset.src = source;
    imageObserver.observe(image);
    return image;
}

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
        return document.querySelector(`[data-toolbar-modal="${modalId}"]`);
    }
};

// 最小化模态框
function minimizeModal(modalId) {
    ModalManager.minimize(modalId);
}

const itemsPerPage = 9; // 每页显示9条
let currentPage = 1;
let totalPages = 0;
let searchResultTotal = 0;
function buildImageUrl(filename, variant = '') {
    const parts = String(filename || '')
        .trim()
        .split('/')
        .filter(part => part);
    if (parts.length === 0) {
        return '';
    }
    const imageUrl = `../images/${parts.map(part => encodeURIComponent(part)).join('/')}`;
    return variant ? `${imageUrl}?variant=${encodeURIComponent(variant)}` : imageUrl;
}
let allMovies = []; // 存储所有搜索结果

// 定义全局配置变量
let staticDelegatesInitialized = false;
let dynamicDelegatesInitialized = false;
