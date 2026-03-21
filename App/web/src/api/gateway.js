/**
 * SAM Gateway Client
 *
 * Handles JSON-RPC communication with the Solace Agent Mesh HTTP SSE Gateway.
 * Instead of traditional REST endpoints, communication happens through natural
 * language prompts sent to specific agents, which return structured data via SSE.
 */

const DEFAULT_GATEWAY_URL = "http://localhost:8000";

function makeId(prefix) {
  
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return `${prefix}-${window.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Recursively collects all text parts from a gateway SSE payload.
 */
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

export class GatewayClient {
  constructor(gatewayUrl = DEFAULT_GATEWAY_URL) {
    this.gatewayUrl = gatewayUrl.replace(/\/$/, "");
    this.sessionId = null;
    this.activeEventSource = null;
  }

  setGatewayUrl(url) {
    this.gatewayUrl = url.replace(/\/$/, "");
  }

  getSessionId() {
    if (!this.sessionId) {
      this.sessionId = makeId("web-session");
    }
    return this.sessionId;
  }

  setSessionId(id) {
    this.sessionId = id;
  }

  resetSession() {
    this.closeStream();
    this.sessionId = makeId("web-session");
    return this.sessionId;
  }

  closeStream() {
    if (this.activeEventSource) {
      this.activeEventSource.close();
      this.activeEventSource = null;
    }
  }

  /**
   * Upload a file as an artifact. If a session already exists and is valid,
   * uses it; otherwise lets the gateway create a new session and adopts its ID.
   *
   * @param {File} file - The file to upload
   * @param {string} [filename] - Override filename (defaults to file.name)
   * @returns {Promise<object>} Upload response with uri, filename, sessionId, etc.
   */
  async uploadArtifact(file, filename) {
    // Try with current session first; if none exists, let gateway create one
    const existingSession = this.sessionId;
    const form = new FormData();
    form.append("upload_file", file);
    if (existingSession) {
      form.append("sessionId", existingSession);
    }
    if (filename) {
      form.append("filename", filename);
    }

    let response = await fetch(`${this.gatewayUrl}/api/v1/artifacts/upload`, {
      method: "POST",
      body: form,
    });

    // If session validation failed (403), retry without session to create a new one
    if (response.status === 403 && existingSession) {
      const retryForm = new FormData();
      retryForm.append("upload_file", file);
      if (filename) {
        retryForm.append("filename", filename);
      }
      response = await fetch(`${this.gatewayUrl}/api/v1/artifacts/upload`, {
        method: "POST",
        body: retryForm,
      });
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Artifact upload failed (${response.status}): ${text}`);
    }

    const result = await response.json();

    // Adopt the session ID from the upload response so the chat uses the same session
    if (result.sessionId) {
      this.sessionId = result.sessionId;
    }

    return result;
  }

  /**
   * Send a prompt to a specific agent and get the response via SSE streaming.
   *
   * @param {string} prompt - Natural language prompt
   * @param {string} agentName - Target agent (e.g. "InventoryManager", "OrchestratorAgent")
   * @param {object} options
   * @param {function} options.onStatus - Called on status updates
   * @param {function} options.onArtifact - Called on artifact updates (raw payload)
   * @param {function} options.onError - Called on errors
   * @returns {Promise<{ text: string, raw: object }>} Final response
   */
  async send(prompt, agentName, options = {}) {
    const { onStatus, onArtifact, onError } = options;

    this.closeStream();

    const sessionId = this.getSessionId();

    const payload = {
      jsonrpc: "2.0",
      id: makeId("req"),
      method: "message/stream",
      params: {
        message: {
          role: "user",
          parts: [{ kind: "text", text: prompt }],
          messageId: makeId("msg"),
          kind: "message",
          contextId: sessionId,
          metadata: { agent_name: agentName },
        },
      },
    };

    const response = await fetch(`${this.gatewayUrl}/api/v1/message:stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

    if (contextId && contextId !== sessionId) {
      this.sessionId = contextId;
    }

    return new Promise((resolve, reject) => {
      const sseUrl = `${this.gatewayUrl}/api/v1/sse/subscribe/${encodeURIComponent(taskId)}`;
      const eventSource = new EventSource(sseUrl);
      this.activeEventSource = eventSource;

      let gotFinal = false;

      const closeStream = () => {
        eventSource.close();
        if (this.activeEventSource === eventSource) {
          this.activeEventSource = null;
        }
      };

      const handlePayload = (kind, event) => {
        if (!event?.data) return;
        try {
          const payload = JSON.parse(event.data);
          const text = extractDisplayText(payload);

          console.log(`[Gateway] SSE event: ${kind}`, {
            state: payload?.result?.status?.state,
            final: payload?.result?.final ?? payload?.final,
            textPreview: text?.slice(0, 120),
          });

          if (kind === "status_update") {
            onStatus?.(text, payload);
          } else if (kind === "artifact_update") {
            onArtifact?.(payload);
          } else if (kind === "final_response") {
            gotFinal = true;
            closeStream();
            console.log("[Gateway] final_response:", payload);
            resolve({ text: text || JSON.stringify(payload, null, 2), raw: payload, taskId });
          } else if (kind === "error") {
            closeStream();
            const error = new Error(text || JSON.stringify(payload, null, 2));
            error.raw = payload;
            onError?.(error);
            reject(error);
          }
        } catch {
          // parse error - ignore non-JSON payloads
        }
      };

      eventSource.addEventListener("status_update", (e) => handlePayload("status_update", e));
      eventSource.addEventListener("artifact_update", (e) => handlePayload("artifact_update", e));
      eventSource.addEventListener("final_response", (e) => handlePayload("final_response", e));
      eventSource.addEventListener("error", (e) => handlePayload("error", e));

      eventSource.onerror = () => {
        if (!gotFinal) {
          closeStream();
          reject(new Error("SSE connection closed before final response."));
        }
      };
    });
  }
}

// Singleton instance
let clientInstance = null;

export function getGatewayClient(gatewayUrl) {
  if (!clientInstance) {
    clientInstance = new GatewayClient(gatewayUrl);
  } else if (gatewayUrl) {
    clientInstance.setGatewayUrl(gatewayUrl);
  }
  return clientInstance;
}

/**
 * Extract text parts from an SSE status-update payload following the SAM
 * message structure: payload.result.status.message.parts[].
 *
 * Only collects parts with kind === "text", skipping data/progress parts.
 * Returns the raw text without trimming so markdown formatting is preserved.
 */
function extractMessageTextParts(payload) {
  const parts = payload?.result?.status?.message?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((p) => p.kind === "text" || p.type === "text")
    .map((p) => p.text ?? p.content ?? "")
    .join("");
}

export { makeId, extractDisplayText, extractMessageTextParts };
