import * as vscode from 'vscode';

/**
 * Ensures the user has configured their display name.
 * Prompts for it if not set. Returns the name or undefined if cancelled.
 */
export async function ensureUserName(): Promise<string | undefined> {
    const config = vscode.workspace.getConfiguration('agentKanban');
    let name = config.get<string>('userName', '');

    if (!name) {
        const input = await vscode.window.showInputBox({
            prompt: 'Enter your display name for Agent Kanban conversations',
            placeHolder: 'Your name',
            validateInput: (value) => value.trim() ? null : 'Name cannot be empty',
        });

        if (input) {
            name = input;
            await config.update('userName', name.trim(), vscode.ConfigurationTarget.Global);
        }
    }

    return name?.trim() || undefined;
}

export function getUserName(): string {
    return vscode.workspace.getConfiguration('agentKanban').get<string>('userName', '');
}
