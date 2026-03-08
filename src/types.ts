export interface Task {
    id: string;
    title: string;
    lane: string;
    created: string;
    updated: string;
    description: string;
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
