import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { FIREBASE_CONFIG } from './config.js';

const app = getApps().length > 0 ? getApp() : initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) {
      const data = snap.data();
      const avatar = document.getElementById("navAvatar");
      if (avatar && data.photoURL) {
        avatar.src = data.photoURL;
      }

      if (data.role === "admin") {
        const adminNav = document.getElementById("adminNavLink");
        const adminDropdown = document.getElementById("adminDropdownLink");
        if (adminNav) adminNav.style.display = "block";
        if (adminDropdown) adminDropdown.style.display = "block";
      }
    }
  } catch (e) {
    console.error("Error loading user profile:", e);
  }
});

document.querySelectorAll("#logoutBtn, #mobileLogoutBtn, .logout-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    signOut(auth).then(() => {
      localStorage.clear();
      window.location.href = "login.html";
    });
  });
});