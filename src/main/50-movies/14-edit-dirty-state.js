let editMovieDirtySession = 0;
let editMovieBaselineSnapshot = null;
let editMovieDirtyTrackingReady = false;
let editMovieSavePending = false;
let editMovieDirtyCheckFrame = null;
let editMovieDirtyObserver = null;

function getEditMovieSaveButton() {
    return document.querySelector('#editModal [data-action="update-movie"]');
}

function setEditMovieSaveDisabled(disabled) {
    const button = getEditMovieSaveButton();
    if (!button) return;
    button.disabled = disabled;
    button.setAttribute('aria-disabled', String(disabled));
}

function getEditExistingImageFilenames() {
    return Array.from(document.querySelectorAll('#editModal .existing-image-item'))
        .map(item => item.querySelector('.delete-existing-image')?.dataset.filename || '')
        .filter(Boolean);
}

function getEditUploadedFileState() {
    const files = window['getedit-image-upload-areaFiles']?.() || [];
    return files.map(file => ({
        name: file.name || '',
        size: Number(file.size) || 0,
        type: file.type || '',
        lastModified: Number(file.lastModified) || 0,
        captureTimestamp: Number.isFinite(Number(file.captureTimestamp))
            ? Number(file.captureTimestamp)
            : null
    }));
}

function getEditRatingState() {
    return Array.from(document.querySelectorAll('#edit-ratings-container .rating'))
        .map(rating => {
            const dimensionId = String(rating.dataset.dimensionId || '');
            const checked = rating.querySelector('input[type="radio"]:checked');
            return `${dimensionId}:${checked ? checked.value : DEFAULT_RATING_VALUE}`;
        })
        .sort();
}

function getCurrentEditMovieState() {
    return {
        recommended: Boolean(document.getElementById('edit-recommended')?.checked),
        review: document.getElementById('edit-review')?.value || '',
        tags: Array.from(document.querySelectorAll('#edit-tags .tag.is-selected'))
            .map(tag => tag.textContent.trim())
            .sort(),
        ratings: getEditRatingState(),
        existingImages: getEditExistingImageFilenames(),
        uploadedFiles: getEditUploadedFileState()
    };
}

function getInitialEditMovieState(movie) {
    const ratingValues = new Map();
    String(movie.ratings || '').split(',').forEach(pair => {
        const [dimensionId, value] = pair.split(':');
        if (dimensionId && value) ratingValues.set(String(dimensionId), String(value));
    });

    const ratings = Array.from(document.querySelectorAll('#edit-ratings-container .rating'))
        .map(rating => {
            const dimensionId = String(rating.dataset.dimensionId || '');
            return `${dimensionId}:${ratingValues.get(dimensionId) || DEFAULT_RATING_VALUE}`;
        })
        .sort();

    return {
        recommended: movie.recommended === 1 || movie.recommended === true,
        review: movie.review || '',
        tags: String(movie.tag_names || '')
            .split(',')
            .map(tag => tag.trim())
            .filter(Boolean)
            .sort(),
        ratings,
        existingImages: String(movie.image_filename || '')
            .split(',')
            .map(filename => filename.trim())
            .filter(Boolean),
        uploadedFiles: []
    };
}

function serializeEditMovieState(state) {
    return JSON.stringify(state);
}

function isEditMovieDirty() {
    if (!editMovieDirtyTrackingReady || editMovieBaselineSnapshot === null) return false;
    return serializeEditMovieState(getCurrentEditMovieState()) !== editMovieBaselineSnapshot;
}

function updateEditMovieSaveState() {
    editMovieDirtyCheckFrame = null;
    setEditMovieSaveDisabled(editMovieSavePending || !isEditMovieDirty());
}

function scheduleEditMovieDirtyCheck() {
    if (!editMovieDirtyTrackingReady || editMovieDirtyCheckFrame !== null) return;
    editMovieDirtyCheckFrame = requestAnimationFrame(updateEditMovieSaveState);
}

function beginEditMovieDirtyTracking() {
    editMovieDirtySession += 1;
    editMovieBaselineSnapshot = null;
    editMovieDirtyTrackingReady = false;
    editMovieSavePending = false;
    if (editMovieDirtyCheckFrame !== null) {
        cancelAnimationFrame(editMovieDirtyCheckFrame);
        editMovieDirtyCheckFrame = null;
    }
    setEditMovieSaveDisabled(true);
    return editMovieDirtySession;
}

function completeEditMovieDirtyTracking(session, movie) {
    if (session !== editMovieDirtySession) return;
    requestAnimationFrame(() => {
        if (session !== editMovieDirtySession) return;
        editMovieBaselineSnapshot = serializeEditMovieState(getInitialEditMovieState(movie));
        editMovieDirtyTrackingReady = true;
        updateEditMovieSaveState();
    });
}

function endEditMovieDirtyTracking() {
    editMovieDirtySession += 1;
    editMovieBaselineSnapshot = null;
    editMovieDirtyTrackingReady = false;
    editMovieSavePending = false;
    if (editMovieDirtyCheckFrame !== null) {
        cancelAnimationFrame(editMovieDirtyCheckFrame);
        editMovieDirtyCheckFrame = null;
    }
    setEditMovieSaveDisabled(true);
}

function setEditMovieSavePending(pending) {
    editMovieSavePending = Boolean(pending);
    updateEditMovieSaveState();
}

function initEditMovieDirtyTracking() {
    const form = document.getElementById('edit-movie-form');
    if (!form || editMovieDirtyObserver) return;

    form.addEventListener('input', scheduleEditMovieDirtyCheck);
    form.addEventListener('change', scheduleEditMovieDirtyCheck);
    editMovieDirtyObserver = new MutationObserver(scheduleEditMovieDirtyCheck);
    editMovieDirtyObserver.observe(form, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class', 'data-index']
    });
}

document.addEventListener('DOMContentLoaded', initEditMovieDirtyTracking);
