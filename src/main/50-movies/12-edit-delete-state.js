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
                        refreshAfterMovieDelete();
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
    searchState = getSearchControlsState(currentPage);
}

// 恢复搜索状态的函数
function restoreSearchState() {
    applySearchControlsState(searchState);
}