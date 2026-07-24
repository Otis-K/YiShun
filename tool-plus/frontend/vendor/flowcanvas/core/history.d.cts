export interface HistoryEntry {
    label: string;
    undo: () => void;
    redo: () => void;
}
export declare class CommandHistory {
    private readonly limit;
    private undoStack;
    private redoStack;
    constructor(limit?: number);
    push(entry: HistoryEntry): void;
    undo(): boolean;
    redo(): boolean;
    clear(): void;
    get canUndo(): boolean;
    get canRedo(): boolean;
    get undoLabel(): string | undefined;
    get redoLabel(): string | undefined;
}
