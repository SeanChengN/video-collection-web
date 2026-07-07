// 添加图片查看器相关函数
let currentImageIndex = 0;
let currentImages = [];
const IMAGE_VIEWER_WIDTH_RATIO = 3 / 5;
const IMAGE_VIEWER_MAX_HEIGHT_RATIO = 0.9;
const IMAGE_VIEWER_MOBILE_BREAKPOINT = 768;

function setImageViewerModalWidth() {
    const modal = document.getElementById('imageViewerModal');
    const modalCard = modal?.querySelector('.modal-card');
    if (!modalCard) return;

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    modalCard.style.width = viewportWidth <= IMAGE_VIEWER_MOBILE_BREAKPOINT
        ? '90%'
        : `${Math.round(viewportWidth * IMAGE_VIEWER_WIDTH_RATIO)}px`;
    modalCard.style.height = 'auto';
    modalCard.style.maxHeight = `${Math.round(viewportHeight * IMAGE_VIEWER_MAX_HEIGHT_RATIO)}px`;
    modalCard.style.overflow = 'hidden';
    modalCard.style.overflowY = 'hidden';
}

function centerImageViewerModal() {
    const modal = document.getElementById('imageViewerModal');
    const modalCard = modal?.querySelector('.modal-card');
    if (!modalCard || !modal.classList.contains('is-active')) return;

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const modalWidth = modalCard.offsetWidth;
    const modalHeight = modalCard.offsetHeight;

    modalCard.style.left = `${Math.max(0, (viewportWidth - modalWidth) / 2)}px`;
    modalCard.style.top = `${Math.max(0, (viewportHeight - modalHeight) / 2)}px`;
}

function getImageViewerMaxBodyHeight(modal, modalCard) {
    const header = modal.querySelector('.modal-card-head');
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const maxModalHeight = Math.round(viewportHeight * IMAGE_VIEWER_MAX_HEIGHT_RATIO);
    const headerHeight = header ? header.offsetHeight : 0;

    modalCard.style.maxHeight = `${maxModalHeight}px`;
    modalCard.style.overflow = 'hidden';
    modalCard.style.overflowY = 'hidden';

    return Math.max(1, maxModalHeight - headerHeight);
}

function resizeImageViewerImage() {
    const modal = document.getElementById('imageViewerModal');
    const modalCard = modal?.querySelector('.modal-card');
    const modalBody = modal?.querySelector('.modal-card-body');
    const viewer = modal?.querySelector('.viewer-image');
    const container = modal?.querySelector('.image-viewer-container');
    const scrollContainer = modal?.querySelector('.image-viewer-scroll');
    const strip = modal?.querySelector('.image-viewer-strip');

    if (!modalCard || !modalBody || !viewer || !container || !scrollContainer || !viewer.naturalWidth || !viewer.naturalHeight) return;

    const displayWidth = scrollContainer.clientWidth || container.clientWidth || modalCard.clientWidth;
    if (!displayWidth) return;

    const idealImageHeight = Math.round(displayWidth * viewer.naturalHeight / viewer.naturalWidth);
    const stripHeight = strip && !strip.hidden ? strip.offsetHeight : 0;
    const imagePaneHeight = Math.min(
        idealImageHeight,
        Math.max(1, getImageViewerMaxBodyHeight(modal, modalCard) - stripHeight)
    );
    const bodyHeight = imagePaneHeight + stripHeight;

    modalBody.style.height = `${bodyHeight}px`;
    modalBody.style.maxHeight = `${bodyHeight}px`;
    container.style.height = `${imagePaneHeight}px`;
    scrollContainer.style.height = '100%';
    viewer.style.width = '100%';
    viewer.style.height = `${idealImageHeight}px`;
    centerImageViewerModal();
}

function resetImageViewerScroll() {
    const scrollContainer = document.getElementById('imageViewerModal')?.querySelector('.image-viewer-scroll');
    if (scrollContainer) {
        scrollContainer.scrollTop = 0;
        scrollContainer.scrollLeft = 0;
    }
}

function scheduleImageViewerResize() {
    requestAnimationFrame(() => {
        resizeImageViewerImage();
        requestAnimationFrame(resizeImageViewerImage);
    });
}
