export type Priority = 'critical' | 'high' | 'medium' | 'low' | 'none';

export interface Task {
    id: string;
    title: string;
    lane: string;
    created: string;
    updated: string;
    description: string;
    priority?: Priority;
    assignee?: string;
    labels?: string[];
    dueDate?: string;
    archived?: boolean;
    sortOrder?: number;
}

export interface LaneConfig {
    id: string;
    name: string;
}

export interface BoardConfig {
    lanes: LaneConfig[];
    basePrompt: string;
    users?: string[];
    labels?: string[];
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

export const PROTECTED_LANE_NAMES = ['todo', 'done'];

export function isProtectedLane(lane: LaneConfig): boolean {
    return PROTECTED_LANE_NAMES.includes(lane.name.toLowerCase());
}
