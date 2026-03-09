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
    sortOrder?: number;
}

export interface BoardConfig {
    lanes: string[];
    users?: string[];
    labels?: string[];
}

export const DEFAULT_LANES: string[] = ['todo', 'doing', 'done'];

export const DEFAULT_BOARD_CONFIG: BoardConfig = {
    lanes: [...DEFAULT_LANES],
};

export const PROTECTED_LANES = ['todo', 'done'];
export const RESERVED_LANES = ['archive'];

/** Slugify a lane name: lowercase, non-alphanumeric→hyphens, trim edges. */
export function slugifyLane(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/** Display a lane slug in the UI: UPPERCASE, hyphens→spaces. */
export function displayLane(slug: string): string {
    return slug.replace(/-/g, ' ').toUpperCase();
}

export function isProtectedLane(slug: string): boolean {
    return PROTECTED_LANES.includes(slug);
}

export function isReservedLane(slug: string): boolean {
    return RESERVED_LANES.includes(slug);
}
