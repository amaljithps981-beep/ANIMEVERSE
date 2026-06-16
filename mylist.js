import { requireAuth } from './guard.js';
import { fetchDbToStorage, syncStorageToDb } from './db.js';

const mylistContainer = document.getElementById("mylistContainer");

function renderMyList(myList) {
    if (!mylistContainer) return;
    mylistContainer.innerHTML = "";

    if (!myList || myList.length === 0) {
        mylistContainer.innerHTML = `<p style="color: var(--text-muted); padding-left: 5%;">Your list is empty.</p>`;
        return;
    }

    myList.forEach(item => {
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
        mylistContainer.appendChild(card);
    });
}

async function loadMyList() {
    console.log("[MyList] Loading — waiting for auth...");

    // Step 1: Show localStorage data immediately (instant render)
    let localList = [];
    try {
        localList = JSON.parse(localStorage.getItem("myList")) || [];
    } catch (e) {
        localList = [];
    }
    console.log("[MyList] localStorage data:", localList);
    renderMyList(localList);

    // Step 2: Fetch from Firestore (authoritative source)
    console.log("[MyList] Fetching from Firestore...");
    const dbList = await fetchDbToStorage("myList");
    console.log("[MyList] Firestore data:", dbList);

    if (dbList !== null) {
        // Deduplicate
        const seen = new Set();
        const cleaned = [];
        let hasDuplicates = false;
        dbList.forEach(item => {
            if (!item) return;
            const key = (item.title || item.name || '').toLowerCase().trim();
            if (key && !seen.has(key)) {
                seen.add(key);
                cleaned.push(item);
            } else if (key) {
                hasDuplicates = true;
            }
        });
        const finalList = hasDuplicates ? cleaned : dbList;
        if (hasDuplicates) {
            await syncStorageToDb("myList", finalList);
        }
        console.log("[MyList] Rendering", finalList.length, "items from Firestore.");
        renderMyList(finalList);
    } else {
        // No Firestore data found (null) — fallback to local
        console.log("[MyList] No Firestore data found. Showing localStorage copy.");
        renderMyList(localList);
    }
}

// Only run after auth is confirmed
requireAuth().then(() => {
    console.log("[MyList] Auth confirmed. Starting load.");
    loadMyList();
});
