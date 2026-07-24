'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_NAME_LENGTH = 40;
const MAX_TAG_LENGTH = 40;
const MAX_REGION_LENGTH = 40;
const MAX_AGE_GROUP_LENGTH = 30;
const MAX_DESCRIPTION_LENGTH = 500;
const STORE_VERSION = 1;
const MODEL_STYLES = new Set(['editorial', 'casual']);
const IMAGE_TYPES = Object.freeze({
  jpeg: { extension: '.jpg', mimeType: 'image/jpeg' },
  png: { extension: '.png', mimeType: 'image/png' },
  webp: { extension: '.webp', mimeType: 'image/webp' },
});

class ModelLibraryError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'ModelLibraryError';
    this.statusCode = statusCode;
  }
}

function isInsidePath(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function detectImageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return IMAGE_TYPES.jpeg;
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return IMAGE_TYPES.png;
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return IMAGE_TYPES.webp;
  throw new ModelLibraryError('模特图片仅支持 JPG、PNG 或 WebP 格式。');
}

function normalizeName(value) {
  const name = String(value || '').trim().normalize('NFC');
  if (!name) throw new ModelLibraryError('请输入模特名称。');
  if ([...name].length > MAX_NAME_LENGTH) throw new ModelLibraryError(`模特名称不能超过 ${MAX_NAME_LENGTH} 个字符。`);
  if (/\p{Cc}/u.test(name)) throw new ModelLibraryError('模特名称包含无效字符。');
  return name;
}

function normalizeGender(value) {
  const gender = String(value || '').trim().toLowerCase();
  if (gender === 'male' || gender === '男') return 'male';
  if (gender === 'female' || gender === '女') return 'female';
  throw new ModelLibraryError('模特性别必须为 male 或 female。');
}

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function normalizeOptionalText(value, label, maximumLength) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw new ModelLibraryError(`${label}格式无效。`);
  const canonical = value.normalize('NFC');
  if (/\p{Cc}/u.test(canonical)) throw new ModelLibraryError(`${label}包含无效字符。`);
  const normalized = canonical.trim();
  if ([...normalized].length > maximumLength) throw new ModelLibraryError(`${label}不能超过 ${maximumLength} 个字符。`);
  return normalized;
}

function normalizeStyle(value) {
  const style = normalizeOptionalText(value, '模特风格', 20).toLowerCase();
  if (!style || MODEL_STYLES.has(style)) return style;
  throw new ModelLibraryError('模特风格必须为 editorial 或 casual。');
}

function normalizeDescription(payload, fallback = '') {
  if (hasOwn(payload, 'description')) return normalizeOptionalText(payload.description, '模特备注', MAX_DESCRIPTION_LENGTH);
  if (hasOwn(payload, 'meta')) return normalizeOptionalText(payload.meta, '模特备注', MAX_DESCRIPTION_LENGTH);
  return fallback;
}

function hasImagePayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (hasOwn(payload, 'image')) return payload.image !== undefined && payload.image !== null;
  return hasOwn(payload, 'bytes') || hasOwn(payload, 'bytesBase64');
}

function nextUpdatedAt(previousValue) {
  const previousTime = Date.parse(String(previousValue || ''));
  const currentTime = Date.now();
  return new Date(Number.isFinite(previousTime) && previousTime >= currentTime ? previousTime + 1 : currentTime).toISOString();
}

function decodeBase64(value) {
  const encoded = String(value || '').trim();
  const maximumEncodedLength = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4;
  if (!encoded || encoded.length > maximumEncodedLength || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new ModelLibraryError('模特图片内容无效。');
  }
  return Buffer.from(encoded, 'base64');
}

function imageBytesFromPayload(payload) {
  const source = payload && typeof payload.image === 'object' && payload.image ? payload.image : payload || {};
  const raw = source.bytes !== undefined ? source.bytes : payload && payload.bytes;
  if (Buffer.isBuffer(raw)) return Buffer.from(raw);
  if (raw instanceof ArrayBuffer) return Buffer.from(raw);
  if (ArrayBuffer.isView(raw)) return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  const encoded = source.bytesBase64 !== undefined ? source.bytesBase64 : payload && payload.bytesBase64;
  if (encoded !== undefined) return decodeBase64(encoded);
  throw new ModelLibraryError('请选择模特图片。');
}

function normalizeImage(payload) {
  const source = payload && typeof payload.image === 'object' && payload.image ? payload.image : payload || {};
  const bytes = imageBytesFromPayload(payload);
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new ModelLibraryError('模特图片大小必须在 25MB 以内。');
  const detected = detectImageType(bytes);
  const claimedMimeType = String(source.mimeType || payload && payload.mimeType || '').trim().toLowerCase();
  if (claimedMimeType && claimedMimeType !== detected.mimeType && !(claimedMimeType === 'image/jpg' && detected.mimeType === 'image/jpeg')) {
    throw new ModelLibraryError('模特图片的文件类型与内容不一致。');
  }
  const originalName = path.basename(String(source.name || payload && payload.imageName || `model${detected.extension}`)).slice(-160);
  const extension = path.extname(originalName).toLowerCase();
  if (extension && !['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) {
    throw new ModelLibraryError('模特图片仅支持 JPG、PNG 或 WebP 格式。');
  }
  if (extension) {
    const extensionType = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
    if (extensionType !== detected.mimeType) throw new ModelLibraryError('模特图片的扩展名与内容不一致。');
  }
  return { bytes, mimeType: detected.mimeType, extension: detected.extension, originalName: originalName || `model${detected.extension}` };
}

function publicRecord(record) {
  return {
    id: record.id,
    name: record.name,
    gender: record.gender,
    source: 'custom',
    style: record.style || '',
    tag: record.tag || '',
    region: record.region || '',
    ageGroup: record.ageGroup || '',
    meta: record.meta || '',
    description: record.meta || '',
    imageName: record.imageName,
    mimeType: record.mimeType,
    size: record.size,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt || record.createdAt,
  };
}

class ModelLibrary {
  constructor(dataRoot) {
    if (!dataRoot || !path.isAbsolute(dataRoot)) throw new TypeError('Model library data root must be an absolute path.');
    this.root = path.resolve(dataRoot);
    this.imagesRoot = path.join(this.root, 'images');
    this.metadataPath = path.join(this.root, 'models.json');
    fs.mkdirSync(this.imagesRoot, { recursive: true });
  }

  _loadRecords() {
    if (!fs.existsSync(this.metadataPath)) return [];
    let stored;
    try {
      stored = JSON.parse(fs.readFileSync(this.metadataPath, 'utf8'));
    } catch (_) {
      throw new ModelLibraryError('用户模特数据文件已损坏，无法读取。', 500);
    }
    if (!stored || stored.version !== STORE_VERSION || !Array.isArray(stored.models)) {
      throw new ModelLibraryError('用户模特数据文件格式无效。', 500);
    }
    return stored.models.map(record => this._validateStoredRecord(record));
  }

  _validateStoredRecord(value) {
    const record = value && typeof value === 'object' ? value : {};
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(record.id || ''))) {
      throw new ModelLibraryError('用户模特数据包含无效标识。', 500);
    }
    const imageFile = String(record.imageFile || '');
    const imagePath = path.resolve(this.imagesRoot, imageFile);
    if (!imageFile || path.basename(imageFile) !== imageFile || !isInsidePath(imagePath, this.imagesRoot)) {
      throw new ModelLibraryError('用户模特数据包含不安全的图片路径。', 500);
    }
    if (!Object.values(IMAGE_TYPES).some(type => type.mimeType === record.mimeType && imageFile.endsWith(type.extension))) {
      throw new ModelLibraryError('用户模特数据包含无效图片类型。', 500);
    }
    return {
      id: record.id,
      name: normalizeName(record.name),
      gender: normalizeGender(record.gender),
      source: 'custom',
      style: normalizeStyle(record.style),
      tag: normalizeOptionalText(record.tag, '模特标签', MAX_TAG_LENGTH),
      region: normalizeOptionalText(record.region, '模特地区', MAX_REGION_LENGTH),
      ageGroup: normalizeOptionalText(record.ageGroup, '模特年龄段', MAX_AGE_GROUP_LENGTH),
      meta: normalizeDescription(record),
      imageFile,
      imageName: path.basename(String(record.imageName || imageFile)).slice(-160),
      mimeType: record.mimeType,
      size: Number(record.size) || 0,
      createdAt: String(record.createdAt || ''),
      updatedAt: String(record.updatedAt || record.createdAt || ''),
    };
  }

  _saveRecords(records) {
    fs.mkdirSync(this.root, { recursive: true });
    const temporaryPath = path.join(this.root, `.models-${process.pid}-${crypto.randomUUID()}.tmp`);
    const contents = `${JSON.stringify({ version: STORE_VERSION, models: records }, null, 2)}\n`;
    let descriptor;
    try {
      descriptor = fs.openSync(temporaryPath, 'wx');
      fs.writeFileSync(descriptor, contents, 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      try {
        fs.renameSync(temporaryPath, this.metadataPath);
      } catch (error) {
        if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
        fs.rmSync(this.metadataPath, { force: true });
        fs.renameSync(temporaryPath, this.metadataPath);
      }
    } catch (error) {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch (_) {}
      }
      try { fs.rmSync(temporaryPath, { force: true }); } catch (_) {}
      throw error;
    }
  }

  _recordImagePath(record) {
    const target = path.resolve(this.imagesRoot, record.imageFile);
    if (!isInsidePath(target, this.imagesRoot) || path.basename(record.imageFile) !== record.imageFile) {
      throw new ModelLibraryError('用户模特图片路径无效。', 500);
    }
    return target;
  }

  list() {
    return this._loadRecords()
      .slice()
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .map(publicRecord);
  }

  create(payload = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new ModelLibraryError('模特信息格式无效。');
    }
    const name = normalizeName(payload.name);
    const gender = normalizeGender(payload.gender);
    const style = normalizeStyle(payload.style);
    const tag = normalizeOptionalText(payload.tag, '模特标签', MAX_TAG_LENGTH);
    const region = normalizeOptionalText(payload.region, '模特地区', MAX_REGION_LENGTH);
    const ageGroup = normalizeOptionalText(payload.ageGroup, '模特年龄段', MAX_AGE_GROUP_LENGTH);
    const meta = normalizeDescription(payload);
    const image = normalizeImage(payload);
    const records = this._loadRecords();
    const id = crypto.randomUUID();
    const imageFile = `${id}${image.extension}`;
    const imagePath = path.resolve(this.imagesRoot, imageFile);
    if (!isInsidePath(imagePath, this.imagesRoot)) throw new ModelLibraryError('无法创建用户模特图片。', 500);
    const timestamp = new Date().toISOString();
    const record = {
      id,
      name,
      gender,
      source: 'custom',
      style,
      tag,
      region,
      ageGroup,
      meta,
      imageFile,
      imageName: image.originalName,
      mimeType: image.mimeType,
      size: image.bytes.length,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    fs.mkdirSync(this.imagesRoot, { recursive: true });
    fs.writeFileSync(imagePath, image.bytes, { flag: 'wx' });
    try {
      this._saveRecords([...records, record]);
    } catch (error) {
      try { fs.rmSync(imagePath, { force: true }); } catch (_) {}
      throw error;
    }
    return publicRecord(record);
  }

  update(id, payload = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new ModelLibraryError('模特更新内容格式无效。');
    }
    const normalizedId = String(id || '').trim();
    const records = this._loadRecords();
    const index = records.findIndex(item => item.id === normalizedId);
    if (index < 0) throw new ModelLibraryError('用户模特不存在。', 404);

    const changesImage = hasImagePayload(payload);
    const changesDescription = hasOwn(payload, 'meta') || hasOwn(payload, 'description');
    if (!hasOwn(payload, 'name') && !hasOwn(payload, 'gender') && !hasOwn(payload, 'style')
      && !hasOwn(payload, 'tag') && !hasOwn(payload, 'region') && !hasOwn(payload, 'ageGroup')
      && !changesDescription && !changesImage) {
      throw new ModelLibraryError('请提供需要更新的模特信息。');
    }

    const previous = records[index];
    const next = {
      ...previous,
      name: hasOwn(payload, 'name') ? normalizeName(payload.name) : previous.name,
      gender: hasOwn(payload, 'gender') ? normalizeGender(payload.gender) : previous.gender,
      style: hasOwn(payload, 'style') ? normalizeStyle(payload.style) : previous.style,
      tag: hasOwn(payload, 'tag') ? normalizeOptionalText(payload.tag, '模特标签', MAX_TAG_LENGTH) : previous.tag,
      region: hasOwn(payload, 'region') ? normalizeOptionalText(payload.region, '模特地区', MAX_REGION_LENGTH) : previous.region,
      ageGroup: hasOwn(payload, 'ageGroup') ? normalizeOptionalText(payload.ageGroup, '模特年龄段', MAX_AGE_GROUP_LENGTH) : previous.ageGroup,
      meta: changesDescription ? normalizeDescription(payload) : previous.meta,
      updatedAt: nextUpdatedAt(previous.updatedAt || previous.createdAt),
    };

    let replacementPath = '';
    if (changesImage) {
      const image = normalizeImage(payload);
      next.imageFile = `${previous.id}-${crypto.randomUUID()}${image.extension}`;
      next.imageName = image.originalName;
      next.mimeType = image.mimeType;
      next.size = image.bytes.length;
      replacementPath = path.resolve(this.imagesRoot, next.imageFile);
      if (!isInsidePath(replacementPath, this.imagesRoot) || path.basename(next.imageFile) !== next.imageFile) {
        throw new ModelLibraryError('无法更新用户模特图片。', 500);
      }
      fs.mkdirSync(this.imagesRoot, { recursive: true });
      fs.writeFileSync(replacementPath, image.bytes, { flag: 'wx' });
    }

    records[index] = next;
    try {
      this._saveRecords(records);
    } catch (error) {
      if (replacementPath) {
        try { fs.rmSync(replacementPath, { force: true }); } catch (_) {}
      }
      throw error;
    }

    if (replacementPath) {
      const previousPath = this._recordImagePath(previous);
      try { fs.rmSync(previousPath, { force: true }); } catch (_) {}
    }
    return publicRecord(next);
  }

  read(id) {
    const normalizedId = String(id || '').trim();
    const record = this._loadRecords().find(item => item.id === normalizedId);
    if (!record) throw new ModelLibraryError('用户模特不存在。', 404);
    const imagePath = this._recordImagePath(record);
    let bytes;
    try { bytes = fs.readFileSync(imagePath); }
    catch (error) {
      if (error && error.code === 'ENOENT') throw new ModelLibraryError('用户模特图片不存在。', 404);
      throw error;
    }
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new ModelLibraryError('用户模特图片大小无效。', 500);
    const detected = detectImageType(bytes);
    if (detected.mimeType !== record.mimeType) throw new ModelLibraryError('用户模特图片内容与记录不一致。', 500);
    return { ...publicRecord(record), image: { name: record.imageName, mimeType: record.mimeType, size: bytes.length, bytes } };
  }

  delete(id) {
    const normalizedId = String(id || '').trim();
    const records = this._loadRecords();
    const index = records.findIndex(item => item.id === normalizedId);
    if (index < 0) throw new ModelLibraryError('用户模特不存在。', 404);
    const [record] = records.splice(index, 1);
    const imagePath = this._recordImagePath(record);
    this._saveRecords(records);
    try { fs.rmSync(imagePath, { force: true }); } catch (_) {}
    return publicRecord(record);
  }
}

module.exports = { ModelLibrary, ModelLibraryError, MAX_IMAGE_BYTES, detectImageType };
