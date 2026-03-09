/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ['./src/webview/**/*.{ts,js,html}'],
    theme: {
        extend: {
            colors: {
                vsc: {
                    fg: 'var(--vscode-foreground)',
                    muted: 'var(--vscode-descriptionForeground)',
                    'editor-bg': 'var(--vscode-editor-background)',
                    'panel-bg': 'var(--vscode-sideBar-background)',
                    'tab-bg': 'var(--vscode-editorGroupHeader-tabsBackground)',
                    border: 'var(--vscode-widget-border)',
                    'badge-bg': 'var(--vscode-badge-background)',
                    'badge-fg': 'var(--vscode-badge-foreground)',
                    'btn-bg': 'var(--vscode-button-background)',
                    'btn-fg': 'var(--vscode-button-foreground)',
                    'btn-hover': 'var(--vscode-button-hoverBackground)',
                    'btn2-bg': 'var(--vscode-button-secondaryBackground)',
                    'btn2-fg': 'var(--vscode-button-secondaryForeground)',
                    'btn2-hover': 'var(--vscode-button-secondaryHoverBackground)',
                    'input-bg': 'var(--vscode-input-background)',
                    'input-fg': 'var(--vscode-input-foreground)',
                    'input-border': 'var(--vscode-input-border)',
                    'focus-border': 'var(--vscode-focusBorder)',
                    'hover-bg': 'var(--vscode-list-hoverBackground)',
                    error: 'var(--vscode-errorForeground)',
                    'dropdown-bg': 'var(--vscode-dropdown-background)',
                    'dropdown-fg': 'var(--vscode-dropdown-foreground)',
                    'dropdown-border': 'var(--vscode-dropdown-border)',
                    'widget-bg': 'var(--vscode-editorWidget-background)',
                    'link': 'var(--vscode-textLink-foreground)',
                    'link-active': 'var(--vscode-textLink-activeForeground)',
                },
            },
            fontFamily: {
                vscode: ['var(--vscode-font-family)', 'system-ui', 'sans-serif'],
            },
        },
    },
    plugins: [],
};
