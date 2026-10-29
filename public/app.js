'use strict';

const API_BASE = '/api';
const MAX_MESSAGE_CHARS = 4000;
const MAX_HISTORY_TURNS = 12;
const MAX_HISTORY_CHARS = 48000;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_FILE_CHARS = 24000;
const REQUEST_TIMEOUT_MS = 90000;
const THEME_KEY = 'dh-theme';
const HISTORY_KEY = 'dh-history-v1';
const MAX_SAVED_CHATS = 20;
const MAX_SAVED_MESSAGES = 60;
const MAX_SAVED_CHARS = 2000000;

const chat = document.getElementById('chat');
const messages = document.getElementById('messages');
const chatForm = document.getElementById('chat-form');
const textInput = document.getElementById('textInput');
const sendButton = document.getElementById('sendButton');
const attachButton = document.getElementById('attachButton');
const fileInput = document.getElementById('fileInput');
const fileChip = document.getElementById('fileChip');
const fileName = document.getElementById('fileName');
const fileSize = document.getElementById('fileSize');
const removeFileButton = document.getElementById('removeFileButton');
const loader = document.getElementById('loader');
const errorDiv = document.getElementById('error');
const emptyState = document.getElementById('emptyState');
const promptChips = document.getElementById('promptChips');
const footerText = document.getElementById('footer-text');
const themeToggle = document.getElementById('themeToggle');
const newChatButton = document.getElementById('newChatButton');
const historyButton = document.getElementById('historyButton');
const historyPanel = document.getElementById('historyPanel');
const historyList = document.getElementById('historyList');
const historyEmpty = document.getElementById('historyEmpty');
const historyCount = document.getElementById('historyCount');
const clearHistoryButton = document.getElementById('clearHistoryButton');

let chatHistory = [];
let selectedFile = null;
let busy = false;
let typingIndicator = null;
let savedChats = [];
let currentChat = null;
let clearArmed = false;
let clearTimer = null;
let storageWarningShown = false;

function setError(message) {
    errorDiv.textContent = message || '';
}

async function readJson(response) {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return null;
    try {
        return await response.json();
    } catch {
        return null;
    }
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function applyTheme(theme) {
    const next = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    themeToggle.setAttribute(
        'aria-label',
        next === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
    );
    themeToggle.setAttribute('aria-pressed', String(next === 'light'));

    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) {
        themeColor.setAttribute('content', next === 'dark' ? '#0d1210' : '#f4f0e7');
    }
}

function initTheme() {
    let saved = null;
    try {
        saved = localStorage.getItem(THEME_KEY);
    } catch {
        saved = null;
    }
    applyTheme(saved === 'light' ? 'light' : 'dark');
}

function showFileChip(file) {
    fileName.textContent = file.name;
    fileSize.textContent = formatBytes(file.size);
    fileChip.hidden = false;
}

function clearFile() {
    selectedFile = null;
    fileInput.value = '';
    fileChip.hidden = true;
    fileName.textContent = '';
    fileSize.textContent = '';
}

function scrollMessagesToBottom() {
    messages.scrollTop = messages.scrollHeight;
}

function isNearBottom() {
    return messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
}

const INLINE_TOKEN = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`)/g;
const CODE_LANGUAGES = new Set([
    'bash',
    'c',
    'cpp',
    'csharp',
    'css',
    'diff',
    'go',
    'html',
    'http',
    'java',
    'javascript',
    'js',
    'json',
    'jsx',
    'markdown',
    'md',
    'php',
    'plaintext',
    'powershell',
    'ps1',
    'python',
    'py',
    'ruby',
    'rust',
    'sh',
    'shell',
    'sql',
    'text',
    'ts',
    'tsx',
    'txt',
    'typescript',
    'xml',
    'yaml',
    'yml',
]);

function appendInlineText(parent, text) {
    const normalized = text.replace(/^([ \t]*)[*-][ \t]+/gm, '$1• ');
    let lastIndex = 0;
    for (const match of normalized.matchAll(INLINE_TOKEN)) {
        if (match.index > lastIndex) {
            parent.appendChild(document.createTextNode(normalized.slice(lastIndex, match.index)));
        }

        const token = match[0];
        const isCode = token.startsWith('`');
        const element = document.createElement(isCode ? 'code' : 'strong');
        element.textContent = isCode ? token.slice(1, -1) : token.slice(2, -2);
        parent.appendChild(element);
        lastIndex = match.index + token.length;
    }

    if (lastIndex < normalized.length) {
        parent.appendChild(document.createTextNode(normalized.slice(lastIndex)));
    }
}

function appendFormattedText(parent, text) {
    const segments = text.split(/```/);
    segments.forEach((segment, index) => {
        if (index % 2 === 1) {
            const lines = segment.replace(/^\n/, '').split('\n');
            const firstLine = lines[0].trim();
            const hasLanguage = CODE_LANGUAGES.has(firstLine.toLowerCase());
            const code = (hasLanguage ? lines.slice(1) : lines).join('\n').replace(/\n$/, '');
            const pre = document.createElement('pre');
            const codeElement = document.createElement('code');
            codeElement.textContent = code;
            pre.appendChild(codeElement);
            parent.appendChild(pre);
        } else {
            appendInlineText(parent, segment);
        }
    });
}

function addMessage(role, content) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', role);

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    const label = document.createElement('span');
    label.className = 'sr-only';
    label.textContent = role === 'user' ? 'You: ' : 'Assistant: ';

    bubble.appendChild(label);
    appendFormattedText(bubble, content);
    messageDiv.appendChild(bubble);

    if (typingIndicator && typingIndicator.isConnected) {
        messages.insertBefore(messageDiv, typingIndicator);
    } else {
        messages.appendChild(messageDiv);
    }

    if (emptyState && emptyState.isConnected) emptyState.remove();
    scrollMessagesToBottom();
}

function showTyping() {
    if (typingIndicator) return;

    typingIndicator = document.createElement('div');
    typingIndicator.className = 'message assistant typing';
    typingIndicator.setAttribute('aria-hidden', 'true');

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble typing-bubble';

    const dots = document.createElement('span');
    dots.className = 'typing-dots';
    for (let index = 0; index < 3; index += 1) {
        dots.appendChild(document.createElement('span'));
    }

    bubble.appendChild(dots);
    typingIndicator.appendChild(bubble);
    messages.appendChild(typingIndicator);
    scrollMessagesToBottom();
}

function hideTyping() {
    if (!typingIndicator) return;
    typingIndicator.remove();
    typingIndicator = null;
}

function setBusy(value) {
    busy = value;
    loader.hidden = !value;
    if (value) {
        showTyping();
    } else {
        hideTyping();
    }

    sendButton.disabled = value;
    attachButton.disabled = value;
    removeFileButton.disabled = value;
    textInput.disabled = value;
    newChatButton.disabled = value;
    historyButton.disabled = value;
    clearHistoryButton.disabled = value || savedChats.length === 0;
    chat.setAttribute('aria-busy', String(value));
    messages.setAttribute('aria-busy', String(value));
}

function extractRequestId(data) {
    const requestId = data && data.error && data.error.requestId;
    return typeof requestId === 'string' && requestId.length <= 64 ? requestId : '';
}

function trimHistory(turns) {
    const trimmed = turns.slice(-MAX_HISTORY_TURNS);
    let totalChars = trimmed.reduce((total, turn) => total + turn.text.length, 0);
    while (trimmed.length > 0 && totalChars > MAX_HISTORY_CHARS) {
        totalChars -= trimmed.shift().text.length;
    }
    return trimmed;
}

async function readFileText(file) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let decoder = new TextDecoder('utf-8');

    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
        decoder = new TextDecoder('utf-16le');
    } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
        decoder = new TextDecoder('utf-16be');
    }

    return decoder.decode(buffer).replace(/^\uFEFF/, '');
}

function buildHistoryText(text, file, fileText) {
    const longestFence = Math.max(
        3,
        ...(fileText.match(/`{3,}/g) || []).map((run) => run.length + 1),
    );
    const fence = '`'.repeat(longestFence);
    return `${text || 'Look at the attached file.'}\n\nAttached file: ${file.name}\n\n${fence}\n${fileText}\n${fence}`;
}

function createChat() {
    const id =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const now = Date.now();
    return { id, title: '', createdAt: now, updatedAt: now, messages: [] };
}

function makeChatTitle(text, fileName) {
    const fallback = fileName ? `File: ${fileName}` : 'Health chat';
    const clean = String(text || fallback).replace(/\s+/g, ' ').trim() || fallback;
    return clean.length > 54 ? `${clean.slice(0, 51)}…` : clean;
}

function formatChatDate(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';

    const now = new Date();
    if (date.toDateString() === now.toDateString()) return 'Today';

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function normalizeChat(value) {
    if (!value || typeof value !== 'object') return null;
    if (typeof value.id !== 'string' || value.id.length === 0 || value.id.length > 80) {
        return null;
    }

    const messages = Array.isArray(value.messages)
        ? value.messages
              .filter(
                  (message) =>
                      message &&
                      (message.role === 'user' || message.role === 'assistant') &&
                      typeof message.text === 'string' &&
                      message.text.trim(),
              )
              .slice(-MAX_SAVED_MESSAGES)
              .map((message) => ({
                  role: message.role,
                  text: message.text.slice(0, 12000),
              }))
        : [];

    if (messages.length === 0) return null;

    const createdAt = Number.isFinite(value.createdAt) ? value.createdAt : Date.now();
    const updatedAt = Number.isFinite(value.updatedAt) ? value.updatedAt : createdAt;
    const firstUser = messages.find((message) => message.role === 'user');
    const title =
        typeof value.title === 'string' && value.title.trim()
            ? value.title.trim().slice(0, 80)
            : makeChatTitle(firstUser ? firstUser.text : '', '');

    return { id: value.id, title, createdAt, updatedAt, messages };
}

function loadSavedChats() {
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        if (!raw) return [];

        const data = JSON.parse(raw);
        if (!data || !Array.isArray(data.chats)) return [];

        return data.chats.map(normalizeChat).filter(Boolean).slice(0, MAX_SAVED_CHATS);
    } catch {
        return [];
    }
}

function trimSavedChats() {
    savedChats.sort((a, b) => b.updatedAt - a.updatedAt);
    savedChats = savedChats.slice(0, MAX_SAVED_CHATS);

    for (const chat of savedChats) {
        if (chat.messages.length > MAX_SAVED_MESSAGES) {
            chat.messages = chat.messages.slice(-MAX_SAVED_MESSAGES);
        }
    }

    let totalChars = savedChats.reduce(
        (total, chat) =>
            total + chat.messages.reduce((sum, message) => sum + message.text.length, 0),
        0,
    );

    while (totalChars > MAX_SAVED_CHARS && savedChats.length > 1) {
        const removed = savedChats.pop();
        totalChars -= removed.messages.reduce(
            (sum, message) => sum + message.text.length,
            0,
        );
    }
}

function persistChats() {
    try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify({ version: 1, chats: savedChats }));
        return true;
    } catch {
        return false;
    }
}

function renderHistoryList() {
    if (
        !historyButton ||
        !historyList ||
        !historyEmpty ||
        !historyCount ||
        !clearHistoryButton
    ) {
        return;
    }

    const chats = savedChats.slice().sort((a, b) => b.updatedAt - a.updatedAt);
    historyList.replaceChildren();

    for (const chat of chats) {
        const item = document.createElement('li');
        item.className = 'history-item';
        if (currentChat && chat.id === currentChat.id) item.classList.add('active');

        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'history-open';
        open.dataset.chatId = chat.id;
        open.setAttribute('aria-label', `Open chat: ${chat.title}`);

        const title = document.createElement('span');
        title.className = 'history-item-title';
        title.textContent = chat.title;

        const meta = document.createElement('span');
        meta.className = 'history-item-meta';
        meta.textContent = formatChatDate(chat.updatedAt);

        open.append(title, meta);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'history-delete';
        remove.dataset.deleteId = chat.id;
        remove.setAttribute('aria-label', `Delete chat: ${chat.title}`);
        remove.textContent = '×';

        item.append(open, remove);
        historyList.appendChild(item);
    }

    historyList.hidden = chats.length === 0;
    historyEmpty.hidden = chats.length > 0;
    historyCount.textContent = String(chats.length);
    historyCount.hidden = chats.length === 0;
    clearHistoryButton.disabled = busy || chats.length === 0;
    let historyLabel = 'History';
    if (chats.length === 1) historyLabel = 'History, 1 saved chat';
    else if (chats.length > 1) historyLabel = `History, ${chats.length} saved chats`;
    historyButton.setAttribute('aria-label', historyLabel);
}

function saveCurrentChat() {
    if (!currentChat || currentChat.messages.length === 0) return;

    currentChat.updatedAt = Date.now();
    if (!currentChat.title) {
        const firstUser = currentChat.messages.find((message) => message.role === 'user');
        currentChat.title = makeChatTitle(firstUser ? firstUser.text : '', '');
    }

    const index = savedChats.findIndex((chat) => chat.id === currentChat.id);
    if (index === -1) {
        savedChats.unshift(currentChat);
    } else {
        savedChats[index] = currentChat;
    }

    trimSavedChats();
    if (!persistChats() && !storageWarningShown) {
        storageWarningShown = true;
        setError("I couldn't save this chat in your browser.");
    }
    renderHistoryList();
}

function resetClearHistory() {
    if (clearTimer) {
        clearTimeout(clearTimer);
        clearTimer = null;
    }
    clearArmed = false;
    if (clearHistoryButton) {
        clearHistoryButton.textContent = 'Clear all';
        clearHistoryButton.classList.remove('armed');
    }
}

function closeHistoryPanel() {
    if (!historyPanel || !historyButton) return;
    if (historyPanel.hidden) return;

    historyPanel.hidden = true;
    historyButton.setAttribute('aria-expanded', 'false');
    resetClearHistory();
}

function openHistoryPanel() {
    if (!historyPanel || !historyButton) return;

    renderHistoryList();
    historyPanel.hidden = false;
    historyButton.setAttribute('aria-expanded', 'true');
    historyPanel.focus();
}

function toggleHistoryPanel() {
    if (busy || !historyPanel) return;
    if (historyPanel.hidden) openHistoryPanel();
    else closeHistoryPanel();
}

function openChat(chatId) {
    if (busy) return;

    const chat = savedChats.find((item) => item.id === chatId);
    if (!chat) return;

    currentChat = chat;
    chatHistory = trimHistory(
        chat.messages.map((message) => ({
            role: message.role === 'assistant' ? 'model' : 'user',
            text: message.text,
        })),
    );
    setError('');
    clearFile();
    textInput.value = '';
    messages.replaceChildren();
    for (const message of chat.messages) addMessage(message.role, message.text);
    scrollMessagesToBottom();
    closeHistoryPanel();
    textInput.focus();
}

function deleteChat(chatId) {
    if (busy) return;

    const wasActive = currentChat && currentChat.id === chatId;
    savedChats = savedChats.filter((chat) => chat.id !== chatId);
    persistChats();
    if (wasActive) startNewChat();
    renderHistoryList();
}

function clearAllChats() {
    if (busy) return;

    savedChats = [];
    persistChats();
    startNewChat();
    renderHistoryList();
}

function armClearHistory() {
    if (busy || !clearHistoryButton || savedChats.length === 0) return;

    if (!clearArmed) {
        clearArmed = true;
        clearHistoryButton.textContent = 'Press again to clear';
        clearHistoryButton.classList.add('armed');
        clearTimer = setTimeout(resetClearHistory, 4000);
        return;
    }

    resetClearHistory();
    clearAllChats();
}

function startNewChat() {
    if (busy) return;

    currentChat = createChat();
    chatHistory = [];
    setError('');
    clearFile();
    textInput.value = '';
    messages.replaceChildren(emptyState);
    closeHistoryPanel();
    textInput.focus();
}

async function loadSuggestions() {
    if (!promptChips) return;

    try {
        const response = await fetch(`${API_BASE}/suggestions`, {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
        });
        if (!response.ok) return;

        const data = await readJson(response);
        const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
        const valid = suggestions
            .filter((question) => typeof question === 'string')
            .map((question) => question.trim())
            .filter((question) => question.length > 0 && question.length <= 90)
            .slice(0, 3);

        if (valid.length === 0 || !emptyState?.isConnected) return;

        promptChips.replaceChildren();
        for (const question of valid) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'prompt-chip';
            button.dataset.prompt = question;
            button.textContent = question;
            promptChips.appendChild(button);
        }
        promptChips.hidden = false;
    } catch {
        // Suggestions are optional; the chat still works without them.
    }
}

async function sendMessage() {
    if (busy) return;

    const text = textInput.value.trim();

    if (!text && !selectedFile) {
        setError('Type a question or add a text file for me.');
        textInput.focus();
        return;
    }
    if (text.length > MAX_MESSAGE_CHARS) {
        setError(`Your message is too long. Keep it under ${MAX_MESSAGE_CHARS} characters.`);
        return;
    }

    setError('');

    const previousHistory = trimHistory(chatHistory);
    const attachedName = selectedFile ? selectedFile.name : '';
    const userLabel = selectedFile
        ? `${text || 'Look at the attached file.'}\n[Attached: ${attachedName}]`
        : text;

    let fileText = '';
    if (selectedFile) {
        try {
            fileText = await readFileText(selectedFile);
        } catch {
            fileText = '';
        }
        if (fileText.length > MAX_FILE_CHARS) {
            setError(`That file is too long. Keep it under ${MAX_FILE_CHARS.toLocaleString('en-US')} characters.`);
            return;
        }
    }

    const historyUserText =
        selectedFile && fileText ? buildHistoryText(text, selectedFile, fileText) : userLabel;

    addMessage('user', userLabel);

    if (!currentChat) currentChat = createChat();
    if (currentChat.messages.length === 0) {
        currentChat.title = makeChatTitle(text, attachedName);
    }
    currentChat.messages.push({ role: 'user', text: userLabel });
    saveCurrentChat();
    closeHistoryPanel();

    const formData = new FormData();
    if (text) formData.append('message', text);
    if (selectedFile) formData.append('file', selectedFile, selectedFile.name);
    if (previousHistory.length > 0) formData.append('history', JSON.stringify(previousHistory));

    textInput.value = '';
    setBusy(true);

    let timedOut = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
        let response;
        try {
            response = await fetch(`${API_BASE}/chat`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { Accept: 'application/json' },
                body: formData,
                signal: controller.signal,
            });
        } catch {
            if (timedOut) {
                throw new Error("I'm taking too long. Please try again.");
            }
            throw new Error("I couldn't connect. Check your internet and try again.");
        } finally {
            clearTimeout(timeoutId);
        }

        const data = await readJson(response);

        if (!response.ok) {
            const requestId = extractRequestId(data);
            const serverMessage =
                data && data.error && typeof data.error.message === 'string'
                    ? data.error.message
                    : "That didn't work. Please try again.";
            const reference = requestId ? ` (ref: ${requestId})` : '';
            throw new Error(`${serverMessage}${reference}`);
        }

        const reply = data && typeof data.reply === 'string' ? data.reply.trim() : '';
        if (!reply) {
            throw new Error("I didn't send an answer back. Please try again.");
        }

        addMessage('assistant', reply);
        chatHistory = trimHistory(
            previousHistory.concat([
                { role: 'user', text: historyUserText },
                { role: 'model', text: reply },
            ]),
        );
        currentChat.messages.push({ role: 'assistant', text: reply });
        saveCurrentChat();
        clearFile();
    } catch (error) {
        setError(error && error.message ? error.message : "Something went wrong on my end. Please try again.");
    } finally {
        setBusy(false);
        textInput.focus();
    }
}

themeToggle.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try {
        localStorage.setItem(THEME_KEY, next);
    } catch {
        // Theme persistence is optional.
    }
});

chatForm.addEventListener('submit', (event) => {
    event.preventDefault();
    sendMessage();
});

textInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        chatForm.requestSubmit();
    }
});

textInput.addEventListener('input', () => {
    if (errorDiv.textContent) setError('');
});

attachButton.addEventListener('click', () => {
    if (!busy) fileInput.click();
});

fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
        clearFile();
        return;
    }

    if (file.size > MAX_FILE_BYTES) {
        clearFile();
        setError(`That file is too big. The limit is ${formatBytes(MAX_FILE_BYTES)}.`);
        return;
    }

    selectedFile = file;
    showFileChip(file);
    setError('');
});

removeFileButton.addEventListener('click', () => {
    clearFile();
    setError('');
});

newChatButton.addEventListener('click', startNewChat);

historyButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleHistoryPanel();
});

historyPanel?.addEventListener('click', (event) => {
    event.stopPropagation();
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const open = target.closest('[data-chat-id]');
    if (open) {
        openChat(open.dataset.chatId);
        return;
    }

    const remove = target.closest('[data-delete-id]');
    if (remove) deleteChat(remove.dataset.deleteId);
});

clearHistoryButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    armClearHistory();
});

document.addEventListener('click', (event) => {
    if (!historyPanel || historyPanel.hidden) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target && !target.closest('.chat-actions')) closeHistoryPanel();
});

document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !historyPanel || historyPanel.hidden) return;
    closeHistoryPanel();
    historyButton?.focus();
});

promptChips?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-prompt]');
    if (!chip) return;
    textInput.value = chip.dataset.prompt || '';
    textInput.focus();
});

window.addEventListener('resize', () => {
    if (isNearBottom()) scrollMessagesToBottom();
});

currentChat = createChat();
savedChats = loadSavedChats();
renderHistoryList();
initTheme();
loadSuggestions();
footerText.textContent = `© ${new Date().getFullYear()} Dr.Health`;
