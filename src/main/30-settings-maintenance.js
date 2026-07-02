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
            markSettingsChanged();
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
            markSettingsChanged();
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
                markSettingsChanged();
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
                markSettingsChanged();
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

function formatBackupSize(sizeBytes) {
    const size = Number(sizeBytes) || 0;
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
    return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function setMaintenanceBusy(isBusy) {
    const maintenanceSettings = document.getElementById('maintenanceSettings');
    if (!maintenanceSettings) return;
    maintenanceSettings.querySelectorAll('button').forEach(button => {
        button.disabled = isBusy;
    });
}

function setMaintenanceStatus(status) {
    const statusElement = document.getElementById('maintenanceDbStatus');
    const panel = document.querySelector('.maintenance-panel');
    if (!statusElement) return;
    if (panel) {
        panel.classList.remove('is-ok', 'is-error', 'is-checking');
    }

    if (status === 'checking') {
        if (panel) panel.classList.add('is-checking');
        statusElement.textContent = '正在检查数据库';
        statusElement.className = 'maintenance-db-status is-checking';
        return;
    }

    const isOk = status === 'ok';
    if (panel) panel.classList.add(isOk ? 'is-ok' : 'is-error');
    statusElement.textContent = isOk ? '数据库连接正常' : '数据库连接异常';
    statusElement.className = `maintenance-db-status ${isOk ? 'is-ok' : 'is-error'}`;
}

function renderDatabaseUpgradeDiagnostic(result = {}) {
    const notice = document.getElementById('maintenanceUpgradeNotice');
    const message = document.getElementById('maintenanceUpgradeMessage');
    const command = document.getElementById('maintenanceUpgradeCommand');
    if (!notice || !message || !command) return;

    const upgradeRequired = Boolean(result.database_upgrade_required);
    notice.hidden = !upgradeRequired;
    message.textContent = upgradeRequired
        ? (result.database_upgrade_message || 'MariaDB 系统表需要升级。')
        : '';
    command.textContent = upgradeRequired ? (result.database_upgrade_command || '') : '';
    command.hidden = !upgradeRequired || !result.database_upgrade_command;
}

function renderScheduledBackupStatus(result = {}) {
    const container = document.getElementById('maintenanceScheduleStatus');
    if (!container) return;

    const schedule = result.scheduled_backup || {};
    clearElement(container);
    container.hidden = false;
    container.classList.toggle('is-enabled', Boolean(schedule.enabled));
    container.classList.toggle('is-disabled', !schedule.enabled);

    const title = schedule.enabled ? '定时备份：已启用' : '定时备份：未启用';
    const details = [];
    if (schedule.configured && !schedule.valid_schedule) {
        details.push('时间配置无效，请使用 HH:MM');
    } else {
        details.push(`计划时间：${schedule.schedule_time || '03:30'}`);
    }
    details.push(`保留数量：${schedule.retention_count ?? 7}`);
    if (schedule.next_run_at) {
        details.push(`下次执行：${schedule.next_run_at}`);
    }
    if (schedule.last_run_at || schedule.last_message) {
        const resultText = schedule.last_result ? `（${schedule.last_result}）` : '';
        details.push(`最近结果：${schedule.last_run_at || '暂无'} ${resultText} ${schedule.last_message || ''}`.trim());
    }
    if (!schedule.configured) {
        details.push('设置 DB_BACKUP_SCHEDULE_ENABLED=1 后启用');
    }

    container.appendChild(createEl('div', { className: 'maintenance-schedule-title', text: title }));
    container.appendChild(createEl('div', { className: 'maintenance-schedule-details', text: details.join(' · ') }));
}

function createBackupTableMessage(message) {
    return createEl('tr', { className: 'maintenance-empty-row' }, [
        createEl('td', {
            text: message,
            attrs: { colspan: '5' }
        })
    ]);
}

function renderDatabaseBackups(result) {
    const list = document.getElementById('dbBackupsList');
    const notice = document.getElementById('maintenanceAuthNotice');
    const createButton = document.getElementById('createDbBackupButton');
    if (!list) return;

    const enabled = Boolean(result.maintenance_enabled);
    if (notice) notice.hidden = enabled;
    if (createButton) createButton.disabled = !enabled;
    setMaintenanceStatus(result.database_status || 'error');
    renderDatabaseUpgradeDiagnostic(result);
    renderScheduledBackupStatus(result);

    clearElement(list);
    if (!enabled) {
        list.appendChild(createBackupTableMessage('配置 APP_ACCESS_TOKEN 后可使用备份和恢复功能'));
        return;
    }

    const backups = Array.isArray(result.backups) ? result.backups : [];
    if (backups.length === 0) {
        list.appendChild(createBackupTableMessage('暂无数据库备份'));
        return;
    }

    backups.forEach(backup => {
        const backupDataset = {
            filename: backup.filename,
            typeLabel: backup.type_label || '未知',
            includesImages: backup.includes_images ? '1' : '0'
        };
        const restoreButton = createActionButton({
            className: 'button is-info is-small settings-action-btn maintenance-backup-restore-btn',
            text: '恢复',
            action: 'restore-db-backup',
            dataset: backupDataset
        });
        const deleteButton = createActionButton({
            className: 'button is-danger is-small settings-action-btn maintenance-backup-delete-btn',
            text: '删除',
            action: 'delete-db-backup',
            dataset: backupDataset
        });

        list.appendChild(createEl('tr', {}, [
            createEl('td', { text: backup.filename }),
            createEl('td', { text: backup.type_label || '未知' }),
            createEl('td', { text: formatBackupSize(backup.size_bytes) }),
            createEl('td', { text: backup.modified_at || '' }),
            createEl('td', { className: 'settings-actions-column' }, [
                createEl('div', { className: 'settings-actions' }, [restoreButton, deleteButton])
            ])
        ]));
    });
}

function loadDatabaseBackups() {
    const list = document.getElementById('dbBackupsList');
    if (!list) return Promise.resolve();

    setMaintenanceStatus('checking');
    clearElement(list);
    list.appendChild(createBackupTableMessage('正在读取备份列表...'));

    return callApi(event_map.list_db_backups, {}, 'GET')
        .then(result => {
            if (result.success) {
                renderDatabaseBackups(result);
            } else {
                setMaintenanceStatus('error');
                renderDatabaseUpgradeDiagnostic(result);
                renderScheduledBackupStatus(result);
                clearElement(list);
                list.appendChild(createBackupTableMessage(result.message || '备份列表读取失败'));
            }
        })
        .catch(error => {
            setMaintenanceStatus('error');
            renderDatabaseUpgradeDiagnostic({});
            renderScheduledBackupStatus({});
            clearElement(list);
            list.appendChild(createBackupTableMessage(`备份列表读取失败: ${error.message}`));
        });
}

function formatMaintenanceErrorMessage(result, fallbackMessage) {
    const message = result.message || fallbackMessage;
    if (result.database_upgrade_required && result.database_upgrade_command) {
        return `${message}\n${result.database_upgrade_command}`;
    }
    return message;
}

function createDatabaseBackup() {
    const createButton = document.getElementById('createDbBackupButton');
    if (createButton?.disabled) return;

    showAlert({
        title: '创建完整备份',
        message: '确认现在创建一份完整备份吗？备份会包含数据库和当前缩略图快照。',
        type: 'info',
        confirmText: '创建',
        cancelText: '取消',
        onConfirm: executeCreateDatabaseBackup
    });
}

function executeCreateDatabaseBackup() {
    setMaintenanceBusy(true);
    callApi(event_map.create_db_backup)
        .then(result => {
            if (result.success) {
                showAlert({
                    title: '备份完成',
                    message: result.backup?.filename
                        ? `已创建完整备份：${result.backup.filename}`
                        : '完整备份已创建',
                    type: 'success',
                    showCancel: false
                });
                loadDatabaseBackups();
            } else {
                renderDatabaseUpgradeDiagnostic(result);
                showAlert({
                    title: '备份失败',
                    message: formatMaintenanceErrorMessage(result, '数据库备份失败'),
                    type: 'error',
                    showCancel: false
                });
            }
        })
        .catch(error => {
            showAlert({
                title: '备份失败',
                message: error.message,
                type: 'error',
                showCancel: false
            });
        })
        .finally(() => {
            setMaintenanceBusy(false);
            loadDatabaseBackups();
        });
}

function restoreDatabaseBackup(button) {
    const filename = button?.dataset.filename || '';
    if (!filename || button.disabled) return;
    const includesImages = button.dataset.includesImages === '1';
    const typeLabel = button.dataset.typeLabel || '备份';
    const restoreMessage = includesImages
        ? `确认恢复${typeLabel}“${filename}”吗？当前数据库和缩略图目录都会精确恢复到该备份时的状态，系统会先自动创建一份恢复前完整备份。`
        : `确认恢复${typeLabel}“${filename}”吗？当前数据库会被覆盖，但此备份不包含缩略图，系统会先自动创建一份恢复前完整备份。`;

    showAlert({
        title: includesImages ? '恢复完整备份' : '恢复数据库备份',
        message: restoreMessage,
        type: 'warning',
        confirmText: '恢复',
        cancelText: '取消',
        onConfirm: () => executeDatabaseRestore(filename)
    });
}

function executeDatabaseRestore(filename) {
    setMaintenanceBusy(true);
    callApi(event_map.restore_db_backup, { filename, confirm: true })
        .then(result => {
            if (result.success) {
                const preRestoreFilename = result.pre_restore_backup?.filename;
                const restoredBackup = result.restored_backup || {};
                const restoreScope = restoredBackup.includes_images ? '数据库和缩略图已恢复' : '数据库已恢复，此备份不包含缩略图';
                showAlert({
                    title: '恢复完成',
                    message: preRestoreFilename
                        ? `${restoreScope}。恢复前完整备份已保存为：${preRestoreFilename}`
                        : `${restoreScope}。`,
                    type: 'success',
                    confirmText: '刷新页面',
                    showCancel: false,
                    onConfirm: () => window.location.reload()
                });
            } else {
                renderDatabaseUpgradeDiagnostic(result);
                setMaintenanceBusy(false);
                showAlert({
                    title: '恢复失败',
                    message: formatMaintenanceErrorMessage(result, '数据库恢复失败'),
                    type: 'error',
                    showCancel: false
                });
                loadDatabaseBackups();
            }
        })
        .catch(error => {
            setMaintenanceBusy(false);
            showAlert({
                title: '恢复失败',
                message: error.message,
                type: 'error',
                showCancel: false
            });
            loadDatabaseBackups();
        });
}

function deleteDatabaseBackup(button) {
    const filename = button?.dataset.filename || '';
    if (!filename || button.disabled) return;
    const typeLabel = button.dataset.typeLabel || '备份';

    showAlert({
        title: '删除备份',
        message: `确认永久删除${typeLabel}“${filename}”吗？此操作不能撤销。`,
        type: 'warning',
        confirmText: '删除',
        cancelText: '取消',
        onConfirm: () => executeDeleteDatabaseBackup(filename)
    });
}

function executeDeleteDatabaseBackup(filename) {
    setMaintenanceBusy(true);
    callApi(event_map.delete_db_backup, { filename, confirm: true }, 'DELETE')
        .then(result => {
            if (result.success) {
                showAlert({
                    title: '删除完成',
                    message: result.deleted_filename
                        ? `已删除备份：${result.deleted_filename}`
                        : '备份文件已删除',
                    type: 'success',
                    showCancel: false
                });
                loadDatabaseBackups();
            } else {
                showAlert({
                    title: '删除失败',
                    message: result.message || '备份删除失败',
                    type: 'error',
                    showCancel: false
                });
                loadDatabaseBackups();
            }
        })
        .catch(error => {
            showAlert({
                title: '删除失败',
                message: error.message,
                type: 'error',
                showCancel: false
            });
            loadDatabaseBackups();
        })
        .finally(() => {
            setMaintenanceBusy(false);
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
                markSettingsChanged();
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
                markSettingsChanged();
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

