import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { processAiQuery, saveToHistory, trackAnalytics, fetchChatSessions, fetchSessionMessages } from './ai.js';

const auth = getAuth();
let currentUser = null;
let currentSessionId = Date.now().toString();

// Conversation Memory State
let contextState = {
    lastGenre: null,
    lastTitle: null,
    modifier: null
};

// UI Elements
const messagesContainer = document.getElementById('messagesContainer');
const chatInput = document.getElementById('chatInput');
const btnSend = document.getElementById('btnSend');
const btnNewChat = document.getElementById('btnNewChat');
const chatHistoryList = document.getElementById('chatHistoryList');

// Auto-resize textarea
if (chatInput) {
    chatInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
    });
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
}

// Handle Send
if (btnSend) {
    btnSend.addEventListener('click', sendMessage);
}

if (btnNewChat) {
    btnNewChat.addEventListener('click', () => {
        currentSessionId = Date.now().toString();
        messagesContainer.innerHTML = `
            <div class="message-wrapper ai">
                <div class="avatar ai">🤖</div>
                <div class="message-bubble">
                    Hello! I'm your AnimeVerse AI Assistant. How can I help you find something to watch today? <br><br>
                    <small style="opacity:0.7;">Try asking:<br>
                    - "Recommend me an action anime"<br>
                    - "Suggest a horror movie"<br>
                    - "Give me a series like Breaking Bad"<br>
                    - "What's trending right now?"</small>
                </div>
            </div>
        `;
        contextState = { lastGenre: null, lastTitle: null, modifier: null };
        loadChatHistory();
    });
}

onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (user) {
        loadChatHistory();
    }
});

async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;

    // Clear input
    chatInput.value = '';
    chatInput.style.height = 'auto';

    // Render User Message
    appendMessage('user', text);

    // Render Typing Indicator
    const typingId = appendTypingIndicator();

    // Process intent and generate unified response
    const response = await processAiQuery(text, currentUser, contextState);

    // Remove Typing Indicator
    const typingEl = document.getElementById(typingId);
    if (typingEl) typingEl.remove();

    // Render AI Message
    appendMessage('ai', response.text, response.cards);

    // Save to Firestore
    await saveToHistory(currentUser, currentSessionId, text, response.text, response.cards);
    
    // Refresh sidebar list to include the new/updated session title
    await loadChatHistory();
}

function appendMessage(role, text, cards = null, scroll = true) {
    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${role}`;

    let avatar = role === 'ai' ? '🤖' : '👤';
    let avatarClass = role === 'ai' ? 'ai' : 'user';

    let cardsHtml = '';
    if (cards && cards.length > 0) {
        cardsHtml = `<div class="chat-cards-container">`;
        cards.forEach(card => {
            const imgUrl = card.image || `https://via.placeholder.com/200x300/1a1a1a/e50914?text=${encodeURIComponent(card.title)}`;
            const title = card.title;
            const rating = card.rating || 'N/A';
            const itemId = card.id;
            const mediaType = card.mediaType || 'movie';
            const genres = card.genres || 'N/A';
            
            cardsHtml += `
                <div class="chat-card" onclick="handleCardClick('${title.replace(/'/g, "\\'")}', '${itemId}', '${mediaType}', '${imgUrl}')">
                    <img src="${imgUrl}" alt="${title}">
                    <div class="chat-card-info">
                        <h4 class="chat-card-title">${title}</h4>
                        <p class="chat-card-genre" style="font-size: 11px; color: #aaa; margin: 4px 0; font-weight: 500;">${genres}</p>
                        <div class="chat-card-meta">
                            <span>⭐ ${rating}</span>
                            <span>${mediaType.toUpperCase()}</span>
                        </div>
                        <button class="chat-card-btn">View Details</button>
                    </div>
                </div>
            `;
        });
        cardsHtml += `</div>`;
    }

    // Convert markdown bold and newlines to HTML format
    let formattedText = text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');

    wrapper.innerHTML = `
        <div class="avatar ${avatarClass}">${avatar}</div>
        <div style="max-width: 80%;">
            <div class="message-bubble">${formattedText}</div>
            ${cardsHtml}
        </div>
    `;

    messagesContainer.appendChild(wrapper);
    if (scroll) {
        scrollToBottom();
    }
}

function appendTypingIndicator() {
    const id = 'typing-' + Date.now();
    const wrapper = document.createElement('div');
    wrapper.id = id;
    wrapper.className = `message-wrapper ai`;
    wrapper.innerHTML = `
        <div class="avatar ai">🤖</div>
        <div class="message-bubble">
            <div class="typing-indicator">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        </div>
    `;
    messagesContainer.appendChild(wrapper);
    scrollToBottom();
    return id;
}

function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

window.handleCardClick = function(title, itemId, mediaType, imgUrl) {
    trackAnalytics("click", title);
    
    const isAnime = mediaType.toLowerCase() === 'anime';
    const selectedItem = {
        title: title,
        image: imgUrl,
        rating: null,
        description: "",
        type: isAnime ? 'Anime' : mediaType,
        mediaType: isAnime ? 'Anime' : mediaType,
        year: "",
        episodes: null,
        id: isAnime ? null : itemId,
        mal_id: isAnime ? itemId : null
    };
    localStorage.setItem("selectedItem", JSON.stringify(selectedItem));
    
    // Add to watch history
    let watchHistory = JSON.parse(localStorage.getItem("watchHistory")) || [];
    watchHistory = watchHistory.filter(h => h && (h.title || '').toLowerCase().trim() !== title.toLowerCase().trim());
    watchHistory.unshift(selectedItem);
    localStorage.setItem("watchHistory", JSON.stringify(watchHistory.slice(0, 20)));

    window.location.href = "details.html";
};

async function loadChatHistory() {
    if (!currentUser) return;
    try {
        const sessions = await fetchChatSessions(currentUser);
        if (chatHistoryList) {
            chatHistoryList.innerHTML = '';
            sessions.forEach(session => {
                let title = "Chat Session";
                if (session.messages && session.messages.length > 0) {
                    const firstUserMsg = session.messages.find(m => m.role === 'user');
                    if (firstUserMsg && firstUserMsg.text) {
                        title = firstUserMsg.text;
                    }
                }
                if (title.length > 25) {
                    title = title.substring(0, 22) + "...";
                }
                
                const item = document.createElement('div');
                item.className = 'history-item';
                if (session.id === currentSessionId) {
                    item.style.background = '#2a2a2a';
                    item.style.borderColor = '#e50914';
                }
                item.innerText = title;
                item.addEventListener('click', () => {
                    switchSession(session.id);
                });
                chatHistoryList.appendChild(item);
            });
        }
    } catch (e) {
        console.warn("[Chat UI] Failed to load history sidebar:", e);
    }
}

async function switchSession(sessionId) {
    currentSessionId = sessionId;
    if (!currentUser) return;
    
    // Render loading state in message window
    messagesContainer.innerHTML = `<p style="text-align:center;color:#888;">Loading session messages...</p>`;
    
    const messages = await fetchSessionMessages(currentUser, sessionId);
    messagesContainer.innerHTML = '';
    
    if (messages.length === 0) {
        messagesContainer.innerHTML = `
            <div class="message-wrapper ai">
                <div class="avatar ai">🤖</div>
                <div class="message-bubble">
                    Hello! I'm your AnimeVerse AI Assistant. How can I help you find something to watch today?
                </div>
            </div>
        `;
    } else {
        messages.forEach(msg => {
            appendMessage(msg.role, msg.text, msg.cards, false);
        });
        scrollToBottom();
    }
    
    // Highlight the selected session in sidebar
    if (chatHistoryList) {
        Array.from(chatHistoryList.children).forEach(el => {
            el.style.background = '';
            el.style.borderColor = '';
        });
    }
    await loadChatHistory();
}
