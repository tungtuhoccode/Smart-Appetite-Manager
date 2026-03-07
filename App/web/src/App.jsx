import React, { useCallback, useEffect, useRef, useState } from "react";

const storage = {
  gatewayUrl: "inventory_gateway_url",
  sessionId: "inventory_gateway_session_id",
  agentName: "inventory_gateway_agent_name",
};

function makeId(prefix) {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return `${prefix}-${window.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function collectTextParts(node, out) {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    node.forEach((v) => collectTextParts(v, out));
    return;
  }
  if (typeof node !== "object") return;

  if ((node.kind === "text" || node.type === "text") && typeof node.text === "string") {
    const t = node.text.trim();
    if (t) out.push(t);
  }
  if ((node.kind === "text" || node.type === "text") && typeof node.content === "string") {
    const t = node.content.trim();
    if (t) out.push(t);
  }
  Object.values(node).forEach((v) => collectTextParts(v, out));
}

function extractDisplayText(payload) {
  const parts = [];
  collectTextParts(payload, parts);
  const unique = [];
  const seen = new Set();
  parts.forEach((line) => {
    if (!seen.has(line)) {
      seen.add(line);
      unique.push(line);
    }
  });
  return unique.join("\n\n").trim();
}

export default function App() {
  const [gatewayUrl, setGatewayUrl] = useState("http://localhost:8000");
  const [agentName, setAgentName] = useState("InventoryManager");
  const [sessionId, setSessionId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [chat, setChat] = useState([]);
  const [eventLog, setEventLog] = useState("Ready.");
  const [isSending, setIsSending] = useState(false);

  const activeEventSourceRef = useRef(null);
  const chatBoxRef = useRef(null);

  const appendBubble = useCallback((role, text, meta) => {
    setChat((prev) => [...prev, { id: makeId("bubble"), role, text, meta }]);
  }, []);

  const logEvent = useCallback((text) => {
    const stamp = new Date().toLocaleTimeString();
    setEventLog((prev) => `[${stamp}] ${text}\n${prev}`);
  }, []);

  const saveSettings = useCallback((nextGatewayUrl, nextSessionId, nextAgentName) => {
    localStorage.setItem(storage.gatewayUrl, nextGatewayUrl.trim());
    localStorage.setItem(storage.sessionId, nextSessionId.trim());
    localStorage.setItem(storage.agentName, nextAgentName);
  }, []);

  const closeActiveStream = useCallback(() => {
    if (activeEventSourceRef.current) {
      activeEventSourceRef.current.close();
      activeEventSourceRef.current = null;
    }
  }, []);

  const readBaseUrl = useCallback(() => gatewayUrl.trim().replace(/\/$/, ""), [gatewayUrl]);

  const openSse = useCallback(
    (taskId) => {
      const sseUrl = `${readBaseUrl()}/api/v1/sse/subscribe/${encodeURIComponent(taskId)}`;
      const eventSource = new EventSource(sseUrl);
      activeEventSourceRef.current = eventSource;

      let gotFinal = false;

      const closeStream = () => {
        eventSource.close();
        if (activeEventSourceRef.current === eventSource) {
          activeEventSourceRef.current = null;
        }
      };

      const handlePayload = (kind, event) => {
        if (!event || !event.data) return;
        try {
          const payload = JSON.parse(event.data);
          const text = extractDisplayText(payload);

          if (kind === "status_update") {
            if (text) {
              logEvent("Status update received.");
            }
          } else if (kind === "artifact_update") {
            logEvent("Artifact update received.");
          } else if (kind === "final_response") {
            gotFinal = true;
            appendBubble("assistant", text || JSON.stringify(payload, null, 2), `task ${taskId}`);
            logEvent("Final response received.");
            closeStream();
            setIsSending(false);
          } else if (kind === "error") {
            appendBubble("assistant", `Gateway SSE error:\n${text || JSON.stringify(payload, null, 2)}`);
            logEvent("SSE error event.");
            closeStream();
            setIsSending(false);
          }
        } catch {
          logEvent("Could not parse SSE payload.");
        }
      };

      eventSource.addEventListener("status_update", (e) => handlePayload("status_update", e));
      eventSource.addEventListener("artifact_update", (e) => handlePayload("artifact_update", e));
      eventSource.addEventListener("final_response", (e) => handlePayload("final_response", e));
      eventSource.addEventListener("error", (e) => handlePayload("error", e));

      eventSource.onerror = () => {
        if (!gotFinal) {
          appendBubble("assistant", "SSE connection closed before final response. Check gateway logs.");
          logEvent("SSE connection closed unexpectedly.");
        }
        closeStream();
        setIsSending(false);
      };
    },
    [appendBubble, logEvent, readBaseUrl]
  );

  const sendPrompt = useCallback(
    async (promptText) => {
      const trimmedPrompt = promptText.trim();
      if (!trimmedPrompt) return;

      let nextSessionId = sessionId.trim();
      if (!nextSessionId) {
        nextSessionId = makeId("web-session");
        setSessionId(nextSessionId);
      }

      saveSettings(gatewayUrl, nextSessionId, agentName);
      closeActiveStream();

      appendBubble("user", trimmedPrompt, agentName);
      setIsSending(true);
      logEvent("Submitting task...");

      const payload = {
        jsonrpc: "2.0",
        id: makeId("req"),
        method: "message/stream",
        params: {
          message: {
            role: "user",
            parts: [{ kind: "text", text: trimmedPrompt }],
            messageId: makeId("msg"),
            kind: "message",
            contextId: nextSessionId,
            metadata: {
              agent_name: agentName,
            },
          },
        },
      };

      try {
        const response = await fetch(`${readBaseUrl()}/api/v1/message:stream`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        const json = await response.json();
        if (!response.ok || json.error) {
          const err = json.error ? JSON.stringify(json.error) : JSON.stringify(json);
          throw new Error(err);
        }

        const taskId = json?.result?.id;
        const contextId = json?.result?.contextId;
        if (!taskId) {
          throw new Error("No task ID returned from gateway.");
        }

        if (contextId && contextId !== nextSessionId) {
          setSessionId(contextId);
          saveSettings(gatewayUrl, contextId, agentName);
        }

        appendBubble("assistant", "Task accepted. Streaming response...", `task ${taskId}`);
        logEvent(`Task created: ${taskId}`);
        openSse(taskId);
      } catch (error) {
        appendBubble("assistant", `Request failed:\n${error?.message || String(error)}`);
        logEvent("Request failed.");
        setIsSending(false);
      }
    },
    [
      agentName,
      appendBubble,
      closeActiveStream,
      gatewayUrl,
      logEvent,
      openSse,
      readBaseUrl,
      saveSettings,
      sessionId,
    ]
  );

  useEffect(() => {
    const savedGatewayUrl = localStorage.getItem(storage.gatewayUrl) || "http://localhost:8000";
    const savedSessionId = localStorage.getItem(storage.sessionId) || makeId("web-session");
    const savedAgentName = localStorage.getItem(storage.agentName) || "InventoryManager";

    setGatewayUrl(savedGatewayUrl);
    setSessionId(savedSessionId);
    setAgentName(savedAgentName);
    saveSettings(savedGatewayUrl, savedSessionId, savedAgentName);
    appendBubble(
      "assistant",
      "Inventory Gateway UI ready.\nUse Ctrl/Cmd+Enter to send.",
      savedSessionId
    );

    return () => closeActiveStream();
  }, [appendBubble, closeActiveStream, saveSettings]);

  useEffect(() => {
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [chat]);

  return (
    <main className="shell">
      <section className="panel">
        <header className="panel-header">
          <h1>Inventory Control</h1>
          <div className="subtitle">Web UI -&gt; SAM Gateway (SSE) -&gt; InventoryManager -&gt; SQLite inventory</div>
        </header>
        <div className="panel-body">
          <div className="field">
            <label htmlFor="gatewayUrl">Gateway URL</label>
            <input
              id="gatewayUrl"
              type="text"
              value={gatewayUrl}
              onChange={(e) => {
                const next = e.target.value;
                setGatewayUrl(next);
                saveSettings(next, sessionId, agentName);
              }}
            />
          </div>

          <div className="field">
            <label htmlFor="agentName">Target Agent</label>
            <select
              id="agentName"
              value={agentName}
              onChange={(e) => {
                const next = e.target.value;
                setAgentName(next);
                saveSettings(gatewayUrl, sessionId, next);
              }}
            >
              <option value="InventoryManager">InventoryManager (direct)</option>
              <option value="OrchestratorAgent">OrchestratorAgent (delegated)</option>
            </select>
          </div>

          <div className="row">
            <div className="field">
              <label htmlFor="sessionId">Session ID</label>
              <input
                id="sessionId"
                type="text"
                value={sessionId}
                onChange={(e) => {
                  const next = e.target.value;
                  setSessionId(next);
                  saveSettings(gatewayUrl, next, agentName);
                }}
              />
            </div>
            <div className="field">
              <label>&nbsp;</label>
              <button
                className="ghost"
                type="button"
                onClick={() => {
                  closeActiveStream();
                  const nextSessionId = makeId("web-session");
                  setSessionId(nextSessionId);
                  saveSettings(gatewayUrl, nextSessionId, agentName);
                  appendBubble("assistant", "Started a new session.", nextSessionId);
                }}
              >
                New Session
              </button>
            </div>
          </div>

          <div className="field">
            <label htmlFor="promptInput">Prompt</label>
            <textarea
              id="promptInput"
              placeholder="Example: Add 2 kg rice, 1 liter milk, and 6 eggs to inventory."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  sendPrompt(prompt);
                }
              }}
            />
          </div>

          <div className="button-row">
            <button className="primary" type="button" onClick={() => sendPrompt(prompt)} disabled={isSending}>
              Send
            </button>
            <button
              className="ghost"
              type="button"
              disabled={isSending}
              onClick={() => {
                const listPrompt =
                  "List the current inventory with product_name, quantity, quantity_unit, and unit.";
                setPrompt(listPrompt);
                sendPrompt(listPrompt);
              }}
            >
              List Inventory
            </button>
            <button
              className="danger"
              type="button"
              onClick={() => {
                closeActiveStream();
                setChat([]);
                setEventLog("Cleared chat.");
              }}
            >
              Clear Chat
            </button>
          </div>

          <div className="log">{eventLog}</div>
        </div>
      </section>

      <section className="panel">
        <header className="panel-header">
          <h2>Conversation</h2>
          <div className="subtitle">SSE events are streamed and final agent output is shown below.</div>
        </header>
        <div className="chat" ref={chatBoxRef}>
          {chat.map((item) => (
            <div className={`bubble ${item.role === "user" ? "user" : "assistant"}`} key={item.id}>
              {item.text}
              {item.meta ? <div className="meta">{item.meta}</div> : null}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
