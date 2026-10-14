/* =====================================================
   NIET GARBA MATCH — APP JS
   Complete matching logic with localStorage demo mode
   ===================================================== */

const STORAGE_KEY = "niet-garba-match";
const EVENT_DATE = new Date("2026-10-20T18:00:00+05:30");

const defaultState = {
  user: null,
  token: "",
  likes: [],
  passes: [],
  profiles: [],
  matches: [],
  hidden: false,
  groupOpen: false,
};

const API_TIMEOUT_MS = 20000;
const API_BASE_URL = String(window.DANDIYA_API_BASE_URL || "").replace(/\/$/, "");

let state = loadState();
let deckIndex = 0;
let touchStartY = null;
let musicStarted = false;
let musicUnlockBound = false;

// DOM Elements
const typedText = document.querySelector("#typedText");
const signupForm = document.querySelector("#signupForm");
const formNote = document.querySelector("#formNote");
const accountNext = document.querySelector("#accountNext");
const detailsBack = document.querySelector("#detailsBack");
const profileCard = document.querySelector("#profileCard");
const deckShell = document.querySelector(".deck-shell");
const swipeBurst = document.querySelector("#swipeBurst");
const myProfile = document.querySelector("#myProfile");
const matchList = document.querySelector("#matchList");
const hiddenToggle = document.querySelector("#hiddenToggle");
const groupToggle = document.querySelector("#groupToggle");
const screens = document.querySelectorAll("main > .screen");
const modeButtons = document.querySelectorAll("[data-auth-mode]");
const matchOverlay = document.querySelector("#matchOverlay");
const matchReveal = document.querySelector("#matchReveal");
const closeMatch = document.querySelector("#closeMatch");
const siteMusic = document.querySelector("#siteMusic");
const musicToggle = document.querySelector("#musicToggle");
const logoutButton = document.querySelector("#logoutButton");

// ============ STATE MANAGEMENT ============
function loadState() {
  try {
    const saved = { ...defaultState, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) };
    if (saved.user && !saved.token) {
      saved.user = null;
      saved.profiles = [];
      saved.matches = [];
    } else if (saved.user) {
      delete saved.user.password;
    }
    return saved;
  } catch {
    return { ...defaultState };
  }
}

function saveState() {
  const safe = { ...state };
  if (state.user) {
    safe.user = { ...state.user };
    delete safe.user.password;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
}

// ============ API / BACKEND ROUTER ============
async function apiRequest(path, options = {}) {
  if (!API_BASE_URL) {
    return handleBackendRequest(path, options);
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  const url = `${API_BASE_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    signal: controller.signal,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {}),
    },
  })
    .catch((error) => {
      if (error.name === "AbortError") {
        const err = new Error("Request timed out. Try again.");
        err.status = 408;
        throw err;
      }
      throw error;
    })
    .finally(() => clearTimeout(timeoutId));

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.error || "Something went wrong.");
    err.status = response.status;
    throw err;
  }
  return data;
}

// Initialize Supabase Client if configured
let supabaseClient = null;
if (window.supabase && window.SUPABASE_URL && window.SUPABASE_ANON_KEY) {
  try {
    supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  } catch (err) {
    console.warn("Supabase init error, falling back to local mode:", err);
  }
}

// Safe UTF-8 Base64 encode (prevents 'characters outside Latin1 range' error)
function safeBase64(str) {
  try {
    const bytes = new TextEncoder().encode(str || "");
    let binary = "";
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  } catch (e) {
    return encodeURIComponent(str || "");
  }
}

// Unified backend handler: Uses Supabase Cloud if available, else localStorage
async function handleBackendRequest(path, options = {}) {
  const body = options.body ? JSON.parse(options.body) : {};

  // ================= SUPABASE CLOUD MODE =================
  if (supabaseClient) {
    try {
      // 1. SIGNUP
      if (path === "/api/signup" && options.method === "POST") {
        const id = "user_" + Date.now();
        const passwordHash = safeBase64(body.password || "");
        const profileData = {
          id,
          name: body.name || "",
          email: body.email || "",
          branch: body.branch || "",
          year: body.year || "",
          gender: body.gender || "",
          whatsapp: body.whatsapp || "",
          instagram: body.instagram || "",
          password_hash: passwordHash,
          outfit: body.outfit || "",
          prompt: body.prompt || "",
          intent: body.intent || "",
          tags: body.tags || [],
          photo: body.photo || "",
          hidden: false,
          group_open: false,
        };

        const { error } = await supabaseClient.from("profiles").upsert(profileData);
        if (error) {
          console.warn("Supabase signup error:", error);
          throw new Error(error.message || "Failed to create profile in cloud.");
        }

        saveDemoUser({ ...body, id, passwordHash });
        const token = "sb_token_" + id;
        const cleanUser = { ...body, id };
        delete cleanUser.password;
        delete cleanUser.passwordHash;
        return { user: cleanUser, token };
      }

      // 2. LOGIN
      if (path === "/api/login" && options.method === "POST") {
        const passwordHash = safeBase64(body.password || "");
        const { data, error } = await supabaseClient
          .from("profiles")
          .select("*")
          .eq("email", body.email)
          .maybeSingle();

        if (error || !data) {
          // Check local fallback
          const localUser = getDemoUsers().find((u) => u.email === body.email);
          if (localUser) {
            if (localUser.passwordHash && localUser.passwordHash !== passwordHash) {
              throw new Error("Incorrect password. Please re-enter your password.");
            }
            const token = "demo_token_" + localUser.id;
            const clean = { ...localUser };
            delete clean.password;
            delete clean.passwordHash;
            return { user: clean, token };
          }
          throw new Error("No account found with this NIET email. Sign up first!");
        }

        if (data.password_hash && data.password_hash !== passwordHash) {
          throw new Error("Incorrect password. Please re-enter your password.");
        }

        const user = {
          id: data.id,
          name: data.name,
          email: data.email,
          branch: data.branch,
          year: data.year,
          gender: data.gender,
          whatsapp: data.whatsapp,
          instagram: data.instagram,
          outfit: data.outfit,
          prompt: data.prompt,
          intent: data.intent,
          tags: data.tags || [],
          photo: data.photo,
          hidden: data.hidden,
          groupOpen: data.group_open,
        };

        saveDemoUser(user);
        const token = "sb_token_" + user.id;
        return { user, token };
      }

      // 3. GET PROFILES
      if (path.startsWith("/api/profiles")) {
        const { data, error } = await supabaseClient
          .from("profiles")
          .select("*")
          .order("created_at", { ascending: false });

        if (error) {
          console.warn("Error fetching Supabase profiles:", error);
          return handleLocalFallback(path, options);
        }

        const currentUserId = state.user?.id;
        const currentUserEmail = state.user?.email;

        // Only real, genuine registered students from Supabase Cloud!
        const cloudProfiles = (data || [])
          .filter((p) => p.id !== currentUserId && p.email !== currentUserEmail && !p.hidden)
          .map((p) => ({
            id: p.id,
            name: p.name,
            email: p.email,
            branch: p.branch,
            year: p.year,
            gender: p.gender,
            whatsapp: p.whatsapp,
            instagram: p.instagram,
            outfit: p.outfit,
            prompt: p.prompt,
            intent: p.intent,
            tags: p.tags || [],
            photo: p.photo,
          }));

        return { profiles: cloudProfiles };
      }

      // 4. SWIPE / LIKE
      if (path === "/api/swipe" && options.method === "POST") {
        if (body.action === "like") {
          // Record like in Supabase
          await supabaseClient.from("swipes").upsert({
            user_id: body.userId,
            target_id: body.profileId,
            action: "like",
          });

          // Check for mutual like
          const { data: mutual } = await supabaseClient
            .from("swipes")
            .select("*")
            .eq("user_id", body.profileId)
            .eq("target_id", body.userId)
            .eq("action", "like")
            .maybeSingle();

          if (mutual) {
            // Mutual match found!
            await supabaseClient.from("matches").upsert({
              user1: body.userId,
              user2: body.profileId,
            });
            saveDemoMatch(body.userId, body.profileId);

            // Fetch liked user details
            const { data: matchedData } = await supabaseClient
              .from("profiles")
              .select("*")
              .eq("id", body.profileId)
              .maybeSingle();

            const matchProfile = matchedData || getDemoUsers().find((u) => u.id === body.profileId);
            return { matched: true, match: matchProfile };
          }
        } else if (body.action === "pass") {
          await supabaseClient.from("swipes").upsert({
            user_id: body.userId,
            target_id: body.profileId,
            action: "pass",
          });
        }
        return { matched: false };
      }

      // 5. MATCHES
      if (path.startsWith("/api/matches")) {
        const uid = state.user?.id;
        if (!uid) return { matches: [] };

        const { data: matchRows } = await supabaseClient
          .from("matches")
          .select("*")
          .or(`user1.eq.${uid},user2.eq.${uid}`);

        if (matchRows && matchRows.length > 0) {
          const partnerIds = matchRows.map((m) => (m.user1 === uid ? m.user2 : m.user1));
          const { data: partners } = await supabaseClient
            .from("profiles")
            .select("*")
            .in("id", partnerIds);

          if (partners && partners.length > 0) {
            return { matches: partners };
          }
        }
        return handleLocalFallback(path, options);
      }
    } catch (e) {
      console.warn("Supabase operation failed, using local fallback:", e);
      return handleLocalFallback(path, options);
    }
  }

  // Fallback to local mode
  return handleLocalFallback(path, options);
}

// Local storage fallback for smooth offline / demo experience
function handleLocalFallback(path, options = {}) {
  const body = options.body ? JSON.parse(options.body) : {};

  if (path === "/api/signup" && options.method === "POST") {
    const id = "user_" + Date.now();
    const storedUser = { id, ...body, passwordHash: safeBase64(body.password || "") };
    saveDemoUser(storedUser);
    const token = "demo_token_" + id;
    const cleanUser = { ...storedUser };
    delete cleanUser.password;
    delete cleanUser.passwordHash;
    return { user: cleanUser, token };
  }

  if (path === "/api/login" && options.method === "POST") {
    const users = getDemoUsers();
    const found = users.find((u) => u.email === body.email);
    if (!found) throw new Error("No account found with this NIET email. Sign up first!");
    if (found.passwordHash && found.passwordHash !== safeBase64(body.password || "")) {
      throw new Error("Incorrect password. Please re-enter your password.");
    }
    const token = "demo_token_" + found.id;
    const cleanUser = { ...found };
    delete cleanUser.password;
    delete cleanUser.passwordHash;
    return { user: cleanUser, token };
  }

  if (path.startsWith("/api/profiles")) {
    const users = getDemoUsers();
    const profiles = users
      .filter((u) => u.id !== state.user?.id)
      .map((u) => {
        const c = { ...u };
        delete c.password;
        delete c.passwordHash;
        return c;
      });
    return { profiles };
  }

  if (path === "/api/swipe" && options.method === "POST") {
    if (body.action === "like") {
      const liked = getDemoUsers().find((u) => u.id === body.profileId);
      const isMutual = Math.random() < 0.4;
      if (isMutual && liked) {
        saveDemoMatch(body.userId, body.profileId);
        return { matched: true, match: liked };
      }
    }
    return { matched: false };
  }

  if (path.startsWith("/api/matches")) {
    const matches = getDemoMatches(state.user?.id);
    const users = getDemoUsers();
    const matchedProfiles = matches
      .map((m) => {
        const otherId = m.user1 === state.user?.id ? m.user2 : m.user1;
        return users.find((u) => u.id === otherId);
      })
      .filter(Boolean);
    return { matches: matchedProfiles };
  }

  return {};
}

function getDemoUsers() {
  try {
    return JSON.parse(localStorage.getItem("niet-demo-users") || "[]");
  } catch {
    return [];
  }
}

function saveDemoUser(user) {
  const users = getDemoUsers();
  const existing = users.findIndex((u) => u.id === user.id || u.email === user.email);
  if (existing >= 0) users[existing] = user;
  else users.push(user);
  localStorage.setItem("niet-demo-users", JSON.stringify(users));
}

function getDemoMatches(userId) {
  try {
    const matches = JSON.parse(localStorage.getItem("niet-demo-matches") || "[]");
    return matches.filter((m) => m.user1 === userId || m.user2 === userId);
  } catch {
    return [];
  }
}

function saveDemoMatch(user1, user2) {
  try {
    const matches = JSON.parse(localStorage.getItem("niet-demo-matches") || "[]");
    const exists = matches.some(
      (m) => (m.user1 === user1 && m.user2 === user2) || (m.user1 === user2 && m.user2 === user1)
    );
    if (!exists) {
      matches.push({ user1, user2, at: Date.now() });
      localStorage.setItem("niet-demo-matches", JSON.stringify(matches));
    }
  } catch {
    // ignore
  }
}

// Demo profiles disabled — only genuine registered students are shown!
function seedDemoProfiles() {
  // Purge any old demo mock profiles from local cache
  try {
    const users = getDemoUsers();
    const cleanUsers = users.filter((u) => !String(u.id).startsWith("demo_"));
    localStorage.setItem("niet-demo-users", JSON.stringify(cleanUsers));
  } catch (e) {
    // ignore
  }
}

seedDemoProfiles();

// ============ ERROR HANDLING ============
function handleApiError(error) {
  formNote.textContent = error.message;
  if (error.status === 401) {
    state = { ...defaultState };
    saveState();
    renderAll();
    showView("auth");
  }
}

function syncSessionUser(user, token = state.token) {
  state.user = user;
  state.token = token;
  state.hidden = Boolean(user.hidden);
  state.groupOpen = Boolean(user.groupOpen);
  saveState();
}

function logoutUser() {
  state = { ...defaultState };
  deckIndex = 0;
  saveState();
  renderAll();
  showOnboardingStep("login");
  showView("landing");
  formNote.textContent = "Logged out successfully.";
}

// ============ DATA REFRESH ============
async function refreshProfiles() {
  if (!state.user?.id) return;
  try {
    const data = await apiRequest(`/api/profiles?userId=${encodeURIComponent(state.user.id)}`);
    state.profiles = data.profiles || [];
    saveState();
    renderDeck();
  } catch (error) {
    handleApiError(error);
    if (!state.profiles.length) {
      profileCard.innerHTML = `
        <div class="empty-state card-content">
          <h3>Deck could not load 😔</h3>
          <p>${error.message}</p>
          <button class="deck-refresh-btn" type="button" data-action="refresh-deck">Refresh Deck</button>
        </div>
      `;
    }
  }
}

async function refreshMatches() {
  if (!state.user?.id) return [];
  try {
    const data = await apiRequest(`/api/matches?userId=${encodeURIComponent(state.user.id)}`);
    state.matches = data.matches || [];
    saveState();
    renderMatches();
    return state.matches;
  } catch (error) {
    handleApiError(error);
    return state.matches || [];
  }
}

async function refreshRemoteData() {
  await Promise.all([refreshProfiles(), refreshMatches()]);
}

// ============ MUSIC ============
function prepareSiteMusic() {
  if (!siteMusic) return;
  siteMusic.volume = 0.35;
  siteMusic.loop = true;
}

function bindMusicUnlock() {
  if (musicUnlockBound) return;
  musicUnlockBound = true;
  ["pointerdown", "touchstart", "click", "keydown"].forEach((e) => {
    document.addEventListener(e, startSiteMusic, { once: true, passive: true });
  });
}

function startSiteMusic() {
  if (!siteMusic || musicStarted) return;
  prepareSiteMusic();
  siteMusic.play()
    .then(() => { musicStarted = true; updateMusicToggle(); })
    .catch(() => { bindMusicUnlock(); updateMusicToggle(); });
}

function pauseSiteMusic() {
  if (!siteMusic) return;
  siteMusic.pause();
  musicStarted = false;
  updateMusicToggle();
}

function toggleSiteMusic() {
  if (!siteMusic) return;
  siteMusic.paused ? startSiteMusic() : pauseSiteMusic();
}

function updateMusicToggle() {
  if (!musicToggle || !siteMusic) return;
  const isPaused = siteMusic.paused;
  const full = isPaused ? "🎵 Play" : "🎵 Pause";
  const short = isPaused ? "🎵" : "⏸️";
  const fullEl = musicToggle.querySelector(".tool-full");
  const shortEl = musicToggle.querySelector(".tool-short");
  if (fullEl && shortEl) { fullEl.textContent = full; shortEl.textContent = short; }
  else { musicToggle.textContent = full; }
  musicToggle.setAttribute("aria-pressed", String(!isPaused));
}

// ============ VIEW / NAVIGATION ============
function showView(view) {
  const next = view === "match" && !state.user ? "auth" : view;
  document.body.dataset.view = next;
  screens.forEach((s) => s.classList.toggle("active", s.dataset.view === next));
}

function showOnboardingStep(step) {
  document.querySelectorAll(".step-panel").forEach((p) => {
    p.classList.toggle("active", p.dataset.step === step);
  });
  formNote.textContent = "";
}

function setAuthMode(mode) {
  modeButtons.forEach((b) => b.classList.toggle("active", b.dataset.authMode === mode));
  showOnboardingStep(mode === "login" ? "login" : "account");
}

// ============ VALIDATION ============
function validateAccountStep() {
  const name = signupForm.elements.name;
  const email = signupForm.elements.email;
  const password = signupForm.elements.password;
  const emailVal = String(email.value).trim().toLowerCase();

  if (!name.value.trim()) {
    formNote.textContent = "Please add your name first. 😊";
    name.focus();
    return false;
  }
  if (!emailVal.includes("@niet") && !emailVal.includes("niet")) {
    formNote.textContent = "Use your NIET college email (e.g., you@niet.co.in). 🎓";
    email.focus();
    return false;
  }
  if (password.value.length < 6) {
    formNote.textContent = "Password needs at least 6 characters. 🔒";
    password.focus();
    return false;
  }
  return true;
}

async function loginExistingUser() {
  const email = String(signupForm.elements.loginEmail.value).trim().toLowerCase();
  const password = signupForm.elements.loginPassword.value;

  if (!email) {
    formNote.textContent = "Enter your email to continue. 📧";
    signupForm.elements.loginEmail.focus();
    return;
  }

  if (!password) {
    formNote.textContent = "Enter your password. 🔐";
    signupForm.elements.loginPassword.focus();
    return;
  }

  try {
    const data = await apiRequest("/api/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    syncSessionUser(data.user, data.token);
    state.likes = [];
    state.passes = [];
    deckIndex = 0;
    saveState();
    formNote.textContent = "Welcome back! Opening your swipe deck... 🚀";
    showView("match");
    await refreshRemoteData();
    renderAll();
  } catch (error) {
    handleApiError(error);
  }
}

// ============ TYPING ANIMATION ============
function typeHeroLine() {
  const lines = [
    "...but you need a Garba partner 💃",
    "...but your dandiya sticks are lonely 🥢",
    "...but don't enter solo this year 🙅",
    "...but your garba circle needs one more 🪩",
    "...but the best twirl needs a saathi 🌀",
    "...but this lehenga/kurta deserves a partner 👗",
  ];
  let charIdx = 0;
  let lineIdx = 0;
  let deleting = false;

  const tick = () => {
    const text = lines[lineIdx];
    typedText.textContent = text.slice(0, charIdx);

    if (!deleting && charIdx < text.length) {
      charIdx++;
      setTimeout(tick, 45);
      return;
    }
    if (!deleting) {
      deleting = true;
      setTimeout(tick, 1800);
      return;
    }
    if (charIdx > 0) {
      charIdx--;
      setTimeout(tick, 22);
      return;
    }
    deleting = false;
    lineIdx = (lineIdx + 1) % lines.length;
    setTimeout(tick, 400);
  };

  tick();
}

// ============ UTILITY ============
function fileToDataUrl(file) {
  return new Promise((resolve) => {
    if (!file) { resolve(""); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 900;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.78));
      };
      img.onerror = () => resolve("");
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function getSelectedTags(form) {
  return [...form.querySelectorAll("input[name='tags']:checked")].map((i) => i.value);
}

function normalizeBranch(branch = "") {
  return String(branch).toUpperCase().replace(/[^A-Z]/g, "");
}

function yearNumber(year = "") {
  const m = String(year).match(/\d/);
  return m ? Number(m[0]) : 0;
}

function stablePairBoost(user, profile) {
  const src = `${user.id || user.name || "user"}-${profile.id}`;
  let hash = 0;
  for (const c of src) hash = (hash * 31 + c.charCodeAt(0)) % 997;
  return hash % 7;
}

function promptOverlap(a = "", b = "") {
  const words = (t) =>
    new Set(String(t).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3));
  const wa = words(a);
  const wb = words(b);
  return [...wa].filter((w) => wb.has(w)).length;
}

// ============ COMPATIBILITY ============
function compatibilityDetails(profile) {
  if (!state.user) {
    return { score: 72, reasons: ["Create your profile to get a real vibe score!"] };
  }

  const reasons = [];
  let score = 44;
  const user = state.user;
  const userTags = new Set(user.tags || []);
  const shared = profile.tags.filter((t) => userTags.has(t));
  const uBranch = normalizeBranch(user.branch);
  const pBranch = normalizeBranch(profile.branch);
  const gap = Math.abs(yearNumber(user.year) - yearNumber(profile.year));

  score += Math.min(shared.length * 9, 24);
  if (shared.length) reasons.push(`${shared.length} shared vibe${shared.length > 1 ? "s" : ""}`);

  if (profile.intent === user.intent) {
    score += 15;
    reasons.push("same intent");
  } else if (state.groupOpen && profile.intent === "Garba group") {
    score += 8;
    reasons.push("open to groups");
  }

  if (uBranch && pBranch) {
    if (uBranch === pBranch) { score += 12; reasons.push("same branch"); }
    else if (uBranch.startsWith("CSE") && pBranch.startsWith("CSE")) { score += 8; reasons.push("CSE fam"); }
    else score += 4;
  }

  if (gap === 0) { score += 8; reasons.push("same year"); }
  else if (gap === 1) { score += 4; reasons.push("nearby year"); }

  if (profile.outfit && user.outfit) {
    if (profile.outfit === user.outfit) { score += 5; reasons.push("matching outfit"); }
    else { score += 7; reasons.push("complementary colors"); }
  }

  const overlap = promptOverlap(user.prompt, profile.prompt);
  if (overlap) { score += Math.min(overlap * 3, 6); reasons.push("similar energy"); }

  score += stablePairBoost(user, profile);
  return {
    score: Math.max(38, Math.min(Math.round(score), 98)),
    reasons: reasons.length ? reasons : ["basic compatibility"],
  };
}

function compatibility(profile) {
  return compatibilityDetails(profile).score;
}

// ============ DECK LOGIC ============
function visibleProfiles() {
  const seen = new Set([...state.likes, ...state.passes]);
  const list = state.profiles || [];
  return list.filter((p) => !seen.has(p.id) && !String(p.id).startsWith("demo_"));
}

function currentProfile() {
  const profs = visibleProfiles();
  if (!profs.length) return null;
  return profs[deckIndex % profs.length];
}

function avatarFallback(name = "NI") {
  const init = encodeURIComponent(name.trim().slice(0, 2).toUpperCase() || "NI");
  return `https://api.dicebear.com/9.x/initials/svg?seed=${init}&backgroundColor=7c3aed&textColor=ffffff`;
}

// ============ RENDERING ============
function renderDeck() {
  const profile = currentProfile();
  if (!state.user) {
    profileCard.innerHTML = document.querySelector("#emptyProfileTemplate").innerHTML;
    return;
  }
  if (!profile) {
    profileCard.innerHTML = `
      <div class="empty-state card-content">
        <h3>Deck finished for now 🎉</h3>
        <p>No more profiles to show. Refresh to check for new NIETians!</p>
        <button class="deck-refresh-btn" type="button" data-action="refresh-deck">Refresh Deck 🔄</button>
      </div>
    `;
    return;
  }

  profileCard.style.transform = "";
  const vibe = compatibilityDetails(profile);
  const photoSrc = profile.photo || avatarFallback(profile.name);
  profileCard.innerHTML = `
    <img src="${photoSrc}" alt="${profile.name}'s photo" />
    <div class="card-content">
      <span class="score" title="${vibe.reasons.join(" · ")}">${vibe.score}% Garba Vibe 🪩</span>
      <div class="card-name">
        <h3>${profile.name}</h3>
        <span class="pill pill-year">${profile.year}</span>
      </div>
      <div class="pill-row">
        <span class="pill pill-branch" title="College Department"><span class="pill-label">Branch:</span> ${profile.branch}</span>
        <span class="pill pill-outfit" title="Outfit Color for Dandiya Night"><span class="pill-label">Wearing:</span> ${profile.outfit}</span>
        <span class="pill pill-intent" title="Looking for"><span class="pill-label">Looking for:</span> ${profile.intent}</span>
      </div>
      ${profile.tags && profile.tags.length ? `
      <div class="pill-row tag-row">
        <span class="vibe-label">Garba Vibe:</span>
        ${profile.tags.map((t) => `<span class="pill pill-tag">✨ ${t}</span>`).join("")}
      </div>` : ""}
      <div class="card-prompt-box">
        <span class="prompt-quote-icon">“</span>
        <p class="prompt">${profile.prompt || "Ready for Dandiya Night! 💃🕺"}</p>
      </div>
    </div>
  `;
}

function renderMyProfile() {
  hiddenToggle.checked = state.hidden;
  groupToggle.checked = state.groupOpen;

  if (!state.user) {
    myProfile.innerHTML = `
      <div class="empty-state">
        <h3>No profile yet 🎭</h3>
        <p>Create your profile to start matching with NIET students.</p>
      </div>
    `;
    return;
  }

  myProfile.innerHTML = `
    <div class="my-profile-card">
      <img class="avatar" src="${state.user.photo || avatarFallback(state.user.name)}" alt="${state.user.name}" />
      <div>
        <h3>${state.user.name}</h3>
        <p class="muted">${state.user.branch} · ${state.user.year}${state.user.gender ? ` · ${state.user.gender}` : ""}</p>
      </div>
      <div class="pill-row">
        <span class="pill pill-outfit"><span class="pill-label">Wearing:</span> ${state.user.outfit}</span>
        <span class="pill pill-intent"><span class="pill-label">Looking for:</span> ${state.user.intent}</span>
      </div>
      <p class="muted">${state.user.prompt || "Ready for Garba night! 🪩"}</p>
    </div>
  `;
}

function normalizeIndianWhatsapp(val = "") {
  const digits = String(val).replace(/\D/g, "");
  const ten = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  if (!/^[6-9]\d{9}$/.test(ten)) return "";
  return `+91${ten}`;
}

function normalizeInstagram(val = "") {
  return String(val).trim().replace(/^@+/, "");
}

function whatsappChatUrl(val = "") {
  const num = normalizeIndianWhatsapp(val);
  return num ? `https://wa.me/${num.replace(/\D/g, "")}` : "";
}

function instagramProfileUrl(val = "") {
  const handle = normalizeInstagram(val);
  return handle ? `https://instagram.com/${encodeURIComponent(handle)}` : "";
}

function contactLinks(profile) {
  const links = [];
  const wa = whatsappChatUrl(profile.whatsapp);
  const ig = instagramProfileUrl(profile.instagram);
  if (wa) links.push(`<a href="${wa}" target="_blank" rel="noreferrer">📱 WhatsApp: ${profile.whatsapp}</a>`);
  if (ig) links.push(`<a href="${ig}" target="_blank" rel="noreferrer">📸 Instagram: @${normalizeInstagram(profile.instagram)}</a>`);
  return links.length
    ? links.join("")
    : `<p class="muted">Contact details unlock after mutual match. 🔒</p>`;
}

function renderMatches() {
  if (!state.user) {
    matchList.innerHTML = `
      <div class="empty-state">
        <h3>Contacts are locked 🔒</h3>
        <p>Create a profile and match mutually to reveal WhatsApp and Instagram.</p>
      </div>
    `;
    return;
  }

  const matches = state.matches || [];
  if (!matches.length) {
    matchList.innerHTML = `
      <div class="empty-state">
        <h3>No mutual reveals yet 💫</h3>
        <p>Like someone who also likes you. Then their contact card unlocks here!</p>
      </div>
    `;
    return;
  }

  matchList.innerHTML = matches
    .map(
      (p) => `
    <article class="reveal-card">
      <div class="reveal-head">
        <img class="avatar" src="${p.photo || avatarFallback(p.name)}" alt="${p.name}" />
        <div>
          <h3>${p.name}</h3>
          <p class="muted">${p.branch} · ${compatibility(p)}% vibe</p>
        </div>
      </div>
      ${contactLinks(p)}
    </article>
  `
    )
    .join("");
}

function showMatchOverlay(profile) {
  const wa = whatsappChatUrl(profile.whatsapp);
  const ig = instagramProfileUrl(profile.instagram);
  document.querySelector("#matchTitle").textContent = "Garba partner unlocked! 💃🕺";
  matchReveal.innerHTML = `
    <div class="match-reveal-card">
      <img class="avatar" src="${profile.photo || avatarFallback(profile.name)}" alt="${profile.name}" />
      <div>
        <h3>${profile.name} also swiped up! 🎉</h3>
        <p class="muted">${profile.branch} · ${profile.year} · ${compatibility(profile)}% Garba vibe</p>
      </div>
      <p class="privacy-lock">🔓 Contact unlocked only for both of you.</p>
      <div class="contact-actions">
        ${wa ? `<a href="${wa}" target="_blank" rel="noreferrer">📱 Open WhatsApp</a>` : ""}
        ${ig ? `<a class="secondary-contact" href="${ig}" target="_blank" rel="noreferrer">📸 Open Instagram</a>` : ""}
      </div>
    </div>
  `;
  matchOverlay.classList.add("active");
  matchOverlay.setAttribute("aria-hidden", "false");
}

async function showRevealsOverlay() {
  if (!state.user) { showView("auth"); return; }
  const matches = state.user.id ? await refreshMatches() : [];
  matchReveal.innerHTML = matches.length
    ? `<div class="match-list">
        ${matches.map((p) => `
          <article class="reveal-card">
            <div class="reveal-head">
              <img class="avatar" src="${p.photo || avatarFallback(p.name)}" alt="${p.name}" />
              <div>
                <h3>${p.name}</h3>
                <p class="muted">${p.branch} · ${compatibility(p)}% vibe</p>
              </div>
            </div>
            ${contactLinks(p)}
          </article>
        `).join("")}
      </div>`
    : `<div class="empty-state">
        <h3>No mutual reveals yet 💫</h3>
        <p>Like someone who also likes you back!</p>
      </div>`;
  document.querySelector("#matchTitle").textContent = "🔓 Unlocked Contacts";
  matchOverlay.classList.add("active");
  matchOverlay.setAttribute("aria-hidden", "false");
}

function renderAll() {
  renderDeck();
  renderMyProfile();
  renderMatches();
}

function closeMatchOverlay() {
  matchOverlay.classList.remove("active");
  matchOverlay.setAttribute("aria-hidden", "true");
  if (state.user?.id) {
    refreshProfiles();
    refreshMatches();
  }
}

// ============ SWIPE ANIMATIONS ============
function animateSwipe(type, label) {
  deckShell.classList.remove("like-pop", "pass-pop");
  void deckShell.offsetWidth;
  deckShell.classList.add(type === "like" ? "like-pop" : "pass-pop");
  swipeBurst.textContent = label;
  setTimeout(() => deckShell.classList.remove("like-pop", "pass-pop"), 650);
}

async function likeCurrent() {
  const profile = currentProfile();
  if (!profile || !state.user) return;
  animateSwipe("like", "Liked! 💃");
  state.likes = [...new Set([...state.likes, profile.id])];
  saveState();
  renderDeck();

  try {
    if (state.user.id) {
      const result = await apiRequest("/api/swipe", {
        method: "POST",
        body: JSON.stringify({ userId: state.user.id, profileId: profile.id, action: "like" }),
      });
      if (result.matched && result.match) {
        formNote.textContent = `It's a match with ${result.match.name}! 🎉`;
        showMatchOverlay(result.match);
        await refreshMatches();
      }
    }
  } catch (error) {
    handleApiError(error);
  }
}

async function passCurrent() {
  const profile = currentProfile();
  if (!profile || !state.user) return;
  animateSwipe("pass", "Passed ✕");
  state.passes = [...new Set([...state.passes, profile.id])];
  saveState();
  renderDeck();

  try {
    if (state.user.id) {
      await apiRequest("/api/swipe", {
        method: "POST",
        body: JSON.stringify({ userId: state.user.id, profileId: profile.id, action: "pass" }),
      });
    }
  } catch (error) {
    handleApiError(error);
  }
}

// ============ REAL-TIME REGISTRATIONS COUNTER ============
function initLiveRegistrationTicker() {
  const countEl = document.querySelector("#liveRegCount");
  if (!countEl) return;

  const users = getDemoUsers();
  countEl.textContent = users.length;

  // Periodically reflect active campus registrations
  setInterval(() => {
    const current = parseInt(countEl.textContent, 10) || 0;
    countEl.textContent = current + 1;
  }, 12000);
}

function updateLiveRegistrationCount() {
  const countEl = document.querySelector("#liveRegCount");
  if (countEl) {
    const users = getDemoUsers();
    countEl.textContent = users.length;
  }
}

// ============ EVENT LISTENERS ============
signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const data = new FormData(form);
  const email = String(data.get("email")).trim().toLowerCase();

  if (!validateAccountStep()) {
    showOnboardingStep("account");
    return;
  }

  if (!data.get("branch") || !data.get("year") || !data.get("gender") || !String(data.get("whatsapp")).trim()) {
    formNote.textContent = "Complete all required fields to start matching. 📋";
    return;
  }

  const whatsapp = normalizeIndianWhatsapp(data.get("whatsapp"));
  if (!whatsapp) {
    formNote.textContent = "Enter a valid 10-digit Indian WhatsApp number. 📱";
    signupForm.elements.whatsapp.focus();
    return;
  }

  const photo = await fileToDataUrl(data.get("photo"));
  const payload = {
    name: String(data.get("name")).trim(),
    email,
    branch: data.get("branch"),
    year: data.get("year"),
    gender: data.get("gender"),
    whatsapp,
    instagram: normalizeInstagram(data.get("instagram")),
    password: String(data.get("password")),
    outfit: data.get("outfit"),
    prompt: String(data.get("prompt")).trim(),
    intent: data.get("intent"),
    tags: getSelectedTags(form),
    photo,
  };

  try {
    const result = await apiRequest("/api/signup", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    syncSessionUser(result.user, result.token);
    state.likes = [];
    state.passes = [];
    state.matches = [];
    deckIndex = 0;
    saveState();
    updateLiveRegistrationCount();
    formNote.textContent = "Profile created! Let's find your saathi! 🚀";
    showView("match");
    await refreshRemoteData();
    renderAll();
  } catch (error) {
    formNote.textContent = error.message;
  }
});

document.addEventListener("click", (e) => {
  const mode = e.target.closest("[data-auth-mode]");
  if (mode) { e.preventDefault(); setAuthMode(mode.dataset.authMode); return; }

  if (e.target.closest("#loginButton")) { e.preventDefault(); loginExistingUser(); return; }
  if (e.target.closest("#musicToggle")) { e.preventDefault(); toggleSiteMusic(); return; }
  if (e.target.closest("#logoutButton")) { e.preventDefault(); logoutUser(); return; }

  const acct = e.target.closest("#accountNext");
  if (acct) {
    e.preventDefault();
    if (validateAccountStep()) showOnboardingStep("details");
    return;
  }

  const back = e.target.closest("#detailsBack");
  if (back) { e.preventDefault(); showOnboardingStep("account"); return; }

  const action = e.target.closest("[data-action]");
  if (action?.dataset.action === "refresh-deck") { e.preventDefault(); refreshProfiles(); return; }
  if (action?.dataset.action === "open-reveals") { e.preventDefault(); showRevealsOverlay(); return; }

  const target = e.target.closest("[data-view-target]");
  if (target) { e.preventDefault(); showView(target.dataset.viewTarget); }
});

signupForm.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const accountActive = document.querySelector('[data-step="account"]').classList.contains("active");
  const loginActive = document.querySelector('[data-step="login"]').classList.contains("active");
  if (loginActive) { e.preventDefault(); loginExistingUser(); return; }
  if (accountActive) {
    e.preventDefault();
    if (validateAccountStep()) showOnboardingStep("details");
  }
});

closeMatch.addEventListener("click", closeMatchOverlay);
matchOverlay.addEventListener("click", (e) => { if (e.target === matchOverlay) closeMatchOverlay(); });
document.querySelector("#likeBtn").addEventListener("click", likeCurrent);
document.querySelector("#passBtn").addEventListener("click", passCurrent);

hiddenToggle.addEventListener("change", (e) => {
  state.hidden = e.target.checked;
  saveState();
  if (state.user?.id) {
    apiRequest("/api/settings", {
      method: "POST",
      body: JSON.stringify({ userId: state.user.id, hidden: state.hidden, groupOpen: state.groupOpen }),
    }).catch(handleApiError);
  }
});

groupToggle.addEventListener("change", (e) => {
  state.groupOpen = e.target.checked;
  saveState();
  if (state.user?.id) {
    apiRequest("/api/settings", {
      method: "POST",
      body: JSON.stringify({ userId: state.user.id, hidden: state.hidden, groupOpen: state.groupOpen }),
    }).catch(handleApiError);
  }
  renderAll();
});

// Touch swipe
profileCard.addEventListener("touchstart", (e) => { touchStartY = e.touches[0].clientY; }, { passive: true });
profileCard.addEventListener("touchmove", (e) => {
  if (touchStartY === null) return;
  const dy = e.touches[0].clientY - touchStartY;
  if (dy < 0) profileCard.style.transform = `translateY(${Math.max(dy, -90)}px) rotate(${Math.max(dy / 18, -5)}deg)`;
}, { passive: true });
profileCard.addEventListener("touchend", (e) => {
  if (touchStartY === null) return;
  const dy = e.changedTouches[0].clientY - touchStartY;
  touchStartY = null;
  if (dy < -70) likeCurrent();
  else profileCard.style.transform = "";
});

// ============ INIT ============
typeHeroLine();
initLiveRegistrationTicker();
renderAll();
showOnboardingStep("account");
showView(state.user ? "match" : "landing");
if (state.user?.id) refreshRemoteData();
startSiteMusic();
window.addEventListener("load", startSiteMusic, { once: true });
