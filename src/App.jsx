import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Maximize2,
  Minimize2,
  Save,
  Scissors,
  Search,
  X,
} from 'lucide-react';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';

const configuredAssetBaseUrl = (import.meta.env.VITE_ASSET_BASE_URL ?? '').trim();
const fallbackBaseUrl = import.meta.env.BASE_URL.replace(/\/$/, '');
const assetBaseUrl = (configuredAssetBaseUrl || fallbackBaseUrl).replace(/\/$/, '');
const imageCrossOrigin = configuredAssetBaseUrl ? 'anonymous' : undefined;
const manifestUrl = `${assetBaseUrl}/converted-images/manifest.json`;
const markdownManifestUrl = `${assetBaseUrl}/markdown-manifest.json`;
const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

function publicUrl(path) {
  const encodedPath = path
    .replace(/^\/+/, '')
    .split('/')
    .map((segment) => {
      let decodedSegment = segment;

      try {
        decodedSegment = decodeURIComponent(segment);
      } catch {
        decodedSegment = segment;
      }

      return encodeURIComponent(decodedSegment).replaceAll('%26', '&');
    })
    .join('/');

  return `${assetBaseUrl}/${encodedPath}`;
}

function assetUrl(path) {
  return publicUrl(`converted-images/${path}`);
}

function cacheBust(url) {
  return `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
}

function resolveMarkdownAssetSrc(src = '') {
  const value = String(src);

  if (
    !value ||
    value.startsWith('#') ||
    /^(?:https?:)?\/\//i.test(value) ||
    /^(?:data|blob|mailto):/i.test(value)
  ) {
    return value;
  }

  return publicUrl(value);
}

function markdownPathForImage(imagePath) {
  return `markdown/${imagePath.replace(/\.[^.]+$/, '.md')}`;
}

function MarkdownContent({ children }) {
  return (
    <ReactMarkdown
      rehypePlugins={[rehypeRaw]}
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ children: linkChildren, href = '', ...props }) => (
          <a {...props} href={resolveMarkdownAssetSrc(href)} target="_blank" rel="noreferrer">
            {linkChildren}
          </a>
        ),
        img: ({ alt = '', src = '', ...props }) => (
          <img
            {...props}
            alt={alt}
            crossOrigin={imageCrossOrigin}
            loading="lazy"
            src={resolveMarkdownAssetSrc(src)}
          />
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

function documentTitle(pdfPath) {
  return pdfPath.split('/').at(-1)?.replace(/\.pdf$/i, '') ?? pdfPath;
}

function documentCategory(pdfPath) {
  const pieces = pdfPath.split('/');
  pieces.pop();

  return pieces.join(' / ') || 'Converted images';
}

function groupPages(pages = []) {
  const documents = new Map();

  pages
    .filter((page) => page.status === 'converted' && page.image && page.pdf)
    .forEach((page) => {
      if (!documents.has(page.pdf)) {
        documents.set(page.pdf, {
          id: page.pdf,
          title: documentTitle(page.pdf),
          category: documentCategory(page.pdf),
          pages: [],
        });
      }

      documents.get(page.pdf).pages.push(page);
    });

  return Array.from(documents.values())
    .map((document) => ({
      ...document,
      pages: document.pages.sort((a, b) => a.page - b.page),
    }))
    .sort((a, b) => collator.compare(a.id, b.id));
}

function buildDocumentTree(documents) {
  const root = {
    type: 'folder',
    id: '',
    title: 'Converted images',
    children: [],
    documentCount: 0,
    pageCount: 0,
  };
  const folders = new Map([['', root]]);

  documents.forEach((document) => {
    const segments = document.id.split('/');
    segments.pop();
    let parent = root;
    let folderPath = '';

    root.documentCount += 1;
    root.pageCount += document.pages.length;

    segments.forEach((segment) => {
      folderPath = folderPath ? `${folderPath}/${segment}` : segment;

      if (!folders.has(folderPath)) {
        const folder = {
          type: 'folder',
          id: folderPath,
          title: segment,
          children: [],
          documentCount: 0,
          pageCount: 0,
        };

        folders.set(folderPath, folder);
        parent.children.push(folder);
      }

      const folder = folders.get(folderPath);
      folder.documentCount += 1;
      folder.pageCount += document.pages.length;
      parent = folder;
    });

    parent.children.push({
      type: 'document',
      id: document.id,
      title: document.title,
      category: document.category,
      pages: document.pages,
    });
  });

  function sortNode(node) {
    node.children.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'folder' ? -1 : 1;
      }

      return collator.compare(a.title, b.title);
    });

    node.children.forEach((child) => {
      if (child.type === 'folder') {
        sortNode(child);
      }
    });
  }

  sortNode(root);

  return root.children;
}

function folderAncestors(documentId) {
  const segments = documentId.split('/');
  segments.pop();

  return segments.reduce((paths, segment) => {
    const parent = paths.at(-1);
    paths.push(parent ? `${parent}/${segment}` : segment);

    return paths;
  }, []);
}

function firstDocumentInNode(node) {
  if (node.type === 'document') {
    return node;
  }

  for (const child of node.children) {
    const document = firstDocumentInNode(child);

    if (document) {
      return document;
    }
  }

  return null;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeSelection(start, end) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function insertMarkdownBlock(markdownText, blockText, insertAt) {
  const source = typeof markdownText === 'string' ? markdownText : '';
  const boundedInsertAt = Number.isFinite(insertAt)
    ? clamp(Math.trunc(insertAt), 0, source.length)
    : 0;
  const before = source.slice(0, boundedInsertAt).trimEnd();
  const after = source.slice(boundedInsertAt).trimStart();

  if (!before && !after) {
    return `${blockText}\n\n`;
  }

  if (!before) {
    return `${blockText}\n\n${after}`;
  }

  if (!after) {
    return `${before}\n\n${blockText}\n`;
  }

  return `${before}\n\n${blockText}\n\n${after}`;
}

function removeMarkdownBlock(markdownText, start, end) {
  const before = markdownText.slice(0, start).trimEnd();
  const after = markdownText.slice(end).trimStart();

  if (!before) {
    return after;
  }

  if (!after) {
    return before;
  }

  return `${before}\n\n${after}`;
}

function extractSnipEmbeds(markdownText) {
  const pattern = /!\[([^\]]*)\]\(((?:\/)?snips\/[^)\n]+)\)/g;
  const matches = [];
  let match = pattern.exec(markdownText);

  while (match) {
    matches.push({
      alt: match[1],
      end: match.index + match[0].length,
      path: match[2],
      start: match.index,
      text: match[0],
    });
    match = pattern.exec(markdownText);
  }

  return matches;
}

export default function App() {
  const snipImageRef = useRef(null);
  const snipMarkdownRef = useRef(null);
  const [manifest, setManifest] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [fitToScreen, setFitToScreen] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState(() => new Set());
  const [markdownOpen, setMarkdownOpen] = useState(false);
  const [markdownText, setMarkdownText] = useState('');
  const [markdownError, setMarkdownError] = useState('');
  const [markdownLoading, setMarkdownLoading] = useState(false);
  const [markdownManifest, setMarkdownManifest] = useState({ files: [] });
  const [markdownManifestError, setMarkdownManifestError] = useState('');
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewMarkdown, setReviewMarkdown] = useState({});
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [reviewVisibleCount, setReviewVisibleCount] = useState(24);
  const [snipOpen, setSnipOpen] = useState(false);
  const [snipLabel, setSnipLabel] = useState('');
  const [snipSelection, setSnipSelection] = useState(null);
  const [snipStart, setSnipStart] = useState(null);
  const [snipMarkdownText, setSnipMarkdownText] = useState('');
  const [snipMarkdownCursor, setSnipMarkdownCursor] = useState(0);
  const [snipMarkdownLoading, setSnipMarkdownLoading] = useState(false);
  const [snipSaving, setSnipSaving] = useState(false);
  const [snipMarkdownSaving, setSnipMarkdownSaving] = useState(false);
  const [snipStatus, setSnipStatus] = useState('');

  useEffect(() => {
    let ignore = false;

    async function loadManifest() {
      try {
        const response = await fetch(manifestUrl);

        if (!response.ok) {
          throw new Error(`Manifest request failed with ${response.status}`);
        }

        const data = await response.json();

        if (!ignore) {
          setManifest(data);
        }
      } catch (loadError) {
        if (!ignore) {
          setError(loadError.message);
        }
      }
    }

    loadManifest();

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    let ignore = false;

    async function loadMarkdownManifest() {
      try {
        const response = await fetch(markdownManifestUrl);

        if (!response.ok) {
          throw new Error(`Markdown manifest request failed with ${response.status}`);
        }

        const data = await response.json();

        if (!ignore) {
          setMarkdownManifest(data);
          setMarkdownManifestError('');
        }
      } catch (loadError) {
        if (!ignore) {
          setMarkdownManifest({ files: [] });
          setMarkdownManifestError(loadError.message);
        }
      }
    }

    loadMarkdownManifest();

    return () => {
      ignore = true;
    };
  }, []);

  const documents = useMemo(() => groupPages(manifest?.pages), [manifest]);

  const filteredDocuments = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return documents;
    }

    return documents.filter((document) =>
      `${document.title} ${document.category} ${document.id}`
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [documents, query]);

  const documentTree = useMemo(
    () => buildDocumentTree(filteredDocuments),
    [filteredDocuments],
  );

  useEffect(() => {
    if (!documents.length) {
      return;
    }

    if (!documents.some((document) => document.id === selectedId)) {
      setSelectedId(documents[0].id);
      setPageIndex(0);
    }
  }, [documents, selectedId]);

  useEffect(() => {
    if (!query.trim() || !filteredDocuments.length) {
      return;
    }

    if (!filteredDocuments.some((document) => document.id === selectedId)) {
      setSelectedId(filteredDocuments[0].id);
      setPageIndex(0);
    }
  }, [filteredDocuments, query, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }

    setExpandedFolders((currentFolders) => {
      const nextFolders = new Set(currentFolders);
      folderAncestors(selectedId).forEach((folderId) => nextFolders.add(folderId));

      return nextFolders;
    });
  }, [selectedId]);

  const selectedDocument = useMemo(
    () => documents.find((document) => document.id === selectedId),
    [documents, selectedId],
  );

  const markdownReviewEntries = useMemo(() => {
    const pageLookup = new Map();

    documents.forEach((document) => {
      document.pages.forEach((page, index) => {
        pageLookup.set(page.image, {
          document,
          page,
          pageIndex: index,
        });
      });
    });

    return (markdownManifest.files ?? [])
      .map((entry) => {
        const match = pageLookup.get(entry.image);

        if (!match) {
          return null;
        }

        return {
          ...entry,
          ...match,
        };
      })
      .filter(Boolean)
      .sort((a, b) => collator.compare(a.image, b.image));
  }, [documents, markdownManifest]);

  const visibleReviewEntries = useMemo(
    () => markdownReviewEntries.slice(0, reviewVisibleCount),
    [markdownReviewEntries, reviewVisibleCount],
  );

  const currentPage = selectedDocument?.pages[pageIndex];
  const currentMarkdownPath = currentPage
    ? markdownPathForImage(currentPage.image)
    : '';
  const totalPages = selectedDocument?.pages.length ?? 0;
  const snipEmbeds = useMemo(
    () => extractSnipEmbeds(snipMarkdownText),
    [snipMarkdownText],
  );

  useEffect(() => {
    let ignore = false;

    async function loadMarkdown() {
      if (!markdownOpen || !currentMarkdownPath) {
        return;
      }

      setMarkdownLoading(true);
      setMarkdownError('');
      setMarkdownText('');

      try {
        const response = await fetch(publicUrl(currentMarkdownPath));
        const contentType = response.headers.get('content-type') ?? '';
        const text = await response.text();

        if (
          !response.ok ||
          contentType.includes('text/html') ||
          text.trimStart().toLowerCase().startsWith('<!doctype html')
        ) {
          throw new Error('No markdown file was found for this image page.');
        }

        if (!ignore) {
          setMarkdownText(text);
        }
      } catch (loadError) {
        if (!ignore) {
          setMarkdownError(loadError.message);
        }
      } finally {
        if (!ignore) {
          setMarkdownLoading(false);
        }
      }
    }

    loadMarkdown();

    return () => {
      ignore = true;
    };
  }, [currentMarkdownPath, markdownOpen]);

  useEffect(() => {
    let ignore = false;

    async function loadSnipMarkdown() {
      if (!snipOpen || !currentMarkdownPath) {
        return;
      }

      setSnipMarkdownLoading(true);
      setSnipStatus('');

      try {
        const response = await fetch(cacheBust(publicUrl(currentMarkdownPath)));
        const contentType = response.headers.get('content-type') ?? '';
        const text = await response.text();

        if (
          !response.ok ||
          contentType.includes('text/html') ||
          text.trimStart().toLowerCase().startsWith('<!doctype html')
        ) {
          throw new Error('No markdown file exists yet.');
        }

        if (!ignore) {
          setSnipMarkdownText(text);
          setSnipMarkdownCursor(text.length);
        }
      } catch {
        if (!ignore) {
          setSnipMarkdownText('');
          setSnipMarkdownCursor(0);
        }
      } finally {
        if (!ignore) {
          setSnipMarkdownLoading(false);
        }
      }
    }

    loadSnipMarkdown();

    return () => {
      ignore = true;
    };
  }, [currentMarkdownPath, snipOpen]);

  useEffect(() => {
    let ignore = false;

    async function loadReviewMarkdown() {
      if (!reviewMode || !visibleReviewEntries.length) {
        return;
      }

      const missingEntries = visibleReviewEntries.filter(
        (entry) => !reviewMarkdown[entry.markdown],
      );

      if (!missingEntries.length) {
        return;
      }

      setReviewLoading(true);
      setReviewError('');

      try {
        const loadedEntries = await Promise.all(
          missingEntries.map(async (entry) => {
            const response = await fetch(publicUrl(entry.markdown));
            const contentType = response.headers.get('content-type') ?? '';
            const text = await response.text();

            if (
              !response.ok ||
              contentType.includes('text/html') ||
              text.trimStart().toLowerCase().startsWith('<!doctype html')
            ) {
              throw new Error(`Markdown failed to load: ${entry.markdown}`);
            }

            return [entry.markdown, text];
          }),
        );

        if (!ignore) {
          setReviewMarkdown((currentMarkdown) => ({
            ...currentMarkdown,
            ...Object.fromEntries(loadedEntries),
          }));
        }
      } catch (loadError) {
        if (!ignore) {
          setReviewError(loadError.message);
        }
      } finally {
        if (!ignore) {
          setReviewLoading(false);
        }
      }
    }

    loadReviewMarkdown();

    return () => {
      ignore = true;
    };
  }, [reviewMarkdown, reviewMode, visibleReviewEntries]);

  const goToPage = useCallback(
    (nextIndex) => {
      if (!selectedDocument) {
        return;
      }

      const boundedIndex =
        ((nextIndex % selectedDocument.pages.length) +
          selectedDocument.pages.length) %
        selectedDocument.pages.length;

      setPageIndex(boundedIndex);
    },
    [selectedDocument],
  );

  const goPrevious = useCallback(() => {
    goToPage(pageIndex - 1);
  }, [goToPage, pageIndex]);

  const goNext = useCallback(() => {
    goToPage(pageIndex + 1);
  }, [goToPage, pageIndex]);

  useEffect(() => {
    function handleKeyDown(event) {
      const tagName = event.target?.tagName;

      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
        return;
      }

      if (event.key === 'ArrowLeft') {
        goPrevious();
      }

      if (event.key === 'ArrowRight') {
        goNext();
      }
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [goNext, goPrevious]);

  function selectDocument(documentId) {
    setSelectedId(documentId);
    setPageIndex(0);
    setReviewMode(false);
  }

  function openReviewPage(entry) {
    setSelectedId(entry.document.id);
    setPageIndex(entry.pageIndex);
    setMarkdownOpen(true);
    setReviewMode(false);
  }

  function openSnipTool() {
    if (!currentPage || !selectedDocument) {
      return;
    }

    setSnipLabel(`${selectedDocument.title} page ${currentPage.page}`);
    setSnipSelection(null);
    setSnipStart(null);
    setSnipStatus('');
    setSnipOpen(true);
  }

  function snipPointerPosition(event) {
    const bounds = event.currentTarget.getBoundingClientRect();

    return {
      x: clamp(event.clientX - bounds.left, 0, bounds.width),
      y: clamp(event.clientY - bounds.top, 0, bounds.height),
    };
  }

  function handleSnipPointerDown(event) {
    const start = snipPointerPosition(event);

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSnipStart(start);
    setSnipSelection({ ...start, width: 0, height: 0 });
  }

  function handleSnipPointerMove(event) {
    if (!snipStart) {
      return;
    }

    setSnipSelection(normalizeSelection(snipStart, snipPointerPosition(event)));
  }

  function handleSnipPointerUp(event) {
    if (!snipStart) {
      return;
    }

    const selection = normalizeSelection(snipStart, snipPointerPosition(event));

    setSnipStart(null);
    setSnipSelection(selection.width < 8 || selection.height < 8 ? null : selection);
  }

  async function refreshMarkdownManifest() {
    try {
      const response = await fetch(cacheBust(markdownManifestUrl));

      if (response.ok) {
        setMarkdownManifest(await response.json());
      }
    } catch {
      // The saved snip is still valid if the review manifest refresh fails.
    }
  }

  function updateSnipMarkdownCursor() {
    const editor = snipMarkdownRef.current;

    if (editor) {
      setSnipMarkdownCursor(editor.selectionStart ?? 0);
    }
  }

  function setSnipEditorCursor(position) {
    requestAnimationFrame(() => {
      const editor = snipMarkdownRef.current;

      if (!editor) {
        return;
      }

      const nextPosition = clamp(position, 0, editor.value.length);
      editor.focus();
      editor.setSelectionRange(nextPosition, nextPosition);
      setSnipMarkdownCursor(nextPosition);
    });
  }

  function syncMarkdownState(nextMarkdownText) {
    setSnipMarkdownText(nextMarkdownText);
    setMarkdownText(nextMarkdownText);
    setMarkdownError('');
    setReviewMarkdown((currentMarkdown) => ({
      ...currentMarkdown,
      [currentMarkdownPath]: nextMarkdownText,
    }));
  }

  async function saveMarkdownSource(nextMarkdownText = snipMarkdownText, status = 'Markdown saved.') {
    if (!currentMarkdownPath) {
      return;
    }

    setSnipMarkdownSaving(true);
    setSnipStatus('Saving markdown...');

    try {
      const response = await fetch('/api/markdown', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          markdownPath: currentMarkdownPath,
          markdownText: nextMarkdownText,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? 'Markdown save failed.');
      }

      syncMarkdownState(data.markdownText);
      setSnipStatus(status);
      await refreshMarkdownManifest();
    } catch (saveError) {
      setSnipStatus(saveError.message);
    } finally {
      setSnipMarkdownSaving(false);
    }
  }

  async function removeSnipEmbed(embed) {
    const nextMarkdownText = removeMarkdownBlock(
      snipMarkdownText,
      embed.start,
      embed.end,
    );

    setSnipMarkdownText(nextMarkdownText);
    setSnipEditorCursor(Math.min(embed.start, nextMarkdownText.length));
    await saveMarkdownSource(nextMarkdownText, 'Snip removed from markdown.');
  }

  async function moveSnipEmbedToCursor(embed) {
    const withoutEmbed = removeMarkdownBlock(snipMarkdownText, embed.start, embed.end);
    const adjustedCursor =
      embed.start < snipMarkdownCursor
        ? Math.max(0, snipMarkdownCursor - (embed.end - embed.start))
        : snipMarkdownCursor;
    const nextMarkdownText = insertMarkdownBlock(
      withoutEmbed,
      embed.text,
      adjustedCursor,
    );
    const nextPosition = nextMarkdownText.indexOf(embed.text) + embed.text.length + 2;

    setSnipMarkdownText(nextMarkdownText);
    setSnipEditorCursor(nextPosition);
    await saveMarkdownSource(nextMarkdownText, 'Snip moved in markdown.');
  }

  async function saveSnip() {
    const image = snipImageRef.current;

    if (!image || !currentPage || !snipSelection) {
      setSnipStatus('Draw a region before saving.');
      return;
    }

    const imageBounds = image.getBoundingClientRect();
    const scaleX = image.naturalWidth / imageBounds.width;
    const scaleY = image.naturalHeight / imageBounds.height;
    const sourceX = Math.round(snipSelection.x * scaleX);
    const sourceY = Math.round(snipSelection.y * scaleY);
    const sourceWidth = Math.round(snipSelection.width * scaleX);
    const sourceHeight = Math.round(snipSelection.height * scaleY);

    if (sourceWidth < 4 || sourceHeight < 4) {
      setSnipStatus('The selected region is too small.');
      return;
    }

    setSnipSaving(true);
    setSnipStatus('Saving snip...');

    try {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');

      canvas.width = sourceWidth;
      canvas.height = sourceHeight;
      context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        sourceWidth,
        sourceHeight,
      );

      const response = await fetch('/api/snips', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          dataUrl: canvas.toDataURL('image/png'),
          imagePath: currentPage.image,
          insertAt: snipMarkdownCursor,
          label: snipLabel.trim() || `${selectedDocument?.title ?? 'Page'} snip`,
          markdownPath: currentMarkdownPath,
          markdownText: snipMarkdownText,
          rect: {
            x: sourceX,
            y: sourceY,
            width: sourceWidth,
            height: sourceHeight,
            page: currentPage.page,
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight,
          },
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? 'Snip save failed.');
      }

      syncMarkdownState(data.markdownText);
      setMarkdownOpen(true);
      setSnipSelection(null);
      setSnipStatus('Snip saved.');
      if (data.markdownEmbed) {
        const embedStart = data.markdownText.indexOf(data.markdownEmbed);
        setSnipEditorCursor(embedStart + data.markdownEmbed.length + 2);
      }
      await refreshMarkdownManifest();
    } catch (saveError) {
      setSnipStatus(saveError.message);
    } finally {
      setSnipSaving(false);
    }
  }

  function toggleFolder(folderId) {
    setExpandedFolders((currentFolders) => {
      const nextFolders = new Set(currentFolders);

      if (nextFolders.has(folderId)) {
        nextFolders.delete(folderId);
      } else {
        nextFolders.add(folderId);
      }

      return nextFolders;
    });
  }

  function openFolder(folder) {
    toggleFolder(folder.id);

    const firstDocument = firstDocumentInNode(folder);

    if (firstDocument && firstDocument.id !== selectedId) {
      selectDocument(firstDocument.id);
    }
  }

  function renderTreeNode(node, depth = 0) {
    const isSearching = query.trim().length > 0;

    if (node.type === 'folder') {
      const isOpen = isSearching || expandedFolders.has(node.id);

      return (
        <div className="tree-node" key={node.id}>
          <button
            aria-expanded={isOpen}
            className="folder-button"
            onClick={() => openFolder(node)}
            style={{ paddingLeft: 10 + depth * 16 }}
            type="button"
          >
            <span className="folder-chevron" aria-hidden="true">
              {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </span>
            <span className="folder-icon" aria-hidden="true">
              {isOpen ? <FolderOpen size={18} /> : <Folder size={18} />}
            </span>
            <span className="folder-copy">
              <span className="folder-title">{node.title}</span>
              <span className="folder-meta">
                {node.documentCount} papers - {node.pageCount} pages
              </span>
            </span>
          </button>

          {isOpen && (
            <div className="tree-children">
              {node.children.map((child) => renderTreeNode(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    return (
      <button
        className={`document-button ${node.id === selectedId ? 'active' : ''}`}
        key={node.id}
        onClick={() => selectDocument(node.id)}
        style={{ paddingLeft: 14 + depth * 16 }}
        type="button"
      >
        <span className="document-icon" aria-hidden="true">
          <FileText size={18} />
        </span>
        <span className="document-copy">
          <span className="document-title">{node.title}</span>
          <span className="document-meta">{node.pages.length} pages</span>
        </span>
      </button>
    );
  }

  function renderMarkdownReview() {
    return (
      <>
        <header className="viewer-header review-header">
          <div className="viewer-title">
            <p className="section-label">Markdown Review</p>
            <h2>Visual Snapshots Against Markdown</h2>
          </div>

          <div className="viewer-controls" aria-label="Review controls">
            <div className="page-counter">
              {visibleReviewEntries.length} / {markdownReviewEntries.length}
            </div>
            <button
              className="control-button primary"
              onClick={() => setReviewMode(false)}
              type="button"
            >
              <span>Carousel</span>
              <ChevronRight size={19} />
            </button>
          </div>
        </header>

        <div className="review-stage">
          {markdownManifestError && (
            <div className="markdown-status warning">
              <strong>Markdown manifest unavailable</strong>
              <span>{markdownManifestError}</span>
            </div>
          )}

          {!markdownManifestError && !markdownReviewEntries.length && (
            <div className="markdown-status">
              <strong>No visual markdown snapshots found</strong>
              <span>
                Add markdown files containing diagram, photo, picture, image, or
                similar visual cues.
              </span>
            </div>
          )}

          {reviewError && (
            <div className="markdown-status warning">
              <strong>Review load failed</strong>
              <span>{reviewError}</span>
            </div>
          )}

          {reviewLoading && (
            <div className="markdown-status">Loading markdown snapshots...</div>
          )}

          <div className="review-list">
            {visibleReviewEntries.map((entry) => (
              <article className="review-pair" key={entry.markdown}>
                <header className="review-pair-header">
                  <div>
                    <p className="section-label">{entry.document.category}</p>
                    <h3>
                      {entry.document.title} - Page {entry.page.page}
                    </h3>
                    {entry.visualCue && (
                      <p className="visual-cue">Matched: {entry.visualCue}</p>
                    )}
                  </div>
                  <button
                    className="control-button"
                    onClick={() => openReviewPage(entry)}
                    type="button"
                  >
                    <FileText size={18} />
                    <span>Open Page</span>
                  </button>
                </header>

                <div className="review-pair-body">
                  <div className="review-snapshot">
                    <img
                      alt={`${entry.document.title} page ${entry.page.page}`}
                      crossOrigin={imageCrossOrigin}
                      loading="lazy"
                      src={assetUrl(entry.image)}
                    />
                  </div>

                  <div className="review-markdown markdown-panel-body">
                    {reviewMarkdown[entry.markdown] ? (
                      <MarkdownContent>{reviewMarkdown[entry.markdown]}</MarkdownContent>
                    ) : (
                      <div className="markdown-status">Loading markdown...</div>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>

          {visibleReviewEntries.length < markdownReviewEntries.length && (
            <div className="load-more-row">
              <button
                className="control-button primary"
                onClick={() =>
                  setReviewVisibleCount((currentCount) =>
                    Math.min(currentCount + 24, markdownReviewEntries.length),
                  )
                }
                type="button"
              >
                <span>Load More</span>
                <ChevronDown size={19} />
              </button>
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <main className="app-shell">
      <aside className="library-panel" aria-label="Image documents">
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true">
            <BookOpen size={22} strokeWidth={2.2} />
          </div>
          <div>
            <h1>PSLE English Tutor</h1>
            <p>{manifest?.converted_pages ?? 0} converted pages</p>
          </div>
        </div>

        <label className="search-field">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search papers"
          />
        </label>

        <div className="sidebar-actions">
          <button
            className={`mode-button ${reviewMode ? 'active' : ''}`}
            onClick={() => setReviewMode((currentValue) => !currentValue)}
            type="button"
          >
            <FileText size={18} />
            <span>
              <span className="mode-title">Visual markdown</span>
              <span className="mode-meta">
                {markdownReviewEntries.length} visual pages
              </span>
            </span>
          </button>
        </div>

        <div className="document-list">
          {documentTree.map((node) => renderTreeNode(node))}

          {!error && !filteredDocuments.length && (
            <div className="empty-state">No matching papers</div>
          )}
        </div>
      </aside>

      <section
        className={`viewer-shell ${reviewMode ? 'review-shell' : ''}`}
        aria-label={reviewMode ? 'Markdown snapshot review' : 'Image carousel'}
      >
        {reviewMode ? renderMarkdownReview() : (
          <>
            <header className="viewer-header">
          <div className="viewer-title">
            <p className="section-label">{selectedDocument?.category ?? 'Library'}</p>
            <h2>{selectedDocument?.title ?? 'Loading images'}</h2>
          </div>

          <div className="viewer-controls" aria-label="Carousel controls">
            <button
              className="control-button"
              disabled={!totalPages}
              onClick={goPrevious}
              type="button"
            >
              <ChevronLeft size={19} />
              <span>Previous</span>
            </button>
            <div className="page-counter">
              {totalPages ? pageIndex + 1 : 0} / {totalPages}
            </div>
            <button
              aria-pressed={!fitToScreen}
              className={`control-button fit-toggle ${!fitToScreen ? 'active' : ''}`}
              disabled={!totalPages}
              onClick={() => setFitToScreen((currentValue) => !currentValue)}
              type="button"
            >
              {fitToScreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
              <span>{fitToScreen ? 'Fit' : 'Actual'}</span>
            </button>
            <button
              className="control-button markdown-toggle"
              disabled={!totalPages}
              onClick={() => setMarkdownOpen((currentValue) => !currentValue)}
              type="button"
            >
              <FileText size={18} />
              <span>Markdown</span>
            </button>
            <button
              className="control-button"
              disabled={!totalPages}
              onClick={openSnipTool}
              type="button"
            >
              <Scissors size={18} />
              <span>Snip</span>
            </button>
            <button
              className="control-button primary"
              disabled={!totalPages}
              onClick={goNext}
              type="button"
            >
              <span>Next</span>
              <ChevronRight size={19} />
            </button>
          </div>
        </header>

        <div className={`viewer-stage ${fitToScreen ? 'fit-mode' : 'actual-mode'}`}>
          {error ? (
            <div className="error-panel">
              <strong>Manifest failed to load</strong>
              <span>{error}</span>
            </div>
          ) : (
            <>
              <button
                aria-label="Previous image"
                className="nav-button previous"
                onClick={goPrevious}
                title="Previous image"
                type="button"
              >
                <ChevronLeft size={30} />
                <span>Prev</span>
              </button>

              <div className="carousel-frame">
                <button
                  className="image-markdown-button"
                  disabled={!currentPage}
                  onClick={() => setMarkdownOpen(true)}
                  type="button"
                >
                  <FileText size={17} />
                  <span>Markdown</span>
                </button>
                <button
                  className="image-snip-button"
                  disabled={!currentPage}
                  onClick={openSnipTool}
                  type="button"
                >
                  <Scissors size={17} />
                  <span>Snip</span>
                </button>

                <div className="carousel-viewport">
                  <div
                    className="carousel-track"
                    style={{ transform: `translateX(-${pageIndex * 100}%)` }}
                  >
                    {selectedDocument?.pages.map((page, index) => (
                      <div className="carousel-slide" key={page.image}>
                        <img
                          alt={`${selectedDocument.title} page ${page.page}`}
                          crossOrigin={imageCrossOrigin}
                          decoding="async"
                          loading={Math.abs(index - pageIndex) <= 1 ? 'eager' : 'lazy'}
                          src={assetUrl(page.image)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <button
                aria-label="Next image"
                className="nav-button next"
                onClick={goNext}
                title="Next image"
                type="button"
              >
                <span>Next</span>
                <ChevronRight size={30} />
              </button>

              {markdownOpen && (
                <aside className="markdown-panel" aria-label="Rendered markdown">
                  <header className="markdown-panel-header">
                    <div>
                      <p className="section-label">Markdown</p>
                      <h3>
                        Page {currentPage?.page ?? pageIndex + 1}
                      </h3>
                    </div>
                    <button
                      aria-label="Close markdown"
                      className="icon-button"
                      onClick={() => setMarkdownOpen(false)}
                      title="Close markdown"
                      type="button"
                    >
                      <X size={20} />
                    </button>
                  </header>

                  <div className="markdown-panel-body">
                    {markdownLoading && (
                      <div className="markdown-status">Loading markdown...</div>
                    )}

                    {!markdownLoading && markdownError && (
                      <div className="markdown-status warning">
                        <strong>Markdown unavailable</strong>
                        <span>{markdownError}</span>
                        <small>{currentMarkdownPath}</small>
                      </div>
                    )}

                    {!markdownLoading && !markdownError && markdownText && (
                      <MarkdownContent>{markdownText}</MarkdownContent>
                    )}
                  </div>
                </aside>
              )}
            </>
          )}
        </div>

        <footer className="thumbnail-rail" aria-label="Page thumbnails">
          {selectedDocument?.pages.map((page, index) => (
            <button
              aria-label={`Page ${page.page}`}
              className={`thumbnail-button ${index === pageIndex ? 'active' : ''}`}
              key={page.image}
              onClick={() => goToPage(index)}
              type="button"
            >
              <img
                alt=""
                crossOrigin={imageCrossOrigin}
                loading="lazy"
                src={assetUrl(page.image)}
              />
              <span>{page.page}</span>
            </button>
          ))}
        </footer>
          </>
        )}
      </section>

      {snipOpen && currentPage && selectedDocument && (
        <div className="snip-modal" role="dialog" aria-modal="true">
          <div className="snip-dialog">
            <header className="snip-header">
              <div>
                <p className="section-label">Region Snip</p>
                <h2>
                  {selectedDocument.title} - Page {currentPage.page}
                </h2>
              </div>
              <button
                aria-label="Close snip tool"
                className="icon-button"
                onClick={() => setSnipOpen(false)}
                title="Close snip tool"
                type="button"
              >
                <X size={20} />
              </button>
            </header>

            <div className="snip-toolbar">
              <label className="snip-label-field">
                <span>Label</span>
                <input
                  value={snipLabel}
                  onChange={(event) => setSnipLabel(event.target.value)}
                  placeholder="Describe this visual"
                />
              </label>
              <button
                className="control-button"
                onClick={() => {
                  setSnipSelection(null);
                  setSnipStatus('');
                }}
                type="button"
              >
                Clear
              </button>
              <button
                className="control-button primary"
                disabled={snipSaving || !snipSelection}
                onClick={saveSnip}
                type="button"
              >
                <Scissors size={18} />
                <span>{snipSaving ? 'Saving' : 'Insert Snip'}</span>
              </button>
              <button
                className="control-button"
                disabled={snipMarkdownSaving}
                onClick={() => saveMarkdownSource()}
                type="button"
              >
                <Save size={18} />
                <span>{snipMarkdownSaving ? 'Saving' : 'Save Markdown'}</span>
              </button>
            </div>

            <div className="snip-body">
              <div className="snip-image-panel">
                <div
                  className="snip-image-shell"
                  onPointerDown={handleSnipPointerDown}
                  onPointerMove={handleSnipPointerMove}
                  onPointerUp={handleSnipPointerUp}
                >
                  <img
                    ref={snipImageRef}
                    alt={`${selectedDocument.title} page ${currentPage.page}`}
                    crossOrigin={imageCrossOrigin}
                    src={assetUrl(currentPage.image)}
                  />
                  {snipSelection && (
                    <div
                      className="snip-selection"
                      style={{
                        left: snipSelection.x,
                        top: snipSelection.y,
                        width: snipSelection.width,
                        height: snipSelection.height,
                      }}
                    />
                  )}
                </div>
              </div>

              <aside className="snip-markdown-panel">
                <header className="snip-markdown-header">
                  <div>
                    <p className="section-label">Markdown Source</p>
                    <h3>{snipEmbeds.length} snips</h3>
                  </div>
                  <button
                    className="control-button"
                    disabled={snipMarkdownSaving}
                    onClick={() => saveMarkdownSource()}
                    type="button"
                  >
                    <Save size={18} />
                    <span>Save</span>
                  </button>
                </header>

                {snipEmbeds.length > 0 && (
                  <div className="snip-embed-list" aria-label="Snips in markdown">
                    {snipEmbeds.map((embed, index) => (
                      <div className="snip-embed-item" key={`${embed.path}-${embed.start}`}>
                        <span>{embed.alt || `Snip ${index + 1}`}</span>
                        <button
                          className="small-button"
                          onClick={() => moveSnipEmbedToCursor(embed)}
                          type="button"
                        >
                          Move to Cursor
                        </button>
                        <button
                          className="small-button danger"
                          onClick={() => removeSnipEmbed(embed)}
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {snipMarkdownLoading ? (
                  <div className="markdown-status">Loading markdown...</div>
                ) : (
                  <textarea
                    ref={snipMarkdownRef}
                    className="snip-markdown-editor"
                    value={snipMarkdownText}
                    onChange={(event) => {
                      setSnipMarkdownText(event.target.value);
                      setSnipMarkdownCursor(event.target.selectionStart ?? 0);
                    }}
                    onClick={updateSnipMarkdownCursor}
                    onKeyUp={updateSnipMarkdownCursor}
                    onSelect={updateSnipMarkdownCursor}
                    spellCheck="false"
                  />
                )}
              </aside>
            </div>

            <footer className="snip-footer">
              <span>Cursor {snipMarkdownCursor}</span>
              {snipStatus && <strong>{snipStatus}</strong>}
            </footer>
          </div>
        </div>
      )}
    </main>
  );
}
