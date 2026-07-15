async function updateMovie() {
    if (!isEditMovieDirty()) return;
    setEditMovieSavePending(true);
    try {
        const form = document.getElementById('edit-movie-form');
        const title = document.getElementById('edit-title').value;
        const modal = document.getElementById('editModal');
        
        // 保存当前的搜索状态
        saveSearchState();

        // 获取当前保留的现有图片
        const currentImages = getEditExistingImageFilenames();

        // 处理新上传的图片
        const uploadedFiles = window[`getedit-image-upload-areaFiles`]() || [];
        const uploadResults = await Promise.all(uploadedFiles.map(async file => {
            const formData = new FormData();
            formData.append('image', file);
            appendCaptureTimestampToUpload(formData, file);
            const response = await fetch('/api', { 
                method: 'POST', 
                headers: window.getCsrfHeaders ? window.getCsrfHeaders() : {},
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
            endEditMovieDirtyTracking();
            ModalManager.close('editModal');
            updateThumbnailSelectionControls();
            // 恢复搜索状态并重新搜索
            restoreSearchState();
            if (hasActiveSearchState()) {
                searchCurrentPage();
            }
        } else {
            setEditMovieSavePending(false);
            showAlert({
                title: '更新失败',
                message: result.error,
                type: 'error',
                showCancel: false
            });
        }
    } catch (error) {
        setEditMovieSavePending(false);
        showAlert({
            title: '更新失败',
            message: error.message || String(error),
            type: 'error',
            showCancel: false
        });
    }
}
