import type { GraphDocument } from '../src/core/types';

export const demoGraph: GraphDocument = {
  schemaVersion: 1,
  id: 'demo-manga-workflow',
  name: '雨夜重逢 · 镜头工作区',
  viewport: { x: 28, y: 20, zoom: .48 },
  metadata: { example: true },
  nodes: [
    { id: 'script', type: 'prompt', position: { x: 100, y: 120 }, data: { title: '01 · 场景脚本', description: '场景提示词', prompt: '雨夜的旧车站，女主在站台尽头认出多年未见的故人。镜头从雨伞边缘缓慢推近。', status: 'idle', cache: true, retryCount: 0 } },
    { id: 'character', type: 'image', position: { x: 760, y: 60 }, data: { title: '角色参考图', description: '固定角色外观', model: 'nano-banana-pro(特价版 1)', preview: '/assets/scene-character.jpg', status: 'idle', cache: true, retryCount: 0 } },
    { id: 'shot', type: 'video', position: { x: 760, y: 760 }, data: { title: '02 · 首镜生成', description: '生成雨夜车站镜头', model: 'Kling 2.1', duration: 5, status: 'idle', cache: true, retryCount: 1 } },
    { id: 'voice', type: 'audio', position: { x: 1440, y: 760 }, data: { title: '03 · 女主配音', description: '生成角色台词', voice: '清冷女声', status: 'idle', cache: true, retryCount: 0 } },
    { id: 'compose', type: 'compose', position: { x: 1460, y: 170 }, data: { title: '04 · 镜头合成', description: '合成画面、配音和字幕', resolution: '1080p', status: 'idle', cache: true, retryCount: 0 } },
  ],
  edges: [
    { id: 'e-script-image', source: 'script', sourcePort: 'text', target: 'character', targetPort: 'prompt' },
    { id: 'e-script-video', source: 'script', sourcePort: 'text', target: 'shot', targetPort: 'prompt' },
    { id: 'e-image-video', source: 'character', sourcePort: 'image', target: 'shot', targetPort: 'image' },
    { id: 'e-script-voice', source: 'script', sourcePort: 'text', target: 'voice', targetPort: 'text' },
    { id: 'e-video-compose', source: 'shot', sourcePort: 'video', target: 'compose', targetPort: 'video' },
    { id: 'e-audio-compose', source: 'voice', sourcePort: 'audio', target: 'compose', targetPort: 'audio' },
  ],
};
