"use client";

import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Recipient = {
  email: string;
  name?: string;
};

type EmailRecord = {
  id: string;
  recipientEmail: string;
  recipientName?: string | null;
  subject: string;
  scheduledAt: string;
  status: string;
  sentAt?: string | null;
};

type Folder = "inbox" | "scheduled" | "sent" | "failed" | "outbox";

type AuthUser = {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  activeWorkspaceId: string;
  workspaces: Array<{
    id: string;
    name: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
  }>;
};

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const SENDER_ID = "863cb3a9-0a7e-4d12-a58e-3dd6f3a5f7db";

function parseRecipients(text: string): Recipient[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return [];

  const first = lines[0]
    .split(",")
    .map((value) => value.trim().toLowerCase());

  const hasHeader =
    first.includes("email") ||
    first.includes("email address") ||
    first.includes("name");

  const data = hasHeader ? lines.slice(1) : lines;

  const emailIndex = hasHeader
    ? Math.max(
        0,
        first.findIndex((value) => value.includes("email")),
      )
    : 0;

  const nameIndex = hasHeader
    ? first.findIndex(
        (value) => value === "name" || value === "full name",
      )
    : 1;

  return data
    .map((line) => {
      const columns = line
        .split(",")
        .map((value) => value.trim().replace(/^"|"$/g, ""));

      const email = columns[emailIndex] ?? "";
      const name =
        nameIndex >= 0 ? columns[nameIndex] || undefined : undefined;

      return { email, name };
    })
    .filter((recipient) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email),
    );
}

function formatDate(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function AssetIcon({
  src,
  alt,
  size = 18,
  fallback = "•",
}: {
  src: string;
  alt: string;
  size?: number;
  fallback?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span
        className="asset-fallback"
        style={{ width: size, height: size }}
        aria-label={alt}
      >
        {fallback}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      className="object-contain"
      onError={() => setFailed(true)}
    />
  );
}

function avatarStyle(seed: string) {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return { background: `hsl(${hash} 42% 38%)` };
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    SENT: "status-sent",
    QUEUED: "status-queued",
    SCHEDULED: "status-scheduled",
    PROCESSING: "status-processing",
    FAILED: "status-failed",
    CANCELLED: "status-cancelled",
  };

  return (
    <span className={`status-pill ${styles[status] ?? ""}`}>
      {status}
    </span>
  );
}

function AuthScreen({
  error,
}: {
  error?: string;
}) {
  function startGoogleLogin() {
    window.location.href = `${API_URL}/api/auth/google`;
  }

  return (
    <main className="auth-shell">
      <div className="desktop-wallpaper" />

      <section className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark">
            <img src="/icons/logo.svg" alt="ReachBox" />
          </div>
          <div>
            <strong>ReachBox</strong>
            <span>Email scheduling infrastructure</span>
          </div>
        </div>

        <div className="auth-content">
          <div className="auth-icon">
            <img src="/icons/mail.svg" alt="" />
          </div>

          <h1>Welcome to ReachBox</h1>
          <p>
            Sign in with your Google account to access your workspace,
            schedule campaigns, and manage delivery.
          </p>

          {error && (
            <div className="auth-error">
              {error}
            </div>
          )}

          <button
            type="button"
            className="google-login-button"
            onClick={startGoogleLogin}
          >
            <span className="google-glyph">G</span>
            <span>Continue with Google</span>
          </button>

          <div className="auth-security">
            <span className="online-dot" />
            Secure workspace session
          </div>
        </div>

        <div className="auth-footer">
          <span>ReachBox Scheduler</span>
          <span>Google OAuth</span>
        </div>
      </section>
    </main>
  );
}

export default function Home() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);

  const [folder, setFolder] = useState<Folder>("scheduled");
  const [emails, setEmails] = useState<EmailRecord[]>([]);
  const [selectedEmail, setSelectedEmail] =
    useState<EmailRecord | null>(null);

  const [composeOpen, setComposeOpen] = useState(false);
  const [search, setSearch] = useState("");

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipientText, setRecipientText] = useState("");
  const [startAt, setStartAt] = useState("");
  const [delaySeconds, setDelaySeconds] = useState("5");
  const [hourlyLimit, setHourlyLimit] = useState("100");

  const [loading, setLoading] = useState(false);
  const [loadingEmails, setLoadingEmails] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const recipients = useMemo(
    () => parseRecipients(recipientText),
    [recipientText],
  );

  const searchController = useRef<AbortController | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadSession() {
      try {
        const response = await fetch(`${API_URL}/api/auth/me`, {
          credentials: "include",
          cache: "no-store",
        });

        if (!mounted) {
          return;
        }

        if (response.status === 401) {
          setAuthUser(null);
          return;
        }

        if (!response.ok) {
          throw new Error("Failed to load session");
        }

        const user = (await response.json()) as AuthUser;
        setAuthUser(user);
      } catch (sessionError) {
        console.error("Authentication bootstrap failed:", sessionError);
        if (mounted) {
          setAuthUser(null);
        }
      } finally {
        if (mounted) {
          setAuthLoading(false);
        }
      }
    }

    void loadSession();

    return () => {
      mounted = false;
    };
  }, []);

  async function handleLogout() {
    try {
      await fetch(`${API_URL}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } finally {
      setProfileOpen(false);
      setAuthUser(null);
      setEmails([]);
      setSelectedEmail(null);
    }
  }

  async function loadEmails(query = search) {
    if (!authUser) {
      return;
    }

    searchController.current?.abort();

    const controller = new AbortController();
    searchController.current = controller;

    setLoadingEmails(true);

    try {
      const trimmedQuery = query.trim();

      const endpoint = trimmedQuery
        ? `${API_URL}/api/emails/search?q=${encodeURIComponent(
            trimmedQuery,
          )}&limit=100`
        : `${API_URL}/api/emails`;

      const response = await fetch(endpoint, {
        credentials: "include",
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error("Failed to load emails");
      }

      const data = (await response.json()) as EmailRecord[];
      setEmails(data);

      setError("");
    } catch (requestError) {
      if (
        requestError instanceof DOMException &&
        requestError.name === "AbortError"
      ) {
        return;
      }

      setError(
        "Unable to load mailbox data. Make sure the backend is running.",
      );
    } finally {
      if (!controller.signal.aborted) {
        setLoadingEmails(false);
      }
    }
  }

  useEffect(() => {
    if (!authUser) {
      return;
    }

    const timer = window.setTimeout(() => {
      void loadEmails(search);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [search, authUser?.activeWorkspaceId]);

  useEffect(() => {
    if (!authUser) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadEmails(search);
    }, 5000);

    return () => {
      window.clearInterval(interval);
      searchController.current?.abort();
    };
  }, [search, authUser?.activeWorkspaceId]);

  function handleFileUpload(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];

    if (!file) return;

    const reader = new FileReader();

    reader.onload = () => {
      setRecipientText(String(reader.result ?? ""));
      setError("");
    };

    reader.readAsText(file);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setSuccess("");

    if (!subject.trim()) {
      setError("Enter a subject.");
      return;
    }

    if (!body.trim()) {
      setError("Enter a message.");
      return;
    }

    if (!recipients.length) {
      setError("Add at least one valid recipient.");
      return;
    }

    if (!startAt) {
      setError("Choose a start time.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/batches`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          senderId: SENDER_ID,
          name: subject.trim(),
          subject: subject.trim(),
          body: body.trim(),
          startAt: new Date(startAt).toISOString(),
          delayMs: Number(delaySeconds) * 1000,
          hourlyLimit: Number(hourlyLimit),
          recipients,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error ?? "Failed to schedule campaign",
        );
      }

      setSuccess(
        `${recipients.length} email${
          recipients.length === 1 ? "" : "s"
        } scheduled successfully.`,
      );

      setSubject("");
      setBody("");
      setRecipientText("");

      await loadEmails();

      window.setTimeout(() => {
        setComposeOpen(false);
        setSuccess("");
      }, 1800);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Something went wrong.",
      );
    } finally {
      setLoading(false);
    }
  }

  const counts = useMemo(
    () => ({
      scheduled: emails.filter((email) =>
        ["SCHEDULED", "QUEUED", "PROCESSING"].includes(
          email.status,
        ),
      ).length,
      sent: emails.filter((email) => email.status === "SENT")
        .length,
      failed: emails.filter((email) => email.status === "FAILED")
        .length,
      outbox: emails.filter((email) =>
        ["SCHEDULED", "QUEUED"].includes(email.status),
      ).length,
    }),
    [emails],
  );

  const filteredEmails = useMemo(() => {
    let result = emails;

    if (folder === "scheduled") {
      result = result.filter((email) =>
        ["SCHEDULED", "QUEUED", "PROCESSING"].includes(
          email.status,
        ),
      );
    }

    if (folder === "sent") {
      result = result.filter((email) => email.status === "SENT");
    }

    if (folder === "failed") {
      result = result.filter((email) => email.status === "FAILED");
    }

    return result;
  }, [emails, folder]);

  const folderTitle: Record<Folder, string> = {
    inbox: "Inbox",
    scheduled: "Scheduled",
    sent: "Sent",
    failed: "Failed",
    outbox: "Outbox",
  };

  const folderDescription: Record<Folder, string> = {
    inbox: "Incoming messages",
    scheduled: "Upcoming email jobs",
    sent: "Successfully submitted emails",
    failed: "Jobs requiring attention",
    outbox: "Queue and delivery pipeline",
  };

  if (authLoading) {
    return <AuthScreen />;
  }

  if (!authUser) {
    const params =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search)
        : null;

    const authError =
      params?.get("authError") === "google_denied"
        ? "Google sign-in was cancelled."
        : params?.get("authError") === "google_failed"
          ? "Google sign-in could not be completed. Please try again."
          : undefined;

    return <AuthScreen error={authError} />;
  }

  const activeWorkspace =
    authUser.workspaces.find(
      (workspace) => workspace.id === authUser.activeWorkspaceId,
    ) ?? authUser.workspaces[0];

  const avatarInitial =
    authUser.name.trim().charAt(0).toUpperCase() || "U";

  return (
    <main className="reachbox-shell">
      <div className="desktop-wallpaper" />

      <div className="reachbox-window">
        {/* ---------- title bar ---------- */}
        <header className="titlebar">
          <div className="titlebar-brand">
            <div className="brand-mark">
              <img
                src="/icons/logo.svg"
                alt="ReachBox"
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                  event.currentTarget.parentElement?.classList.add(
                    "brand-fallback",
                  );
                }}
              />
              <span>R</span>
            </div>
            <span className="brand-name">ReachBox</span>
          </div>

          <div className="search-container">
            <AssetIcon src="/icons/search.svg" alt="Search" size={16} fallback="⌕" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search mail, recipients, subjects..."
            />
            <span className="search-shortcut">/</span>
          </div>

          <div className="top-actions">
            <div className="connection-status">
              <span className="online-dot" />
              Online
            </div>

            <button className="notification-button" title="Notifications">
              <AssetIcon src="/icons/notifications.svg" alt="Notifications" size={18} fallback="N" />
            </button>

            <div className="profile-anchor">
              <button
                type="button"
                className="top-avatar"
                title={authUser.email}
                onClick={() => setProfileOpen((open) => !open)}
              >
                {authUser.avatarUrl ? (
                  <img
                    src={authUser.avatarUrl}
                    alt={authUser.name}
                    className="top-avatar-image"
                  />
                ) : (
                  avatarInitial
                )}
              </button>

              {profileOpen && (
                <div className="profile-menu">
                  <div className="profile-menu-header">
                    <div className="profile-menu-avatar">
                      {authUser.avatarUrl ? (
                        <img
                          src={authUser.avatarUrl}
                          alt={authUser.name}
                        />
                      ) : (
                        avatarInitial
                      )}
                    </div>

                    <div className="profile-menu-identity">
                      <strong>{authUser.name}</strong>
                      <span>{authUser.email}</span>
                    </div>
                  </div>

                  <div className="profile-menu-divider" />

                  <div className="profile-menu-workspace">
                    <span>Workspace</span>
                    <strong>
                      {activeWorkspace?.name ?? "Workspace"}
                    </strong>
                  </div>

                  <button
                    type="button"
                    className="profile-menu-action slack-connect"
                    onClick={() => {
                      window.location.href =
                        `${API_URL}/api/slack/connect`;
                    }}
                  >
                    <span>Connect Slack</span>
                    <small>Notifications</small>
                  </button>

                  <button
                    type="button"
                    className="profile-menu-action logout-action"
                    onClick={() => void handleLogout()}
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="app-body">
          {/* ---------- app rail ---------- */}
          <aside className="app-rail">
            <div className="rail-actions">
              <button className="rail-button rail-active" title="Mail">
                <AssetIcon src="/icons/mail.svg" alt="Mail" size={22} fallback="M" />
              </button>
              <button className="rail-button" title="Calendar">
                <AssetIcon src="/icons/calendar.svg" alt="Calendar" size={22} fallback="C" />
              </button>
              <button className="rail-button" title="Contacts">
                <AssetIcon src="/icons/contacts.svg" alt="Contacts" size={22} fallback="P" />
              </button>
              <button className="rail-button" title="Analytics">
                <AssetIcon src="/icons/analytics.svg" alt="Analytics" size={22} fallback="A" />
              </button>
            </div>

            <button className="rail-button" title="Settings">
              <AssetIcon src="/icons/settings.svg" alt="Settings" size={22} fallback="S" />
            </button>
          </aside>

          <div className="app-main">
            {/* ---------- ribbon ---------- */}
            <div className="ribbon">
              <button className="ribbon-primary" onClick={() => setComposeOpen(true)}>
                <AssetIcon src="/icons/compose.svg" alt="" size={17} fallback="+" />
                New message
              </button>

              <span className="ribbon-divider" />

              <button className="ribbon-button" onClick={() => void loadEmails()}>
                <AssetIcon src="/icons/refresh.svg" alt="" size={17} fallback="↻" />
                Refresh
              </button>
            </div>

            <div className="app-panels">
              {/* ---------- folders ---------- */}
              <aside className="folder-sidebar">
                <div className="account-row">
                  <span className="account-status-dot" />
                  <span>{activeWorkspace?.name ?? "Workspace"}</span>
                </div>

                <nav className="folder-list">
            <button
              onClick={() => setFolder("inbox")}
              className={`folder-item ${folder === "inbox" ? "folder-selected" : ""}`}
            >
              <AssetIcon src="/icons/inbox.svg" alt="" fallback="I" />
              <span>Inbox</span>
            </button>
            <button
              onClick={() => setFolder("scheduled")}
              className={`folder-item ${folder === "scheduled" ? "folder-selected" : ""}`}
            >
              <AssetIcon src="/icons/scheduled.svg" alt="" fallback="S" />
              <span>Scheduled</span>
              {counts.scheduled > 0 && (
                <span className="folder-count">{counts.scheduled}</span>
              )}
            </button>
            <button
              onClick={() => setFolder("sent")}
              className={`folder-item ${folder === "sent" ? "folder-selected" : ""}`}
            >
              <AssetIcon src="/icons/sent.svg" alt="" fallback="✓" />
              <span>Sent</span>
              {counts.sent > 0 && (
                <span className="folder-muted-count">{counts.sent}</span>
              )}
            </button>
            <button
              onClick={() => setFolder("failed")}
              className={`folder-item ${folder === "failed" ? "folder-selected" : ""}`}
            >
              <AssetIcon src="/icons/failed.svg" alt="" fallback="!" />
              <span>Failed</span>
              {counts.failed > 0 && (
                <span className="failed-count">{counts.failed}</span>
              )}
            </button>
            <button
              onClick={() => setFolder("outbox")}
              className={`folder-item ${folder === "outbox" ? "folder-selected" : ""}`}
            >
              <AssetIcon src="/icons/outbox.svg" alt="" fallback="O" />
              <span>Outbox</span>
              {counts.outbox > 0 && (
                <span className="folder-muted-count">{counts.outbox}</span>
              )}
            </button>
                </nav>

                <div className="sidebar-spacer" />

                <div className="scheduler-card">
                  <div className="scheduler-card-title">
                    <span className="online-dot" />
                    Scheduler online
                  </div>
                  <div className="scheduler-card-text">
                    Redis and BullMQ worker connected
                  </div>
                  <div className="scheduler-card-metrics">
                    <div>
                      <strong>{counts.scheduled}</strong>
                      <span>queued</span>
                    </div>
                    <div>
                      <strong>{counts.sent}</strong>
                      <span>sent</span>
                    </div>
                    <div>
                      <strong>{counts.failed}</strong>
                      <span>failed</span>
                    </div>
                  </div>
                </div>
              </aside>

              {/* ---------- message list ---------- */}
              <section className="message-list">
                <div className="message-list-header">
                  <h1 title={folderDescription[folder]}>{folderTitle[folder]}</h1>
                  <div className="list-header-actions">
                    {filteredEmails.length}{" "}
                    {filteredEmails.length === 1 ? "message" : "messages"} · Newest first
                  </div>
                </div>

                {loadingEmails && emails.length === 0 ? (
                  <div className="empty-mail">
                    <div className="empty-icon">R</div>
                    <strong>Loading mailbox</strong>
                    <span>Fetching scheduler state...</span>
                  </div>
                ) : filteredEmails.length === 0 ? (
                  <div className="empty-mail">
                    <div className="empty-icon">
                      <AssetIcon src="/icons/mail.svg" alt="" size={26} fallback="M" />
                    </div>
                    <strong>No messages here</strong>
                    <span>
                      Schedule a campaign and its delivery jobs will appear here.
                    </span>
                    <button onClick={() => setComposeOpen(true)} className="empty-action">
                      Create campaign
                    </button>
                  </div>
                ) : (
                  filteredEmails.map((email) => {
                    const label = email.recipientName || email.recipientEmail;
                    return (
                      <button
                        key={email.id}
                        onClick={() => setSelectedEmail(email)}
                        className={`message-row ${
                          selectedEmail?.id === email.id ? "message-selected" : ""
                        }`}
                      >
                        <div className="sender-avatar" style={avatarStyle(label)}>
                          {label.charAt(0).toUpperCase()}
                        </div>

                        <div className="message-content">
                          <div className="message-main-line">
                            <strong>{label}</strong>
                            <time>{formatTime(email.scheduledAt)}</time>
                          </div>
                          <div className="message-subject">{email.subject}</div>
                          <div className="message-meta">
                            <span>{email.recipientEmail}</span>
                            <StatusPill status={email.status} />
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </section>

              {/* ---------- reading pane (wallpaper shows when empty) ---------- */}
            {selectedEmail && (
              <div className="reading-pane">
                <div className="reading-toolbar">
                  <span>Email details</span>

                  <button
                    onClick={() => setSelectedEmail(null)}
                    className="reading-close"
                  >
                    ×
                  </button>
                </div>

                <div className="reading-content">
                  <div className="reading-header">
                    <div
                      className="sender-avatar large"
                      style={avatarStyle(
                        selectedEmail.recipientName ||
                          selectedEmail.recipientEmail,
                      )}
                    >
                      {(
                        selectedEmail.recipientName ||
                        selectedEmail.recipientEmail
                      )
                        .charAt(0)
                        .toUpperCase()}
                    </div>

                    <div>
                      <h2>{selectedEmail.subject}</h2>
                      <p>
                        To: {selectedEmail.recipientEmail}
                      </p>
                    </div>

                    <StatusPill
                      status={selectedEmail.status}
                    />
                  </div>

                  <div className="reading-divider" />

                  <div className="detail-grid">
                    <div>
                      <span>Scheduled</span>
                      <strong>
                        {formatDate(selectedEmail.scheduledAt)}
                      </strong>
                    </div>

                    <div>
                      <span>Delivery</span>
                      <strong>
                        {selectedEmail.sentAt
                          ? formatDate(selectedEmail.sentAt)
                          : "Pending"}
                      </strong>
                    </div>
                  </div>

                  <div className="delivery-card">
                    <div className="delivery-title">
                      Delivery pipeline
                    </div>

                    <div className="delivery-step completed">
                      <span>1</span>
                      <div>
                        <strong>PostgreSQL</strong>
                        <small>Persistent email state</small>
                      </div>
                      <b>Done</b>
                    </div>

                    <div className="delivery-line" />

                    <div className="delivery-step completed">
                      <span>2</span>
                      <div>
                        <strong>BullMQ</strong>
                        <small>Durable delayed job</small>
                      </div>
                      <b>Done</b>
                    </div>

                    <div className="delivery-line" />

                    <div
                      className={`delivery-step ${
                        selectedEmail.status === "SENT"
                          ? "completed"
                          : "active"
                      }`}
                    >
                      <span>3</span>
                      <div>
                        <strong>SMTP</strong>
                        <small>Ethereal delivery</small>
                      </div>
                      <b>
                        {selectedEmail.status === "SENT"
                          ? "Sent"
                          : "Waiting"}
                      </b>
                    </div>
                  </div>

                  <div className="preview-placeholder">
                    <div className="preview-placeholder-title">
                      Email preview
                    </div>

                    <div className="preview-placeholder-box">
                      <div className="preview-line wide" />
                      <div className="preview-line" />
                      <div className="preview-line short" />
                      <div className="preview-space" />
                      <div className="preview-line wide" />
                      <div className="preview-line" />
                    </div>
                  </div>
                </div>
              </div>
            )}
            </div>
          </div>
        </div>
      </div>

      {composeOpen && (
        <div className="compose-overlay">
          <div className="compose-window">
            <div className="compose-titlebar">
              <div>
                <strong>New message</strong>
                <span>ReachBox Scheduler</span>
              </div>

              <div className="compose-window-actions">
                <button>—</button>
                <button>□</button>
                <button
                  onClick={() => setComposeOpen(false)}
                >
                  ×
                </button>
              </div>
            </div>

            <form
              onSubmit={handleSubmit}
              className="compose-form"
            >
              <div className="compose-scroll">
                <div className="compose-field">
                  <label>To</label>

                  <div className="recipient-input">
                    <textarea
                      value={recipientText}
                      onChange={(event) =>
                        setRecipientText(event.target.value)
                      }
                      placeholder="Paste recipients or upload a CSV..."
                      rows={3}
                    />

                    <label className="upload-button">
                      <AssetIcon
                        src="/icons/upload.svg"
                        alt=""
                        size={15}
                        fallback="↑"
                      />
                      Upload CSV
                      <input
                        type="file"
                        accept=".csv,.txt"
                        onChange={handleFileUpload}
                        hidden
                      />
                    </label>

                    <span className="recipient-count">
                      {recipients.length} valid recipient
                      {recipients.length === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>

                <div className="compose-field">
                  <label>Subject</label>

                  <input
                    value={subject}
                    onChange={(event) =>
                      setSubject(event.target.value)
                    }
                    placeholder="Subject"
                  />
                </div>

                <textarea
                  className="compose-message"
                  value={body}
                  onChange={(event) =>
                    setBody(event.target.value)
                  }
                  placeholder="Write your message..."
                />

                <div className="schedule-panel">
                  <div className="schedule-heading">
                    <div>
                      <strong>Schedule delivery</strong>
                      <span>
                        Configure how the worker sends this
                        campaign.
                      </span>
                    </div>

                    <span className="schedule-badge">
                      BullMQ
                    </span>
                  </div>

                  <div className="schedule-grid">
                    <div>
                      <label>Start time</label>
                      <input
                        type="datetime-local"
                        value={startAt}
                        onChange={(event) =>
                          setStartAt(event.target.value)
                        }
                      />
                    </div>

                    <div>
                      <label>Minimum delay</label>
                      <div className="input-with-unit">
                        <input
                          type="number"
                          min="0"
                          value={delaySeconds}
                          onChange={(event) =>
                            setDelaySeconds(
                              event.target.value,
                            )
                          }
                        />
                        <span>sec</span>
                      </div>
                    </div>

                    <div>
                      <label>Hourly limit</label>
                      <div className="input-with-unit">
                        <input
                          type="number"
                          min="1"
                          value={hourlyLimit}
                          onChange={(event) =>
                            setHourlyLimit(
                              event.target.value,
                            )
                          }
                        />
                        <span>/ hour</span>
                      </div>
                    </div>
                  </div>
                </div>

                {error && (
                  <div className="form-error">{error}</div>
                )}

                {success && (
                  <div className="form-success">{success}</div>
                )}
              </div>

              <div className="compose-footer">
                <div className="compose-footer-info">
                  <span className="online-dot" />
                  SMTP ready
                </div>

                <div className="compose-footer-actions">
                  <button
                    type="button"
                    onClick={() => setComposeOpen(false)}
                    className="cancel-button"
                  >
                    Discard
                  </button>

                  <button
                    type="submit"
                    disabled={loading}
                    className="send-button"
                  >
                    {loading
                      ? "Scheduling..."
                      : `Schedule${
                          recipients.length
                            ? ` · ${recipients.length}`
                            : ""
                        }`}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}