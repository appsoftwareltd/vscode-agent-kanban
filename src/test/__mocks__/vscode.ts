const Uri = {
    file: (path: string) => ({ scheme: 'file', fsPath: path, path, toString: () => path }),
    joinPath: (base: any, ...segments: string[]) => {
        const joined = [base.fsPath || base.path, ...segments].join('/');
        return Uri.file(joined);
    },
    parse: (str: string) => Uri.file(str),
};

const EventEmitter = class {
    private listeners: Function[] = [];
    event = (listener: Function) => {
        this.listeners.push(listener);
        return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
    };
    fire = (data?: any) => { this.listeners.forEach(l => l(data)); };
    dispose = () => { this.listeners = []; };
};

enum FileType {
    Unknown = 0,
    File = 1,
    Directory = 2,
    SymbolicLink = 64,
}

const workspace = {
    workspaceFolders: [{ uri: Uri.file('/test-workspace'), name: 'test', index: 0 }],
    fs: {
        readFile: async (_uri: any) => new Uint8Array(),
        writeFile: async (_uri: any, _content: Uint8Array) => { },
        stat: async (_uri: any) => ({ type: FileType.File, ctime: 0, mtime: 0, size: 0 }),
        readDirectory: async (_uri: any) => [] as Array<[string, number]>,
        createDirectory: async (_uri: any) => { },
        delete: async (_uri: any) => { },
        rename: async (_source: any, _target: any, _options?: any) => { },
    },
    asRelativePath: (uri: any) => {
        const p = typeof uri === 'string' ? uri : (uri.fsPath || uri.path || '');
        return p.replace(/.*\/test-workspace\//, '');
    },
    openTextDocument: async (_uri: any) => ({ uri: _uri }),
    getConfiguration: (_section?: string) => ({
        get: (_key: string, _defaultValue?: any) => _defaultValue,
        update: async (_key: string, _value: any) => { },
    }),
    createFileSystemWatcher: (_pattern: any) => ({
        onDidChange: () => ({ dispose: () => { } }),
        onDidCreate: () => ({ dispose: () => { } }),
        onDidDelete: () => ({ dispose: () => { } }),
        dispose: () => { },
    }),
    findFiles: async (_pattern: any, _exclude?: any, _maxResults?: number) => [] as any[],
};

const window = {
    showInformationMessage: async (..._args: any[]) => undefined,
    showErrorMessage: async (..._args: any[]) => undefined,
    showInputBox: async (_options?: any) => undefined,
    showWarningMessage: async (..._args: any[]) => undefined,
    showTextDocument: async (_doc: any, _options?: any) => undefined,
    registerWebviewViewProvider: (_viewId: string, _provider: any) => ({ dispose: () => { } }),
    createWebviewPanel: (_viewType: string, _title: string, _showOptions: any, _options?: any) => ({
        webview: {
            html: '',
            onDidReceiveMessage: () => ({ dispose: () => { } }),
            postMessage: async (_msg: any) => true,
            asWebviewUri: (uri: any) => uri,
            cspSource: '',
        },
        onDidDispose: () => ({ dispose: () => { } }),
        reveal: () => { },
        dispose: () => { },
    }),
};

const commands = {
    registerCommand: (_command: string, _callback: Function) => ({ dispose: () => { } }),
    executeCommand: async (_command: string, ..._args: any[]) => { },
};

const chat = {
    createChatParticipant: (_id: string, _handler: Function) => ({
        iconPath: undefined as any,
        dispose: () => { },
    }),
};

enum ViewColumn {
    One = 1,
    Two = 2,
    Three = 3,
    Active = -1,
    Beside = -2,
}

class RelativePattern {
    constructor(public base: any, public pattern: string) { }
}

const lm = {
    selectChatModels: async (_selector?: any) => [] as any[],
};

const LanguageModelChatToolMode = {
    Auto: 'auto',
};

class CancellationTokenSource {
    token = { isCancellationRequested: false };
    cancel() { this.token.isCancellationRequested = true; }
    dispose() { }
}

class LanguageModelTextPart {
    constructor(public value: string) { }
}

class LanguageModelToolCallPart {
    constructor(public callId: string, public name: string, public input: any) { }
}

class LanguageModelToolResultPart {
    constructor(public callId: string, public content: any[]) { }
}

const LanguageModelChatMessage = {
    User: (content: any) => ({ role: 'user', content }),
    Assistant: (content: any) => ({ role: 'assistant', content }),
};

export {
    Uri,
    EventEmitter,
    FileType,
    workspace,
    window,
    commands,
    chat,
    ViewColumn,
    RelativePattern,
    lm,
    LanguageModelChatToolMode,
    CancellationTokenSource,
    LanguageModelTextPart,
    LanguageModelToolCallPart,
    LanguageModelToolResultPart,
    LanguageModelChatMessage,
};
