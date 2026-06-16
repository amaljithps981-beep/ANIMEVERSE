import { auth, db, getDoc, doc, updateDoc, getAnalytics, getUserData } from './db.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const userName     = document.getElementById("userName");
const userEmail    = document.getElementById("userEmail");
const memberSince  = document.getElementById("memberSince");
const profilePic   = document.getElementById("profilePic");
const fileUpload   = document.getElementById("fileUpload");

const statFavorites = document.getElementById("statFavorites");
const statList      = document.getElementById("statList");
const statWatched   = document.getElementById("statWatched");
const topGenreEl    = document.getElementById("topGenre");
const topTypeEl     = document.getElementById("topType");
const recAccuracyEl = document.getElementById("recAccuracy");

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "login.html";
        return;
    }

    // Load Basic Profile from Firestore
    try {
        const userRef  = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
            const data = userSnap.data();
            if (userName)    userName.innerText    = data.displayName || "Anime Fan";
            if (userEmail)   userEmail.innerText   = data.email || user.email;
            if (profilePic)  profilePic.src        = data.photoURL || "https://i.pinimg.com/736x/8b/16/7a/8b167af653c2399dd93b952a48740620.jpg";
            if (memberSince && data.createdAt) {
                memberSince.innerText = new Date(data.createdAt).toLocaleDateString();
            }
        } else {
            if (userEmail) userEmail.innerText = user.email;
        }
    } catch (e) {
        console.warn("Profile load error:", e);
    }

    // Load Analytics from helper
    try {
        const analytics = await getAnalytics();
        if (statWatched)   statWatched.innerText    = analytics.watchedCount;
        if (statFavorites) statFavorites.innerText  = analytics.favoritesCount;
        if (statList)      statList.innerText       = analytics.myListCount;
        const statContinue = document.getElementById("statContinue");
        if (statContinue)  statContinue.innerText   = analytics.continueWatchingCount || 0;
        const statHistory = document.getElementById("statHistory");
        if (statHistory)   statHistory.innerText    = analytics.historyCount || 0;
        const avgRatingEl = document.getElementById("avgRating");
        if (avgRatingEl)   avgRatingEl.innerText    = analytics.avgRating || 'N/A';
        if (topGenreEl)    topGenreEl.innerText     = analytics.topGenre || 'N/A';
        if (topTypeEl)     topTypeEl.innerText      = analytics.topType  || 'N/A';
        if (recAccuracyEl) recAccuracyEl.innerText  = (analytics.accuracy !== undefined ? analytics.accuracy : 85) + '%';
        
        // 1. Calculate Viewing Streak
        const history = (await getUserData("watchHistory")) || [];
        const viewingStreakEl = document.getElementById("viewingStreak");
        if (viewingStreakEl) {
            let streak = 0;
            if (history.length > 0) {
                const uniqueDates = [...new Set(history.map(i => {
                    const d = i.addedAt ? new Date(i.addedAt) : new Date();
                    return d.toISOString().split('T')[0];
                }))].sort((a,b) => new Date(b) - new Date(a));
                
                const todayStr = new Date().toISOString().split('T')[0];
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                const yesterdayStr = yesterday.toISOString().split('T')[0];
                
                if (uniqueDates[0] === todayStr || uniqueDates[0] === yesterdayStr) {
                    streak = 1;
                    let currDate = new Date(uniqueDates[0]);
                    for (let i = 1; i < uniqueDates.length; i++) {
                        currDate.setDate(currDate.getDate() - 1);
                        if (uniqueDates[i] === currDate.toISOString().split('T')[0]) {
                            streak++;
                        } else {
                            break;
                        }
                    }
                }
            }
            viewingStreakEl.innerText = `${streak} Days`;
        }

        // 2. Render Recently Watched
        const recentContainer = document.getElementById("recentWatchContainer");
        if (recentContainer && history.length > 0) {
            recentContainer.innerHTML = '';
            history.slice(0, 10).forEach(item => {
                const img = item.poster_path ? (item.poster_path.startsWith('http') ? item.poster_path : `https://image.tmdb.org/t/p/w500${item.poster_path}`) : '';
                const card = document.createElement("div");
                card.className = "card";
                card.style.minWidth = "120px";
                card.style.maxWidth = "120px";
                card.innerHTML = `<img src="${img}" alt="${item.title}" style="width:100%; height:180px; object-fit:cover; border-radius:8px;">
                                  <div style="font-size:12px; margin-top:5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${item.title || item.name}</div>`;
                recentContainer.appendChild(card);
            });
        } else if (recentContainer) {
            recentContainer.innerHTML = '<p>No recently watched items.</p>';
        }

        // 3. Render Activity Timeline
        const favorites = (await getUserData("favorites")) || [];
        const watched = (await getUserData("watched")) || [];
        const myList = (await getUserData("myList")) || [];
        
        const allEvents = [];
        const addEvents = (list, type, icon) => {
            list.forEach(i => {
                allEvents.push({
                    title: i.title || i.name,
                    type: type,
                    icon: icon,
                    date: i.addedAt ? new Date(i.addedAt) : new Date()
                });
            });
        };
        addEvents(history, 'Watched', '🕒');
        addEvents(favorites, 'Favorited', '❤️');
        addEvents(watched, 'Marked Watched', '👀');
        addEvents(myList, 'Added to List', '📚');
        
        allEvents.sort((a,b) => b.date - a.date);

        const timelineContainer = document.getElementById("timelineContainer");
        const timelineTabs = document.querySelectorAll(".timeline-tab");
        
        const renderTimeline = (period) => {
            if (!timelineContainer) return;
            timelineContainer.innerHTML = '';
            
            const now = new Date();
            let filteredEvents = allEvents.filter(e => {
                if (period === 'today') return e.date.toDateString() === now.toDateString();
                if (period === 'week') {
                    const diffTime = Math.abs(now - e.date);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
                    return diffDays <= 7;
                }
                if (period === 'month') {
                    return e.date.getMonth() === now.getMonth() && e.date.getFullYear() === now.getFullYear();
                }
                return true;
            });

            if (filteredEvents.length === 0) {
                timelineContainer.innerHTML = '<p style="color:#aaa;">No activity for this period.</p>';
                return;
            }

            filteredEvents.slice(0, 50).forEach(e => {
                const div = document.createElement("div");
                div.style.padding = "10px";
                div.style.borderBottom = "1px solid #333";
                div.style.display = "flex";
                div.style.alignItems = "center";
                div.style.gap = "15px";
                
                div.innerHTML = `
                    <div style="font-size:20px;">${e.icon}</div>
                    <div style="flex:1;">
                        <div style="font-weight:bold;">${e.type}: ${e.title}</div>
                        <div style="font-size:12px; color:#aaa;">${e.date.toLocaleString()}</div>
                    </div>
                `;
                timelineContainer.appendChild(div);
            });
        };

        if (timelineTabs.length > 0) {
            timelineTabs.forEach(tab => {
                tab.addEventListener("click", (e) => {
                    timelineTabs.forEach(t => t.classList.remove("active", "btn-primary"));
                    timelineTabs.forEach(t => t.classList.add("btn-secondary"));
                    e.target.classList.remove("btn-secondary");
                    e.target.classList.add("active", "btn-primary");
                    renderTimeline(e.target.getAttribute("data-period"));
                });
            });
            renderTimeline('today');
        }

    } catch (e) {
        console.warn("Analytics load error:", e);
    }
});

// Profile Pic Upload (base64 stored in Firestore — fine for Phase 3)
if (fileUpload) {
    fileUpload.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            const base64 = event.target.result;
            if (profilePic) profilePic.src = base64;
            if (auth.currentUser) {
                const userRef = doc(db, "users", auth.currentUser.uid);
                await updateDoc(userRef, { photoURL: base64 });
                alert("Profile picture updated!");
            }
        };
        reader.readAsDataURL(file);
    });
}

// ======================
// MOBILE HAMBURGER MENU TOGGLE
// ======================
function initHamburgerMenu() {
    const hamburgerBtn = document.getElementById("hamburgerBtn");
    const navOverlay = document.getElementById("navOverlay");
    const navUl = document.querySelector("nav ul");

    if (!hamburgerBtn || !navOverlay || !navUl) return;

    function toggleMenu() {
        hamburgerBtn.classList.toggle("open");
        navUl.classList.toggle("active");
        navOverlay.classList.toggle("active");
    }

    function closeMenu() {
        hamburgerBtn.classList.remove("open");
        navUl.classList.remove("active");
        navOverlay.classList.remove("active");
    }

    hamburgerBtn.addEventListener("click", (e) => {
        toggleMenu();
        e.stopPropagation();
    });

    navOverlay.addEventListener("click", closeMenu);

    // Close menu when clicking on any link inside nav ul
    navUl.querySelectorAll("a").forEach(link => {
        link.addEventListener("click", closeMenu);
    });
}

initHamburgerMenu();

// ======================
// PWA INSTALLATION PROMPT
// ======================
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent Chrome 67 and earlier from automatically showing the prompt
    e.preventDefault();
    // Stash the event so it can be triggered later.
    deferredPrompt = e;
    // Update UI to show the install buttons
    const installBtns = document.querySelectorAll('.install-btn');
    installBtns.forEach(btn => {
        btn.style.setProperty('display', 'flex', 'important');
    });
});

document.querySelectorAll('.install-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
        e.preventDefault();
        if (!deferredPrompt) return;
        // Show the prompt
        deferredPrompt.prompt();
        // Wait for the user to respond to the prompt
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User response to the install prompt: ${outcome}`);
        // We've used the prompt, and can't use it again
        deferredPrompt = null;
        // Hide the install buttons
        const installBtns = document.querySelectorAll('.install-btn');
        installBtns.forEach(ib => ib.style.setProperty('display', 'none', 'important'));
    });
});

window.addEventListener('appinstalled', () => {
    // Hide the install buttons
    const installBtns = document.querySelectorAll('.install-btn');
    installBtns.forEach(ib => ib.style.setProperty('display', 'none', 'important'));
    console.log('AnimeVerse was installed.');
});
