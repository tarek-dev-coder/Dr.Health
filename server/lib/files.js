import path from 'node:path';
import { badRequest, payloadTooLarge, unsupportedMedia } from './errors.js';

// Both upstream models are text models. We accept any file that is valid text
// (UTF-8, or UTF-16 with a BOM), plus common source-code files. Binary formats
// such as images, PDFs, audio, and video are rejected before any provider call.
const LANGUAGE_BY_EXTENSION = Object.freeze({
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'jsx',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.py': 'python',
  '.pyw': 'python',
  '.rb': 'ruby',
  '.php': 'php',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.go': 'go',
  '.rs': 'rust',
  '.swift': 'swift',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.fish': 'fish',
  '.ps1': 'powershell',
  '.bat': 'batch',
  '.cmd': 'batch',
  '.sql': 'sql',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'sass',
  '.less': 'less',
  '.json': 'json',
  '.jsonl': 'json',
  '.ndjson': 'json',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.ini': 'ini',
  '.cfg': 'ini',
  '.conf': 'ini',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.mdx': 'mdx',
  '.csv': 'csv',
  '.tsv': 'tsv',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.astro': 'astro',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.proto': 'protobuf',
  '.tf': 'hcl',
  '.tfvars': 'hcl',
  '.hcl': 'hcl',
  '.nix': 'nix',
  '.zig': 'zig',
  '.dart': 'dart',
  '.r': 'r',
  '.lua': 'lua',
  '.pl': 'perl',
  '.pm': 'perl',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.hrl': 'erlang',
  '.clj': 'clojure',
  '.cljs': 'clojure',
  '.cljc': 'clojure',
  '.scala': 'scala',
  '.fs': 'fsharp',
  '.fsx': 'fsharp',
  '.vb': 'vb',
  '.asm': 'asm',
  '.s': 'asm',
  '.sol': 'solidity',
  '.ipynb': 'json',
  '.properties': 'properties',
  '.gradle': 'groovy',
  '.groovy': 'groovy',
});

const CODE_EXTENSIONS = new Set(Object.keys(LANGUAGE_BY_EXTENSION));

const BLOCKED_EXTENSIONS = new Set([
  '.env',
  '.pem',
  '.key',
  '.crt',
  '.cer',
  '.p12',
  '.pfx',
  '.jks',
  '.keystore',
  '.ppk',
]);

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.ico',
  '.tif',
  '.tiff',
  '.pdf',
  '.zip',
  '.gz',
  '.tgz',
  '.bz2',
  '.xz',
  '.7z',
  '.rar',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.odt',
  '.ods',
  '.odp',
  '.mp3',
  '.wav',
  '.ogg',
  '.flac',
  '.m4a',
  '.mp4',
  '.mov',
  '.avi',
  '.mkv',
  '.webm',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.dat',
  '.db',
  '.sqlite',
  '.wasm',
  '.class',
  '.jar',
  '.apk',
  '.dmg',
  '.iso',
]);

const SPECIAL_TEXT_FILES = new Set([
  'dockerfile',
  'makefile',
  'procfile',
  'gemfile',
  'rakefile',
  'jenkinsfile',
  'cmakelists.txt',
  'license',
  'readme',
  'changelog',
  'authors',
  'notice',
  'copying',
  'todo',
  '.gitignore',
  '.editorconfig',
]);

function cleanFileName(value) {
  const base = path.basename(String(value || 'file'));
  return base.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120) || 'file';
}

function extensionOf(name) {
  return path.extname(name).toLowerCase();
}

function isBlockedName(name, extension) {
  const lower = name.toLowerCase();
  return (
    lower === '.env' ||
    lower.startsWith('.env.') ||
    lower === '.npmrc' ||
    lower === '.pypirc' ||
    lower === 'id_rsa' ||
    lower === 'id_dsa' ||
    lower === 'id_ecdsa' ||
    lower === 'id_ed25519' ||
    BLOCKED_EXTENSIONS.has(extension)
  );
}

function decodeText(buffer) {
  try {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) {
      return new TextDecoder('utf-16le', { fatal: true }).decode(buffer.subarray(2));
    }
    if (buffer[0] === 0xfe && buffer[1] === 0xff) {
      return new TextDecoder('utf-16be', { fatal: true }).decode(buffer.subarray(2));
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw unsupportedMedia(
      'That file is not text. Add a text or code file instead.',
      'UNSUPPORTED_FILE',
    );
  }
}

export function parseTextFile(file, { maxBytes, maxChars }) {
  if (!file) return null;

  if (file.size > maxBytes) {
    throw payloadTooLarge(
      `That file is too big. The limit is ${Math.round(maxBytes / 1024)} KB.`,
      'FILE_TOO_LARGE',
    );
  }

  const name = cleanFileName(file.originalname);
  const extension = extensionOf(name);
  const isSpecialText = SPECIAL_TEXT_FILES.has(name.toLowerCase());

  if (isBlockedName(name, extension)) {
    throw unsupportedMedia(
      'For safety, .env and private key files are not allowed.',
      'UNSUPPORTED_FILE',
    );
  }

  if (BINARY_EXTENSIONS.has(extension) && !isSpecialText) {
    throw unsupportedMedia(
      'Images, PDFs, office files, audio, and video are not supported. Add a text or code file instead.',
      'UNSUPPORTED_FILE',
    );
  }

  if (!file.buffer || file.buffer.length === 0) {
    throw badRequest('That file is empty.', 'EMPTY_FILE');
  }

  if (file.buffer.includes(0) && !(file.buffer[0] === 0xff || file.buffer[0] === 0xfe)) {
    throw unsupportedMedia(
      'That file is not text. Add a text or code file instead.',
      'UNSUPPORTED_FILE',
    );
  }

  const content = decodeText(file.buffer).replace(/^\uFEFF/, '').replace(/\u0000/g, '').trim();
  if (!content) {
    throw badRequest('That file is empty.', 'EMPTY_FILE');
  }

  if (content.length > maxChars) {
    throw payloadTooLarge(
      `That file is too long. Keep it under ${maxChars.toLocaleString('en-US')} characters.`,
      'FILE_TOO_LONG',
    );
  }

  return {
    name,
    extension,
    kind: CODE_EXTENSIONS.has(extension) ? 'code' : 'text',
    language: LANGUAGE_BY_EXTENSION[extension] || '',
    content,
  };
}

export function buildFileBlock(file) {
  if (!file) return '';
  const longestFence = Math.max(
    3,
    ...(file.content.match(/`{3,}/g) || []).map((run) => run.length + 1),
  );
  const fence = '`'.repeat(longestFence);
  return `\n\nAttached file: ${file.name}\n\n${fence}${file.language}\n${file.content}\n${fence}`;
}
