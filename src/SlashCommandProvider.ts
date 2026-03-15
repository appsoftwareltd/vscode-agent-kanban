import * as vscode from 'vscode';

/**
 * Provides `/` slash command completions in Agent Kanban task markdown files.
 *
 * Three commands:
 * - User Turn → inserts `\n### user\n\n`
 * - Agent Turn → inserts `\n### agent\n\n`
 * - Comment → inserts `[comment: ]` with cursor inside
 *
 * Suppressed inside YAML frontmatter and fenced code blocks.
 */
export class SlashCommandProvider implements vscode.CompletionItemProvider {
    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): vscode.CompletionList | undefined {
        // Ensure there is a `/` immediately before the cursor
        const lineText = document.lineAt(position.line).text;
        if (lineText[position.character - 1] !== '/') {
            return undefined;
        }

        // Suppress in frontmatter
        if (this.isInsideFrontmatter(document, position.line)) {
            return undefined;
        }

        // Suppress inside fenced code blocks
        if (this.isInsideCodeBlock(document, position.line)) {
            return undefined;
        }

        // Replacement range covers the `/` character
        const range = new vscode.Range(
            new vscode.Position(position.line, position.character - 1),
            position,
        );

        const items: vscode.CompletionItem[] = [];

        // User Turn
        const userItem = new vscode.CompletionItem('User Turn', vscode.CompletionItemKind.Snippet);
        userItem.detail = 'Insert ### user conversation marker';
        userItem.sortText = '0-user';
        userItem.filterText = '/User Turn';
        userItem.insertText = new vscode.SnippetString('\n### user\n\n$0');
        userItem.range = range;
        items.push(userItem);

        // Agent Turn
        const agentItem = new vscode.CompletionItem('Agent Turn', vscode.CompletionItemKind.Snippet);
        agentItem.detail = 'Insert ### agent conversation marker';
        agentItem.sortText = '1-agent';
        agentItem.filterText = '/Agent Turn';
        agentItem.insertText = new vscode.SnippetString('\n### agent\n\n$0');
        agentItem.range = range;
        items.push(agentItem);

        // Comment
        const commentItem = new vscode.CompletionItem('Comment', vscode.CompletionItemKind.Snippet);
        commentItem.detail = 'Insert [comment: ] annotation';
        commentItem.sortText = '2-comment';
        commentItem.filterText = '/Comment';
        commentItem.insertText = new vscode.SnippetString('[comment: $0]');
        commentItem.range = range;
        items.push(commentItem);

        return new vscode.CompletionList(items, false);
    }

    private isInsideFrontmatter(document: vscode.TextDocument, line: number): boolean {
        if (document.lineAt(0).text.trim() !== '---') {
            return false;
        }
        for (let i = 1; i <= line; i++) {
            if (document.lineAt(i).text.trim() === '---') {
                return line <= i;
            }
        }
        // No closing fence found — entire document is frontmatter
        return true;
    }

    private isInsideCodeBlock(document: vscode.TextDocument, line: number): boolean {
        let insideCode = false;
        for (let i = 0; i < line; i++) {
            const text = document.lineAt(i).text.trimStart();
            if (text.startsWith('```') || text.startsWith('~~~')) {
                insideCode = !insideCode;
            }
        }
        return insideCode;
    }
}
