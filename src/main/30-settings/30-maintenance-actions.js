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
