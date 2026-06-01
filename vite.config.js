import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, relative, resolve } from 'node:path';

function toPublicPath(path) {
  return path.replaceAll('\\', '/');
}

const visualCuePatterns = [
  /!\[[^\]]*\]\([^)]+\)/i,
  /\[(?:diagram|photo|photograph|picture|image|illustration|graph|chart|map|poster|advertisement|notice|webpage|logo|crest|drawing|comic|screenshot|snip)[^\]]*\]/i,
  /\b(?:study|look at|refer to|shown below|shown above|following)\b[^\n.]{0,120}\b(?:poster|picture|diagram|photo|photograph|image|map|chart|graph|advertisement|notice|webpage)\b/i,
  /\bread\b[^\n.]{0,120}\b(?:poster|diagram|map|chart|graph|advertisement|notice|webpage)\b/i,
  /\b(?:pictures?|diagrams?|photos?|photographs?|images?|charts?|graphs?|maps?|posters?)\b[^\n.]{0,100}\b(?:below|above|shown|provided|carefully|following)\b/i,
];

function resolveInside(root, requestedPath) {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(resolvedRoot, requestedPath);

  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}\\`)) {
    throw new Error('Refusing to write outside the project workspace.');
  }

  return resolvedPath;
}

function readRequestBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    let body = '';

    request.on('data', (chunk) => {
      body += chunk;
    });

    request.on('end', () => {
      try {
        resolveBody(JSON.parse(body || '{}'));
      } catch (error) {
        rejectBody(error);
      }
    });

    request.on('error', rejectBody);
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nextSnipPath(imagePath) {
  const sourceFolder = dirname(imagePath);
  const sourceExt = extname(imagePath);
  const sourceBase = basename(imagePath, sourceExt);
  const snipFolder = `snips/${sourceFolder}`;
  const absoluteSnipFolder = resolveInside(process.cwd(), snipFolder);

  mkdirSync(absoluteSnipFolder, { recursive: true });

  const existingIndexes = readdirSync(absoluteSnipFolder)
    .map((name) => name.match(new RegExp(`^${escapeRegExp(sourceBase)}-snip-(\\d+)\\.png$`, 'i'))?.[1])
    .filter(Boolean)
    .map(Number);
  const nextIndex = existingIndexes.length ? Math.max(...existingIndexes) + 1 : 1;

  return `${snipFolder}/${sourceBase}-snip-${String(nextIndex).padStart(2, '0')}.png`;
}

function publicMarkdownImagePath(path) {
  return `/${path.split('/').map(encodeURIComponent).join('/').replaceAll('%26', '&')}`;
}

function insertMarkdownEmbed(markdownText, markdownEmbed, insertAt) {
  const source = typeof markdownText === 'string' ? markdownText : '';
  const boundedInsertAt = Number.isFinite(insertAt)
    ? Math.min(Math.max(Math.trunc(insertAt), 0), source.length)
    : 0;
  const before = source.slice(0, boundedInsertAt).trimEnd();
  const after = source.slice(boundedInsertAt).trimStart();

  if (!before && !after) {
    return `${markdownEmbed}\n\n`;
  }

  if (!before) {
    return `${markdownEmbed}\n\n${after}`;
  }

  if (!after) {
    return `${before}\n\n${markdownEmbed}\n`;
  }

  return `${before}\n\n${markdownEmbed}\n\n${after}`;
}

async function saveSnip(request, response) {
  try {
    if (request.method !== 'POST') {
      response.statusCode = 405;
      response.end(JSON.stringify({ error: 'POST required.' }));
      return;
    }

    const payload = await readRequestBody(request);
    const {
      dataUrl,
      imagePath,
      insertAt,
      label = 'Selected image region',
      markdownPath,
      markdownText,
      rect,
    } = payload;

    if (!imagePath || !markdownPath || !dataUrl?.startsWith('data:image/png;base64,')) {
      response.statusCode = 400;
      response.end(JSON.stringify({ error: 'Missing snip image, source path, or markdown path.' }));
      return;
    }

    const snipPath = nextSnipPath(imagePath);
    const absoluteSnipPath = resolveInside(process.cwd(), snipPath);
    const absoluteMarkdownPath = resolveInside(process.cwd(), markdownPath);
    const imageBuffer = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');

    mkdirSync(dirname(absoluteSnipPath), { recursive: true });
    writeFileSync(absoluteSnipPath, imageBuffer);
    writeFileSync(
      absoluteSnipPath.replace(/\.png$/i, '.json'),
      JSON.stringify(
        {
          sourceImage: imagePath,
          markdown: markdownPath,
          label,
          rect,
        },
        null,
        2,
      ),
    );

    mkdirSync(dirname(absoluteMarkdownPath), { recursive: true });

    const existingMarkdown = existsSync(absoluteMarkdownPath)
      ? readFileSync(absoluteMarkdownPath, 'utf8')
      : '';
    const markdownEmbed = `![${label}](${publicMarkdownImagePath(snipPath)})`;
    const updatedMarkdown = insertMarkdownEmbed(
      typeof markdownText === 'string' ? markdownText : existingMarkdown,
      markdownEmbed,
      insertAt,
    );

    writeFileSync(absoluteMarkdownPath, updatedMarkdown, 'utf8');

    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({
      markdownEmbed,
      markdownPath,
      markdownText: updatedMarkdown,
      snipPath,
    }));
  } catch (error) {
    response.statusCode = 500;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ error: error.message }));
  }
}

async function saveMarkdown(request, response) {
  try {
    if (request.method !== 'POST') {
      response.statusCode = 405;
      response.end(JSON.stringify({ error: 'POST required.' }));
      return;
    }

    const payload = await readRequestBody(request);
    const { markdownPath, markdownText } = payload;

    if (!markdownPath || typeof markdownText !== 'string') {
      response.statusCode = 400;
      response.end(JSON.stringify({ error: 'Missing markdown path or text.' }));
      return;
    }

    const absoluteMarkdownPath = resolveInside(process.cwd(), markdownPath);

    mkdirSync(dirname(absoluteMarkdownPath), { recursive: true });
    writeFileSync(absoluteMarkdownPath, markdownText, 'utf8');

    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({
      markdownPath,
      markdownText,
    }));
  } catch (error) {
    response.statusCode = 500;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ error: error.message }));
  }
}

function findVisualCue(markdownText) {
  const match = visualCuePatterns
    .map((pattern) => markdownText.match(pattern)?.[0])
    .find(Boolean);

  return match?.trim() ?? '';
}

function collectMarkdownFiles() {
  const markdownSource = resolve(process.cwd(), 'markdown');
  const files = [];
  let totalCount = 0;

  function walk(folder) {
    readdirSync(folder).forEach((name) => {
      const fullPath = resolve(folder, name);
      const stats = statSync(fullPath);

      if (stats.isDirectory()) {
        walk(fullPath);
        return;
      }

      if (!name.toLowerCase().endsWith('.md')) {
        return;
      }

      totalCount += 1;

      const markdownText = readFileSync(fullPath, 'utf8');
      const visualCue = findVisualCue(markdownText);

      if (!visualCue) {
        return;
      }

      const relativePath = toPublicPath(relative(markdownSource, fullPath));
      const markdown = `markdown/${relativePath}`;
      const image = relativePath.replace(/\.md$/i, '.jpg');

      files.push({
        image,
        markdown,
        visualCue,
      });
    });
  }

  if (existsSync(markdownSource)) {
    walk(markdownSource);
  }

  files.sort((a, b) => a.markdown.localeCompare(b.markdown, undefined, {
    numeric: true,
    sensitivity: 'base',
  }));

  return {
    totalCount,
    count: files.length,
    files,
  };
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-markdown-output',
      configureServer(server) {
        server.middlewares.use('/markdown-manifest.json', (_request, response) => {
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify(collectMarkdownFiles()));
        });
        server.middlewares.use('/api/markdown', saveMarkdown);
        server.middlewares.use('/api/snips', saveSnip);
      },
      writeBundle() {
        const markdownSource = resolve(process.cwd(), 'markdown');
        const markdownOutput = resolve(process.cwd(), 'dist', 'markdown');
        const snipsSource = resolve(process.cwd(), 'snips');
        const snipsOutput = resolve(process.cwd(), 'dist', 'snips');
        const manifestOutput = resolve(process.cwd(), 'dist', 'markdown-manifest.json');

        const hasMarkdownSource = existsSync(markdownSource);

        if (hasMarkdownSource) {
          cpSync(markdownSource, markdownOutput, { recursive: true });
        }

        if (existsSync(snipsSource)) {
          cpSync(snipsSource, snipsOutput, { recursive: true });
        }

        if (hasMarkdownSource) {
          mkdirSync(resolve(process.cwd(), 'dist'), { recursive: true });
          writeFileSync(manifestOutput, JSON.stringify(collectMarkdownFiles(), null, 2));
        }
      },
    },
  ],
  publicDir: false,
  server: {
    open: false,
  },
});
