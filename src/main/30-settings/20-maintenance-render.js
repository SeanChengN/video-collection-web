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
            text: normalizeUiMessage(message, '备份列表读取失败。'),
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
