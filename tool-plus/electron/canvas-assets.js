const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function isInsidePath(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function materializeCanvasAssets(rawAssets, canvasRoot) {
  const source = Array.isArray(rawAssets) ? rawAssets.slice(0, 15) : [];
  if (!source.length) return { assets: [], cleanup() {} };
  const resolvedCanvasRoot = path.resolve(canvasRoot);
  const stagingBase = path.join(resolvedCanvasRoot, 'upload-staging');
  const stagingRoot = path.join(stagingBase, crypto.randomUUID());
  fs.mkdirSync(stagingRoot, { recursive: true });
  const assets = [];
  try {
    for (const [index, raw] of source.entries()) {
      const item = raw && typeof raw === 'object' ? raw : {};
      const kind = String(item.kind || '').toLowerCase();
      if (!['image', 'video', 'audio'].includes(kind)) throw new Error(`不支持的本地素材类型：${kind || 'unknown'}`);
      const role = ['firstFrame', 'lastFrame', 'reference'].includes(item.role) ? item.role : 'reference';
      const mimeType = String(item.mimeType || '').trim();
      const name = path.basename(String(item.name || `${role}-${index + 1}`)).replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(-120) || `${role}-${index + 1}`;
      let localPath = String(item.localPath || '').trim();
      if (localPath) {
        if (!path.isAbsolute(localPath) || !isInsidePath(localPath, resolvedCanvasRoot)) throw new Error('本地素材路径不在画布资源目录内。');
        if (!fs.statSync(localPath).isFile()) throw new Error('本地素材文件不存在。');
      } else {
        let bytes;
        if (item.bytes instanceof ArrayBuffer) bytes = Buffer.from(item.bytes);
        else if (ArrayBuffer.isView(item.bytes)) bytes = Buffer.from(item.bytes.buffer, item.bytes.byteOffset, item.bytes.byteLength);
        else if (Buffer.isBuffer(item.bytes)) bytes = item.bytes;
        else throw new Error(`素材“${name}”没有可读取的文件内容。`);
        const maxBytes = kind === 'image' ? 25 * 1024 * 1024 : kind === 'audio' ? 50 * 1024 * 1024 : 500 * 1024 * 1024;
        if (!bytes.length || bytes.length > maxBytes) throw new Error(`素材“${name}”大小不符合 ${kind} 上传限制。`);
        localPath = path.join(stagingRoot, `${String(index + 1).padStart(2, '0')}-${name}`);
        fs.writeFileSync(localPath, bytes, { flag: 'wx' });
      }
      assets.push({ path: localPath, name, kind, mimeType, role });
    }
    return {
      assets,
      cleanup() {
        if (isInsidePath(stagingRoot, stagingBase)) fs.rmSync(stagingRoot, { recursive: true, force: true });
      }
    };
  } catch (error) {
    if (isInsidePath(stagingRoot, stagingBase)) fs.rmSync(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { isInsidePath, materializeCanvasAssets };
