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
