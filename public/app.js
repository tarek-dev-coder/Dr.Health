'use strict';

const API_BASE = '/api';
const MAX_MESSAGE_CHARS = 4000;
const MAX_GUEST_MESSAGE_CHARS = 2000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_HISTORY_TURNS = 20;
const MAX_HISTORY_CHARS = 20000;
const MAX_GUEST_HISTORY_TURNS = 4;
const MAX_GUEST_HISTORY_CHARS = 4000;
const DEFAULT_GUEST_LIMIT = 5;
const REQUEST_TIMEOUT_MS = 75000;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const IMAGE_COMPRESSION_THRESHOLD = 1.5 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1600;
const IMAGE_QUALITY = 0.82;
const IS_FILE_PROTOCOL = window.location.protocol === 'file:';

const chat = document.getElementById('chat');
const messages = document.getElementById('messages');
const chatForm = document.getElementById('chat-form');
const textInput = document.getElementById('textInput');
const imageInput = document.getElementById('imageInput');
const uploadButton = document.getElementById('uploadButton');
const sendButton = document.getElementById('sendButton');
const loader = document.getElementById('loader');
const errorDiv = document.getElementById('error');
const attachment = document.getElementById('attachment');
const emptyState = document.getElementById('emptyState');
const footerText = document.getElementById('footer-text');
const heroPlay = document.getElementById('heroPlay');
const heroAnimation = document.getElementById('heroAnimation');
const authGate = document.getElementById('authGate');
const authError = document.getElementById('authError');
const authButton = document.getElementById('authButton');
const guestButton = document.getElementById('guestButton');
const guestGateNote = document.getElementById('guestGateNote');
const account = document.getElementById('account');
const guestAccount = document.getElementById('guestAccount');
const guestRemaining = document.getElementById('guestRemaining');
const signOutButton = document.getElementById('signOutButton');
const composer = document.getElementById('composer');
const composerHint = document.getElementById('composer-hint');
const guestModeNote = document.getElementById('guestModeNote');

let chatHistory = [];
let uploadedImage = null;
let busy = false;
let typingIndicator = null;
let mode = null;
let guestAvailable = true;
let guestLimit = DEFAULT_GUEST_LIMIT;

function setError(message) {
    errorDiv.textContent = message || '';
}

function setGuestLimit(limit) {
    const parsed = Number(limit);
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 1000) {
        guestLimit = parsed;
    }

    if (guestGateNote) {
        guestGateNote.textContent = guestAvailable
            ? `Guest mode is text-only and limited to ${guestLimit} questions a day. Sign in for image support and more questions.`
            : 'Guest mode is unavailable right now. Sign in to continue.';
    }
}

function setGuestRemaining(remaining) {
    const safeRemaining = Number.isInteger(remaining) ? Math.max(0, remaining) : 0;
    guestRemaining.textContent = `${safeRemaining} left`;
    guestModeNote.textContent = safeRemaining > 0
        ? `Guest mode · text only · ${safeRemaining} question${safeRemaining === 1 ? '' : 's'} left`
        : 'Guest limit reached · sign in to continue';
}

function showAuthGate(message = '') {
    mode = null;
    authGate.hidden = false;
    messages.hidden = true;
    composer.hidden = true;
    account.hidden = true;
    guestAccount.hidden = true;
    guestButton.hidden = !guestAvailable;
    authError.textContent = message;
    chat.setAttribute('aria-busy', 'false');
}

function setEmptyStateForGuest(isGuest) {
    if (!emptyState) return;
    const title = emptyState.querySelector('p');
    const example = emptyState.querySelector('.empty-example');
    if (!title || !example) return;

    title.textContent = isGuest
        ? 'Start with a health question.'
        : 'Start with a health question, or attach a food photo.';
    example.textContent = isGuest
        ? 'Guest mode is text-only. Sign in to attach a food photo.'
        : 'For example: “What should I eat before a run?”';
}

function showChat() {
    mode = 'user';
    authGate.hidden = true;
    messages.hidden = false;
    composer.hidden = false;
    account.hidden = false;
    guestAccount.hidden = true;
    guestButton.hidden = !guestAvailable;
    uploadButton.hidden = false;
    textInput.maxLength = MAX_MESSAGE_CHARS;
    composerHint.hidden = false;
    guestModeNote.hidden = true;
    setEmptyStateForGuest(false);
    authError.textContent = '';
}

function showGuestChat(remaining, limit = guestLimit) {
    mode = 'guest';
    setGuestLimit(limit);
    authGate.hidden = true;
    messages.hidden = false;
    composer.hidden = false;
    account.hidden = true;
    guestAccount.hidden = false;
    guestButton.hidden = !guestAvailable;
    uploadButton.hidden = true;
    uploadedImage = null;
    imageInput.value = '';
    showAttachment(null);
    textInput.maxLength = MAX_GUEST_MESSAGE_CHARS;
    composerHint.hidden = true;
    guestModeNote.hidden = false;
    setEmptyStateForGuest(true);
    setGuestRemaining(remaining);
    authError.textContent = '';
}

async function loadGuestSession() {
    try {
        const response = await fetch(`${API_BASE}/guest/session`, {
            method: 'GET',
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) return null;
        return await response.json();
    } catch {
        return null;
    }
}

async function loadSession() {
    const params = new URLSearchParams(window.location.search);
    let data = null;

    try {
        const response = await fetch(`${API_BASE}/auth/session`, {
            method: 'GET',
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(10000),
        });
        if (response.ok) {
            data = await response.json();
        }
    } catch {
        data = null;
    }

    let guestData = null;
    if (!(data && data.authenticated === true)) {
        guestData = await loadGuestSession();
        guestAvailable = Boolean(guestData && guestData.available === true);
        if (guestAvailable) {
            setGuestLimit(guestData.limit);
        } else if (guestGateNote) {
            guestGateNote.textContent = 'Guest mode is unavailable right now. Sign in to continue.';
        }
    }

    if (data && data.authenticated === true) {
        showChat();
        if (params.has('signed_in')) textInput.focus();
    } else if (guestAvailable && guestData && guestData.guest === true) {
        showGuestChat(guestData.remaining, guestData.limit);
        textInput.focus();
    } else {
        const message = params.has('auth_error')
            ? 'Sign-in could not be completed. Please try again.'
            : data === null
                ? 'Could not check sign-in status. Please refresh the page.'
                : '';
        showAuthGate(message);
    }

    if (window.location.search) {
        window.history.replaceState(null, '', window.location.pathname);
    }
}

async function startGuest() {
    if (busy) return;

    guestButton.disabled = true;
    guestButton.textContent = 'Starting…';

    try {
        const response = await fetch(`${API_BASE}/guest/session`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(10000),
        });

        let data = null;
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            try {
                data = await response.json();
            } catch {
                data = null;
            }
        }

        if (!response.ok) {
            const serverMessage = data && data.error && typeof data.error.message === 'string'
                ? data.error.message
                : 'Guest mode is unavailable right now. Please sign in.';
            throw new Error(serverMessage);
        }

        if (!data || data.guest !== true) {
            throw new Error('Guest mode could not be started. Please sign in.');
        }

        showGuestChat(data.remaining, data.limit);
        textInput.focus();
    } catch (error) {
        authError.textContent = error && error.message
            ? error.message
            : 'Guest mode is unavailable right now. Please sign in.';
    } finally {
        guestButton.disabled = false;
        guestButton.textContent = 'Continue as guest';
    }
}

async function signOut() {
    signOutButton.disabled = true;
    try {
        const response = await fetch(`${API_BASE}/auth/logout`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error('Sign-out failed');
        window.location.reload();
    } catch {
        signOutButton.disabled = false;
        setError('Could not sign out. Please try again.');
    }
}

const INLINE_TOKEN = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`)/g;

function appendFormattedText(parent, text) {
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

function scrollMessagesToBottom() {
    messages.scrollTop = messages.scrollHeight;
}

function isNearBottom() {
    return messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
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
    uploadButton.disabled = value;
    chat.setAttribute('aria-busy', String(value));
    messages.setAttribute('aria-busy', String(value));
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeFileName(name) {
    const normalized = String(name || 'image');
    return normalized.length > 80 ? `${normalized.slice(0, 77)}…` : normalized;
}

function validateFile(file) {
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
        return 'Unsupported image type. Please use a JPEG, PNG, or WebP image.';
    }
    if (file.size === 0) {
        return 'That image is empty. Please choose another file.';
    }
    if (file.size > MAX_FILE_BYTES) {
        return `That image is too large. The limit is ${formatBytes(MAX_FILE_BYTES)}.`;
    }
    return null;
}

function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function optimizeImage(file) {
    if (file.size <= IMAGE_COMPRESSION_THRESHOLD || typeof createImageBitmap !== 'function') {
        return file;
    }

    let bitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        return file;
    }

    try {
        const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));

        const context = canvas.getContext('2d');
        if (!context) return file;

        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

        let blob = await canvasToBlob(canvas, 'image/webp', IMAGE_QUALITY);
        if (!blob) {
            blob = await canvasToBlob(canvas, 'image/jpeg', IMAGE_QUALITY);
        }
        if (!blob || blob.size >= file.size) return file;

        const extension =
            blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/png' ? 'png' : 'webp';
        const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
        return new File([blob], `${baseName}.${extension}`, {
            type: blob.type,
            lastModified: Date.now(),
        });
    } catch {
        return file;
    } finally {
        bitmap.close?.();
    }
}

function showAttachment(file) {
    if (!file) {
        attachment.hidden = true;
        attachment.textContent = '';
        return;
    }
    attachment.textContent = `Attached: ${safeFileName(file.name)} (${formatBytes(file.size)})`;
    attachment.hidden = false;
}

function playHeroAnimation() {
    if (!heroAnimation || !heroPlay) return;

    const image = heroAnimation.querySelector('img');
    const reveal = () => heroAnimation.classList.add('is-visible');
    const restore = () => {
        heroAnimation.hidden = true;
        heroPlay.hidden = false;
    };

    heroPlay.hidden = true;
    heroAnimation.hidden = false;

    if (!image) {
        reveal();
        return;
    }

    if (image.complete) {
        if (image.naturalWidth > 0) {
            reveal();
        } else {
            restore();
        }
        return;
    }

    image.addEventListener('load', reveal, { once: true });
    image.addEventListener('error', restore, { once: true });
}

function extractRequestId(data) {
    const requestId = data && data.error && data.error.requestId;
    return typeof requestId === 'string' && requestId.length <= 64 ? requestId : '';
}

function trimHistory(turns, maxTurns = MAX_HISTORY_TURNS, maxChars = MAX_HISTORY_CHARS) {
    const trimmed = turns.slice(-maxTurns);
    let totalChars = trimmed.reduce((total, turn) => total + turn.text.length, 0);
    while (trimmed.length > 0 && totalChars > maxChars) {
        totalChars -= trimmed.shift().text.length;
    }
    return trimmed;
}

async function sendMessage() {
    if (busy || IS_FILE_PROTOCOL) return;

    const isGuest = mode === 'guest';
    const maxMessageChars = isGuest ? MAX_GUEST_MESSAGE_CHARS : MAX_MESSAGE_CHARS;
    const maxHistoryTurns = isGuest ? MAX_GUEST_HISTORY_TURNS : MAX_HISTORY_TURNS;
    const maxHistoryChars = isGuest ? MAX_GUEST_HISTORY_CHARS : MAX_HISTORY_CHARS;
    const text = textInput.value.trim();

    if (isGuest && uploadedImage) {
        setError('Guest mode is text-only. Sign in to attach an image.');
        return;
    }
    if (!text && !uploadedImage) {
        setError('Type a message or attach an image first.');
        textInput.focus();
        return;
    }
    if (text.length > maxMessageChars) {
        setError(`Messages are limited to ${maxMessageChars} characters in this mode.`);
        return;
    }

    setError('');

    let attachedFile = isGuest ? null : uploadedImage;
    const previousHistory = trimHistory(chatHistory, maxHistoryTurns, maxHistoryChars);
    const userBubble = attachedFile
        ? text
            ? `${text}\nImage attached`
            : 'Image attached'
        : text;
    addMessage('user', userBubble);

    textInput.value = '';
    uploadedImage = null;
    imageInput.value = '';
    showAttachment(null);
    setBusy(true);

    if (attachedFile) {
        attachment.textContent = 'Preparing image…';
        attachment.hidden = false;
        try {
            attachedFile = await optimizeImage(attachedFile);
        } catch {
            // Keep the original file if the browser cannot resize it.
        }
        showAttachment(attachedFile);
    }

    const requestOptions = {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        signal: null,
    };

    if (isGuest) {
        requestOptions.headers['Content-Type'] = 'application/json';
        requestOptions.body = JSON.stringify({
            message: text,
            history: previousHistory,
        });
    } else {
        const formData = new FormData();
        if (text) formData.append('message', text);
        if (attachedFile) formData.append('image', attachedFile, attachedFile.name);
        if (previousHistory.length > 0) formData.append('history', JSON.stringify(previousHistory));
        requestOptions.body = formData;
    }

    let timedOut = false;
    const controller = new AbortController();
    requestOptions.signal = controller.signal;
    const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
        let response;
        try {
            response = await fetch(`${API_BASE}${isGuest ? '/guest/chat' : '/chat'}`, requestOptions);
        } catch (error) {
            if (timedOut) {
                throw new Error('The request timed out. Please try again.');
            }
            throw new Error('Could not reach the Dr.Health server. Please check your connection and try again.');
        } finally {
            clearTimeout(timeoutId);
        }

        let data = null;
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            try {
                data = await response.json();
            } catch {
                data = null;
            }
        }

        if (response.status === 401) {
            showAuthGate('Please sign in again.');
            return;
        }

        if (!response.ok) {
            if (isGuest && data && data.error && data.error.code === 'GUEST_LIMIT_REACHED') {
                setGuestRemaining(0);
            }

            const requestId = extractRequestId(data);
            const serverMessage =
                data && data.error && typeof data.error.message === 'string'
                    ? data.error.message
                    : 'The request failed. Please try again.';
            const reference = requestId ? ` (ref: ${requestId})` : '';
            throw new Error(`${serverMessage}${reference}`);
        }

        const reply = data && typeof data.reply === 'string' ? data.reply.trim() : '';
        if (!reply) {
            throw new Error('The assistant returned an empty response. Please try again.');
        }

        if (isGuest && data && Number.isInteger(data.remaining)) {
            setGuestRemaining(data.remaining);
        }

        addMessage('assistant', reply);

        const historyText = text
            ? attachedFile
                ? `${text} [the user attached an image]`
                : text
            : 'The user attached an image.';
        chatHistory = trimHistory(
            previousHistory.concat([
                { role: 'user', text: historyText },
                { role: 'model', text: reply },
            ]),
            maxHistoryTurns,
            maxHistoryChars,
        );
    } catch (error) {
        setError(error && error.message ? error.message : 'Something went wrong. Please try again.');
    } finally {
        setBusy(false);
        showAttachment(null);
        textInput.focus();
    }
}

chatForm.addEventListener('submit', (event) => {
    event.preventDefault();
    sendMessage();
});

window.addEventListener('resize', () => {
    if (isNearBottom()) scrollMessagesToBottom();
});

uploadButton.addEventListener('click', () => {
    if (!busy && mode !== 'guest') imageInput.click();
});

guestButton.addEventListener('click', startGuest);

signOutButton.addEventListener('click', signOut);

if (heroPlay && heroAnimation) {
    heroPlay.addEventListener('click', playHeroAnimation);
}

imageInput.addEventListener('change', () => {
    if (mode === 'guest') {
        imageInput.value = '';
        setError('Guest mode is text-only. Sign in to attach an image.');
        return;
    }

    const file = imageInput.files && imageInput.files[0];
    if (!file) {
        uploadedImage = null;
        showAttachment(null);
        return;
    }

    const validationError = validateFile(file);
    if (validationError) {
        setError(validationError);
        uploadedImage = null;
        imageInput.value = '';
        showAttachment(null);
        return;
    }

    uploadedImage = file;
    showAttachment(file);
    setError('');
});

if (IS_FILE_PROTOCOL) {
    showAuthGate(
        'Dr.Health must be opened through its server. Run "npm start" and visit http://localhost:3000.',
    );
    authButton.hidden = true;
    guestButton.hidden = true;
    sendButton.disabled = true;
    uploadButton.disabled = true;
} else {
    loadSession();
}

footerText.textContent = `© ${new Date().getFullYear()} Dr.Health. All rights reserved.`;
