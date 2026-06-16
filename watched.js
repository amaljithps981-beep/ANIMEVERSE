import { requireAuth } from './guard.js';
import { fetchDbToStorage, syncStorageToDb } from './db.js';

const watchedContainer = document.getElementById("watchedContainer");

function renderWatched(watched) {
    if (!watchedContainer) return;
    watchedContainer.innerHTML = "";

    if (!watched || watched.length === 0) {
        watchedContainer.innerHTML = `<p style="color: var(--text-muted); padding-left: 5%;">You haven't marked anything as watched yet.</p>`;
        return;
    }

    watched.forEach(item => {
        if (!item) return;
        const card = document.createElement("div");
        card.classList.add("card");
        card.innerHTML = `
            <img src="${item.image || ''}" alt="${item.title || ''}" loading="lazy">
            <div class="card-content">
                <h3>${item.title || 'Unknown'}</h3>
                <span class="rating">⭐ ${item.rating || 'N/A'}</span>
            </div>
        `;
        card.addEventListener("click", () => {
            localStorage.setItem("selectedItem", JSON.stringify(item));
            window.location.href = "details.html";
        });
        watchedContainer.appendChild(card);
    });
}

async function loadWatched() {
    console.log("[Watched] Loading — waiting for auth...");

    // Step 1: Show localStorage data immediately (instant render)
    let localWatched = [];
    try {
        localWatched = JSON.parse(localStorage.getItem("watched")) || [];
    } catch (e) {
        localWatched = [];
    }
    console.log("[Watched] localStorage data:", localWatched);
    renderWatched(localWatched);

    // Step 2: Fetch from Firestore (authoritative source)
    console.log("[Watched] Fetching from Firestore...");
    const dbWatched = await fetchDbToStorage("watched");
    console.log("[Watched] Firestore data:", dbWatched);

    if (dbWatched !== null) {
        // Deduplicate
        const seen = new Set();
        const cleaned = [];
        let hasDuplicates = false;
        dbWatched.forEach(item => {
            if (!item) return;
            const key = (item.title || item.name || '').toLowerCase().trim();
            if (key && !seen.has(key)) {
                seen.add(key);
                cleaned.push(item);
            } else if (key) {
                hasDuplicates = true;
            }
        });
        const finalList = hasDuplicates ? cleaned : dbWatched;
        if (hasDuplicates) {
            await syncStorageToDb("watched", finalList);
        }
        console.log("[Watched] Rendering", finalList.length, "items from Firestore.");
        renderWatched(finalList);
    } else {
        // No Firestore data found (null) — fallback to local
        console.log("[Watched] No Firestore data found. Showing localStorage copy.");
        renderWatched(localWatched);
    }
}

// Only run after auth is confirmed
requireAuth().then(() => {
    console.log("[Watched] Auth confirmed. Starting load.");
    loadWatched();
});
