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
    iconSvg.setAttribute('href', `/static/sprite.svg#alert-${type}-icon`);

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
        '/static/styles.min.css',
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
let allMovies = []; // 存储所有搜索结果

// 定义全局配置变量
let serviceConfig = {};

// 页面加载时获取所有服务配置
fetch('/get_services_config')
    .then(response => response.json())
    .then(config => {
        serviceConfig = config;
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
    
    // 使用 passive 选项优化事件监听
    modalHead.addEventListener('mousedown', dragStart, { passive: false });
    document.addEventListener('mousemove', drag, { passive: false });
    document.addEventListener('mouseup', dragEnd, { passive: true });

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

    fetch('/check_duplicates', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ titles: movieData.map(m => m.title) })
    })
    .then(response => response.json())
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
                            <td title="${movie.title}">${movie.title}</td>
                            <td title="${movie.matchedTitle || ''}">${movie.matchedTitle || ''}</td>
                            <td title="${movie.extra}">${movie.extra}</td>
                            <td>
                                <button class="button is-small copy-btn" onclick="copyToClipboard('${movie.extra.replace(/'/g, "\\'")}', this)">
                                    <span class="icon">
                                        <svg width="20" height="20" fill="#888888" stroke="none" aria-label="复制">
                                            <use href="/static/sprite.svg#copy-btn-icon"></use>
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
                                <td title="${movie.title}">${movie.title}</td>
                                <td title="${movie.matchedTitle}">${movie.matchedTitle}</td>
                                <td title="${movie.extra}">${movie.extra}</td>
                                <td>
                                    <button class="button is-small copy-btn" onclick="copyToClipboard('${movie.extra.replace(/'/g, "\\'")}', this)">
                                        <span class="icon">
                                            <svg width="20" height="20" fill="#888888" stroke="none" aria-label="复制">
                                                <use href="/static/sprite.svg#copy-btn-icon"></use>
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
        console.error('Error:', error);
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
        button.innerHTML = '<span class="icon"><svg width="20" height="20" fill="#fff"><use href="/static/sprite.svg#copy-success-btn-icon"></use></svg></span>';
        button.classList.add('is-success'); // 添加成功样式
    } catch (err) {
        // 修改按钮显示失败
        button.innerHTML = '<span class="icon"><svg width="20" height="20" fill="#fff"><use href="/static/sprite.svg#copy-fail-btn-icon"></use></svg></span>';
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
}

function searchEmby() {
    const query = document.getElementById('emby-search-input').value;
    const resultsDiv = document.getElementById('emby-results');
    
    if (!query.trim()) {
        resultsDiv.innerHTML = '<div class="notification is-warning">请输入搜索内容</div>';
        return;
    }
    
    resultsDiv.innerHTML = '<div class="notification is-info">正在搜索...</div>';
    
    fetch(`${serviceConfig.emby_server_url}/emby/Items?Recursive=true&IncludeItemTypes=Movie&NameStartsWith=${encodeURIComponent(query)}&api_key=${serviceConfig.emby_api_key}`)
        .then(response => response.json())
        .then(data => {
            if (data.Items.length === 0) {
                resultsDiv.innerHTML = '<div class="notification is-info">未找到相关影片</div>';
                return;
            }
            
            const fragment = document.createDocumentFragment();
            const container = document.createElement('div');
            container.className = 'columns is-multiline';
            
            data.Items.forEach(movie => {
                const column = document.createElement('div');
                column.className = 'column is-one-fifth';
                column.innerHTML = `
                    <div class="card movie-card">
                        <div class="card-image">
                            <figure class="image is-2by3">
                                <img data-src="${serviceConfig.emby_server_url}/emby/Items/${movie.Id}/Images/Primary?tag=${movie.ImageTags.Primary}&api_key=${serviceConfig.emby_api_key}" 
                                     alt="${movie.Name}"
                                     src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
                                <div class="runtime-badge">${formatRuntime(movie.RunTimeTicks)}</div>
                            </figure>
                        </div>
                        <div class="card-content fixed-height">
                            <p class="title is-6 movie-title" data-full-title="${movie.Name}">${movie.Name}</p>
                        </div>
                    </div>
                `;
                
                // 为新加载的图片添加懒加载观察
                const img = column.querySelector('img');
                imageObserver.observe(img);
                
                container.appendChild(column);
            });
            
            fragment.appendChild(container);
            resultsDiv.innerHTML = '';
            resultsDiv.appendChild(fragment);
        })
        .catch(error => {
            resultsDiv.innerHTML = '<div class="notification is-danger">搜索出错，请稍后重试</div>';
            console.error('Search error:', error);
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
        document.querySelector('#jackettModal iframe').src = `${serviceConfig.jackett_url}/UI/Dashboard#search`;
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
        document.querySelector('#thunderModal iframe').src = serviceConfig.thunder_url;
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
    }
}

function closeWtlModal() {
    ModalManager.close('wtlModal');
}

function searchWtl() {
    const query = document.getElementById('wtl-input').value;
    const resultsDiv = document.getElementById('wtl-results');
    
    if (!query.trim()) {
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
        })
        .catch(error => {
            resultsDiv.innerHTML = '<div class="notification is-danger">查询失败，请检查链接是否正确</div>';
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
    loadSettingsTags();
    loadSettingsRatingDimensions();
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
    
    fetch('/update_tag', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
            old_name: oldName,
            new_name: newName 
        })
    })
    .then(response => response.json())
    .then(result => {
        if (result.success) {
            // 只更新表格中的显示
            nameDiv.textContent = newName;
            // 更新编辑表单中的值
            input.value = newName;
            // 更新按钮的 onclick 属性以使用新名称
            const saveButton = tr.querySelector('.edit-form button');
            saveButton.setAttribute('onclick', `saveTagEdit(this, '${newName}')`);
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
    })
    .catch(error => {
        console.error('Error:', error);
        showAlert({
            title: '更新失败',
            message: error.message || String(error),
            type: 'error',
            showCancel: false
        });
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
    
    fetch('/update_rating_dimension', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
            old_name: oldName,
            new_name: newName 
        })
    })
    .then(response => response.json())
    .then(result => {
        if (result.success) {
            // 只更新表格中的显示
            nameDiv.textContent = newName;
            // 更新编辑表单中的值
            input.value = newName;
            // 更新按钮的 onclick 属性以使用新名称
            const saveButton = tr.querySelector('.edit-form button');
            saveButton.setAttribute('onclick', `saveRatingEdit(this, '${newName}')`);
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
    })
    .catch(error => {
        console.error('Error:', error);
        showAlert({
            title: '更新失败',
            message: error.message || String(error),
            type: 'error',
            showCancel: false
        });
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
    
    fetch('/add_tag', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: tagName })
    })
    .then(response => response.json())
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
    })
    .catch(error => {
        console.error('Error:', error);
        showAlert({
            title: '添加失败',
            message: error.message || String(error),
            type: 'error',
            showCancel: false
        });
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
    
    fetch('/add_rating_dimension', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: ratingName })
    })
    .then(response => response.json())
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
    })
    .catch(error => {
        console.error('Error:', error);
        showAlert({
            title: '添加失败',
            message: error.message || String(error),
            type: 'error',
            showCancel: false
        });
    });
}

// 加载设置界面的标签列表
function loadSettingsTags() {
    fetch('/get_tags')
        .then(response => response.json())
        .then(result => {
            if (result.success) {
                const tagsList = document.getElementById('tagsList');
                tagsList.innerHTML = result.data.map(tag => `
                    <tr>
                        <td>
                            <div class="item-content">
                                <div class="tag-name">${tag}</div>
                                <div class="edit-form">
                                    <input type="text" class="input" value="${tag}">
                                    <button class="button is-success is-small save-btn-small" onclick="saveTagEdit(this, '${tag}')">
                                        <span class="icon">
                                            <svg width="10" height="10" fill="currentColor" stroke="none" aria-label="保存">
                                                <use href="/static/sprite.svg#save-btn-icon"></use>
                                            </svg>
                                        </span>
                                        <span>保存</span>
                                    </button>
                                    <button class="button is-light is-small" onclick="cancelEdit(this)">取消</button>
                                </div>
                            </div>
                        </td>
                        <td>
                            <button class="button is-small is-info edit-btn" onclick="startEdit(this)">
                                <span>编辑</span>
                            </button>
                        </td>
                    </tr>
                `).join('');

                // 更新标签计数
                document.querySelector('.tag-counter').textContent = result.data.length;
            }
        });
}

// 加载设置界面的评分维度列表
function loadSettingsRatingDimensions() {
    fetch('/get_ratings_dimensions')
        .then(response => response.json())
        .then(result => {
            if (result.success) {
                const ratingsList = document.getElementById('ratingsList');
                ratingsList.innerHTML = result.dimensions.map(dimension => `
                    <tr>
                        <td>
                            <div class="item-content">
                                <div class="rating-name">${dimension.name}</div>
                                <div class="edit-form">
                                    <input type="text" class="input" value="${dimension.name}">
                                    <button class="button is-success is-small save-btn-small" onclick="saveRatingEdit(this, '${dimension.name}')">
                                        <span class="icon">
                                            <svg width="10" height="10" fill="currentColor" stroke="none" aria-label="保存">
                                                <use href="/static/sprite.svg#save-btn-icon"></use>
                                            </svg>
                                        </span>
                                        <span>保存</span>
                                    </button>
                                    <button class="button is-light is-small" onclick="cancelEdit(this)">取消</button>
                                </div>
                            </div>
                        </td>
                        <td>
                            <button class="button is-small is-info edit-btn" onclick="startEdit(this)">
                                <span>编辑</span>
                            </button>
                        </td>
                    </tr>
                `).join('');
                
                // 更新评分维度计数
                document.querySelector('.rating-counter').textContent = result.dimensions.length;
            }
        });
}

function loadTags() {
    fetch('/get_tags')
        .then(response => response.json())
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
    // 加载评分维度
    fetch('/get_ratings_dimensions')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const dimensionSelect = document.getElementById('rating-dimension-filter');
                dimensionSelect.innerHTML = '<option value="">全部维度</option>';
                
                data.dimensions.forEach(dimension => {
                    const option = document.createElement('option');
                    option.value = dimension.name;
                    option.textContent = dimension.name;
                    dimensionSelect.appendChild(option);
                });
            }
        })
        .catch(error => {
            console.error('加载评分维度失败:', error);
            showAlert({
                title: '加载失败',
                message: error.message || String(error),
                type: 'error',
                showCancel: false
            });
        });

    // 加载标签
    fetch('/get_tags')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const tagsFilter = document.getElementById('tags-filter');
                tagsFilter.innerHTML = ''; // 清空现有标签
                
                data.data.forEach(tagName => {
                    const tagSpan = document.createElement('span');
                    tagSpan.className = 'tag';
                    tagSpan.textContent = tagName;
                    tagSpan.onclick = () => toggleFilterTag(tagSpan);
                    tagsFilter.appendChild(tagSpan);
                });
            }
        })
        .catch(error => {
            console.error('加载标签失败:', error);
            showAlert({
                title: '加载失败',
                message: error.message || String(error),
                type: 'error',
                showCancel: false
            });
        });
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
function searchMovies() {
    const title = document.getElementById('search-input').value.trim();
    const ratingDimension = document.getElementById('rating-dimension-filter').value;
    const minRating = document.getElementById('min-rating-filter').value;
    const selectedTags = getSelectedTags();
    const messageDiv = document.getElementById('search-message');
    const resultsDiv = document.getElementById('search-results');
    
    // 构建搜索参数
    const searchParams = new URLSearchParams();
    if (title) {
        searchParams.append('title', title);
    }
    if (ratingDimension) {
        searchParams.append('rating_dimension', ratingDimension);
    }
    if (minRating) {
        searchParams.append('min_rating', minRating);
    }
    if (selectedTags.length > 0) {
        searchParams.append('tags', selectedTags.join(','));
    }
    
    // 构建搜索URL
    const searchUrl = `/search?${searchParams.toString()}`;
    
    // 显示加载提示
    //messageDiv.innerHTML = '<div class="notification is-info">正在搜索...</div>';
    
    fetch(searchUrl)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP status: ${response.status}`);
            }
            return response.json();
        })
        .then(result => {
            if (!result) {
                throw new Error('No result returned from server');
            }

            if (result.success) {
                // 处理过滤
                let filteredMovies = result.data;
                
                // 标签过滤
                if (selectedTags.length > 0) {
                    filteredMovies = filteredMovies.filter(movie => {
                        const movieTags = movie.tag_names.split(', ');
                        return selectedTags.every(tag => movieTags.includes(tag));
                    });
                }
                
                // 评分过滤
                if (minRating) {
                    const minRatingValue = parseInt(minRating);
                    filteredMovies = filteredMovies.filter(movie => {
                        const ratings = movie.ratings_display || {};
                        
                        if (ratingDimension) {
                            // 特定维度过滤
                            return ratings[ratingDimension] >= minRatingValue;
                        } else {
                            // 全部维度过滤（所有维度都必须达到最低评分要求）
                            const ratingValues = Object.values(ratings);
                            return ratingValues.length > 0 && // 确保有评分
                                   ratingValues.every(rating => rating >= minRatingValue);
                        }
                    });
                }
    
                allMovies = filteredMovies;
                totalPages = Math.ceil(allMovies.length / itemsPerPage);
                
                if (allMovies.length === 0) {
                    messageDiv.innerHTML = '<div class="notification is-info">未找到电影</div>';
                    resultsDiv.innerHTML = '';
                    document.getElementById('pagination').innerHTML = '';
                    return;
                }

                // 不再默认回到首页
                //currentPage = 1;
                displayCurrentPage();
                messageDiv.innerHTML = ''; 
            } else {
                messageDiv.innerHTML = `<div class="notification is-warning">${result.message || '搜索失败'}</div>`;
            }
        })
        .catch(error => {
            console.error('Search error:', error);
            messageDiv.innerHTML = `<div class="notification is-danger">搜索出错: ${error.message}</div>`;
            resultsDiv.innerHTML = '';
            document.getElementById('pagination').innerHTML = '';
        });
}

function displayPagination() {
    const paginationHtml = `
        <nav class="pagination is-centered" role="navigation" aria-label="pagination">
            <a class="pagination-previous" ${currentPage === 1 ? 'disabled' : ''} onclick="changePage(${currentPage - 1})">上一页</a>
            <a class="pagination-next" ${currentPage === totalPages ? 'disabled' : ''} onclick="changePage(${currentPage + 1})">下一页</a>
            <ul class="pagination-list">
                ${generatePaginationItems()}
            </ul>
        </nav>
    `;
    
    document.getElementById('pagination').innerHTML = paginationHtml;
}

function generatePaginationItems() {
    let items = [];
    
    // 显示当前页码前后2页
    for (let i = Math.max(1, currentPage - 2); i <= Math.min(totalPages, currentPage + 2); i++) {
        items.push(`
            <li>
                <a class="pagination-link ${i === currentPage ? 'is-current' : ''}" 
                   onclick="changePage(${i})">${i}</a>
            </li>
        `);
    }
    
    return items.join('');
}

function changePage(page) {
    if (page >= 1 && page <= totalPages) {
        currentPage = page;
        displayCurrentPage();
    }
}

function closeModal() {
    ModalManager.close('editModal');
}

document.getElementById('search-input').addEventListener('input', debounce(searchMovies, 300));

// 动态加载非关键资源
function loadNonCriticalResources() {
    // 只加载实际存在的资源文件
    const resources = [
        // 示例: 如果有额外的JavaScript文件
        // { type: 'script', src: '/static/extra-features.js' },
        // 示例: 如果有额外的CSS文件
        // { type: 'style', href: '/static/extra-styles.css' }
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
    fetch('/get_ratings_dimensions')
        .then(response => response.json())
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
                    <use href="/static/sprite.svg#rating-star-icon"></use>
                </svg>
                <input type="radio" id="${prefix}rating-${dimension.id}-4" name="${prefix}rating-${dimension.id}" value="4">
                <svg width="16" height="16" fill="currentColor" stroke="none" aria-label="评分">
                    <use href="/static/sprite.svg#rating-star-icon"></use>
                </svg>
                <input type="radio" id="${prefix}rating-${dimension.id}-3" name="${prefix}rating-${dimension.id}" value="3">
                <svg width="16" height="16" fill="currentColor" stroke="none" aria-label="评分">
                    <use href="/static/sprite.svg#rating-star-icon"></use>
                </svg>
                <input type="radio" id="${prefix}rating-${dimension.id}-2" name="${prefix}rating-${dimension.id}" value="2">
                <svg width="16" height="16" fill="currentColor" stroke="none" aria-label="评分">
                    <use href="/static/sprite.svg#rating-star-icon"></use>
                </svg>
                <input type="radio" id="${prefix}rating-${dimension.id}-1" name="${prefix}rating-${dimension.id}" value="1">
                <svg width="16" height="16" fill="currentColor" stroke="none" aria-label="评分">
                    <use href="/static/sprite.svg#rating-star-icon"></use>
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
    existingImagesContainer.innerHTML = ''; // 清空现有内容

    // 数组存储当前显示的图片文件名
    const currentImages = new Set();

    if (movie.image_filename && movie.image_filename.trim()) {
        const images = movie.image_filename.split(',');
        images.forEach((filename, index) => {
            if (filename.trim()) {
                const imageWrapper = document.createElement('div');
                imageWrapper.className = 'existing-image-item';
                imageWrapper.draggable = true; // 添加可拖拽属性
                imageWrapper.dataset.index = index; // 添加索引用于排序
                imageWrapper.innerHTML = `
                    <img src="/images/${filename.trim()}" alt="预览图">
                    <button class="delete-existing-image" data-filename="${filename.trim()}" type="button">
                        <svg width="12" height="12" fill="currentColor" stroke="none" aria-label="删除">
                            <use href="/static/sprite.svg#close-icon"></use>
                        </svg>
                    </button>
                `;

                // 阻止右键菜单弹出
                imageWrapper.addEventListener('contextmenu', e => e.preventDefault());

                // 添加删除按钮点击事件
                const deleteButton = imageWrapper.querySelector('.delete-existing-image');
                deleteButton.addEventListener('click', (e) => {
                    e.preventDefault();
                    imageWrapper.remove();
                    currentImages.delete(filename.trim());
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
                });
                // 图片拖拽事件 - 结束
                imageWrapper.addEventListener('dragend', () => {
                    imageWrapper.classList.remove('dragging');
                    existingImagesContainer.classList.remove('dragging-over');
                });
                // 移动端图片拖拽事件 - 结束
                imageWrapper.addEventListener('touchend', () => {
                    imageWrapper.classList.remove('dragging');
                    existingImagesContainer.classList.remove('dragging-over');
                });

                existingImagesContainer.appendChild(imageWrapper);
                currentImages.add(filename.trim());
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
        });
        // 容器图片拖拽事件 - 结束
        existingImagesContainer.addEventListener('dragend', updateImageOrder);
        // 移动端容器图片拖拽事件 - 结束
        existingImagesContainer.addEventListener('touchend', updateImageOrder);

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
}

// 加载编辑标签
async function loadEditTags() {
    try {
        const response = await fetch('/get_tags');
        const result = await response.json();
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
        console.error('加载标签失败:', error);
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
        const response = await fetch('/get_ratings_dimensions');
        const result = await response.json();
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
        console.error('加载评分维度失败:', error);
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
            fetch(`/api/movies/${encodeURIComponent(title)}`, {
                method: 'DELETE'
            })
            .then(response => response.json())
            .then(data => {
                if (!data.success) {
                    throw new Error(data.message || '删除失败');
                }
                closeModal();
                // 恢复搜索状态并重新搜索
                restoreSearchState();
                searchMovies();
                showAlert({
                    title: '删除成功',
                    message: data.message || '电影已删除',
                    type: 'success',
                    showCancel: false
                });
            })
            .catch(error => {
                console.error('Error:', error);
                showAlert({
                    title: '删除失败',
                    message: error.message,
                    type: 'error',
                    showCancel: false
                });
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
            const response = await fetch('/upload_image', { method: 'POST', body: formData });
            return response.json();
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

        const response = await fetch(`/api/movies/${encodeURIComponent(title)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await response.json();
        if (result.message) {
            ModalManager.close('editModal');
            // 恢复搜索状态并重新搜索
            restoreSearchState();
            searchMovies();
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
function displayCurrentPage() {
    const resultsDiv = document.getElementById('search-results');
    resultsDiv.innerHTML = '';
    
    if (allMovies.length === 0) {
        resultsDiv.innerHTML = '<div class="notification is-info">没有找到电影</div>';
        document.getElementById('pagination').innerHTML = '';
        return;
    }

    const start = (currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const pageItems = allMovies.slice(start, end);

    // 创建表格容器
    const tableContainer = document.createElement('div');
    tableContainer.className = 'table-container';

    // 创建表格
    const table = document.createElement('table');
    table.className = 'table is-fullwidth is-striped is-hoverable';

    // 创建表头
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    
    // 应用列宽
    headerRow.innerHTML = `
        <th data-column="title" style="width: 23%">电影名称</th>
        <th data-column="recommended" style="width: 4.5%">推荐</th>
        <th data-column="review" style="width: 36%">评价</th>
        <th data-column="tags" style="width: 15.5%">标签</th>
        <th data-column="ratings" style="width: 10.5%">评分</th>
        <th data-column="action" style="width: 10.5%">操作</th>
    `;
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // 创建表格主体
    const tbody = document.createElement('tbody');
    
    // 遍历当前页的数据
    pageItems.forEach(movie => {
        const tr = document.createElement('tr');
        
        // 解析并过滤评分
        const movieRatings = movie.ratings ? movie.ratings.split(',').map(r => {
            const [dimensionId, value] = r.split(':');
            return {
                dimensionId: dimensionId.toString(), // 确保ID为字符串类型
                value: parseInt(value)
            };
        }).filter(r => r.value > 0) : [];
        
        // 只有存在非零评分时才创建评分下拉内容
        const ratingsHtml = movieRatings.length > 0 ? 
            movieRatings.map(rating => {
                // 确保使用字符串比较
                const dimension = ratingsDimensions.find(d => d.id.toString() === rating.dimensionId);
                if (dimension) {
                    return `
                        <div class="rating-item">
                            <span class="dimension-name">${dimension.name}:</span>
                            <span class="stars">${renderStars(rating.value)}</span>
                        </div>
                    `;
                }
                return '';
            }).join('') : '';

        // 根据是否有评分决定显示内容
        const ratingsCell = movieRatings.length > 0 ? 
            `<div class="dropdown is-hoverable">
                <div class="dropdown-trigger">
                    <button class="button is-small">
                        <span>查看评分</span>
                    </button>
                </div>
                <div class="dropdown-menu" role="menu">
                    <div class="dropdown-content">
                        ${ratingsHtml}
                    </div>
                </div>
            </div>` :
            '<button class="button is-small" disabled>暂无评分</button>';

            tr.innerHTML = `
            <td class="hoverable">
                ${movie.image_filename ? `
                    <div class="movie-title-with-image">
                        <div class="movie-preview-image" onclick="openImageViewer('${movie.image_filename}', '${movie.title}')">
                            <img src="/images/${movie.image_filename.split(',')[0]}" alt="预览图">
                        </div>
                        <span title="${movie.title}">${movie.title}</span>
                    </div>
                ` : `
                    <span title="${movie.title}">${movie.title}</span>
                `}
            </td>
            <td>
                <svg width="20" height="20" fill="${movie.recommended ? '#ff7b00' : '#515151'}" stroke="none" aria-label="${movie.recommended ? '推荐' : '不推荐'}">
                    <use href="/static/sprite.svg#${movie.recommended ? 'recommend-light-icon' : 'recommend-icon'}"></use>
                </svg>
            </td>
            <td class="hoverable" title="${movie.review || ''}">${movie.review || ''}</td>
            <td class="hoverable" title="${movie.tag_names || ''}">${movie.tag_names || ''}</td>
            <td class="ratings-cell">${ratingsCell}</td>
            <td>
                <button class="button is-small is-info edit-btn" onclick='openModal(${JSON.stringify(movie)})'>
                    <span>编辑</span>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
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
                <use href="/static/sprite.svg#rating-star-icon"></use>
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
function updatePagination() {
    const paginationDiv = document.getElementById('pagination');
    if (!paginationDiv) return;

    let paginationHtml = '<nav class="pagination is-centered" role="navigation" aria-label="pagination">';
    
    // 上一页按钮
    paginationHtml += `
        <a class="pagination-previous" ${currentPage <= 1 ? 'disabled' : ''} 
           onclick="${currentPage > 1 ? 'changePage(' + (currentPage - 1) + ')' : ''}"}>
           上一页
        </a>
    `;

    // 下一页按钮
    paginationHtml += `
        <a class="pagination-next" ${currentPage >= totalPages ? 'disabled' : ''} 
           onclick="${currentPage < totalPages ? 'changePage(' + (currentPage + 1) + ')' : ''}"}>
           下一页
        </a>
    `;

    // 页码列表
    paginationHtml += '<ul class="pagination-list">';
    
    // 显示页码的逻辑
    const delta = 2; // 当前页前后显示的页码数
    
    // 始终显示第一页
    if (currentPage > delta + 1) {
        paginationHtml += `
            <li><a class="pagination-link" onclick="changePage(1)">1</a></li>
            ${currentPage > delta + 2 ? '<li><span class="pagination-ellipsis">&hellip;</span></li>' : ''}
        `;
    }

    // 显示当前页附近的页码
    for (let i = Math.max(1, currentPage - delta); i <= Math.min(totalPages, currentPage + delta); i++) {
        if (i === currentPage) {
            paginationHtml += `<li><a class="pagination-link is-current" aria-current="page">${i}</a></li>`;
        } else {
            paginationHtml += `<li><a class="pagination-link" onclick="changePage(${i})">${i}</a></li>`;
        }
    }

    // 始终显示最后一页
    if (currentPage < totalPages - delta) {
        paginationHtml += `
            ${currentPage < totalPages - delta - 1 ? '<li><span class="pagination-ellipsis">&hellip;</span></li>' : ''}
            <li><a class="pagination-link" onclick="changePage(${totalPages})">${totalPages}</a></li>
        `;
    }
    
    paginationHtml += '</ul></nav>';
    paginationDiv.innerHTML = paginationHtml;
}

// 图片上传相关代码
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
    });
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
    });
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
                <use href="/static/sprite.svg#close-icon"></use>
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

function openImageViewer(imageFilenames, movieTitle) {
    currentImageIndex = 0;
    currentImages = [];
    
    currentImages = imageFilenames.split(',').filter(name => name.trim());

    const modal = document.getElementById('imageViewerModal');
    modal.querySelector('.modal-card-title').textContent = `查看图片：${movieTitle}`;
    
    updateViewerImage();
    ModalManager.open('imageViewerModal');
}
function updateViewerImage() {
    const modal = document.getElementById('imageViewerModal');
    const viewer = modal.querySelector('.viewer-image');
    const prevButton = modal.querySelector('.nav-button.prev');
    const nextButton = modal.querySelector('.nav-button.next');
    const counter = modal.querySelector('.image-counter');
    
    viewer.src = `/images/${currentImages[currentImageIndex].trim()}`;
    
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
            
            const response = await fetch('/upload_image', {
                method: 'POST',
                body: imageFormData
            });
            
            const result = await response.json();

            if(result.success) {
                uploadedFiles.push(result.filename);
            } else {
                throw new Error(result.message || '图片上传失败');
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
        const movieResponse = await fetch('/api/movies', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        })

        const result = await movieResponse.json();

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
        console.error('Error:', error);
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