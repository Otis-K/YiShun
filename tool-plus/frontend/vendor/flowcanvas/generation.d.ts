import type { CanvasNodeData } from './core/types.js';
export declare const GENERATION_MODES: readonly ['text', 'image', 'video', 'audio'];
export type GenerationMode = typeof GENERATION_MODES[number];
export type GenerationMediaKind = 'image' | 'video' | 'audio' | 'text' | 'file';
export interface GenerationMediaReference {
    id: string;
    name: string;
    kind: GenerationMediaKind;
    mimeType?: string;
    url?: string;
    size?: number;
    lastModified?: number;
}
export type GenerationReferenceValue = string | GenerationMediaReference;
/** Gemini 3 Pro Image / Nano Banana Pro accepts at most 14 reference images. */
export declare const IMAGE_REFERENCE_LIMIT = 14;
export interface TextGenerationDraft {
    prompt: string;
    model: string;
    references: GenerationReferenceValue[];
}
export interface ImageGenerationDraft {
    prompt: string;
    model: string;
    references: GenerationReferenceValue[];
    ratio: string;
    quality: string;
    panorama: boolean;
    count: number;
}
export interface VideoGenerationDraft {
    prompt: string;
    model: string;
    references: GenerationReferenceValue[];
    resolution: string;
    duration: number;
    firstFrame: GenerationReferenceValue | '';
    lastFrame: GenerationReferenceValue | '';
    modeType: string;
    ratio: string;
    enableSound: string;
}
/** Derive the provider mode from the material configuration instead of asking users to keep a second selector in sync. */
export declare function inferVideoModeType(video: Pick<VideoGenerationDraft, 'references' | 'firstFrame' | 'lastFrame'>): 'text2video' | 'image2video' | 'mixed2video';
export interface AudioGenerationDraft {
    prompt: string;
    model: string;
    references: GenerationReferenceValue[];
    lyricsMode: string;
}
export interface GenerationDrafts {
    text: TextGenerationDraft;
    image: ImageGenerationDraft;
    video: VideoGenerationDraft;
    audio: AudioGenerationDraft;
}
export interface GenerationNodeData extends CanvasNodeData {
    generationMode: GenerationMode;
    generationDrafts: GenerationDrafts;
}
export interface GenerationModeDescriptor {
    mode: GenerationMode;
    nodeType: string;
    label: string;
    shortLabel: string;
    placeholder: string;
    creditCost: number;
    accept?: string;
}
export declare const generationModeDescriptors: readonly GenerationModeDescriptor[];
export declare function isGenerationMode(value: unknown): value is GenerationMode;
export declare function generationModeFromNodeType(type: string): GenerationMode | undefined;
export declare function generationNodeTypeForMode(mode: GenerationMode): string;
export declare function isGenerationNodeType(type: string): boolean;
export declare function getGenerationModeDescriptor(mode: GenerationMode): GenerationModeDescriptor;
export declare function createGenerationDrafts(): GenerationDrafts;
export declare function normalizeGenerationDrafts(value: unknown, legacyData?: CanvasNodeData, activeMode?: GenerationMode): GenerationDrafts;
export declare function generationDataPatch(mode: GenerationMode, drafts: GenerationDrafts): Partial<GenerationNodeData>;
export declare function generationCreditCost(mode: GenerationMode, drafts: GenerationDrafts): number;
