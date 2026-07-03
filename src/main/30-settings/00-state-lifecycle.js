let settingsNeedsMainRefresh = false;

function markSettingsChanged() {
    settingsNeedsMainRefresh = true;
}

function openSettingsModal() {
    ModalManager.open('settingsModal');
    loadSettings();
}

function closeSettingsModal() {
    ModalManager.close('settingsModal');
    if (settingsNeedsMainRefresh) {
        settingsNeedsMainRefresh = false;
        refreshMainSettingsData();
    }
}

function refreshMainSettingsData() {
    Promise.all([
        loadTags(),
        loadRatingsDimensions(),
        loadFilters()
    ]).then(() => {
        if (hasActiveSearchState()) {
            searchCurrentPage();
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
        if (tab.dataset.tab === 'maintenance') {
            loadDatabaseBackups();
        }
    });
});

// 加载设置内容
function loadSettings() {
    return Promise.all([
        loadSettingsTags(),
        loadSettingsRatingDimensions(),
        loadDatabaseBackups()
    ]);
}
