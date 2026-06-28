"use client";

import { useEffect, useMemo, useState, useRef } from "react";

type KeyValue = { key: string; value: string; enabled?: boolean };
type AuthType = "none" | "bearer" | "basic";
type AuthData = { type: AuthType; token?: string; username?: string; password?: string };

interface Tab {
  id: string;
  name: string;
  method: string;
  url: string;
  headers: KeyValue[];
  query: KeyValue[];
  body: string;
  bodyType: string;
  auth: AuthData;
  response: ResponseData | null;
  statusMessage: string;
  isDirty: boolean;
  savedRequestId?: number;
}

type Collection = { id: number; name: string };
type SavedRequest = {
  id: number;
  collection_id: number | null;
  name: string;
  method: string;
  url: string;
  headers: KeyValue[];
  query: KeyValue[];
  body: string | null;
  body_type: string | null;
  auth: AuthData;
};

type Environment = { id: number; name: string; variables: Record<string, string> };
type HistoryEntry = { id: number; request_data: any; response_data: any; created_at: string };
type ResponseData = {
  status_code: number;
  headers: Record<string, string>;
  body: any;
  duration_ms: number;
  size_bytes: number;
  is_error?: boolean;
};

interface Toast {
  id: string;
  message: string;
  type: "success" | "error" | "info";
}

const EMPTY_TAB_STATE = {
  method: "GET",
  url: "https://jsonplaceholder.typicode.com/posts/1",
  headers: [{ key: "Accept", value: "application/json", enabled: true }],
  query: [{ key: "", value: "", enabled: true }],
  body: "",
  bodyType: "none",
  auth: { type: "none" as AuthType },
  response: null,
  statusMessage: "",
  isDirty: false,
};

function normalizePairs(pairs: KeyValue[]): KeyValue[] {
  const result = pairs.map(p => ({ ...p, enabled: p.enabled ?? true }));
  if (result.length === 0 || result[result.length - 1].key || result[result.length - 1].value) {
    result.push({ key: "", value: "", enabled: true });
  }
  return result;
}

function parseQueryParams(urlStr: string): KeyValue[] {
  const qIndex = urlStr.indexOf('?');
  if (qIndex === -1) return [{ key: "", value: "", enabled: true }];
  const queryString = urlStr.substring(qIndex + 1);
  if (!queryString) return [{ key: "", value: "", enabled: true }];
  const pairs = queryString.split('&');
  const result = pairs.map(p => {
    const eqIndex = p.indexOf('=');
    if (eqIndex === -1) {
      return { key: decodeURIComponent(p), value: "", enabled: true };
    }
    return {
      key: decodeURIComponent(p.substring(0, eqIndex)),
      value: decodeURIComponent(p.substring(eqIndex + 1)),
      enabled: true
    };
  });
  return result.length ? result : [{ key: "", value: "", enabled: true }];
}

function buildUrlWithParams(baseUrlStr: string, queryParams: KeyValue[]): string {
  const qIndex = baseUrlStr.indexOf('?');
  const cleanBase = qIndex === -1 ? baseUrlStr : baseUrlStr.substring(0, qIndex);
  const activeParams = queryParams.filter(p => p.enabled !== false && p.key);
  if (activeParams.length === 0) return cleanBase;
  const queryString = activeParams.map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&');
  return queryString ? `${cleanBase}?${queryString}` : cleanBase;
}

function formatJson(value: unknown) {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

function highlightJson(jsonStr: string): string {
  if (!jsonStr) return "";
  let html = jsonStr
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  
  const jsonRegex = /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g;
  
  return html.replace(jsonRegex, (match) => {
    let cls = "json-number";
    if (/^"/.test(match)) {
      if (/:$/.test(match)) {
        cls = "json-key";
        return `<span class="${cls}">${match.replace(/:$/, "")}</span>:`;
      } else {
        cls = "json-string";
      }
    } else if (/true|false/.test(match)) {
      cls = "json-boolean";
    } else if (/null/.test(match)) {
      cls = "json-null";
    }
    return `<span class="${cls}">${match}</span>`;
  });
}

export default function Home() {
  // Sidebar resizing
  const [sidebarWidth, setSidebarWidth] = useState(260);
  // Panel resizing
  const [requestPanelHeight, setRequestPanelHeight] = useState(360);

  // Collections, environments, history
  const [collections, setCollections] = useState<Collection[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [historyItems, setHistoryItems] = useState<HistoryEntry[]>([]);
  
  // Left Sidebar state
  const [sidebarTab, setSidebarTab] = useState<"collections" | "environments" | "history" | "mocks" | "monitors" | "docs">("collections");
  const [searchQuery, setSearchQuery] = useState("");
  
  // Selected Sidebar active item
  const [activeCollectionId, setActiveCollectionId] = useState<number | null>(null);
  const [savedRequests, setSavedRequests] = useState<SavedRequest[]>([]);
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<number | null>(null);

  // Theme support
  const [isDarkMode, setIsDarkMode] = useState(true);

  // Tabs management
  const [tabs, setTabs] = useState<Tab[]>([
    { ...EMPTY_TAB_STATE, id: "initial-tab", name: "GET: JSONPlaceholder" }
  ]);
  const [activeTabId, setActiveTabId] = useState<string>("initial-tab");

  // Response tabs
  const [responseTab, setResponseTab] = useState<"body" | "headers">("body");
  const [responseBodyMode, setResponseBodyMode] = useState<"pretty" | "raw" | "preview">("pretty");
  const [responseSearchQuery, setResponseSearchQuery] = useState("");

  // Request sub-tabs
  const [requestSubTab, setRequestSubTab] = useState<"params" | "headers" | "body" | "auth">("params");

  // Code snippet side panel
  const [codeSnippetLang, setCodeSnippetLang] = useState<"curl" | "fetch" | "python" | "node">("curl");
  const [showCodeSnippet, setShowCodeSnippet] = useState(false);

  // Custom Toast System
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Modals state
  const [modalType, setModalType] = useState<"create_collection" | "rename_collection" | "edit_env" | "save_as" | "import" | "manage_cookies" | null>(null);
  const [modalInputName, setModalInputName] = useState("");

  interface CookieItem {
    id: number;
    domain: string;
    path: string;
    name: string;
    value: string;
    expires: string | null;
  }
  const [cookies, setCookies] = useState<CookieItem[]>([]);
  const [cookieNewDomain, setCookieNewDomain] = useState("");
  const [expandedDomains, setExpandedDomains] = useState<string[]>([]);
  const [modalTargetId, setModalTargetId] = useState<number | null>(null);
  
  // Modal State for Environments variables editing
  const [envModalVariables, setEnvModalVariables] = useState<{ key: string; value: string }[]>([]);

  // Ref to handle import file selection
  const importFileRef = useRef<HTMLInputElement>(null);

  // Toast trigger
  const showToast = (message: string, type: "success" | "error" | "info" = "info") => {
    const id = Math.random().toString();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  // Find active tab
  const activeTab = useMemo(() => {
    return tabs.find(t => t.id === activeTabId) || tabs[0] || { ...EMPTY_TAB_STATE, id: "fallback", name: "Untitled request" };
  }, [tabs, activeTabId]);

  // Helper to update active tab fields
  const updateActiveTab = (updater: (prev: Tab) => Tab) => {
    setTabs(prev => prev.map(t => t.id === activeTabId ? updater(t) : t));
  };

  // Fetch initial data
  useEffect(() => {
    // Check localStorage for theme
    const localTheme = localStorage.getItem("theme");
    if (localTheme) {
      setIsDarkMode(localTheme === "dark");
    }

    fetch("https://postman-clone-backend-bhfx.onrender.com/collections")
      .then((res) => res.json())
      .then((data) => setCollections(Array.isArray(data) ? data : []))
      .catch(() => showToast("Could not fetch collections from backend", "error"));

    fetch("https://postman-clone-backend-bhfx.onrender.com/environments")
      .then((res) => res.json())
      .then((envs) => {
        const list = Array.isArray(envs) ? envs : [];
        setEnvironments(list);
        if (list.length > 0) {
          setSelectedEnvironmentId(list[0].id);
        }
      })
      .catch(() => showToast("Could not fetch environments", "error"));

    fetch("https://postman-clone-backend-bhfx.onrender.com/history")
      .then((res) => res.json())
      .then((data) => setHistoryItems(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // Fetch requests for selected collection
  useEffect(() => {
    if (activeCollectionId !== null) {
      fetch(`https://postman-clone-backend-bhfx.onrender.com/collections/${activeCollectionId}/requests`)
        .then((res) => res.json())
        .then((data) => setSavedRequests(Array.isArray(data) ? data : []))
        .catch(() => showToast("Failed to load requests", "error"));
    }
  }, [activeCollectionId]);

  // Sync variables resolved URL
  const resolvedUrlPreview = useMemo(() => {
    if (!selectedEnvironmentId) return activeTab.url;
    const activeEnv = environments.find(e => e.id === selectedEnvironmentId);
    if (!activeEnv || typeof activeEnv.variables !== "object") return activeTab.url;
    let url = activeTab.url;
    Object.entries(activeEnv.variables).forEach(([key, value]) => {
      url = url.replace(new RegExp(`{{${key}}}`, "g"), String(value));
    });
    return url;
  }, [activeTab.url, environments, selectedEnvironmentId]);

  // Sidebar drag handle
  const startResizeSidebar = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const onMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = startWidth + (moveEvent.clientX - startX);
      if (newWidth > 180 && newWidth < 500) {
        setSidebarWidth(newWidth);
      }
    };
    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  // Horizontal divider drag handle
  const startResizeRequestPanel = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = requestPanelHeight;
    const onMouseMove = (moveEvent: MouseEvent) => {
      const newHeight = startHeight + (moveEvent.clientY - startY);
      if (newHeight > 150 && newHeight < 650) {
        setRequestPanelHeight(newHeight);
      }
    };
    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  // Toggle Dark Mode
  const toggleTheme = () => {
    const nextTheme = !isDarkMode;
    setIsDarkMode(nextTheme);
    localStorage.setItem("theme", nextTheme ? "dark" : "light");
  };

  // URL input field changes
  const handleUrlChange = (val: string) => {
    updateActiveTab(tab => {
      const query = normalizePairs(parseQueryParams(val));
      return {
        ...tab,
        url: val,
        query: query,
        isDirty: true
      };
    });
  };

  // Query parameters Grid Changes
  const updateQueryPair = (index: number, key: string, value: string, enabled: boolean) => {
    updateActiveTab(tab => {
      const queryList = [...tab.query];
      queryList[index] = { key, value, enabled };
      
      // Auto add row if editing last row
      if (index === queryList.length - 1 && (key || value)) {
        queryList.push({ key: "", value: "", enabled: true });
      }
      
      const newUrl = buildUrlWithParams(tab.url, queryList);
      return {
        ...tab,
        query: queryList,
        url: newUrl,
        isDirty: true
      };
    });
  };

  const removeQueryPair = (index: number) => {
    updateActiveTab(tab => {
      const queryList = tab.query.filter((_, idx) => idx !== index);
      const normalized = queryList.length ? queryList : [{ key: "", value: "", enabled: true }];
      const newUrl = buildUrlWithParams(tab.url, normalized);
      return {
        ...tab,
        query: normalized,
        url: newUrl,
        isDirty: true
      };
    });
  };

  // Headers Grid Changes
  const updateHeaderPair = (index: number, key: string, value: string, enabled: boolean) => {
    updateActiveTab(tab => {
      const headersList = [...tab.headers];
      headersList[index] = { key, value, enabled };
      
      // Auto add row if editing last row
      if (index === headersList.length - 1 && (key || value)) {
        headersList.push({ key: "", value: "", enabled: true });
      }
      return {
        ...tab,
        headers: headersList,
        isDirty: true
      };
    });
  };

  const removeHeaderPair = (index: number) => {
    updateActiveTab(tab => {
      const headersList = tab.headers.filter((_, idx) => idx !== index);
      const normalized = headersList.length ? headersList : [{ key: "", value: "", enabled: true }];
      return {
        ...tab,
        headers: normalized,
        isDirty: true
      };
    });
  };

  // Tab switching and control
  const openNewTab = () => {
    const id = Math.random().toString();
    const newTab: Tab = {
      ...EMPTY_TAB_STATE,
      id,
      name: "Untitled Request",
      headers: [{ key: "Accept", value: "application/json", enabled: true }],
      query: [{ key: "", value: "", enabled: true }]
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(id);
  };

  const closeTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length === 1) {
      showToast("Cannot close the only open tab", "info");
      return;
    }
    const targetIdx = tabs.findIndex(t => t.id === id);
    const newTabs = tabs.filter(t => t.id !== id);
    setTabs(newTabs);
    
    if (activeTabId === id) {
      const nextActive = newTabs[Math.max(0, targetIdx - 1)];
      setActiveTabId(nextActive.id);
    }
  };

  // Send request runner
  const sendRequest = async () => {
    updateActiveTab(tab => ({ ...tab, statusMessage: "Sending...", response: null }));
    
    try {
      const payload = {
        method: activeTab.method,
        url: activeTab.url,
        environment_id: selectedEnvironmentId,
        headers: activeTab.headers.filter(h => h.enabled !== false && h.key),
        query: activeTab.query.filter(q => q.enabled !== false && q.key),
        body: activeTab.bodyType === "none" ? null : activeTab.body,
        body_type: activeTab.bodyType,
        auth: activeTab.auth
      };

      const res = await fetch("https://postman-clone-backend-bhfx.onrender.com/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error("HTTP error " + res.status);
      }

      const data: ResponseData = await res.json();
      
      updateActiveTab(tab => ({
        ...tab,
        response: data,
        statusMessage: data.is_error ? "Error sending request" : "Completed"
      }));

      // Refresh history list
      fetch("https://postman-clone-backend-bhfx.onrender.com/history")
        .then(r => r.json())
        .then(h => setHistoryItems(Array.isArray(h) ? h : []));

    } catch (err) {
      updateActiveTab(tab => ({
        ...tab,
        statusMessage: "Failed",
        response: {
          status_code: 0,
          headers: {},
          body: { error: { message: err instanceof Error ? err.message : "Unknown gateway error" } },
          duration_ms: 0,
          size_bytes: 0,
          is_error: true
        }
      }));
    }
  };

  // Save current request settings
  const handleSaveRequest = async () => {
    // If it's already a saved request (has savedRequestId), update it
    if (activeTab.savedRequestId) {
      const payload = {
        collection_id: activeCollectionId,
        name: activeTab.name,
        method: activeTab.method,
        url: activeTab.url,
        headers: activeTab.headers.filter(h => h.key),
        query: activeTab.query.filter(q => q.key),
        body: activeTab.body,
        body_type: activeTab.bodyType,
        auth: activeTab.auth
      };

      try {
        await fetch(`https://postman-clone-backend-bhfx.onrender.com/requests/${activeTab.savedRequestId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        showToast("Request updated successfully", "success");
        updateActiveTab(t => ({ ...t, isDirty: false }));
        
        // Refresh saved requests inside list
        if (activeCollectionId !== null) {
          fetch(`https://postman-clone-backend-bhfx.onrender.com/collections/${activeCollectionId}/requests`)
            .then((res) => res.json())
            .then(setSavedRequests);
        }
      } catch {
        showToast("Error updating request", "error");
      }
    } else {
      // Trigger "Save As" modal
      if (collections.length === 0) {
        showToast("Create a collection first before saving", "info");
        return;
      }
      setModalInputName(activeTab.name);
      setModalTargetId(activeCollectionId || collections[0].id);
      setModalType("save_as");
    }
  };

  // Execute Save As POST request
  const submitSaveAs = async () => {
    if (!modalInputName.trim() || modalTargetId === null) {
      showToast("Request name and collection required", "error");
      return;
    }

    const payload = {
      collection_id: modalTargetId,
      name: modalInputName,
      method: activeTab.method,
      url: activeTab.url,
      headers: activeTab.headers.filter(h => h.key),
      query: activeTab.query.filter(q => q.key),
      body: activeTab.body,
      body_type: activeTab.bodyType,
      auth: activeTab.auth
    };

    try {
      const res = await fetch("https://postman-clone-backend-bhfx.onrender.com/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      
      showToast("Saved request to collection", "success");
      setModalType(null);

      // Update active tab configuration to tie to this saved ID
      updateActiveTab(t => ({
        ...t,
        name: modalInputName,
        savedRequestId: data.id,
        isDirty: false
      }));

      // Focus collection in sidebar
      setActiveCollectionId(modalTargetId);
      
    } catch {
      showToast("Error saving request", "error");
    }
  };

  // Delete saved request from collection
  const handleDeleteSavedRequest = async (requestId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this request?")) return;
    try {
      await fetch(`https://postman-clone-backend-bhfx.onrender.com/requests/${requestId}`, { method: "DELETE" });
      setSavedRequests(prev => prev.filter(r => r.id !== requestId));
      showToast("Request deleted", "success");
      
      // If active tab was referencing this, unset savedRequestId
      setTabs(prev => prev.map(t => t.savedRequestId === requestId ? { ...t, savedRequestId: undefined, isDirty: true } : t));
    } catch {
      showToast("Could not delete request", "error");
    }
  };

  // Click history to open in tab
  const handleOpenHistoryItem = (item: HistoryEntry) => {
    const id = "hist-" + item.id;
    // Check if already open
    if (tabs.some(t => t.id === id)) {
      setActiveTabId(id);
      return;
    }

    const reqData = item.request_data;
    const respData = item.response_data;

    const newTab: Tab = {
      id,
      name: `${reqData.method}: ${reqData.url.substring(0, 30)}...`,
      method: reqData.method || "GET",
      url: reqData.url || "",
      headers: normalizePairs(reqData.headers || []),
      query: normalizePairs(reqData.query || []),
      body: reqData.body || "",
      bodyType: reqData.body_type || reqData.bodyType || "none",
      auth: reqData.auth || { type: "none" },
      response: respData,
      statusMessage: "Loaded from history",
      isDirty: false
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTabId(id);
  };

  // Open saved request in tab
  const handleOpenSavedRequest = (saved: SavedRequest) => {
    const id = "saved-" + saved.id;
    if (tabs.some(t => t.id === id)) {
      setActiveTabId(id);
      return;
    }

    const newTab: Tab = {
      id,
      name: saved.name,
      method: saved.method,
      url: saved.url,
      headers: normalizePairs(saved.headers || []),
      query: normalizePairs(saved.query || []),
      body: saved.body || "",
      bodyType: saved.body_type || "none",
      auth: saved.auth || { type: "none" },
      response: null,
      statusMessage: "",
      isDirty: false,
      savedRequestId: saved.id
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTabId(id);
  };

  // Collections CRUD implementation
  const triggerCreateCollection = () => {
    setModalInputName("");
    setModalType("create_collection");
  };

  const submitCreateCollection = async () => {
    if (!modalInputName.trim()) return;
    try {
      const res = await fetch("https://postman-clone-backend-bhfx.onrender.com/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: modalInputName })
      });
      const data = await res.json();
      setCollections(prev => [data, ...prev]);
      setActiveCollectionId(data.id);
      setModalType(null);
      showToast("Collection created", "success");
    } catch {
      showToast("Error creating collection", "error");
    }
  };

  const triggerRenameCollection = (col: Collection, e: React.MouseEvent) => {
    e.stopPropagation();
    setModalTargetId(col.id);
    setModalInputName(col.name);
    setModalType("rename_collection");
  };

  const submitRenameCollection = async () => {
    if (!modalInputName.trim() || modalTargetId === null) return;
    try {
      await fetch(`https://postman-clone-backend-bhfx.onrender.com/collections/${modalTargetId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: modalInputName })
      });
      setCollections(prev => prev.map(c => c.id === modalTargetId ? { ...c, name: modalInputName } : c));
      setModalType(null);
      showToast("Collection renamed", "success");
    } catch {
      showToast("Error renaming collection", "error");
    }
  };

  const handleDeleteCollection = async (col: Collection, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete collection "${col.name}" and all its requests?`)) return;
    try {
      await fetch(`https://postman-clone-backend-bhfx.onrender.com/collections/${col.id}`, { method: "DELETE" });
      setCollections(prev => prev.filter(c => c.id !== col.id));
      if (activeCollectionId === col.id) {
        setActiveCollectionId(null);
        setSavedRequests([]);
      }
      showToast("Collection deleted", "success");
    } catch {
      showToast("Error deleting collection", "error");
    }
  };

  // Environments CRUD implementation
  const triggerCreateEnvironment = () => {
    setModalTargetId(null);
    setModalInputName("");
    setEnvModalVariables([{ key: "", value: "" }]);
    setModalType("edit_env");
  };

  const triggerEditEnvironment = (env: Environment) => {
    setModalTargetId(env.id);
    setModalInputName(env.name);
    const vars = Object.entries(env.variables).map(([k, v]) => ({ key: k, value: String(v) }));
    setEnvModalVariables(vars.length ? vars : [{ key: "", value: "" }]);
    setModalType("edit_env");
  };

  const handleAddEnvVariableRow = () => {
    setEnvModalVariables(prev => [...prev, { key: "", value: "" }]);
  };

  const handleUpdateEnvVariableRow = (index: number, key: string, value: string) => {
    setEnvModalVariables(prev => {
      const list = [...prev];
      list[index] = { key, value };
      return list;
    });
  };

  const handleRemoveEnvVariableRow = (index: number) => {
    setEnvModalVariables(prev => prev.filter((_, idx) => idx !== index));
  };

  const submitEditEnvironment = async () => {
    if (!modalInputName.trim()) {
      showToast("Environment name is required", "error");
      return;
    }

    const varsObj: Record<string, string> = {};
    envModalVariables.forEach(item => {
      if (item.key.trim()) {
        varsObj[item.key.trim()] = item.value;
      }
    });

    try {
      if (modalTargetId === null) {
        // Create environment
        const res = await fetch("https://postman-clone-backend-bhfx.onrender.com/environments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: modalInputName, variables: varsObj })
        });
        const data = await res.json();
        setEnvironments(prev => [data, ...prev]);
        setSelectedEnvironmentId(data.id);
        showToast("Environment created", "success");
      } else {
        // Update environment
        const res = await fetch(`https://postman-clone-backend-bhfx.onrender.com/environments/${modalTargetId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: modalInputName, variables: varsObj })
        });
        const data = await res.json();
        setEnvironments(prev => prev.map(e => e.id === modalTargetId ? data : e));
        showToast("Environment updated", "success");
      }
      setModalType(null);
    } catch {
      showToast("Error saving environment", "error");
    }
  };

  const handleDeleteEnvironment = async (env: Environment, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete environment "${env.name}"?`)) return;
    try {
      await fetch(`https://postman-clone-backend-bhfx.onrender.com/environments/${env.id}`, { method: "DELETE" });
      const nextEnvs = environments.filter(e => e.id !== env.id);
      setEnvironments(nextEnvs);
      if (selectedEnvironmentId === env.id) {
        setSelectedEnvironmentId(nextEnvs[0]?.id ?? null);
      }
      showToast("Environment deleted", "success");
    } catch {
      showToast("Error deleting environment", "error");
    }
  };

  // Code Snippet generation helper
  const generatedCodeSnippet = useMemo(() => {
    const method = activeTab.method;
    const url = resolvedUrlPreview || activeTab.url;
    const activeHeaders = activeTab.headers.filter(h => h.enabled !== false && h.key);
    
    // Auth integration in snippets
    const finalHeaders = [...activeHeaders];
    if (activeTab.auth.type === "bearer" && activeTab.auth.token) {
      finalHeaders.push({ key: "Authorization", value: `Bearer ${activeTab.auth.token}` });
    } else if (activeTab.auth.type === "basic" && activeTab.auth.username) {
      const token = btoa(`${activeTab.auth.username}:${activeTab.auth.password || ""}`);
      finalHeaders.push({ key: "Authorization", value: `Basic ${token}` });
    }

    if (codeSnippetLang === "curl") {
      let cmd = `curl -X ${method} "${url}"`;
      finalHeaders.forEach(h => {
        cmd += ` \\\n  -H "${h.key}: ${h.value}"`;
      });
      if (activeTab.bodyType !== "none" && activeTab.body) {
        cmd += ` \\\n  -d '${activeTab.body.replace(/'/g, "'\\''")}'`;
      }
      return cmd;
    }
    
    if (codeSnippetLang === "fetch") {
      const headersObj: Record<string, string> = {};
      finalHeaders.forEach(h => { headersObj[h.key] = h.value; });
      
      const options: any = { method };
      if (finalHeaders.length > 0) options.headers = headersObj;
      if (activeTab.bodyType !== "none" && activeTab.body) options.body = activeTab.body;
      
      return `fetch("${url}", ${JSON.stringify(options, null, 2)});`;
    }

    if (codeSnippetLang === "python") {
      const hMap = finalHeaders.map(h => `    "${h.key}": "${h.value}"`).join(",\n");
      const headersStr = hMap ? `{\n${hMap}\n}` : "None";
      let bodyDataStr = "None";
      
      if (activeTab.bodyType !== "none" && activeTab.body) {
        if (activeTab.bodyType === "raw" && activeTab.body.startsWith("{")) {
          bodyDataStr = `json=${activeTab.body}`;
        } else {
          bodyDataStr = `data="""${activeTab.body}"""`;
        }
      }
      
      return `import requests
import json

url = "${url}"
headers = ${headersStr}
${bodyDataStr.startsWith("json=") ? "json_data" : "data"} = ${bodyDataStr.startsWith("json=") ? bodyDataStr.substring(5) : (bodyDataStr === "None" ? "None" : bodyDataStr.substring(5))}

response = requests.request(
    "${method}",
    url,
    headers=headers,
    ${bodyDataStr.startsWith("json=") ? "json=json_data" : "data=data"}
)

print(response.status_code)
print(response.text)`;
    }

    if (codeSnippetLang === "node") {
      const headersObj: Record<string, string> = {};
      finalHeaders.forEach(h => { headersObj[h.key] = h.value; });
      let dataLine = "";
      if (activeTab.bodyType !== "none" && activeTab.body) {
        dataLine = `,\n  data: ${activeTab.body}`;
      }

      return `const axios = require('axios');

axios({
  method: '${method.toLowerCase()}',
  url: '${url}',
  headers: ${JSON.stringify(headersObj, null, 2)}${dataLine}
})
.then(response => {
  console.log(response.data);
})
.catch(error => {
  console.error(error);
});`;
    }

    return "";
  }, [activeTab, resolvedUrlPreview, codeSnippetLang]);

  // Import / Export trigger
  const handleExportCollection = async (col: Collection, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await fetch(`https://postman-clone-backend-bhfx.onrender.com/collections/${col.id}/requests`);
      const reqs = await res.json();
      
      const postmanCollection = {
        info: {
          name: col.name,
          schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
        },
        item: reqs.map((r: any) => ({
          name: r.name,
          request: {
            method: r.method,
            header: (Array.isArray(r.headers) ? r.headers : []).map((h: any) => ({
              key: h.key,
              value: h.value,
              type: "text"
            })),
            url: {
              raw: r.url,
              host: [r.url]
            },
            body: r.body ? {
              mode: r.body_type === "raw" ? "raw" : (r.body_type === "form-data" ? "formdata" : "urlencoded"),
              raw: r.body_type === "raw" ? r.body : undefined,
              urlencoded: r.body_type === "form-urlencoded" ? JSON.parse(r.body) : undefined,
              formdata: r.body_type === "form-data" ? JSON.parse(r.body) : undefined
            } : undefined
          }
        }))
      };

      const blob = new Blob([JSON.stringify(postmanCollection, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${col.name}.postman_collection.json`;
      link.click();
      showToast("Collection exported successfully", "success");
    } catch {
      showToast("Export failed", "error");
    }
  };

  const handleImportClick = () => {
    importFileRef.current?.click();
  };

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const jsonContent = event.target?.result as string;
      try {
        const parsed = JSON.parse(jsonContent);
        const name = parsed.info?.name || "Imported Collection";
        
        // Create collection
        const colRes = await fetch("https://postman-clone-backend-bhfx.onrender.com/collections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name })
        });
        const col = await colRes.json();

        const items = parsed.item || [];
        for (const item of items) {
          if (!item.request) continue;
          const reqName = item.name || "Imported Request";
          const method = item.request.method || "GET";
          const urlStr = typeof item.request.url === "string" ? item.request.url : (item.request.url?.raw || "");
          const headers = (item.request.header || []).map((h: any) => ({ key: h.key, value: h.value, enabled: !h.disabled }));
          
          let bodyType = "none";
          let body = "";
          if (item.request.body) {
            const mode = item.request.body.mode;
            if (mode === "raw") {
              bodyType = "raw";
              body = item.request.body.raw || "";
            } else if (mode === "urlencoded" || mode === "formdata") {
              bodyType = mode === "urlencoded" ? "form-urlencoded" : "form-data";
              const rawData = item.request.body[mode === "urlencoded" ? "urlencoded" : "formdata"] || [];
              body = JSON.stringify(rawData.map((d: any) => ({ key: d.key, value: d.value, enabled: !d.disabled })));
            }
          }

          await fetch("https://postman-clone-backend-bhfx.onrender.com/requests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              collection_id: col.id,
              name: reqName,
              method,
              url: urlStr,
              headers,
              query: [],
              body,
              body_type: bodyType,
              auth: { type: "none" }
            })
          });
        }

        // Refresh collections
        fetch("https://postman-clone-backend-bhfx.onrender.com/collections")
          .then((res) => res.json())
          .then((data) => setCollections(Array.isArray(data) ? data : []));
        
        showToast(`Imported collection "${name}" successfully`, "success");
      } catch {
        showToast("Invalid Postman Collection file format", "error");
      }
    };
    reader.readAsText(file);
    e.target.value = ""; // reset file input
  };

  const triggerManageCookies = async () => {
    try {
      const res = await fetch("https://postman-clone-backend-bhfx.onrender.com/cookies");
      const data = await res.json();
      setCookies(Array.isArray(data) ? data : []);
      setCookieNewDomain("");
      setModalType("manage_cookies");
    } catch {
      showToast("Failed to load cookies", "error");
    }
  };

  const handleAddCookieDomain = async () => {
    if (!cookieNewDomain.trim()) return;
    const domainName = cookieNewDomain.trim();
    const payload = {
      domain: domainName,
      path: "/",
      name: "cookie_name",
      value: "cookie_value",
      expires: null
    };
    try {
      await fetch("https://postman-clone-backend-bhfx.onrender.com/cookies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const res = await fetch("https://postman-clone-backend-bhfx.onrender.com/cookies").then(r => r.json());
      setCookies(res);
      setCookieNewDomain("");
      showToast(`Domain ${domainName} added`, "success");
    } catch {
      showToast("Error adding cookie domain", "error");
    }
  };

  const handleSaveCookieItem = async (cookie: CookieItem) => {
    if (!cookie.name.trim() || !cookie.domain.trim()) {
      showToast("Cookie name and domain required", "error");
      return;
    }
    try {
      await fetch("https://postman-clone-backend-bhfx.onrender.com/cookies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: cookie.domain,
          path: cookie.path || "/",
          name: cookie.name,
          value: cookie.value,
          expires: cookie.expires
        })
      });
      const res = await fetch("https://postman-clone-backend-bhfx.onrender.com/cookies").then(r => r.json());
      setCookies(res);
      showToast("Cookie saved", "success");
    } catch {
      showToast("Error saving cookie", "error");
    }
  };

  const handleDeleteCookieItem = async (cookieId: number) => {
    try {
      await fetch(`https://postman-clone-backend-bhfx.onrender.com/cookies/${cookieId}`, {
        method: "DELETE"
      });
      setCookies(prev => prev.filter(c => c.id !== cookieId));
      showToast("Cookie deleted", "success");
    } catch {
      showToast("Error deleting cookie", "error");
    }
  };

  const handleCreateEmptyCookieRow = (domain: string) => {
    const tempId = -Math.floor(Math.random() * 1000000);
    const newRow: CookieItem = {
      id: tempId,
      domain,
      path: "/",
      name: "new_cookie",
      value: "value",
      expires: null
    };
    setCookies(prev => [...prev, newRow]);
  };

  const toggleExpandDomain = (domain: string) => {
    setExpandedDomains(prev => 
      prev.includes(domain) ? prev.filter(d => d !== domain) : [...prev, domain]
    );
  };

  const cookiesByDomain = useMemo(() => {
    const groups: Record<string, CookieItem[]> = {};
    cookies.forEach(c => {
      if (!groups[c.domain]) groups[c.domain] = [];
      groups[c.domain].push(c);
    });
    return groups;
  }, [cookies]);

  // Filter lists based on search
  const filteredCollections = useMemo(() => {
    return collections.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [collections, searchQuery]);

  const filteredEnvironments = useMemo(() => {
    return environments.filter(e => e.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [environments, searchQuery]);

  const filteredHistory = useMemo(() => {
    return historyItems.filter(h => {
      const urlMatch = h.request_data.url?.toLowerCase().includes(searchQuery.toLowerCase());
      const methodMatch = h.request_data.method?.toLowerCase().includes(searchQuery.toLowerCase());
      return urlMatch || methodMatch;
    });
  }, [historyItems, searchQuery]);

  // Keyboard Shortcuts (Ctrl+Enter to Send, Ctrl+S to Save, Ctrl+T for New Tab)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        sendRequest();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSaveRequest();
      }
      if (e.altKey && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        openNewTab();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTab, selectedEnvironmentId, collections, activeCollectionId]);

  return (
    <div className={`app-shell ${isDarkMode ? "theme-dark" : "theme-light"}`}>
      
      {/* Toast notifications rendering */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast-card toast-${t.type}`}>
            <span>{t.message}</span>
            <button onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}>×</button>
          </div>
        ))}
      </div>

      {/* Top Navbar */}
      <nav className="top-nav">
        <div className="nav-logo">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="var(--accent)">
            <path d="M12 2C6.477 2 2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.879V14.89h-2.54v-2.89h2.54V9.798c0-2.507 1.493-3.89 3.777-3.89 1.094 0 2.24.195 2.24.195v2.46h-1.26c-1.243 0-1.63.772-1.63 1.562v1.875h2.773l-.443 2.89h-2.33v6.989C18.343 21.129 22 16.99 22 12c0-5.523-4.477-10-10-10z" style={{ display: "none" }} />
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-13c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0 8c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3z" />
          </svg>
          <span className="logo-title">Postman Clone</span>
          <span className="badge-workspace">My Workspace</span>
        </div>

        <div className="nav-actions">
          {/* Active Environment Selector */}
          <div className="env-selector-container">
            <span className="env-label">Environment:</span>
            <select 
              value={selectedEnvironmentId ?? ""} 
              onChange={e => setSelectedEnvironmentId(Number(e.target.value) || null)}
              className="env-select"
            >
              <option value="">No Environment</option>
              {environments.map(env => (
                <option key={env.id} value={env.id}>{env.name}</option>
              ))}
            </select>
            {selectedEnvironmentId && (
              <button 
                onClick={() => {
                  const active = environments.find(e => e.id === selectedEnvironmentId);
                  if (active) triggerEditEnvironment(active);
                }} 
                className="btn-icon-nav"
                title="Edit current environment"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              </button>
            )}
          </div>

          {/* Theme switcher */}
          <button className="theme-toggle-btn" onClick={toggleTheme} title="Toggle Theme">
            {isDarkMode ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
            )}
          </button>
        </div>
      </nav>

      {/* Main Container */}
      <div className="main-content">
        
        {/* Left Sidebar */}
        <aside className="sidebar" style={{ width: `${sidebarWidth}px` }}>
          <div className="sidebar-tabs">
            <button 
              className={sidebarTab === "collections" ? "active" : ""} 
              onClick={() => setSidebarTab("collections")}
            >
              Collections
            </button>
            <button 
              className={sidebarTab === "environments" ? "active" : ""} 
              onClick={() => setSidebarTab("environments")}
            >
              Environments
            </button>
            <button 
              className={sidebarTab === "history" ? "active" : ""} 
              onClick={() => setSidebarTab("history")}
            >
              History
            </button>
            <button 
              className={sidebarTab === "mocks" ? "active" : ""} 
              onClick={() => setSidebarTab("mocks")}
            >
              Mocks
            </button>
            <button 
              className={sidebarTab === "monitors" ? "active" : ""} 
              onClick={() => setSidebarTab("monitors")}
            >
              Monitors
            </button>
            <button 
              className={sidebarTab === "docs" ? "active" : ""} 
              onClick={() => setSidebarTab("docs")}
            >
              Docs
            </button>
          </div>

          {(sidebarTab === "collections" || sidebarTab === "environments" || sidebarTab === "history") && (
            <div className="sidebar-search">
              <input 
                placeholder={`Search ${sidebarTab}...`} 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="search-input"
              />
              {sidebarTab === "collections" && (
                <div className="sidebar-actions-row">
                  <button className="btn-sidebar-add" onClick={triggerCreateCollection}>
                    + New Collection
                  </button>
                  <button className="btn-sidebar-secondary" onClick={handleImportClick} title="Import Collection JSON">
                    Import
                  </button>
                  <input 
                    type="file" 
                    ref={importFileRef} 
                    style={{ display: "none" }} 
                    accept=".json" 
                    onChange={handleImportFileChange}
                  />
                </div>
              )}
              {sidebarTab === "environments" && (
                <button className="btn-sidebar-add" onClick={triggerCreateEnvironment}>
                  + New Environment
                </button>
              )}
            </div>
          )}

          {/* List display */}
          <div className="sidebar-list">
            
            {/* MOCK SERVERS PLACEHOLDER */}
            {sidebarTab === "mocks" && (
              <div className="coming-soon-card">
                <h3>Mock Servers</h3>
                <p>Simulate your API responses before building your backend service. Save mock endpoints and test them directly.</p>
                <span className="badge-coming-soon">Coming Soon</span>
              </div>
            )}

            {/* MONITORS PLACEHOLDER */}
            {sidebarTab === "monitors" && (
              <div className="coming-soon-card">
                <h3>API Monitors</h3>
                <p>Schedule collections to run at periodic intervals to check performance, response times, and API uptime.</p>
                <span className="badge-coming-soon">Coming Soon</span>
              </div>
            )}

            {/* API DOCS PLACEHOLDER */}
            {sidebarTab === "docs" && (
              <div className="coming-soon-card">
                <h3>API Documentation</h3>
                <p>Automatically generate clear, copyable, and developer-friendly documentation for all your saved collections.</p>
                <span className="badge-coming-soon">Coming Soon</span>
              </div>
            )}

            {/* COLLECTIONS VIEW */}
            {sidebarTab === "collections" && (
              filteredCollections.length ? (
                filteredCollections.map(col => {
                  const isExpanded = activeCollectionId === col.id;
                  return (
                    <div key={col.id} className="collection-group">
                      <div 
                        className={`collection-header ${isExpanded ? "expanded" : ""}`}
                        onClick={() => setActiveCollectionId(isExpanded ? null : col.id)}
                      >
                        <span className="collection-title-container">
                          <svg className="folder-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                          <span className="collection-name">{col.name}</span>
                        </span>
                        <div className="collection-options">
                          <button onClick={(e) => triggerRenameCollection(col, e)} title="Rename">✏️</button>
                          <button onClick={(e) => handleExportCollection(col, e)} title="Export JSON">📥</button>
                          <button onClick={(e) => handleDeleteCollection(col, e)} title="Delete">🗑️</button>
                        </div>
                      </div>
                      
                      {isExpanded && (
                        <div className="collection-requests">
                          {savedRequests.length ? (
                            savedRequests.map(req => (
                              <div 
                                key={req.id} 
                                className={`saved-request-item ${activeTab.savedRequestId === req.id ? "active" : ""}`}
                                onClick={() => handleOpenSavedRequest(req)}
                              >
                                <span className={`method-text method-${req.method.toLowerCase()}`}>{req.method}</span>
                                <span className="request-name">{req.name}</span>
                                <button className="delete-request-btn" onClick={(e) => handleDeleteSavedRequest(req.id, e)}>×</button>
                              </div>
                            ))
                          ) : (
                            <div className="empty-subtext">No saved requests. Click Save As on a request to save it.</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              ) : <div className="empty-subtext">No collections found.</div>
            )}

            {/* ENVIRONMENTS VIEW */}
            {sidebarTab === "environments" && (
              filteredEnvironments.length ? (
                filteredEnvironments.map(env => (
                  <div 
                    key={env.id} 
                    className={`env-item ${selectedEnvironmentId === env.id ? "active" : ""}`}
                    onClick={() => setSelectedEnvironmentId(env.id)}
                  >
                    <span className="env-title-text">{env.name}</span>
                    <div className="env-item-actions">
                      <button onClick={(e) => { e.stopPropagation(); triggerEditEnvironment(env); }} title="Edit Variables">✏️</button>
                      <button onClick={(e) => handleDeleteEnvironment(env, e)} title="Delete Environment">🗑️</button>
                    </div>
                  </div>
                ))
              ) : <div className="empty-subtext">No environments found.</div>
            )}

            {/* HISTORY VIEW */}
            {sidebarTab === "history" && (
              filteredHistory.length ? (
                filteredHistory.map(hist => (
                  <div 
                    key={hist.id} 
                    className="history-card"
                    onClick={() => handleOpenHistoryItem(hist)}
                  >
                    <div className="history-top">
                      <span className={`method-text method-${hist.request_data.method.toLowerCase()}`}>{hist.request_data.method}</span>
                      <span className="history-url" title={hist.request_data.url}>{hist.request_data.url}</span>
                    </div>
                    <div className="history-bottom">
                      <span className="history-time">{new Date(hist.created_at).toLocaleTimeString()}</span>
                      {hist.response_data && (
                        <span className={`history-status ${hist.response_data.is_error ? "status-err" : ""}`}>
                          {hist.response_data.status_code || "Network Err"}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              ) : <div className="empty-subtext">No history records found.</div>
            )}
          </div>
        </aside>

        {/* Sidebar Drag Resizer Handle */}
        <div className="sidebar-resize-handle" onMouseDown={startResizeSidebar} />

        {/* Central Workspace */}
        <main className="workspace">
          
          {/* Tab bar header */}
          <div className="tab-bar">
            <div className="tab-scroll-container">
              {tabs.map(t => (
                <div 
                  key={t.id} 
                  className={`tab-header-item ${t.id === activeTabId ? "active" : ""}`}
                  onClick={() => setActiveTabId(t.id)}
                >
                  <span className={`method-mini-tag method-${t.method.toLowerCase()}`}>{t.method}</span>
                  <span className="tab-label" title={t.name}>{t.name}</span>
                  {t.isDirty && <span className="dirty-dot" title="Unsaved changes" />}
                  <button className="tab-close-btn" onClick={(e) => closeTab(t.id, e)}>×</button>
                </div>
              ))}
            </div>
            <button className="btn-tab-add" onClick={openNewTab} title="Open new tab">+</button>
          </div>

          {/* Active Request Panel */}
          <section className="request-pane" style={{ height: `${requestPanelHeight}px` }}>
            <div className="request-toolbar">
              {/* Method Selector */}
              <select 
                value={activeTab.method} 
                onChange={e => updateActiveTab(t => ({ ...t, method: e.target.value, isDirty: true }))}
                className="method-select"
              >
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>

              {/* URL address input */}
              <div className="url-input-container">
                <input 
                  className="url-input" 
                  value={activeTab.url} 
                  onChange={e => handleUrlChange(e.target.value)} 
                  placeholder="Enter request URL"
                />
              </div>

              {/* Action Buttons */}
              <button className="btn-send" onClick={sendRequest}>
                Send
              </button>
              
              <button className="btn-save" onClick={handleSaveRequest}>
                Save
              </button>

              <button 
                className={`btn-code-toggle ${showCodeSnippet ? "active" : ""}`} 
                onClick={() => setShowCodeSnippet(!showCodeSnippet)}
                title="Generate Code Snippet"
              >
                Code
              </button>

              <button 
                className="btn-cookies" 
                onClick={triggerManageCookies}
                title="Manage Cookies"
              >
                Cookies
              </button>
            </div>

            {/* Resolved URL Preview (Environment substitution helper) */}
            {selectedEnvironmentId && activeTab.url.includes("{{") && (
              <div className="resolved-url-preview">
                <strong>Resolved:</strong> {resolvedUrlPreview}
              </div>
            )}

            {/* Sub-tab configuration selector */}
            <div className="request-tabs">
              <button 
                className={requestSubTab === "params" ? "active" : ""} 
                onClick={() => setRequestSubTab("params")}
              >
                Params ({activeTab.query.filter(q => q.key).length})
              </button>
              <button 
                className={requestSubTab === "auth" ? "active" : ""} 
                onClick={() => setRequestSubTab("auth")}
              >
                Authorization ({activeTab.auth.type !== "none" ? "1" : "0"})
              </button>
              <button 
                className={requestSubTab === "headers" ? "active" : ""} 
                onClick={() => setRequestSubTab("headers")}
              >
                Headers ({activeTab.headers.filter(h => h.key).length})
              </button>
              <button 
                className={requestSubTab === "body" ? "active" : ""} 
                onClick={() => setRequestSubTab("body")}
              >
                Body ({activeTab.bodyType !== "none" ? "Active" : "None"})
              </button>
            </div>

            {/* Sub-tab Content Panels */}
            <div className="tab-contents">
              
              {/* PARAMS TAB */}
              {requestSubTab === "params" && (
                <div className="key-value-grid">
                  <div className="grid-header-row">
                    <span className="col-checkbox" />
                    <span>Key</span>
                    <span>Value</span>
                    <span className="col-action" />
                  </div>
                  <div className="grid-rows-container">
                    {activeTab.query.map((pair, idx) => (
                      <div key={idx} className="grid-data-row">
                        <input 
                          type="checkbox" 
                          checked={pair.enabled !== false} 
                          onChange={e => updateQueryPair(idx, pair.key, pair.value, e.target.checked)}
                          className="row-checkbox"
                        />
                        <input 
                          value={pair.key} 
                          onChange={e => updateQueryPair(idx, e.target.value, pair.value, pair.enabled ?? true)}
                          placeholder="Parameter Name"
                          className="grid-field"
                        />
                        <input 
                          value={pair.value} 
                          onChange={e => updateQueryPair(idx, pair.key, e.target.value, pair.enabled ?? true)}
                          placeholder="Value"
                          className="grid-field"
                        />
                        <button className="row-delete-btn" onClick={() => removeQueryPair(idx)}>×</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* AUTH TAB */}
              {requestSubTab === "auth" && (
                <div className="auth-panel">
                  <div className="form-group-horizontal">
                    <label>Auth Type:</label>
                    <select 
                      value={activeTab.auth.type} 
                      onChange={e => updateActiveTab(t => ({ ...t, auth: { ...t.auth, type: e.target.value as AuthType }, isDirty: true }))}
                      className="auth-select"
                    >
                      <option value="none">No Auth</option>
                      <option value="bearer">Bearer Token</option>
                      <option value="basic">Basic Auth</option>
                    </select>
                  </div>

                  {activeTab.auth.type === "bearer" && (
                    <div className="form-group">
                      <label>Token</label>
                      <input 
                        type="text"
                        placeholder="Bearer token string"
                        value={activeTab.auth.token ?? ""}
                        onChange={e => updateActiveTab(t => ({ ...t, auth: { ...t.auth, token: e.target.value }, isDirty: true }))}
                        className="form-input"
                      />
                    </div>
                  )}

                  {activeTab.auth.type === "basic" && (
                    <div className="basic-auth-fields">
                      <div className="form-group">
                        <label>Username</label>
                        <input 
                          type="text"
                          placeholder="Username"
                          value={activeTab.auth.username ?? ""}
                          onChange={e => updateActiveTab(t => ({ ...t, auth: { ...t.auth, username: e.target.value }, isDirty: true }))}
                          className="form-input"
                        />
                      </div>
                      <div className="form-group">
                        <label>Password</label>
                        <input 
                          type="password"
                          placeholder="Password"
                          value={activeTab.auth.password ?? ""}
                          onChange={e => updateActiveTab(t => ({ ...t, auth: { ...t.auth, password: e.target.value }, isDirty: true }))}
                          className="form-input"
                        />
                      </div>
                    </div>
                  )}

                  {activeTab.auth.type === "none" && (
                    <div className="empty-subtext">This request does not use authorization headers.</div>
                  )}
                </div>
              )}

              {/* HEADERS TAB */}
              {requestSubTab === "headers" && (
                <div className="key-value-grid">
                  <div className="grid-header-row">
                    <span className="col-checkbox" />
                    <span>Header Key</span>
                    <span>Value</span>
                    <span className="col-action" />
                  </div>
                  <div className="grid-rows-container">
                    {activeTab.headers.map((pair, idx) => (
                      <div key={idx} className="grid-data-row">
                        <input 
                          type="checkbox" 
                          checked={pair.enabled !== false} 
                          onChange={e => updateHeaderPair(idx, pair.key, pair.value, e.target.checked)}
                          className="row-checkbox"
                        />
                        <input 
                          value={pair.key} 
                          onChange={e => updateHeaderPair(idx, e.target.value, pair.value, pair.enabled ?? true)}
                          placeholder="Header Key"
                          className="grid-field"
                        />
                        <input 
                          value={pair.value} 
                          onChange={e => updateHeaderPair(idx, pair.key, e.target.value, pair.enabled ?? true)}
                          placeholder="Value"
                          className="grid-field"
                        />
                        <button className="row-delete-btn" onClick={() => removeHeaderPair(idx)}>×</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* BODY TAB */}
              {requestSubTab === "body" && (
                <div className="body-panel">
                  <div className="body-type-bar">
                    {['none', 'raw', 'form-data', 'x-www-form-urlencoded'].map(type => (
                      <label key={type} className="radio-label">
                        <input 
                          type="radio" 
                          name="bodyType"
                          value={type}
                          checked={activeTab.bodyType === type}
                          onChange={e => {
                            const bt = e.target.value;
                            // Initialize content type header automatically if JSON
                            let headers = [...activeTab.headers];
                            if (bt === "raw") {
                              const hasContentType = headers.some(h => h.key.toLowerCase() === "content-type");
                              if (!hasContentType) {
                                headers.unshift({ key: "Content-Type", value: "application/json", enabled: true });
                              }
                            }
                            updateActiveTab(t => ({ 
                              ...t, 
                              bodyType: bt, 
                              headers: normalizePairs(headers),
                              isDirty: true 
                            }));
                          }}
                        />
                        <span>{type}</span>
                      </label>
                    ))}
                  </div>

                  {activeTab.bodyType === "none" && (
                    <div className="empty-subtext">This request has no body payload.</div>
                  )}

                  {activeTab.bodyType === "raw" && (
                    <div className="textarea-container">
                      <textarea 
                        className="body-editor"
                        placeholder='{"key": "value"}'
                        value={activeTab.body}
                        onChange={e => updateActiveTab(t => ({ ...t, body: e.target.value, isDirty: true }))}
                      />
                    </div>
                  )}

                  {(activeTab.bodyType === "form-data" || activeTab.bodyType === "x-www-form-urlencoded") && (
                    <div className="form-body-editor">
                      <div className="empty-subtext">
                        Enter key-value pairs. They will be serialized as {activeTab.bodyType === "form-data" ? "multipart form data" : "url-encoded form fields"} automatically.
                      </div>
                      <textarea
                        className="body-editor body-raw-list"
                        placeholder={JSON.stringify([
                          { key: "foo", value: "bar" },
                          { key: "username", value: "admin" }
                        ], null, 2)}
                        value={activeTab.body}
                        onChange={e => updateActiveTab(t => ({ ...t, body: e.target.value, isDirty: true }))}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Horizontal Split resizing bar */}
          <div className="horizontal-resize-handle" onMouseDown={startResizeRequestPanel} />

          {/* Code Snippet Drawer Panel */}
          {showCodeSnippet && (
            <div className="code-snippet-panel">
              <div className="snippet-header">
                <span className="snippet-title">Generate Code Snippet</span>
                <select 
                  value={codeSnippetLang} 
                  onChange={e => setCodeSnippetLang(e.target.value as any)}
                  className="lang-select"
                >
                  <option value="curl">cURL</option>
                  <option value="fetch">Fetch API (JS)</option>
                  <option value="python">Python (Requests)</option>
                  <option value="node">Node.js (Axios)</option>
                </select>
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(generatedCodeSnippet);
                    showToast("Code copied to clipboard", "success");
                  }} 
                  className="btn-copy"
                >
                  Copy
                </button>
              </div>
              <pre className="snippet-code-box"><code>{generatedCodeSnippet}</code></pre>
            </div>
          )}

          {/* Active Response Viewer Panel */}
          <section className="response-pane">
            <div className="response-toolbar">
              <div className="response-tabs">
                <button 
                  className={responseTab === "body" ? "active" : ""} 
                  onClick={() => setResponseTab("body")}
                >
                  Response Body
                </button>
                <button 
                  className={responseTab === "headers" ? "active" : ""} 
                  onClick={() => setResponseTab("headers")}
                >
                  Headers ({activeTab.response ? Object.keys(activeTab.response.headers).length : 0})
                </button>
              </div>

              {/* Status info badges */}
              <div className="response-status-group">
                <span>{activeTab.statusMessage}</span>
                {activeTab.response && (
                  <>
                    <span className={`status-badge ${
                      activeTab.response.status_code >= 200 && activeTab.response.status_code < 300 ? "status-success" : 
                      (activeTab.response.status_code >= 400 ? "status-client-error" : "status-redirect")
                    }`}>
                      Status: {activeTab.response.status_code}
                    </span>
                    <span className="meta-badge">{activeTab.response.duration_ms} ms</span>
                    <span className="meta-badge">{(activeTab.response.size_bytes / 1024).toFixed(2)} KB</span>
                  </>
                )}
              </div>
            </div>

            {/* Response contents */}
            <div className="response-body-viewport">
              {activeTab.response ? (
                activeTab.response.is_error ? (
                  <div className="response-error-card">
                    <svg className="error-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                    <h3>Could not get any response</h3>
                    <p className="error-summary">There was an error connecting to <strong>{activeTab.url}</strong>.</p>
                    
                    <div className="error-details-box">
                      <strong>Details:</strong>
                      <div className="error-message-text">{activeTab.response.body?.error?.message || "Connection failure"}</div>
                      {activeTab.response.body?.error?.details && (
                        <div className="error-details-text">{activeTab.response.body.error.details}</div>
                      )}
                    </div>

                    <div className="error-help-box">
                      <strong>Why did this happen?</strong>
                      <ul>
                        <li>The server is unreachable or offline.</li>
                        <li>The URL contains a typo or is invalid.</li>
                        <li>The request timed out (default limit: 8s).</li>
                        <li>SSL certificate verification failed.</li>
                      </ul>
                    </div>
                  </div>
                ) : responseTab === "body" ? (
                  <div className="response-body-tab">
                    
                    {/* Pretty/Raw subselector */}
                    <div className="response-subtoolbar">
                      <div className="body-modes">
                        <button 
                          className={responseBodyMode === "pretty" ? "active" : ""} 
                          onClick={() => setResponseBodyMode("pretty")}
                        >
                          Pretty
                        </button>
                        <button 
                          className={responseBodyMode === "raw" ? "active" : ""} 
                          onClick={() => setResponseBodyMode("raw")}
                        >
                          Raw
                        </button>
                        <button 
                          className={responseBodyMode === "preview" ? "active" : ""} 
                          onClick={() => setResponseBodyMode("preview")}
                        >
                          Preview
                        </button>
                      </div>
                      
                      {/* Search box inside response body */}
                      <input 
                        className="body-search" 
                        placeholder="Find text..." 
                        value={responseSearchQuery}
                        onChange={e => setResponseSearchQuery(e.target.value)}
                      />
                    </div>

                    {/* Body render area */}
                    <div className="response-render-area">
                      {responseBodyMode === "pretty" && (
                        <pre className="json-container">
                          <code dangerouslySetInnerHTML={{ 
                            __html: highlightJson(formatJson(activeTab.response.body)) 
                          }} />
                        </pre>
                      )}
                      
                      {responseBodyMode === "raw" && (
                        <pre className="raw-container">
                          <code>{typeof activeTab.response.body === "string" ? activeTab.response.body : JSON.stringify(activeTab.response.body, null, 2)}</code>
                        </pre>
                      )}

                      {responseBodyMode === "preview" && (
                        typeof activeTab.response.body === "string" && activeTab.response.body.includes("<html") ? (
                          <iframe 
                            srcDoc={activeTab.response.body} 
                            className="preview-iframe" 
                            title="HTML Preview" 
                          />
                        ) : (
                          <pre className="raw-container">
                            <code>{JSON.stringify(activeTab.response.body, null, 2)}</code>
                          </pre>
                        )
                      )}
                    </div>

                  </div>
                ) : (
                  /* HEADERS VIEW */
                  <div className="response-headers-tab">
                    <table className="headers-table">
                      <thead>
                        <tr>
                          <th>Header Name</th>
                          <th>Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(activeTab.response.headers).map(([k, v]) => (
                          <tr key={k}>
                            <td className="header-key">{k}</td>
                            <td className="header-val">{String(v)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : (
                <div className="response-empty-state">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="empty-icon"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                  <span>No response yet. Fill out the request and click Send.</span>
                </div>
              )}
            </div>
          </section>

        </main>
      </div>

      {/* POPUP MODALS SYSTEM */}
      {modalType && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="modal-header">
              <span className="modal-title">
                {modalType === "create_collection" && "Create New Collection"}
                {modalType === "rename_collection" && "Rename Collection"}
                {modalType === "save_as" && "Save Request As..."}
                {modalType === "edit_env" && (modalTargetId === null ? "Add Environment" : "Edit Environment Variables")}
                {modalType === "manage_cookies" && "Manage Cookies"}
              </span>
              <button className="modal-close" onClick={() => setModalType(null)}>×</button>
            </div>

            <div className="modal-body">
              {/* Form Input fields */}
              {(modalType === "create_collection" || modalType === "rename_collection") && (
                <div className="form-group">
                  <label>Collection Name</label>
                  <input 
                    type="text" 
                    value={modalInputName} 
                    onChange={e => setModalInputName(e.target.value)} 
                    placeholder="Enter name"
                    className="modal-field"
                    autoFocus
                  />
                </div>
              )}

              {modalType === "save_as" && (
                <div className="save-as-form">
                  <div className="form-group">
                    <label>Request Name</label>
                    <input 
                      type="text" 
                      value={modalInputName} 
                      onChange={e => setModalInputName(e.target.value)} 
                      placeholder="Request name"
                      className="modal-field"
                      autoFocus
                    />
                  </div>
                  <div className="form-group">
                    <label>Select Collection</label>
                    <select 
                      value={modalTargetId ?? ""} 
                      onChange={e => setModalTargetId(Number(e.target.value))}
                      className="modal-field"
                    >
                      {collections.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {modalType === "edit_env" && (
                <div className="env-editor-form">
                  <div className="form-group">
                    <label>Environment Name</label>
                    <input 
                      type="text" 
                      value={modalInputName} 
                      onChange={e => setModalInputName(e.target.value)} 
                      placeholder="e.g. Production / Local"
                      className="modal-field"
                      autoFocus
                    />
                  </div>

                  <div className="modal-sub-label">Variables (Reference via {"{{variableName}}"}):</div>
                  <div className="env-modal-grid">
                    <div className="env-grid-header">
                      <span>Variable Name</span>
                      <span>Resolved Value</span>
                      <span className="col-action" />
                    </div>
                    
                    <div className="env-grid-body">
                      {envModalVariables.map((item, idx) => (
                        <div key={idx} className="env-grid-row">
                          <input 
                            value={item.key} 
                            onChange={e => handleUpdateEnvVariableRow(idx, e.target.value, item.value)}
                            placeholder="baseUrl"
                            className="env-field"
                          />
                          <input 
                            value={item.value} 
                            onChange={e => handleUpdateEnvVariableRow(idx, item.key, e.target.value)}
                            placeholder="https://api.example.com"
                            className="env-field"
                          />
                          <button 
                            className="row-delete-btn" 
                            onClick={() => handleRemoveEnvVariableRow(idx)}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                    
                    <button className="btn-add-var" onClick={handleAddEnvVariableRow}>
                      + Add Variable Row
                    </button>
                  </div>
                </div>
              )}

              {modalType === "manage_cookies" && (
                <div className="cookies-manager-form">
                  <div className="cookie-add-domain-row">
                    <input 
                      type="text" 
                      placeholder="Enter domain (e.g. httpbin.org)" 
                      value={cookieNewDomain}
                      onChange={e => setCookieNewDomain(e.target.value)}
                      className="cookie-domain-input"
                    />
                    <button className="btn-add-domain" onClick={handleAddCookieDomain}>
                      Add Domain
                    </button>
                  </div>

                  <div className="cookies-domain-list">
                    {Object.keys(cookiesByDomain).length === 0 ? (
                      <div className="empty-subtext">No domains added. Enter a domain above to start.</div>
                    ) : (
                      Object.entries(cookiesByDomain).map(([domain, list]) => {
                        const isExpanded = expandedDomains.includes(domain);
                        return (
                          <div key={domain} className="cookie-domain-group">
                            <div className="cookie-domain-header" onClick={() => toggleExpandDomain(domain)}>
                              <span className="cookie-domain-name">
                                🌐 {domain} ({list.filter(c => c.id > 0).length} cookies)
                              </span>
                              <span className="expand-arrow">{isExpanded ? "▼" : "▶"}</span>
                            </div>

                            {isExpanded && (
                              <div className="cookie-items-container">
                                {list.map((c) => (
                                  <div key={c.id} className="cookie-item-row">
                                    <input 
                                      value={c.name} 
                                      onChange={e => {
                                        const nameVal = e.target.value;
                                        setCookies(prev => prev.map(item => item.id === c.id ? { ...item, name: nameVal } : item));
                                      }}
                                      placeholder="Name"
                                      className="cookie-field-input"
                                    />
                                    <input 
                                      value={c.value} 
                                      onChange={e => {
                                        const valVal = e.target.value;
                                        setCookies(prev => prev.map(item => item.id === c.id ? { ...item, value: valVal } : item));
                                      }}
                                      placeholder="Value"
                                      className="cookie-field-input"
                                    />
                                    <input 
                                      value={c.path} 
                                      onChange={e => {
                                        const pathVal = e.target.value;
                                        setCookies(prev => prev.map(item => item.id === c.id ? { ...item, path: pathVal } : item));
                                      }}
                                      placeholder="Path"
                                      className="cookie-field-input-short"
                                    />
                                    <div className="cookie-action-buttons">
                                      <button className="btn-cookie-save" onClick={() => handleSaveCookieItem(c)} title="Save cookie to DB">💾</button>
                                      <button className="btn-cookie-delete" onClick={() => {
                                        if (c.id < 0) {
                                          setCookies(prev => prev.filter(item => item.id !== c.id));
                                        } else {
                                          handleDeleteCookieItem(c.id);
                                        }
                                      }} title="Delete cookie">🗑️</button>
                                    </div>
                                  </div>
                                ))}
                                <button className="btn-add-cookie-row" onClick={() => handleCreateEmptyCookieRow(domain)}>
                                  + Add Cookie
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn-modal-cancel" onClick={() => setModalType(null)}>
                {modalType === "manage_cookies" ? "Close" : "Cancel"}
              </button>
              {modalType !== "manage_cookies" && (
                <button 
                  className="btn-modal-submit" 
                  onClick={() => {
                    if (modalType === "create_collection") submitCreateCollection();
                    if (modalType === "rename_collection") submitRenameCollection();
                    if (modalType === "save_as") submitSaveAs();
                    if (modalType === "edit_env") submitEditEnvironment();
                  }}
                >
                  Save
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Styled JSX Layout Scopes */}
      <style jsx>{`
        .app-shell {
          display: flex;
          flex-direction: column;
          height: 100vh;
          font-size: 13px;
          color: var(--text-primary);
          background-color: var(--bg-main);
        }
        
        .top-nav {
          display: flex;
          justify-content: space-between;
          align-items: center;
          height: 48px;
          border-bottom: 1px solid var(--border-color);
          background-color: var(--bg-sidebar);
          padding: 0 16px;
        }

        .nav-logo {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .logo-title {
          font-weight: 700;
          letter-spacing: -0.01em;
          font-size: 14px;
        }

        .badge-workspace {
          background-color: var(--btn-secondary);
          padding: 2px 8px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 500;
          color: var(--text-secondary);
          margin-left: 10px;
        }

        .nav-actions {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .env-selector-container {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .env-label {
          font-size: 11.5px;
          color: var(--text-secondary);
        }

        .env-select {
          padding: 3px 8px;
          font-size: 12px;
          border-radius: 4px;
          height: 26px;
        }

        .btn-icon-nav {
          border: none;
          background: transparent;
          cursor: pointer;
          color: var(--text-secondary);
          padding: 4px;
        }
        .btn-icon-nav:hover {
          color: var(--accent);
        }

        .theme-toggle-btn {
          border: none;
          background: var(--btn-secondary);
          width: 28px;
          height: 28px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-secondary);
        }
        .theme-toggle-btn:hover {
          background: var(--btn-secondary-hover);
          color: var(--text-primary);
        }

        .main-content {
          display: flex;
          flex: 1;
          overflow: hidden;
        }

        .sidebar {
          display: flex;
          flex-direction: column;
          background-color: var(--bg-sidebar);
          border-right: 1px solid var(--border-color);
          overflow: hidden;
        }

        .sidebar-tabs {
          display: flex;
          flex-wrap: wrap;
          border-bottom: 1px solid var(--border-color);
        }

        .sidebar-tabs button {
          flex: 1 1 33.33%;
          border: none;
          border-bottom: 2px solid transparent;
          background: transparent;
          padding: 10px 0;
          font-size: 11.5px;
          font-weight: 600;
          color: var(--text-secondary);
          border-radius: 0;
          cursor: pointer;
        }

        .coming-soon-card {
          padding: 24px 16px;
          text-align: center;
          color: var(--text-secondary);
        }
        .coming-soon-card h3 {
          color: var(--text-primary);
          font-size: 14px;
          margin-bottom: 8px;
        }
        .coming-soon-card p {
          font-size: 11.5px;
          line-height: 1.5;
          margin-bottom: 16px;
        }
        .badge-coming-soon {
          background-color: var(--accent);
          color: white;
          padding: 4px 8px;
          font-size: 10px;
          border-radius: 4px;
          font-weight: 600;
          text-transform: uppercase;
        }

        .sidebar-tabs button.active {
          border-bottom-color: var(--accent);
          color: var(--text-primary);
        }

        .sidebar-search {
          padding: 12px;
          border-bottom: 1px solid var(--border-light);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .search-input {
          padding: 6px 10px;
          font-size: 12px;
          width: 100%;
        }

        .sidebar-actions-row {
          display: flex;
          gap: 6px;
        }

        .btn-sidebar-add {
          flex: 1;
          padding: 5px 0;
          font-size: 11px;
          background: var(--accent);
          color: white;
          border: none;
          border-radius: 4px;
        }
        .btn-sidebar-add:hover {
          background: var(--accent-hover);
        }

        .btn-sidebar-secondary {
          padding: 5px 12px;
          font-size: 11px;
          background: var(--btn-secondary);
          border: 1px solid var(--border-color);
          border-radius: 4px;
        }
        .btn-sidebar-secondary:hover {
          background: var(--btn-secondary-hover);
        }

        .sidebar-list {
          flex: 1;
          overflow-y: auto;
          padding: 8px 0;
        }

        .collection-group {
          margin-bottom: 4px;
        }

        .collection-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 12px;
          cursor: pointer;
          transition: background-color 0.15s;
        }
        .collection-header:hover {
          background-color: var(--row-hover);
        }

        .collection-title-container {
          display: flex;
          align-items: center;
          gap: 8px;
          overflow: hidden;
        }

        .folder-icon {
          color: var(--text-muted);
          flex-shrink: 0;
        }

        .collection-name {
          font-weight: 500;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .collection-options {
          display: flex;
          gap: 4px;
          opacity: 0;
          transition: opacity 0.15s;
        }

        .collection-header:hover .collection-options {
          opacity: 1;
        }

        .collection-options button {
          background: transparent;
          border: none;
          padding: 2px;
          font-size: 11px;
          cursor: pointer;
        }

        .collection-requests {
          padding-left: 20px;
          border-left: 1px dashed var(--border-color);
          margin-left: 18px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .saved-request-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 12px;
          cursor: pointer;
          border-radius: 4px;
          font-size: 12px;
          transition: background-color 0.15s;
        }
        .saved-request-item:hover {
          background-color: var(--row-hover);
        }
        .saved-request-item.active {
          background-color: var(--btn-secondary);
          font-weight: 500;
        }

        .method-text {
          font-size: 9px;
          font-weight: 700;
          width: 32px;
          text-align: left;
        }

        .request-name {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .delete-request-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          font-size: 14px;
          opacity: 0;
        }
        .saved-request-item:hover .delete-request-btn {
          opacity: 1;
        }
        .delete-request-btn:hover {
          color: var(--error);
        }

        .env-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 16px;
          cursor: pointer;
          transition: background-color 0.15s;
        }
        .env-item:hover {
          background-color: var(--row-hover);
        }
        .env-item.active {
          background-color: var(--btn-secondary);
          border-left: 3px solid var(--accent);
        }

        .env-title-text {
          font-weight: 500;
        }

        .env-item-actions {
          display: flex;
          gap: 6px;
          opacity: 0;
        }
        .env-item:hover .env-item-actions {
          opacity: 1;
        }
        .env-item-actions button {
          border: none;
          background: transparent;
          font-size: 11px;
        }

        .history-card {
          padding: 10px 16px;
          border-bottom: 1px solid var(--border-light);
          cursor: pointer;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .history-card:hover {
          background-color: var(--row-hover);
        }

        .history-top {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .history-url {
          flex: 1;
          font-family: monospace;
          font-size: 11px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--text-secondary);
        }

        .history-bottom {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 10.5px;
          color: var(--text-muted);
        }

        .history-status {
          font-weight: 600;
          color: var(--success);
        }
        .history-status.status-err {
          color: var(--error);
        }

        .empty-subtext {
          padding: 16px;
          color: var(--text-muted);
          font-size: 11px;
          text-align: center;
        }

        .sidebar-resize-handle {
          width: 4px;
          cursor: col-resize;
          background-color: transparent;
          transition: background-color 0.15s;
        }
        .sidebar-resize-handle:hover, .sidebar-resize-handle:active {
          background-color: var(--accent);
        }

        .workspace {
          display: flex;
          flex-direction: column;
          flex: 1;
          overflow: hidden;
          background-color: var(--bg-main);
        }

        .tab-bar {
          display: flex;
          background-color: var(--bg-tab-inactive);
          border-bottom: 1px solid var(--border-color);
          height: 36px;
          align-items: center;
          padding-right: 8px;
        }

        .tab-scroll-container {
          display: flex;
          flex: 1;
          overflow-x: auto;
          height: 100%;
        }
        .tab-scroll-container::-webkit-scrollbar {
          display: none;
        }

        .tab-header-item {
          display: flex;
          align-items: center;
          padding: 0 16px;
          background-color: var(--bg-tab-inactive);
          border-right: 1px solid var(--border-color);
          height: 100%;
          cursor: pointer;
          font-size: 11.5px;
          max-width: 160px;
          min-width: 100px;
          gap: 6px;
          position: relative;
        }
        .tab-header-item:hover {
          background-color: var(--bg-tab-hover);
        }
        .tab-header-item.active {
          background-color: var(--bg-tab-active);
          border-bottom: 2px solid var(--accent);
          font-weight: 500;
        }

        .method-mini-tag {
          font-size: 8px;
          font-weight: 700;
        }

        .tab-label {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1;
        }

        .dirty-dot {
          width: 6px;
          height: 6px;
          background-color: var(--accent);
          border-radius: 50%;
        }

        .tab-close-btn {
          border: none;
          background: transparent;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 12px;
          border-radius: 50%;
          width: 16px;
          height: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .tab-close-btn:hover {
          background-color: var(--btn-secondary);
          color: var(--text-primary);
        }

        .btn-tab-add {
          border: none;
          background: transparent;
          font-size: 18px;
          color: var(--text-secondary);
          width: 28px;
          height: 28px;
          border-radius: 4px;
        }
        .btn-tab-add:hover {
          background-color: var(--btn-secondary);
          color: var(--text-primary);
        }

        .request-pane {
          display: flex;
          flex-direction: column;
          padding: 16px;
          background-color: var(--bg-main);
          overflow-y: auto;
        }

        .request-toolbar {
          display: flex;
          gap: 8px;
          align-items: center;
          margin-bottom: 12px;
        }

        .method-select {
          height: 36px;
          padding: 0 12px;
          font-weight: 700;
          font-size: 12.5px;
          background-color: var(--btn-secondary);
          border-color: var(--border-color);
        }

        .url-input-container {
          flex: 1;
        }

        .url-input {
          width: 100%;
          height: 36px;
          padding: 0 12px;
          font-family: monospace;
          font-size: 12px;
        }

        .btn-send {
          background-color: var(--btn-send-bg);
          color: white;
          border: none;
          height: 36px;
          padding: 0 18px;
          border-radius: 4px;
          font-weight: 600;
        }
        .btn-send:hover {
          background-color: var(--btn-send-hover);
        }

        .btn-save {
          background-color: var(--btn-secondary);
          border-color: var(--border-color);
          height: 36px;
          padding: 0 14px;
        }
        .btn-save:hover {
          background-color: var(--btn-secondary-hover);
        }

        .btn-code-toggle {
          background-color: var(--btn-secondary);
          border-color: var(--border-color);
          height: 36px;
          padding: 0 12px;
        }
        .btn-code-toggle.active {
          border-color: var(--accent);
          color: var(--accent);
        }

        .resolved-url-preview {
          font-size: 11.5px;
          color: var(--text-muted);
          background-color: var(--bg-panel);
          padding: 6px 12px;
          border-radius: 4px;
          border: 1px solid var(--border-light);
          margin-bottom: 12px;
          word-break: break-all;
        }

        .request-tabs {
          display: flex;
          gap: 16px;
          border-bottom: 1px solid var(--border-color);
          margin-bottom: 12px;
        }

        .request-tabs button {
          border: none;
          background: transparent;
          padding: 8px 0;
          font-size: 12px;
          color: var(--text-secondary);
          border-bottom: 2px solid transparent;
          border-radius: 0;
          cursor: pointer;
        }
        .request-tabs button.active {
          border-bottom-color: var(--accent);
          color: var(--text-primary);
          font-weight: 600;
        }

        .tab-contents {
          flex: 1;
        }

        .key-value-grid {
          display: flex;
          flex-direction: column;
          border: 1px solid var(--border-color);
          border-radius: 4px;
          overflow: hidden;
        }

        .grid-header-row {
          display: grid;
          grid-template-columns: 36px 1fr 1.5fr 36px;
          background-color: var(--bg-panel);
          border-bottom: 1px solid var(--border-color);
          font-weight: 600;
          font-size: 11px;
          color: var(--text-secondary);
          align-items: center;
          height: 32px;
        }
        .grid-header-row span {
          padding: 0 8px;
        }

        .grid-rows-container {
          max-height: 180px;
          overflow-y: auto;
        }

        .grid-data-row {
          display: grid;
          grid-template-columns: 36px 1fr 1.5fr 36px;
          border-bottom: 1px solid var(--border-light);
          align-items: center;
          height: 32px;
        }
        .grid-data-row:last-child {
          border-bottom: none;
        }

        .row-checkbox {
          justify-self: center;
          width: 14px;
          height: 14px;
          cursor: pointer;
        }

        .grid-field {
          border: none !important;
          background: transparent !important;
          box-shadow: none !important;
          height: 100%;
          border-radius: 0;
          font-family: monospace;
          font-size: 11.5px;
          padding: 0 8px;
        }

        .row-delete-btn {
          border: none;
          background: transparent;
          font-size: 16px;
          color: var(--text-muted);
          cursor: pointer;
        }
        .row-delete-btn:hover {
          color: var(--error);
        }

        .auth-panel {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 8px 0;
        }

        .form-group-horizontal {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .form-group-horizontal label {
          font-weight: 500;
          width: 80px;
        }

        .auth-select {
          height: 30px;
          padding: 0 8px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .form-group label {
          font-weight: 600;
          font-size: 11.5px;
          color: var(--text-secondary);
        }

        .form-input {
          height: 32px;
          padding: 0 10px;
          width: 280px;
        }

        .basic-auth-fields {
          display: flex;
          gap: 16px;
        }

        .body-panel {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .body-type-bar {
          display: flex;
          gap: 16px;
          align-items: center;
        }

        .radio-label {
          display: flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          font-size: 12px;
        }
        .radio-label input {
          cursor: pointer;
        }

        .textarea-container {
          border: 1px solid var(--border-color);
          border-radius: 4px;
          overflow: hidden;
        }

        .body-editor {
          width: 100%;
          height: 120px;
          border: none !important;
          box-shadow: none !important;
          border-radius: 0;
          font-family: monospace;
          font-size: 12px;
          padding: 10px;
          resize: vertical;
          background-color: var(--bg-panel);
        }

        .body-raw-list {
          height: 100px;
        }

        .horizontal-resize-handle {
          height: 4px;
          cursor: row-resize;
          background-color: transparent;
          transition: background-color 0.15s;
        }
        .horizontal-resize-handle:hover, .horizontal-resize-handle:active {
          background-color: var(--accent);
        }

        .code-snippet-panel {
          background-color: var(--bg-panel);
          border: 1px solid var(--border-color);
          border-radius: 4px;
          margin: 0 16px 12px 16px;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .snippet-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .snippet-title {
          font-weight: 700;
          color: var(--accent);
        }

        .lang-select {
          height: 26px;
          padding: 0 6px;
        }

        .btn-copy {
          background-color: var(--btn-secondary);
          border-color: var(--border-color);
          padding: 4px 10px;
          font-size: 11px;
        }
        .btn-copy:hover {
          background-color: var(--btn-secondary-hover);
        }

        .snippet-code-box {
          font-family: monospace;
          font-size: 11.5px;
          background-color: var(--bg-main);
          padding: 10px;
          border-radius: 4px;
          overflow-x: auto;
          color: var(--text-primary);
          border: 1px solid var(--border-light);
          white-space: pre-wrap;
          word-break: break-all;
        }

        .response-pane {
          flex: 1;
          display: flex;
          flex-direction: column;
          background-color: var(--bg-main);
          overflow: hidden;
          border-top: 1px solid var(--border-color);
        }

        .response-toolbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0 16px;
          border-bottom: 1px solid var(--border-color);
          height: 38px;
          background-color: var(--bg-panel);
          flex-shrink: 0;
        }

        .response-tabs {
          display: flex;
          gap: 16px;
          height: 100%;
        }

        .response-tabs button {
          border: none;
          background: transparent;
          font-size: 12px;
          color: var(--text-secondary);
          border-bottom: 2px solid transparent;
          border-radius: 0;
          cursor: pointer;
        }
        .response-tabs button.active {
          border-bottom-color: var(--accent);
          color: var(--text-primary);
          font-weight: 600;
        }

        .response-status-group {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 11.5px;
          color: var(--text-secondary);
        }

        .meta-badge {
          background-color: var(--btn-secondary);
          padding: 2px 6px;
          border-radius: 3px;
          font-weight: 500;
          font-size: 10.5px;
        }

        .response-body-viewport {
          flex: 1;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          background-color: var(--bg-panel);
        }

        .response-body-tab {
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
        }

        .response-subtoolbar {
          display: flex;
          justify-content: space-between;
          padding: 8px 16px;
          border-bottom: 1px solid var(--border-light);
          align-items: center;
          background-color: var(--bg-main);
        }

        .body-modes {
          display: flex;
          border: 1px solid var(--border-color);
          border-radius: 4px;
          overflow: hidden;
        }

        .body-modes button {
          border: none;
          border-right: 1px solid var(--border-color);
          background: var(--bg-panel);
          padding: 3px 10px;
          font-size: 11px;
          border-radius: 0;
        }
        .body-modes button:last-child {
          border-right: none;
        }
        .body-modes button.active {
          background: var(--accent);
          color: white;
        }

        .body-search {
          padding: 3px 8px;
          font-size: 11.5px;
          width: 180px;
        }

        .response-render-area {
          flex: 1;
          overflow: auto;
          padding: 16px;
          background-color: var(--bg-main);
          font-family: monospace;
          font-size: 12px;
        }

        .json-container, .raw-container {
          margin: 0;
          white-space: pre-wrap;
          word-break: break-all;
        }

        .preview-iframe {
          width: 100%;
          height: 100%;
          border: none;
          background-color: white;
          border-radius: 4px;
        }

        .response-headers-tab {
          padding: 16px;
          overflow-y: auto;
          background-color: var(--bg-main);
          height: 100%;
        }

        .headers-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
        }
        .headers-table th, .headers-table td {
          padding: 6px 12px;
          border-bottom: 1px solid var(--border-light);
        }
        .headers-table th {
          background-color: var(--bg-panel);
          font-weight: 600;
          color: var(--text-secondary);
        }
        .header-key {
          font-family: monospace;
          color: var(--accent);
        }
        .header-val {
          font-family: monospace;
          word-break: break-all;
        }

        .response-empty-state {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          color: var(--text-muted);
        }
        .empty-icon {
          stroke-width: 1px;
        }

        .response-error-card {
          padding: 24px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 14px;
          color: var(--text-primary);
          height: 100%;
          overflow-y: auto;
          text-align: center;
          max-width: 440px;
          margin: 0 auto;
        }
        .error-icon {
          color: var(--error);
        }
        .response-error-card h3 {
          font-size: 15px;
          font-weight: 600;
          color: var(--text-primary);
        }
        .error-summary {
          font-size: 12.5px;
          color: var(--text-secondary);
        }
        .error-details-box {
          background-color: rgba(255, 82, 82, 0.08);
          border: 1px solid rgba(255, 82, 82, 0.2);
          border-radius: 6px;
          padding: 10px;
          width: 100%;
          text-align: left;
          font-family: monospace;
          font-size: 11px;
        }
        .error-message-text {
          color: var(--error);
          font-weight: 600;
          margin-top: 2px;
        }
        .error-details-text {
          color: var(--text-secondary);
          margin-top: 4px;
          font-size: 10px;
          white-space: pre-wrap;
          word-break: break-all;
        }
        .error-help-box {
          text-align: left;
          width: 100%;
          font-size: 11.5px;
          color: var(--text-secondary);
          background-color: var(--bg-main);
          border: 1px solid var(--border-color);
          padding: 10px 14px;
          border-radius: 6px;
        }
        .error-help-box ul {
          margin-top: 4px;
          padding-left: 16px;
        }
        .error-help-box li {
          margin-bottom: 2px;
        }

        /* Modals & Overlays */
        .modal-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: rgba(0,0,0,0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }

        .modal-card {
          background-color: var(--bg-main);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          width: 460px;
          box-shadow: 0 10px 25px var(--shadow);
          display: flex;
          flex-direction: column;
          max-height: 80vh;
        }

        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 14px 16px;
          border-bottom: 1px solid var(--border-color);
        }

        .modal-title {
          font-weight: 700;
          font-size: 13.5px;
        }

        .modal-close {
          border: none;
          background: transparent;
          font-size: 20px;
          cursor: pointer;
        }

        .modal-body {
          padding: 16px;
          overflow-y: auto;
        }

        .modal-field {
          width: 100%;
          height: 32px;
          padding: 0 10px;
        }

        .modal-sub-label {
          font-weight: 600;
          font-size: 11px;
          color: var(--text-secondary);
          margin-top: 16px;
          margin-bottom: 8px;
        }

        .env-modal-grid {
          border: 1px solid var(--border-color);
          border-radius: 4px;
          overflow: hidden;
        }

        .env-grid-header {
          display: grid;
          grid-template-columns: 1fr 1fr 36px;
          background-color: var(--bg-panel);
          border-bottom: 1px solid var(--border-color);
          font-weight: 600;
          font-size: 11px;
          color: var(--text-secondary);
          padding: 6px 0;
        }
        .env-grid-header span {
          padding: 0 8px;
        }

        .env-grid-body {
          max-height: 200px;
          overflow-y: auto;
        }

        .env-grid-row {
          display: grid;
          grid-template-columns: 1fr 1fr 36px;
          border-bottom: 1px solid var(--border-light);
          align-items: center;
          height: 32px;
        }

        .env-field {
          border: none !important;
          background: transparent !important;
          box-shadow: none !important;
          height: 100%;
          padding: 0 8px;
          font-family: monospace;
        }

        .btn-add-var {
          width: 100%;
          border: none;
          background: var(--bg-panel);
          border-top: 1px solid var(--border-color);
          padding: 8px 0;
          font-size: 11.5px;
          color: var(--text-secondary);
          border-radius: 0;
        }
        .btn-add-var:hover {
          background-color: var(--btn-secondary);
          color: var(--text-primary);
        }

        .modal-footer {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          padding: 12px 16px;
          border-top: 1px solid var(--border-color);
          background-color: var(--bg-panel);
          border-bottom-left-radius: 8px;
          border-bottom-right-radius: 8px;
        }

        .btn-modal-cancel {
          background-color: var(--btn-secondary);
          border-color: var(--border-color);
          padding: 6px 14px;
        }
        .btn-modal-cancel:hover {
          background-color: var(--btn-secondary-hover);
        }

        .btn-modal-submit {
          background-color: var(--accent);
          color: white;
          border: none;
          padding: 6px 14px;
        }
        .btn-modal-submit:hover {
          background-color: var(--accent-hover);
        }

        .btn-cookies {
          height: 36px;
          padding: 0 14px;
          background-color: var(--btn-secondary);
          color: var(--text-primary);
          border: 1px solid var(--border-color);
          border-radius: 4px;
          font-weight: 500;
          cursor: pointer;
          transition: background-color 0.2s;
        }
        .btn-cookies:hover {
          background-color: var(--btn-secondary-hover);
        }

        .cookies-manager-form {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .cookie-add-domain-row {
          display: flex;
          gap: 8px;
        }
        .cookie-domain-input {
          flex: 1;
          height: 32px;
          padding: 0 8px;
          background-color: var(--input-bg);
          border: 1px solid var(--input-border);
          color: var(--text-primary);
          border-radius: 4px;
        }
        .btn-add-domain {
          background-color: var(--accent);
          color: white;
          border: none;
          padding: 0 12px;
          height: 32px;
          border-radius: 4px;
          cursor: pointer;
        }
        .btn-add-domain:hover {
          background-color: var(--accent-hover);
        }
        .cookies-domain-list {
          max-height: 250px;
          overflow-y: auto;
          border: 1px solid var(--border-color);
          border-radius: 4px;
        }
        .cookie-domain-group {
          border-bottom: 1px solid var(--border-light);
        }
        .cookie-domain-group:last-child {
          border-bottom: none;
        }
        .cookie-domain-header {
          display: flex;
          justify-content: space-between;
          padding: 8px 12px;
          background-color: var(--bg-panel);
          cursor: pointer;
          font-weight: 600;
        }
        .cookie-domain-header:hover {
          background-color: var(--row-hover);
        }
        .cookie-items-container {
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          background-color: var(--bg-main);
        }
        .cookie-item-row {
          display: flex;
          gap: 6px;
          align-items: center;
        }
        .cookie-field-input {
          flex: 1;
          height: 28px;
          padding: 0 8px;
          background-color: var(--input-bg);
          border: 1px solid var(--input-border);
          color: var(--text-primary);
          border-radius: 4px;
          font-size: 11.5px;
          font-family: monospace;
        }
        .cookie-field-input-short {
          width: 50px;
          height: 28px;
          padding: 0 4px;
          background-color: var(--input-bg);
          border: 1px solid var(--input-border);
          color: var(--text-primary);
          border-radius: 4px;
          font-size: 11.5px;
          font-family: monospace;
          text-align: center;
        }
        .cookie-action-buttons {
          display: flex;
          gap: 6px;
        }
        .cookie-action-buttons button {
          border: none;
          background: transparent;
          cursor: pointer;
          font-size: 12px;
          padding: 2px;
        }
        .btn-add-cookie-row {
          background: var(--bg-panel);
          border: 1px dashed var(--border-color);
          padding: 6px 0;
          font-size: 11px;
          color: var(--text-secondary);
          width: 100%;
          border-radius: 4px;
          cursor: pointer;
        }
        .btn-add-cookie-row:hover {
          background-color: var(--row-hover);
          color: var(--text-primary);
        }

        /* Toasts rendering */
        .toast-container {
          position: fixed;
          top: 16px;
          right: 16px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          z-index: 2000;
        }

        .toast-card {
          padding: 10px 14px;
          border-radius: 4px;
          color: white;
          font-weight: 500;
          font-size: 12px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 280px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.25);
          animation: slideIn 0.2s ease-out;
        }
        
        .toast-success { background-color: #2e7d32; }
        .toast-error { background-color: #c62828; }
        .toast-info { background-color: #1565c0; }

        .toast-card button {
          border: none;
          background: transparent;
          color: white;
          font-size: 16px;
          cursor: pointer;
        }

        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>

    </div>
  );
}
