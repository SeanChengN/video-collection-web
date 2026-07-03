function openJackettModal() {
    if (ModalManager.minimizedModals.has('jackettModal')) {
        ModalManager.restoreModal('jackettModal');
    } else {
        ModalManager.open('jackettModal');
        const route = serviceConfig.service_routes?.jackett || '/services/jackett';
        document.querySelector('#jackettModal iframe').src = `${route}?path=${encodeURIComponent('/UI/Dashboard#search')}`;
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
        const route = serviceConfig.service_routes?.thunder || '/services/thunder';
        document.querySelector('#thunderModal iframe').src = route;
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
        clearElement(document.getElementById('wtl-results'));
        resetWtlModalHeight();
    }
}

function closeWtlModal() {
    ModalManager.close('wtlModal');
}
