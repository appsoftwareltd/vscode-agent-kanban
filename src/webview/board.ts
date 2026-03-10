import type { Task, BoardConfig, Priority } from '../types';

declare function acquireVsCodeApi(): {
    postMessage(message: unknown): void;
};

const vscode = acquireVsCodeApi();

// ── Types ────────────────────────────────────────────────────────────────────

interface BoardState {
    tasks: Task[];
    config: BoardConfig;
}

// ── State ────────────────────────────────────────────────────────────────────

let state: BoardState = { tasks: [], config: { lanes: [] } };
let draggedTaskId: string | null = null;
let draggedLaneId: string | null = null;
let isDragging = false;
let pendingState: BoardState | null = null;

// Modal state
let modalTaskId: string | null = null;
let modalLabels: string[] = [];
let modalMode: 'create' | 'edit' = 'edit';

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getInitials(name: string): string {
    return name
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? '')
        .join('');
}

function formatDate(isoDate: string): string {
    return isoDate;
}

function formatIsoToDate(iso: string): string {
    return iso.slice(0, 10);
}

const ICON_CLOCK = '<svg class="inline-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.25"/><path d="M8 4.5V8l2.5 1.5"/></svg>';
const ICON_ARCHIVE = '<svg class="inline-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h12v2H2z"/><path d="M3 6v7a1 1 0 001 1h8a1 1 0 001-1V6"/><path d="M6.5 9h3"/></svg>';
const ICON_CALENDAR = '<svg class="inline-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="11" rx="1"/><path d="M5 1v3M11 1v3M2 7h12"/></svg>';

function isOverdue(isoDate: string): boolean {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Date(isoDate + 'T00:00:00') < today;
}

/** Display a lane slug in the UI: UPPERCASE, hyphens→spaces. */
function displayLane(slug: string): string {
    return slug.replace(/-/g, ' ').toUpperCase();
}

function isProtectedLane(slug: string): boolean {
    return ['todo', 'done'].includes(slug);
}

const PRIORITY_LABELS: Record<string, string> = {
    critical: 'Critical',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
    none: 'None',
};

// ── Message Handling ─────────────────────────────────────────────────────────

window.addEventListener('message', (event: MessageEvent) => {
    const msg = event.data as { type: string; state?: BoardState };
    if (msg.type === 'stateUpdate' && msg.state) {
        if (isDragging) {
            pendingState = msg.state;
        } else {
            state = msg.state;
            renderBoard();
        }
    }
    if (msg.type === 'openCreateModal') {
        openCreateModal();
    }
});

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    vscode.postMessage({ type: 'ready' });
});

// ── Rendering ────────────────────────────────────────────────────────────────

function renderBoard(): void {
    const app = document.getElementById('app');
    if (!app) {
        return;
    }

    // Track in-progress modal state before clobbering the DOM
    const openModalId = modalTaskId;
    const savedLabels = [...modalLabels];
    const savedMode = modalMode;
    const pendingLabelInput = (document.getElementById('modal-label-input') as HTMLInputElement | null)?.value ?? '';
    const savedAssignee = (document.getElementById('modal-assignee') as HTMLInputElement | null)?.value ?? '';
    const savedPriority = (document.getElementById('modal-priority') as HTMLSelectElement | null)?.value ?? '';
    const savedDueDate = (document.getElementById('modal-duedate') as HTMLInputElement | null)?.value ?? '';
    const savedLane = (document.getElementById('modal-lane') as HTMLSelectElement | null)?.value ?? '';
    const savedTitleInput = (document.getElementById('modal-title-input') as HTMLInputElement | null)?.value ?? '';
    const savedDescription = (document.getElementById('modal-description') as HTMLTextAreaElement | null)?.value ?? '';

    app.innerHTML = buildBoardHtml();

    // Re-open modal if it was open before the re-render
    if (openModalId || savedMode === 'create') {
        if (savedMode === 'create') {
            modalMode = 'create';
            modalLabels = savedLabels;
            document.getElementById('modal-backdrop')?.removeAttribute('hidden');
            configureModalMode();
            // Restore create-mode inputs
            const titleInput = document.getElementById('modal-title-input') as HTMLInputElement | null;
            if (titleInput) {
                titleInput.value = savedTitleInput;
            }
            const descEl = document.getElementById('modal-description') as HTMLTextAreaElement | null;
            if (descEl) {
                descEl.value = savedDescription;
            }
            const laneEl = document.getElementById('modal-lane') as HTMLSelectElement | null;
            if (laneEl && savedLane) {
                laneEl.value = savedLane;
            }
            const priorityEl = document.getElementById('modal-priority') as HTMLSelectElement | null;
            if (priorityEl && savedPriority) {
                priorityEl.value = savedPriority;
            }
            const assigneeEl = document.getElementById('modal-assignee') as HTMLInputElement | null;
            if (assigneeEl) {
                assigneeEl.value = savedAssignee;
            }
            const dueDateEl = document.getElementById('modal-duedate') as HTMLInputElement | null;
            if (dueDateEl) {
                dueDateEl.value = savedDueDate;
            }
            const labelInputEl = document.getElementById('modal-label-input') as HTMLInputElement | null;
            if (labelInputEl && pendingLabelInput) {
                labelInputEl.value = pendingLabelInput;
            }
            renderTags();
        } else if (openModalId) {
            const task = state.tasks.find((t) => t.id === openModalId);
            if (task) {
                modalTaskId = openModalId;
                modalLabels = savedLabels;
                modalMode = 'edit';
                document.getElementById('modal-backdrop')?.removeAttribute('hidden');
                configureModalMode();
                populateModal(task);
                // Restore any in-progress user input
                const assigneeEl = document.getElementById('modal-assignee') as HTMLInputElement | null;
                if (assigneeEl && savedAssignee) {
                    assigneeEl.value = savedAssignee;
                }
                const priorityEl = document.getElementById('modal-priority') as HTMLSelectElement | null;
                if (priorityEl && savedPriority) {
                    priorityEl.value = savedPriority;
                }
                const dueDateEl = document.getElementById('modal-duedate') as HTMLInputElement | null;
                if (dueDateEl && savedDueDate) {
                    dueDateEl.value = savedDueDate;
                }
                const laneEl = document.getElementById('modal-lane') as HTMLSelectElement | null;
                if (laneEl && savedLane) {
                    laneEl.value = savedLane;
                }
                const labelInputEl = document.getElementById('modal-label-input') as HTMLInputElement | null;
                if (labelInputEl && pendingLabelInput) {
                    labelInputEl.value = pendingLabelInput;
                }
            } else {
                modalTaskId = null;
                modalLabels = [];
            }
        }
    }
}

function buildBoardHtml(): string {
    const { lanes } = state.config;
    return `
        <div class="toolbar">
            <button id="btn-new-task" class="btn-primary">+ New Task</button>
            <button id="btn-add-lane" class="btn-secondary">+ Add Lane</button>
        </div>
        <div class="board" id="board">
            ${lanes.map((lane) => buildLaneHtml(lane, state.tasks.filter((t) => t.lane === lane))).join('')}
        </div>
        ${buildModalHtml()}
        ${buildConfirmDialogHtml()}
    `;
}

function buildLaneHtml(lane: string, tasks: Task[]): string {
    const isProtected = isProtectedLane(lane);
    return `
        <div class="lane" data-lane-id="${esc(lane)}">
            <div class="lane-header" draggable="true" data-drag-lane-id="${esc(lane)}">
                <span class="lane-grip" title="Drag to reorder">&#x2630;</span>
                <span class="lane-title${isProtected ? '' : ' lane-title-renameable'}"
                      ${isProtected ? '' : `data-rename-lane-id="${esc(lane)}"`}>${esc(displayLane(lane))}</span>
                <span class="lane-count">${tasks.length}</span>
                ${isProtected ? '' : `<button class="icon-btn lane-remove" data-remove-lane-id="${esc(lane)}" title="Remove lane">&times;</button>`}
            </div>
            <div class="lane-cards" data-lane-id="${esc(lane)}">
                ${tasks.map(buildCardHtml).join('')}
            </div>
        </div>
    `;
}

function buildCardHtml(task: Task): string {
    const p = task.priority && task.priority !== 'none' ? task.priority : null;
    const priorityBadge = p
        ? `<span class="priority-badge priority-${esc(p)}">${esc(PRIORITY_LABELS[p] ?? p)}</span>`
        : '<span class="priority-badge priority-none">No Priority</span>';
    const hasMeta =
        task.assignee || task.dueDate || (task.labels && task.labels.length > 0);
    return `
        <div class="card" draggable="true" data-task-id="${esc(task.id)}">
            <div class="card-header">
                ${priorityBadge}
                <button class="icon-btn card-delete" data-delete-task-id="${esc(task.id)}" title="Delete task">&times;</button>
            </div>
            <div class="card-title">${esc(task.title)}</div>
            ${hasMeta
            ? `<div class="card-meta">
                <div class="card-meta-row">
                    ${task.assignee ? `<span class="assignee-badge" title="${esc(task.assignee)}">${esc(getInitials(task.assignee))}</span>` : ''}
                    ${task.dueDate ? `<span class="due-chip${isOverdue(task.dueDate) ? ' due-overdue' : ''}">${ICON_CLOCK} ${esc(formatDate(task.dueDate))}</span>` : ''}
                </div>
                ${(task.labels?.length ?? 0) > 0
                ? `<div class="card-labels">
                    ${(task.labels ?? []).map((l) => `<span class="label-pill">${esc(l)}</span>`).join('')}
                </div>`
                : ''
            }
            </div>`
            : ''
        }
            <div class="card-footer">
                <div class="card-date">${formatIsoToDate(task.updated)}</div>
                <button class="icon-btn card-archive" data-archive-task-id="${esc(task.id)}" title="Archive task">${ICON_ARCHIVE}</button>
            </div>
        </div>
    `;
}

function buildModalHtml(): string {
    const laneOptions = state.config.lanes
        .map((l) => `<option value="${esc(l)}">${esc(displayLane(l))}</option>`)
        .join('');
    return `
        <div class="modal-backdrop" id="modal-backdrop" hidden>
            <div class="modal" id="modal" role="dialog" aria-modal="true">
                <div class="modal-header">
                    <h3 class="modal-title" id="modal-task-title"></h3>
                    <input class="form-control modal-title-input" id="modal-title-input" type="text" placeholder="Task title" hidden>
                    <button class="icon-btn" id="modal-close" title="Close">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-row" id="modal-description-row" hidden>
                        <label class="form-label" for="modal-description">Description</label>
                        <textarea class="form-control" id="modal-description" rows="3" placeholder="Describe the task…"></textarea>
                    </div>
                    <div class="form-row">
                        <label class="form-label" for="modal-lane">Lane</label>
                        <select class="form-control" id="modal-lane">
                            ${laneOptions}
                        </select>
                    </div>
                    <div class="form-row">
                        <label class="form-label" for="modal-priority">Priority</label>
                        <select class="form-control" id="modal-priority">
                            <option value="none">None</option>
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                            <option value="critical">Critical</option>
                        </select>
                    </div>
                    <div class="form-row">
                        <label class="form-label" for="modal-assignee">Assignee</label>
                        <div class="autocomplete-wrapper" id="assignee-ac-wrapper">
                            <input class="form-control" id="modal-assignee" type="text"
                                   placeholder="Unassigned" autocomplete="off">
                            <div class="autocomplete-dropdown" id="assignee-ac-dropdown" hidden></div>
                        </div>
                    </div>
                    <div class="form-row">
                        <label class="form-label">Labels</label>
                        <div class="tag-field">
                            <div class="tags-row" id="tags-row"></div>
                            <div class="tag-add-row">
                                <div class="autocomplete-wrapper" id="label-ac-wrapper">
                                    <input class="form-control tag-add-input" id="modal-label-input" type="text"
                                           placeholder="Add label\u2026" autocomplete="off">
                                    <div class="autocomplete-dropdown" id="label-ac-dropdown" hidden></div>
                                </div>
                                <button class="btn-secondary btn-sm" id="btn-add-label-tag" type="button">Add</button>
                            </div>
                        </div>
                    </div>
                    <div class="form-row">
                        <label class="form-label">Due Date</label>
                        <div class="datepicker-wrapper" id="datepicker-wrapper">
                            <div class="datepicker-input-row">
                                <input class="form-control" id="modal-duedate" type="text" placeholder="YYYY-MM-DD">
                                <button class="icon-btn datepicker-toggle" id="datepicker-toggle" type="button" title="Pick date">${ICON_CALENDAR}</button>
                                <button class="icon-btn datepicker-clear" id="datepicker-clear" type="button" title="Clear date">&times;</button>
                            </div>
                            <div class="datepicker-help" id="datepicker-help" hidden></div>
                        </div>
                    </div>
                </div>
                <div class="datepicker-overlay" id="datepicker-overlay" hidden>
                    <div class="datepicker-overlay-backdrop" id="datepicker-overlay-backdrop"></div>
                    <div class="datepicker-popup" id="datepicker-popup"></div>
                </div>
                <div class="modal-footer">
                    <div class="modal-footer-left" id="modal-footer-left">
                        <button class="btn-primary" id="btn-open-task">Open in editor</button>
                        <button class="btn-secondary" id="btn-send-to-chat" hidden>Send to Chat</button>
                    </div>
                    <div class="modal-actions">
                        <button class="btn-secondary" id="modal-cancel">Cancel</button>
                        <button class="btn-primary" id="modal-save">Save</button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// ── Event Listeners ───────────────────────────────────────────────────────────

function setupEventListeners(): void {
    document.addEventListener('click', handleClick);
    document.addEventListener('dblclick', handleDblClick);
    document.addEventListener('dragstart', handleDragStart as EventListener);
    document.addEventListener('dragend', handleDragEnd as EventListener);
    document.addEventListener('dragover', handleDragOver as EventListener);
    document.addEventListener('dragleave', handleDragLeave as EventListener);
    document.addEventListener('drop', handleDrop as EventListener);
    document.addEventListener('keydown', handleKeydown as EventListener);
    document.addEventListener('focusout', (e: FocusEvent) => {
        if ((e.target as HTMLElement)?.id === 'modal-duedate') {
            validateDateInput();
        }
    });
    document.addEventListener('input', (e: Event) => {
        if ((e.target as HTMLElement)?.id === 'modal-duedate') {
            clearDateError();
        }
    });
}

function handleClick(e: MouseEvent): void {
    const t = e.target as Element;

    if ((t as HTMLElement).id === 'btn-new-task') {
        openCreateModal();
        return;
    }
    if ((t as HTMLElement).id === 'btn-add-lane') {
        vscode.postMessage({ type: 'addLane' });
        return;
    }
    if ((t as HTMLElement).id === 'modal-close' || (t as HTMLElement).id === 'modal-cancel') {
        closeModal();
        return;
    }
    if ((t as HTMLElement).id === 'modal-backdrop') {
        closeModal();
        return;
    }
    if ((t as HTMLElement).id === 'modal-save') {
        saveModal();
        return;
    }
    if ((t as HTMLElement).id === 'btn-open-task') {
        if (modalTaskId) {
            vscode.postMessage({ type: 'openTask', taskId: modalTaskId });
            closeModal();
        }
        return;
    }
    if ((t as HTMLElement).id === 'btn-send-to-chat') {
        if (modalTaskId) {
            vscode.postMessage({ type: 'sendToChat', taskId: modalTaskId });
            closeModal();
        }
        return;
    }
    if ((t as HTMLElement).id === 'btn-add-label-tag') {
        addLabelTag();
        return;
    }
    if (t.closest('#datepicker-toggle')) {
        toggleDatepicker();
        return;
    }
    if (t.closest('#datepicker-clear')) {
        clearDatepicker();
        return;
    }
    if ((t as HTMLElement).id === 'datepicker-overlay-backdrop') {
        document.getElementById('datepicker-overlay')?.setAttribute('hidden', '');
        return;
    }
    // Datepicker navigation & day selection
    if (t.closest('#dp-prev')) {
        dpNavigate(-1);
        return;
    }
    if (t.closest('#dp-next')) {
        dpNavigate(1);
        return;
    }
    const dayBtn = t.closest('[data-dp-day]') as HTMLElement | null;
    if (dayBtn) {
        dpSelectDay(dayBtn.dataset.dpDay!);
        return;
    }
    if ((t as HTMLElement).id === 'confirm-cancel') {
        hideArchiveConfirm();
        return;
    }
    if ((t as HTMLElement).id === 'confirm-archive') {
        confirmArchive();
        return;
    }
    if ((t as HTMLElement).id === 'confirm-backdrop') {
        hideArchiveConfirm();
        return;
    }

    const archiveBtn = t.closest('[data-archive-task-id]') as HTMLElement | null;
    if (archiveBtn) {
        e.stopPropagation();
        showArchiveConfirm(archiveBtn.dataset.archiveTaskId!);
        return;
    }

    const deleteBtn = t.closest('[data-delete-task-id]') as HTMLElement | null;
    if (deleteBtn) {
        e.stopPropagation();
        vscode.postMessage({ type: 'deleteTask', taskId: deleteBtn.dataset.deleteTaskId });
        return;
    }

    const removeBtn = t.closest('[data-remove-lane-id]') as HTMLElement | null;
    if (removeBtn) {
        e.stopPropagation();
        vscode.postMessage({ type: 'removeLane', laneId: removeBtn.dataset.removeLaneId });
        return;
    }

    const tagRemoveBtn = t.closest('[data-remove-tag]') as HTMLElement | null;
    if (tagRemoveBtn) {
        removeTag(tagRemoveBtn.getAttribute('data-remove-tag')!);
        return;
    }

    const card = t.closest('.card[data-task-id]') as HTMLElement | null;
    if (card && !t.closest('[data-delete-task-id]') && !t.closest('[data-archive-task-id]')) {
        openModal(card.dataset.taskId!);
        return;
    }
}

function handleDblClick(e: MouseEvent): void {
    const renameEl = (e.target as Element).closest('[data-rename-lane-id]') as HTMLElement | null;
    if (renameEl) {
        vscode.postMessage({ type: 'renameLane', laneId: renameEl.dataset.renameLaneId });
    }
}

function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
        const overlay = document.getElementById('datepicker-overlay');
        if (overlay && !overlay.hasAttribute('hidden')) {
            overlay.setAttribute('hidden', '');
            return;
        }
        if (confirmTaskId) {
            hideArchiveConfirm();
        } else {
            closeModal();
        }
        return;
    }
    if (e.key === 'Enter' && (e.target as Element).id === 'modal-label-input') {
        e.preventDefault();
        addLabelTag();
        return;
    }
    if (e.key === 'Enter' && (e.target as Element).id === 'modal-duedate') {
        e.preventDefault();
        if (validateDateInput()) {
            document.getElementById('datepicker-overlay')?.setAttribute('hidden', '');
        }
        return;
    }
}

// ── Drag and Drop ─────────────────────────────────────────────────────────────

function handleDragStart(e: DragEvent): void {
    const t = e.target as Element;

    const laneHeader = t.closest('[data-drag-lane-id]') as HTMLElement | null;
    if (laneHeader) {
        draggedLaneId = laneHeader.dataset.dragLaneId!;
        e.dataTransfer!.effectAllowed = 'move';
        laneHeader.closest('.lane')?.classList.add('lane-dragging');
        isDragging = true;
        return;
    }

    const card = t.closest('.card[data-task-id]') as HTMLElement | null;
    if (card) {
        draggedTaskId = card.dataset.taskId!;
        card.classList.add('card-dragging');
        e.dataTransfer!.effectAllowed = 'move';
        isDragging = true;
    }
}

function handleDragEnd(e: DragEvent): void {
    document.querySelectorAll('.lane').forEach((el) => el.classList.remove('lane-dragging', 'lane-drag-over'));
    document.querySelectorAll('.lane-cards').forEach((el) => el.classList.remove('cards-drag-over'));
    document.querySelectorAll('.card-drop-indicator').forEach((el) => el.remove());
    (e.target as Element).closest('.card')?.classList.remove('card-dragging');
    draggedTaskId = null;
    draggedLaneId = null;
    isDragging = false;
    if (pendingState) {
        state = pendingState;
        pendingState = null;
        renderBoard();
    }
}

function handleDragOver(e: DragEvent): void {
    e.preventDefault();
    const t = e.target as Element;

    if (draggedLaneId) {
        const lane = t.closest('.lane') as HTMLElement | null;
        if (lane && lane.dataset.laneId !== draggedLaneId) {
            document.querySelectorAll('.lane').forEach((el) => el.classList.remove('lane-drag-over'));
            lane.classList.add('lane-drag-over');
        }
        return;
    }

    if (!draggedTaskId) {
        return;
    }

    const laneCards = t.closest('.lane-cards') as HTMLElement | null;
    if (!laneCards) {
        return;
    }
    laneCards.classList.add('cards-drag-over');

    // Remove all existing drop indicators
    document.querySelectorAll('.card-drop-indicator').forEach((el) => el.remove());

    // Find which card we're hovering over
    const cards = Array.from(laneCards.querySelectorAll('.card[data-task-id]')) as HTMLElement[];
    const hoveredCard = t.closest('.card[data-task-id]') as HTMLElement | null;

    if (hoveredCard && hoveredCard.dataset.taskId !== draggedTaskId) {
        const rect = hoveredCard.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const indicator = document.createElement('div');
        indicator.className = 'card-drop-indicator';
        if (e.clientY < midY) {
            hoveredCard.parentNode!.insertBefore(indicator, hoveredCard);
        } else {
            hoveredCard.parentNode!.insertBefore(indicator, hoveredCard.nextSibling);
        }
    } else if (!hoveredCard && cards.length === 0) {
        // Empty lane — show indicator
        const indicator = document.createElement('div');
        indicator.className = 'card-drop-indicator';
        laneCards.appendChild(indicator);
    }
}

function handleDragLeave(e: DragEvent): void {
    const t = e.target as Element;
    const related = e.relatedTarget as Element | null;

    if (draggedLaneId) {
        const lane = t.closest('.lane');
        if (lane && !lane.contains(related)) {
            lane.classList.remove('lane-drag-over');
        }
        return;
    }

    const cards = t.closest('.lane-cards');
    if (cards && !cards.contains(related)) {
        cards.classList.remove('cards-drag-over');
        // Remove indicators when leaving lane
        cards.querySelectorAll('.card-drop-indicator').forEach((el) => el.remove());
    }
}

function getTaskSortOrder(taskId: string): number {
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) {
        return 0;
    }
    return task.sortOrder ?? Date.parse(task.created);
}

function handleDrop(e: DragEvent): void {
    e.preventDefault();
    const t = e.target as Element;

    // Clean up indicators
    document.querySelectorAll('.card-drop-indicator').forEach((el) => el.remove());

    if (draggedLaneId) {
        const targetLane = t.closest('.lane') as HTMLElement | null;
        if (targetLane && targetLane.dataset.laneId !== draggedLaneId) {
            vscode.postMessage({
                type: 'moveLane',
                sourceLaneId: draggedLaneId,
                targetLaneId: targetLane.dataset.laneId,
            });
        }
        document.querySelectorAll('.lane').forEach((el) => el.classList.remove('lane-dragging', 'lane-drag-over'));
        draggedLaneId = null;
        return;
    }

    const laneCards = t.closest('.lane-cards') as HTMLElement | null;
    if (!laneCards || !draggedTaskId) {
        document.querySelectorAll('.lane-cards').forEach((el) => el.classList.remove('cards-drag-over'));
        return;
    }

    const targetLaneId = laneCards.dataset.laneId!;
    const cards = Array.from(laneCards.querySelectorAll('.card[data-task-id]')) as HTMLElement[];
    const cardIds = cards.map((c) => c.dataset.taskId!).filter((id) => id !== draggedTaskId);

    // Determine drop position based on cursor
    const hoveredCard = t.closest('.card[data-task-id]') as HTMLElement | null;
    let insertIndex = cardIds.length; // default: end

    if (hoveredCard && hoveredCard.dataset.taskId !== draggedTaskId) {
        const hoveredId = hoveredCard.dataset.taskId!;
        const idx = cardIds.indexOf(hoveredId);
        if (idx !== -1) {
            const rect = hoveredCard.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            insertIndex = e.clientY < midY ? idx : idx + 1;
        }
    }

    // Calculate sortOrder: midpoint between neighbours
    let newSortOrder: number;
    if (cardIds.length === 0) {
        // Empty lane or only card
        newSortOrder = 1;
    } else if (insertIndex === 0) {
        // Before first card
        newSortOrder = getTaskSortOrder(cardIds[0]) - 1;
    } else if (insertIndex >= cardIds.length) {
        // After last card
        newSortOrder = getTaskSortOrder(cardIds[cardIds.length - 1]) + 1;
    } else {
        // Between two cards
        const above = getTaskSortOrder(cardIds[insertIndex - 1]);
        const below = getTaskSortOrder(cardIds[insertIndex]);
        newSortOrder = (above + below) / 2;
    }

    vscode.postMessage({
        type: 'moveTask',
        taskId: draggedTaskId,
        lane: targetLaneId,
        sortOrder: newSortOrder,
    });

    document.querySelectorAll('.lane-cards').forEach((el) => el.classList.remove('cards-drag-over'));
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function openModal(taskId: string): void {
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) {
        return;
    }
    modalMode = 'edit';
    modalTaskId = taskId;
    modalLabels = [...(task.labels ?? [])];
    document.getElementById('modal-backdrop')?.removeAttribute('hidden');
    configureModalMode();
    populateModal(task);
}

function openCreateModal(): void {
    modalMode = 'create';
    modalTaskId = null;
    modalLabels = [];
    document.getElementById('modal-backdrop')?.removeAttribute('hidden');
    configureModalMode();

    // Defaults for create mode
    const titleInput = document.getElementById('modal-title-input') as HTMLInputElement | null;
    if (titleInput) {
        titleInput.value = '';
    }
    const descEl = document.getElementById('modal-description') as HTMLTextAreaElement | null;
    if (descEl) {
        descEl.value = '';
    }
    const laneEl = document.getElementById('modal-lane') as HTMLSelectElement | null;
    if (laneEl && state.config.lanes.length > 0) {
        laneEl.value = state.config.lanes[0];
    }
    const priorityEl = document.getElementById('modal-priority') as HTMLSelectElement | null;
    if (priorityEl) {
        priorityEl.value = 'none';
    }
    const assigneeEl = document.getElementById('modal-assignee') as HTMLInputElement | null;
    if (assigneeEl) {
        assigneeEl.value = '';
    }
    const dueDateEl = document.getElementById('modal-duedate') as HTMLInputElement | null;
    if (dueDateEl) {
        dueDateEl.value = '';
    }

    initAutocomplete('modal-assignee', 'assignee-ac-dropdown', () => state.config.users ?? [], 'select');
    initAutocomplete('modal-label-input', 'label-ac-dropdown', () => state.config.labels ?? [], 'add-tag');

    renderTags();
    titleInput?.focus();
}

function configureModalMode(): void {
    const titleH3 = document.getElementById('modal-task-title');
    const titleInput = document.getElementById('modal-title-input');
    const descRow = document.getElementById('modal-description-row');
    const footerLeft = document.getElementById('modal-footer-left');
    const saveBtn = document.getElementById('modal-save');

    if (modalMode === 'create') {
        titleH3?.setAttribute('hidden', '');
        titleInput?.removeAttribute('hidden');
        descRow?.removeAttribute('hidden');
        if (footerLeft) {
            footerLeft.style.visibility = 'hidden';
        }
        if (saveBtn) {
            saveBtn.textContent = 'Create';
        }
    } else {
        titleH3?.removeAttribute('hidden');
        titleInput?.setAttribute('hidden', '');
        descRow?.setAttribute('hidden', '');
        if (footerLeft) {
            footerLeft.style.visibility = 'visible';
        }
        if (saveBtn) {
            saveBtn.textContent = 'Save';
        }
    }
}

function populateModal(task: Task): void {
    const titleEl = document.getElementById('modal-task-title');
    if (titleEl) {
        titleEl.textContent = task.title;
    }

    const laneEl = document.getElementById('modal-lane') as HTMLSelectElement | null;
    if (laneEl) {
        laneEl.value = task.lane;
    }

    const priorityEl = document.getElementById('modal-priority') as HTMLSelectElement | null;
    if (priorityEl) {
        priorityEl.value = task.priority ?? 'none';
    }

    const assigneeEl = document.getElementById('modal-assignee') as HTMLInputElement | null;
    if (assigneeEl) {
        assigneeEl.value = task.assignee ?? '';
    }

    const dueDateEl = document.getElementById('modal-duedate') as HTMLInputElement | null;
    if (dueDateEl) {
        dueDateEl.value = task.dueDate ?? '';
    }

    initAutocomplete('modal-assignee', 'assignee-ac-dropdown', () => state.config.users ?? [], 'select');
    initAutocomplete('modal-label-input', 'label-ac-dropdown', () => state.config.labels ?? [], 'add-tag');

    renderTags();
}

function closeModal(): void {
    document.getElementById('modal-backdrop')?.setAttribute('hidden', '');
    modalTaskId = null;
    modalLabels = [];
    modalMode = 'edit';
}

function saveModal(): void {
    const priority = (document.getElementById('modal-priority') as HTMLSelectElement).value as Priority;
    const assigneeRaw = ((document.getElementById('modal-assignee') as HTMLInputElement).value ?? '').trim();
    const dueDateRaw = ((document.getElementById('modal-duedate') as HTMLInputElement).value ?? '').trim();
    if (dueDateRaw && !isValidDate(dueDateRaw)) {
        showDateError('Please enter a valid date in YYYY-MM-DD format');
        return;
    }
    clearDateError();
    const dueDate = dueDateRaw || undefined;
    const assignee = assigneeRaw || undefined;
    const labels = modalLabels.length > 0 ? [...modalLabels] : undefined;
    const lane = (document.getElementById('modal-lane') as HTMLSelectElement).value;

    if (modalMode === 'create') {
        const titleRaw = ((document.getElementById('modal-title-input') as HTMLInputElement).value ?? '').trim();
        if (!titleRaw) {
            (document.getElementById('modal-title-input') as HTMLInputElement)?.focus();
            return;
        }
        const description = ((document.getElementById('modal-description') as HTMLTextAreaElement).value ?? '').trim();

        vscode.postMessage({
            type: 'createTask',
            title: titleRaw,
            description,
            lane,
            priority: priority === 'none' ? undefined : priority,
            assignee,
            labels,
            dueDate,
        });
    } else {
        if (!modalTaskId) {
            return;
        }

        vscode.postMessage({
            type: 'updateTaskMeta',
            taskId: modalTaskId,
            lane,
            priority: priority === 'none' ? undefined : priority,
            assignee,
            labels,
            dueDate,
        });
    }

    // Register new user/labels with the config registry
    if (assignee && !(state.config.users ?? []).includes(assignee)) {
        vscode.postMessage({ type: 'addUser', name: assignee });
    }
    for (const label of modalLabels) {
        if (!(state.config.labels ?? []).includes(label)) {
            vscode.postMessage({ type: 'addLabel', name: label });
        }
    }

    closeModal();
}

function addLabelTag(): void {
    const input = document.getElementById('modal-label-input') as HTMLInputElement | null;
    if (!input) {
        return;
    }
    const value = sanitiseLabel(input.value);
    if (value && !modalLabels.includes(value)) {
        modalLabels.push(value);
        renderTags();
    }
    input.value = '';
    input.focus();
}

/** Sanitise a label: lowercase, alphanumeric and hyphens only. */
function sanitiseLabel(raw: string): string {
    return raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
}

function removeTag(label: string): void {
    modalLabels = modalLabels.filter((l) => l !== label);
    renderTags();
}

function renderTags(): void {
    const row = document.getElementById('tags-row');
    if (!row) {
        return;
    }
    row.innerHTML = modalLabels
        .map(
            (l) =>
                `<span class="tag-chip">${esc(l)}<button class="tag-remove" data-remove-tag="${esc(l)}" type="button">&times;</button></span>`,
        )
        .join('');
}

// ── Confirm Dialog ────────────────────────────────────────────────────────────

let confirmTaskId: string | null = null;

function buildConfirmDialogHtml(): string {
    return `
        <div class="confirm-backdrop" id="confirm-backdrop" hidden>
            <div class="confirm-dialog">
                <p class="confirm-message">Archive this task? It will be hidden from all lanes.</p>
                <div class="confirm-actions">
                    <button class="btn-secondary" id="confirm-cancel">Cancel</button>
                    <button class="btn-primary confirm-archive-btn" id="confirm-archive">Archive</button>
                </div>
            </div>
        </div>
    `;
}

function showArchiveConfirm(taskId: string): void {
    confirmTaskId = taskId;
    document.getElementById('confirm-backdrop')?.removeAttribute('hidden');
}

function hideArchiveConfirm(): void {
    confirmTaskId = null;
    document.getElementById('confirm-backdrop')?.setAttribute('hidden', '');
}

function confirmArchive(): void {
    if (confirmTaskId) {
        vscode.postMessage({ type: 'archiveTask', taskId: confirmTaskId });
    }
    hideArchiveConfirm();
}

// ── Autocomplete ──────────────────────────────────────────────────────────────

type AutocompleteMode = 'select' | 'add-tag';
const acCleanups: Array<() => void> = [];

function initAutocomplete(
    inputId: string,
    dropdownId: string,
    getItems: () => string[],
    mode: AutocompleteMode,
): void {
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    const dropdown = document.getElementById(dropdownId) as HTMLElement | null;
    if (!input || !dropdown) {
        return;
    }

    let acIndex = -1;

    function showDropdown(filter: string): void {
        const items = getItems().filter((item) =>
            item.toLowerCase().includes(filter.toLowerCase()),
        );
        if (items.length === 0 || (items.length === 1 && items[0].toLowerCase() === filter.toLowerCase())) {
            dropdown!.setAttribute('hidden', '');
            return;
        }
        acIndex = -1;
        dropdown!.innerHTML = items
            .map(
                (item, i) =>
                    `<div class="autocomplete-option" data-ac-index="${i}" data-ac-value="${esc(item)}">${esc(item)}</div>`,
            )
            .join('');
        dropdown!.removeAttribute('hidden');
    }

    function hideDropdown(): void {
        dropdown!.setAttribute('hidden', '');
        acIndex = -1;
    }

    function selectItem(value: string): void {
        if (mode === 'select') {
            input!.value = value;
            hideDropdown();
        } else {
            // add-tag mode
            input!.value = '';
            hideDropdown();
            const sanitised = sanitiseLabel(value);
            if (sanitised && !modalLabels.includes(sanitised)) {
                modalLabels.push(sanitised);
                renderTags();
            }
        }
    }

    function handleInput(): void {
        showDropdown(input!.value);
    }

    function handleFocus(): void {
        if (input!.value || getItems().length > 0) {
            showDropdown(input!.value);
        }
    }

    function handleKeydown(e: KeyboardEvent): void {
        if (dropdown!.hasAttribute('hidden')) {
            return;
        }
        const options = dropdown!.querySelectorAll('.autocomplete-option');
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            acIndex = Math.min(acIndex + 1, options.length - 1);
            updateActiveOption(options);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            acIndex = Math.max(acIndex - 1, 0);
            updateActiveOption(options);
        } else if (e.key === 'Enter' && acIndex >= 0) {
            e.preventDefault();
            e.stopPropagation();
            const opt = options[acIndex] as HTMLElement | undefined;
            if (opt) {
                selectItem(opt.dataset.acValue!);
            }
        } else if (e.key === 'Escape') {
            hideDropdown();
        }
    }

    function updateActiveOption(options: NodeListOf<Element>): void {
        options.forEach((el, i) => {
            el.classList.toggle('autocomplete-option-active', i === acIndex);
        });
    }

    function handleDropdownClick(e: MouseEvent): void {
        const opt = (e.target as Element).closest('.autocomplete-option') as HTMLElement | null;
        if (opt) {
            selectItem(opt.dataset.acValue!);
        }
    }

    function handleBlur(): void {
        // Delay to allow click on dropdown option
        setTimeout(() => hideDropdown(), 150);
    }

    input.addEventListener('input', handleInput);
    input.addEventListener('focus', handleFocus);
    input.addEventListener('blur', handleBlur);
    input.addEventListener('keydown', handleKeydown);
    dropdown.addEventListener('mousedown', handleDropdownClick);

    acCleanups.push(() => {
        input.removeEventListener('input', handleInput);
        input.removeEventListener('focus', handleFocus);
        input.removeEventListener('blur', handleBlur);
        input.removeEventListener('keydown', handleKeydown);
        dropdown.removeEventListener('mousedown', handleDropdownClick);
    });
}

// ── Datepicker ────────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Check format AND that the date is real (e.g. rejects 2025-02-30). */
function isValidDate(v: string): boolean {
    if (!DATE_RE.test(v)) { return false; }
    const [y, m, d] = v.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function showDateError(msg: string): void {
    const input = document.getElementById('modal-duedate');
    const help = document.getElementById('datepicker-help');
    input?.classList.add('datepicker-error');
    if (help) { help.textContent = msg; help.removeAttribute('hidden'); }
}

function clearDateError(): void {
    const input = document.getElementById('modal-duedate');
    const help = document.getElementById('datepicker-help');
    input?.classList.remove('datepicker-error');
    if (help) { help.textContent = ''; help.setAttribute('hidden', ''); }
}

function validateDateInput(): boolean {
    const input = document.getElementById('modal-duedate') as HTMLInputElement | null;
    if (!input) { return true; }
    const v = input.value.trim();
    if (!v) { clearDateError(); return true; }
    if (!isValidDate(v)) {
        showDateError('Please enter a valid date in YYYY-MM-DD format');
        return false;
    }
    clearDateError();
    return true;
}

let dpViewYear = new Date().getFullYear();
let dpViewMonth = new Date().getMonth(); // 0-based

function toggleDatepicker(): void {
    const overlay = document.getElementById('datepicker-overlay');
    if (!overlay) {
        return;
    }
    if (overlay.hasAttribute('hidden')) {
        // Initialise view to current value or today
        const input = document.getElementById('modal-duedate') as HTMLInputElement | null;
        if (input?.value && isValidDate(input.value)) {
            const d = new Date(input.value + 'T00:00:00');
            dpViewYear = d.getFullYear();
            dpViewMonth = d.getMonth();
        } else {
            const now = new Date();
            dpViewYear = now.getFullYear();
            dpViewMonth = now.getMonth();
        }
        renderCalendar();
        overlay.removeAttribute('hidden');
    } else {
        overlay.setAttribute('hidden', '');
    }
}

function clearDatepicker(): void {
    const input = document.getElementById('modal-duedate') as HTMLInputElement | null;
    if (input) {
        input.value = '';
    }
    clearDateError();
    document.getElementById('datepicker-overlay')?.setAttribute('hidden', '');
}

function dpNavigate(delta: number): void {
    dpViewMonth += delta;
    if (dpViewMonth < 0) {
        dpViewMonth = 11;
        dpViewYear--;
    } else if (dpViewMonth > 11) {
        dpViewMonth = 0;
        dpViewYear++;
    }
    renderCalendar();
}

function dpSelectDay(dateStr: string): void {
    const input = document.getElementById('modal-duedate') as HTMLInputElement | null;
    if (input) {
        input.value = dateStr;
    }
    clearDateError();
    document.getElementById('datepicker-overlay')?.setAttribute('hidden', '');
}

function renderCalendar(): void {
    const popup = document.getElementById('datepicker-popup');
    if (!popup) {
        return;
    }
    const input = document.getElementById('modal-duedate') as HTMLInputElement | null;
    const selectedDate = input?.value ?? '';

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];

    const firstDay = new Date(dpViewYear, dpViewMonth, 1);
    const startDow = firstDay.getDay(); // 0=Sun
    const daysInMonth = new Date(dpViewYear, dpViewMonth + 1, 0).getDate();

    let cells = '';
    // Empty cells before first day
    for (let i = 0; i < startDow; i++) {
        cells += '<div class="dp-cell dp-empty"></div>';
    }
    for (let d = 1; d <= daysInMonth; d++) {
        const ds = `${dpViewYear}-${String(dpViewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const isSelected = ds === selectedDate;
        const isToday = ds === todayStr;
        let cls = 'dp-cell dp-day';
        if (isSelected) {
            cls += ' dp-selected';
        }
        if (isToday) {
            cls += ' dp-today';
        }
        cells += `<div class="${cls}" data-dp-day="${ds}">${d}</div>`;
    }

    popup.innerHTML = `
        <div class="dp-header">
            <button class="icon-btn dp-nav" id="dp-prev" type="button">&lsaquo;</button>
            <span class="dp-month-label">${monthNames[dpViewMonth]} ${dpViewYear}</span>
            <button class="icon-btn dp-nav" id="dp-next" type="button">&rsaquo;</button>
        </div>
        <div class="dp-weekdays">
            <div>Su</div><div>Mo</div><div>Tu</div><div>We</div><div>Th</div><div>Fr</div><div>Sa</div>
        </div>
        <div class="dp-grid">${cells}</div>
    `;
}
