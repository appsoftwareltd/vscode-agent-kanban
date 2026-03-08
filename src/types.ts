export interface Message {
    role: 'user' | 'agent';
    /** Display name of the human author (present when role === 'user') */
    author?: string;
    /** Agent provider identifier (present when role === 'agent') */
    provider?: string;
    /** The action that was requested (present on the initiating user message) */
    action?: 'plan' | 'todo' | 'implement';
    timestamp: string;
    content: string;
}

export interface Task {
    id: string;
    title: string;
    lane: string;
    created: string;
    updated: string;
    description: string;
    /** Optional model override — when set, uses this model instead of the default. */
    model?: string;
    conversation: Message[];
}

export interface LaneConfig {
    id: string;
    name: string;
}

export interface BoardConfig {
    lanes: LaneConfig[];
    basePrompt: string;
}

export const DEFAULT_LANES: LaneConfig[] = [
    { id: 'todo', name: 'Todo' },
    { id: 'doing', name: 'Doing' },
    { id: 'done', name: 'Done' },
];

export const DEFAULT_BOARD_CONFIG: BoardConfig = {
    lanes: DEFAULT_LANES,
    basePrompt: '',
};
