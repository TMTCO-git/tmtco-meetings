(() => {
  "use strict";

  const el = (id) => document.getElementById(id);

  const lobby = el("lobby");
  const callScreen = el("callScreen");
  const rtkMeeting = el("rtkMeeting");
  const statusLine = el("statusLine");
  const nameInput = el("displayName");
  const avatarInitial = el("avatarInitial");
  const newMeetingBtn = el("newMeetingBtn");
  const joinForm = el("joinForm");
  const joinCodeInput = el("joinCode");
  const recentsSection = el("recentsSection");
  const recentsList = el("recentsList");
  const clockEl = el("clock");
  const callTitleEl = el("callTitle");
  const copyLinkBtn = el("copyLinkBtn");

  const RECENTS_KEY = "meet.recents";
  const NAME_KEY = "meet.displayName";
  const MAX_RECENTS = 6;

  // ---------- small utilities ----------

  function setStatus(message, isError = false) {
    statusLine.textContent = message || "";
    statusLine.dataset.error = isError ? "true" : "false";
  }

  function setBusy(busy) {
    newMeetingBtn.disabled = busy;
    joinForm.querySelector(".join-go").disabled = busy;
  }

  function extractMeetingId(raw) {
    const value = (raw || "").trim();
    if (!value) return null;
    try {
      const url = new URL(value);
      const fromQuery = url.searchParams.get("m");
      if (fromQuery) return fromQuery;
    } catch {
      // not a URL — fall through, treat as a bare code
    }
    return value.replace(/[^a-zA-Z0-9-]/g, "");
  }

  function inviteLinkFor(meetingId) {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("m", meetingId);
    return url.toString();
  }

  function tickClock() {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // ---------- recents (client-side convenience only) ----------

  function loadRecents() {
    try {
      return JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function saveRecent(meetingId) {
    const recents = loadRecents().filter((r) => r.id !== meetingId);
    recents.unshift({ id: meetingId, at: Date.now() });
    localStorage.setItem(
      RECENTS_KEY,
      JSON.stringify(recents.slice(0, MAX_RECENTS))
    );
  }

  function renderRecents() {
    const recents = loadRecents();
    recentsList.innerHTML = "";
    if (!recents.length) {
      recentsSection.hidden = true;
      return;
    }
    recentsSection.hidden = false;
    for (const r of recents) {
      const li = document.createElement("li");
      const when = new Date(r.at).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      li.innerHTML = `
        <span class="recent-meta">
          <span class="recent-title">${when}</span>
          <span class="recent-code">${r.id}</span>
        </span>
      `;
      const rejoinBtn = document.createElement("button");
      rejoinBtn.textContent = "Rejoin";
      rejoinBtn.addEventListener("click", () => joinMeeting(r.id, false));
      li.appendChild(rejoinBtn);
      recentsList.appendChild(li);
    }
  }

  // ---------- name persistence ----------

  function currentName() {
    return (nameInput.value || "").trim() || "Guest";
  }

  function refreshAvatar() {
    const name = currentName();
    avatarInitial.textContent = name.charAt(0).toUpperCase();
  }

  nameInput.value = localStorage.getItem(NAME_KEY) || "";
  refreshAvatar();
  nameInput.addEventListener("input", () => {
    localStorage.setItem(NAME_KEY, nameInput.value);
    refreshAvatar();
  });

  // ---------- API calls ----------

  async function apiCreateMeeting(title) {
    const res = await fetch("/api/meetings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not create the meeting.");
    return data.meetingId;
  }

  async function apiJoin(meetingId, name, isHost) {
    const res = await fetch(`/api/meetings/${meetingId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, isHost }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not join the meeting.");
    return data.authToken;
  }

  // ---------- meeting lifecycle ----------

  async function joinMeeting(meetingId, isHost) {
    setBusy(true);
    setStatus(isHost ? "Creating your meeting…" : "Joining meeting…");

    try {
      const authToken = await apiJoin(meetingId, currentName(), isHost);

      const meeting = await RealtimeKitClient.init({
        authToken,
        defaults: { audio: false, video: false },
      });

      rtkMeeting.meeting = meeting;
      meeting.self.on("roomLeft", () => showLobby());

      saveRecent(meetingId);
      renderRecents();

      const url = new URL(window.location.href);
      url.search = "";
      url.searchParams.set("m", meetingId);
      window.history.pushState({}, "", url);

      callTitleEl.textContent = `Meeting · ${meetingId.slice(0, 8)}`;
      showCall();
      setStatus("");
    } catch (err) {
      console.error(err);
      setStatus(err.message || "Something went wrong.", true);
    } finally {
      setBusy(false);
    }
  }

  async function startNewMeeting() {
    setBusy(true);
    setStatus("Setting up a new meeting…");
    try {
      const meetingId = await apiCreateMeeting(`${currentName()}'s meeting`);
      await joinMeeting(meetingId, true);
    } catch (err) {
      console.error(err);
      setStatus(err.message || "Could not start the meeting.", true);
      setBusy(false);
    }
  }

  function showCall() {
    lobby.hidden = true;
    callScreen.hidden = false;
  }

  function showLobby() {
    callScreen.hidden = true;
    lobby.hidden = false;
    rtkMeeting.meeting = undefined;
    const url = new URL(window.location.href);
    url.search = "";
    window.history.pushState({}, "", url);
  }

  // ---------- wire up UI ----------

  newMeetingBtn.addEventListener("click", startNewMeeting);

  joinForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const meetingId = extractMeetingId(joinCodeInput.value);
    if (!meetingId) {
      setStatus("Enter a meeting code or link first.", true);
      return;
    }
    joinMeeting(meetingId, false);
  });

  copyLinkBtn.addEventListener("click", async () => {
    const params = new URL(window.location.href).searchParams;
    const meetingId = params.get("m");
    if (!meetingId) return;
    try {
      await navigator.clipboard.writeText(inviteLinkFor(meetingId));
      copyLinkBtn.textContent = "Copied!";
      setTimeout(() => (copyLinkBtn.textContent = "Copy invite link"), 1500);
    } catch {
      setStatus("Couldn't copy — copy the URL from your address bar instead.", true);
    }
  });

  // ---------- boot ----------

  tickClock();
  setInterval(tickClock, 1000 * 30);
  renderRecents();

  const incomingId = new URL(window.location.href).searchParams.get("m");
  if (incomingId) {
    joinCodeInput.value = incomingId;
    setStatus("You have a meeting link ready — add your name and hit Join.");
  }
})();
