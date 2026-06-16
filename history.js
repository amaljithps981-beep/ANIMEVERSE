import { requireAuth } from './guard.js';
import { fetchDbToStorage, syncStorageToDb } from './db.js';

const historyContainer = document.getElementById("historyContainer");

function renderHistory(watchHistory) {
    historyContainer.innerHTML = "";

    if (!watchHistory || watchHistory.length === 0) {
        historyContainer.innerHTML = `<p style="color: var(--text-muted); padding-left: 5%;">Your history is empty.</p>`;
        return;
    }

    watchHistory.forEach(item => {
        if (!item) return;
        const card = document.createElement("div");
        card.classList.add("card");
        card.innerHTML = `
            <img src="${item.image || ''}" loading="lazy" alt="${item.title || ''}">
            <div class="card-content">
                <h3>${item.title || 'Unknown'}</h3>
                <span class="rating">⭐ ${item.rating || 'N/A'}</span>
            </div>
        `;
        card.addEventListener("click", () => {
            localStorage.setItem("selectedItem", JSON.stringify(item));
            window.location.href = "details.html";
        });
        historyContainer.appendChild(card);
    });
}

async function loadHistory() {
    // 1. Render from localStorage synchronously (instant feedback)
    let localHistory = [];
    try {
        localHistory = JSON.parse(localStorage.getItem("watchHistory")) || [];
    } catch (e) {
        localHistory = [];
    }
    renderHistory(localHistory);

    // 2. Fetch from database in the background
    const dbHistory = await fetchDbToStorage("watchHistory");
    if (dbHistory !== null) {
        const watchHistory = [];
        const seenTitles = new Set();
        let hasDuplicates = false;

        dbHistory.forEach(item => {
            if (!item) return;
            const titleLower = item.title ? item.title.toLowerCase().trim() : "";
            if (titleLower) {
                if (!seenTitles.has(titleLower)) {
                    seenTitles.add(titleLower);
                    watchHistory.push(item);
                } else {
                    hasDuplicates = true;
                }
            }
        });

        if (hasDuplicates) {
            await syncStorageToDb("watchHistory", watchHistory);
        }

        renderHistory(watchHistory);
    }
}

// Only run after auth is confirmed
requireAuth().then(() => {
    console.log("[History] Auth confirmed. Starting load.");
    loadHistory();
});