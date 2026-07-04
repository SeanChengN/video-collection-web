const VC_THEME_STORAGE_KEY = 'vc-theme';
const VC_THEME_VALUES = ['light', 'dark'];

function normalizeVcTheme(theme) {
    return VC_THEME_VALUES.includes(theme) ? theme : 'light';
}

function readStoredVcTheme() {
    try {
        return normalizeVcTheme(window.localStorage.getItem(VC_THEME_STORAGE_KEY));
    } catch (error) {
        return 'light';
    }
}

function syncVcThemeControls(theme) {
    document.querySelectorAll('[data-theme-choice]').forEach(button => {
        const isActive = button.dataset.themeChoice === theme;
        button.classList.toggle('is-info', isActive);
        button.classList.toggle('is-light', !isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    document.querySelectorAll('[data-theme-switch]').forEach(input => {
        input.checked = theme === 'light';
        input.setAttribute('aria-checked', input.checked ? 'true' : 'false');
    });
}

function applyVcTheme(theme) {
    const normalizedTheme = normalizeVcTheme(theme);
    document.documentElement.dataset.theme = normalizedTheme;
    syncVcThemeControls(normalizedTheme);
    return normalizedTheme;
}

function setVcTheme(theme) {
    const normalizedTheme = applyVcTheme(theme);
    try {
        window.localStorage.setItem(VC_THEME_STORAGE_KEY, normalizedTheme);
    } catch (error) {
        // Ignore storage failures; the current document still gets the theme.
    }
    return normalizedTheme;
}

function initializeVcTheme() {
    applyVcTheme(document.documentElement.dataset.theme || readStoredVcTheme());

    document.addEventListener('click', event => {
        const button = event.target.closest('[data-theme-choice]');
        if (!button) return;
        event.preventDefault();
        setVcTheme(button.dataset.themeChoice);
    });

    document.addEventListener('change', event => {
        const input = event.target.closest('[data-theme-switch]');
        if (!input) return;
        setVcTheme(input.checked ? 'light' : 'dark');
    });
}

document.addEventListener('DOMContentLoaded', initializeVcTheme);
window.setVcTheme = setVcTheme;
