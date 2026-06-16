import { requireAuth } from './guard.js';
import { fetchDbToStorage, syncStorageToDb } from './db.js';

const favoritesContainer = document.getElementById("favoritesContainer");

function renderFavorites(favorites) {
    if (!favoritesContainer) return;
    favoritesContainer.innerHTML = "";

    if (!favorites || favorites.length === 0) {
        favoritesContainer.innerHTML = `<p style="color: var(--text-muted); padding-left: 5%;">You haven't added any favorites yet.</p>`;
        return;
    }

    favorites.forEach(item => {
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
        favoritesContainer.appendChild(card);
    });
}

async function loadFavorites() {
    console.log("[Favorites] Loading — waiting for auth...");

    // Step 1: Show localStorage data immediately (instant render)
    let localFavorites = [];
    try {
        localFavorites = JSON.parse(localStorage.getItem("favorites")) || [];
    } catch (e) {
        localFavorites = [];
    }
    console.log("[Favorites] localStorage data:", localFavorites);
    renderFavorites(localFavorites);

    // Step 2: Fetch from Firestore (authoritative source)
    console.log("[Favorites] Fetching from Firestore...");
    const dbFavorites = await fetchDbToStorage("favorites");
    console.log("[Favorites] Firestore data:", dbFavorites);

    if (dbFavorites !== null) {
        // Deduplicate
        const seen = new Set();
        const cleaned = [];
        let hasDuplicates = false;
        dbFavorites.forEach(item => {
            if (!item) return;
            const key = (item.title || item.name || '').toLowerCase().trim();
            if (key && !seen.has(key)) {
                seen.add(key);
                cleaned.push(item);
            } else if (key) {
                hasDuplicates = true;
            }
        });
        const finalList = hasDuplicates ? cleaned : dbFavorites;
        if (hasDuplicates) {
            await syncStorageToDb("favorites", finalList);
        }
        console.log("[Favorites] Rendering", finalList.length, "items from Firestore.");
        renderFavorites(finalList);
    } else {
        // No Firestore data found (null) — fallback to local
        console.log("[Favorites] No Firestore data found. Showing localStorage copy.");
        renderFavorites(localFavorites);
    }
}

// Only run after auth is confirmed
requireAuth().then(() => {
    console.log("[Favorites] Auth confirmed. Starting load.");
    loadFavorites();
});
