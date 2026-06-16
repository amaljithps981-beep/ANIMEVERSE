import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCZWdwzHo5IRGWQHs6IzsFtXdoLm10gmII",
  authDomain: "animeverse-4c635.firebaseapp.com",
  projectId: "animeverse-4c635",
  storageBucket: "animeverse-4c635.firebasestorage.app",
  messagingSenderId: "200334860457",
  appId: "1:200334860457:web:d493dd34a5f541d9e8c9b8",
  measurementId: "G-8VMLXQFDWY"
};

const app  = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

/* AUTH GUARD + NAV AVATAR SYNC */
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "login.html";
        return;
    }

    // Sync profile picture to nav avatar + check admin role
    try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (snap.exists()) {
            const data = snap.data();
            const avatar = document.getElementById("navAvatar");
            if (avatar && data.photoURL) {
                avatar.src = data.photoURL;
            }

            // Display admin links if user has admin role
            if (data.role === "admin") {
                const adminNav = document.getElementById("adminNavLink");
                const adminDropdown = document.getElementById("adminDropdownLink");
                if (adminNav) adminNav.style.display = "block";
                if (adminDropdown) adminDropdown.style.display = "block";
            }
        }
    } catch (e) {
        // Non-critical: silently ignore
    }
});

/* LOGOUT */
document.querySelectorAll("#logoutBtn, #mobileLogoutBtn, .logout-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        signOut(auth).then(() => {
            localStorage.clear();
            window.location.href = "login.html";
        });
    });
});