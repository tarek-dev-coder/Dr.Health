'use strict';

const API_BASE = '/api';
const MAX_MESSAGE_CHARS = 2000;
const MAX_HISTORY_TURNS = 4;
const MAX_HISTORY_CHARS = 4000;
const REQUEST_TIMEOUT_MS = 75000;
const IS_FILE_PROTOCOL = window.location.protocol === 'file:';

const chat = document.getElementById('chat');
const messages = document.getElementById('messages');
const chatForm = document.getElementById('chat-form');
const textInput = document.getElementById('textInput');
const sendButton = document.getElementById('sendButton');
const loader = document.getElementById('loader');
const errorDiv = document.getElementById('error');
const emptyState = document.getElementById('emptyState');
const footerText = document.getElementById('footer-text');
const heroPlay = document.getElementById('heroPlay');
const heroAnimation = document.getElementById('heroAnimation');
const guestRemaining = document.getElementById('guestRemaining');
const guestModeNote = document.getElementById('guestModeNote');
const sessionStatus = document.getElementById('sessionStatus');
const composer = document.getElementById('composer');

let chatHistory = [];
let busy = false;
let typingIndicator = null;
let started = false;
let guestExhausted = false;

function setError(message) {
    errorDiv.textContent = message || '';
}

function showSessionError(message) {
    started = false;
    sessionStatus.textContent = message;
    sessionStatus.hidden = false;
    messages.hidden = true;
    composer.hidden = true;
    chat.setAttribute('aria-busy', 'false');
}

function setGuestRemaining(remaining) {
    const safeRemaining = Number.isInteger(remaining) ? Math.max(0, remaining) : 0;
    guestExhausted = safeRemaining <= 0;
    guestRemaining.textContent = `${safeRemaining} left today`;
    guestModeNote.hidden = false;
    guestModeNote.textContent = safeRemaining > 0
        ? `Free text-only chat · ${safeRemaining} question${safeRemaining === 1 ? '' : 's'} left today`
        : 'Daily limit reached · come back tomorrow';

    if (started) {
        sendButton.disabled = busy || guestExhausted;
    }
}

function showChat() {
    started = true;
    sessionStatus.hidden = true;
    messages.hidden = false;
    composer.hidden = false;
    textInput.maxLength = MAX_MESSAGE_CHARS;
}

async function startGuestSession() {
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

        if (!response.ok || !data || data.available !== true || data.guest !== true) {
            const serverMessage = data && data.error && typeof data.error.message === 'string'
                ? data.error.message
                : 'Chat is unavailable right now. Please refresh the page.';
            throw new Error(serverMessage);
        }

        showChat();
        setGuestRemaining(data.remaining);
        textInput.focus();
    } catch (error) {
        showSessionError(
            error && error.message
                ? error.message
                : 'Could not reach the Dr.Health server. Please refresh the page.',
        );
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
    sendButton.disabled = value || guestExhausted || !started;
    chat.setAttribute('aria-busy', String(value));
    messages.setAttribute('aria-busy', String(value));
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

function trimHistory(turns) {
    const trimmed = turns.slice(-MAX_HISTORY_TURNS);
    let totalChars = trimmed.reduce((total, turn) => total + turn.text.length, 0);
    while (trimmed.length > 0 && totalChars > MAX_HISTORY_CHARS) {
        totalChars -= trimmed.shift().text.length;
    }
    return trimmed;
}

async function sendMessage() {
    if (busy || !started || IS_FILE_PROTOCOL) return;

    const text = textInput.value.trim();

    if (guestExhausted) {
        setError('Daily question limit reached. Please come back tomorrow.');
        return;
    }
    if (!text) {
        setError('Type a question first.');
        textInput.focus();
        return;
    }
    if (text.length > MAX_MESSAGE_CHARS) {
        setError(`Messages are limited to ${MAX_MESSAGE_CHARS} characters.`);
        return;
    }

    setError('');

    const previousHistory = trimHistory(chatHistory);
    addMessage('user', text);

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
            response = await fetch(`${API_BASE}/guest/chat`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: text,
                    history: previousHistory,
                }),
                signal: controller.signal,
            });
        } catch {
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

        if (!response.ok) {
            if (data && data.error && data.error.code === 'GUEST_LIMIT_REACHED') {
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

        if (data && Number.isInteger(data.remaining)) {
            setGuestRemaining(data.remaining);
        }

        addMessage('assistant', reply);

        chatHistory = trimHistory(
            previousHistory.concat([
                { role: 'user', text },
                { role: 'model', text: reply },
            ]),
        );
    } catch (error) {
        setError(error && error.message ? error.message : 'Something went wrong. Please try again.');
    } finally {
        setBusy(false);
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

if (heroPlay && heroAnimation) {
    heroPlay.addEventListener('click', playHeroAnimation);
}

if (IS_FILE_PROTOCOL) {
    showSessionError(
        'Dr.Health must be opened through its server. Run "npm start" and visit http://localhost:3000.',
    );
} else {
    startGuestSession();
}

footerText.textContent = `© ${new Date().getFullYear()} Dr.Health. All rights reserved.`;
