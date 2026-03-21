const MAX_TEXT_STEP_LENGTH = 180;

function safePreview(value, max = 220) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    return value.length > max ? `${value.slice(0, max)}...` : value;
  }

  try {
    const raw = JSON.stringify(value);
    return raw.length > max ? `${raw.slice(0, max)}...` : raw;
  } catch {
    const raw = String(value);
    return raw.length > max ? `${raw.slice(0, max)}...` : raw;
  }
}

function pushStep(tracker, step) {
  tracker.counter += 1;
  tracker.steps.push({
    id: `timeline-step-${tracker.counter}`,
    at: new Date().toISOString(),
    ...step,
  });
}

function normalizeText(value) {
  return String(value || "").trim();
}

function extractSignals(payload) {
  const parts = payload?.result?.status?.message?.parts;
  if (!Array.isArray(parts)) return [];

  const signals = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const data = part.data;
    if (!data || typeof data !== "object") continue;
    if (typeof data.type === "string" && data.type.trim()) {
      signals.push(data);
    }
  }
  return signals;
}

function extractAgentName(payload) {
  const metadata = payload?.result?.status?.message?.metadata;
  if (metadata?.agent_name) return normalizeText(metadata.agent_name);
  const taskMeta = payload?.result?.metadata;
  if (taskMeta?.agent_name) return normalizeText(taskMeta.agent_name);
  return "";
}

function formatAgentLabel(rawName) {
  return rawName
    .replace(/([_-])/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function addAgentStatusStep(tracker, statusText) {
  const text = normalizeText(statusText);
  if (!text) return false;
  if (tracker.seenTexts.has(text)) return false;
  tracker.seenTexts.add(text);

  pushStep(tracker, {
    kind: "agent_progress_update",
    status: "info",
    title: text,
  });
  return true;
}

function applySignal(tracker, signal) {
  const signalType = normalizeText(signal?.type);
  if (!signalType) return false;

  if (signalType === "tool_invocation_start") {
    const callId = normalizeText(signal.function_call_id);
    if (callId && tracker.toolCallStepIndex.has(callId)) return false;

    const toolName = normalizeText(signal.tool_name) || "unknown";

    // Detect peer agent calls and show an agent handoff
    if (toolName.startsWith("peer_")) {
      let peerAgent = "";
      // Try to extract agent_name from tool_args metadata
      const args = signal.tool_args;
      if (args && typeof args === "object" && args.metadata?.agent_name) {
        peerAgent = normalizeText(args.metadata.agent_name);
      }
      if (!peerAgent) {
        // Derive from tool name: peer_InventoryDB -> InventoryDB
        peerAgent = toolName.replace(/^peer_/, "");
      }
      const label = formatAgentLabel(peerAgent);
      if (peerAgent !== tracker.currentAgent) {
        tracker.currentAgent = peerAgent;
        pushStep(tracker, {
          kind: "agent_handoff",
          status: "info",
          title: `Agent: ${label}`,
        });
      }
    }

    const argsPreview = safePreview(signal.tool_args, 140);
    pushStep(tracker, {
      kind: signalType,
      status: "running",
      title: `Tool: ${toolName}`,
      detail: argsPreview || undefined,
      callId: callId || undefined,
    });

    if (callId) {
      tracker.toolCallStepIndex.set(callId, tracker.steps.length - 1);
    }
    return true;
  }

  if (signalType === "tool_result") {
    const callId = normalizeText(signal.function_call_id);
    const resultPreview = safePreview(signal.result_data, 160);
    const resultStatus =
      signal?.result_data && typeof signal.result_data === "object"
        ? normalizeText(signal.result_data.status).toLowerCase()
        : "";
    const isError = resultStatus === "error";

    if (callId && tracker.toolCallStepIndex.has(callId)) {
      const index = tracker.toolCallStepIndex.get(callId);
      const step = tracker.steps[index];
      if (step) {
        step.status = isError ? "error" : "completed";
        step.detail = resultPreview || step.detail;
        step.updatedAt = new Date().toISOString();
      }
      return true;
    }

    pushStep(tracker, {
      kind: signalType,
      status: isError ? "error" : "completed",
      title: `Tool completed: ${normalizeText(signal.tool_name) || "unknown"}`,
      detail: resultPreview || undefined,
      callId: callId || undefined,
    });
    return true;
  }

  if (signalType === "agent_progress_update") {
    return addAgentStatusStep(tracker, signal.status_text);
  }

  if (signalType === "artifact_saved") {
    const key = `${normalizeText(signal.filename)}:${normalizeText(signal.version)}`;
    if (tracker.seenArtifacts.has(key)) return false;
    tracker.seenArtifacts.add(key);
    pushStep(tracker, {
      kind: signalType,
      status: "completed",
      title: `Artifact saved: ${normalizeText(signal.filename) || "artifact"}`,
      detail: signal.version ? `Version ${signal.version}` : undefined,
    });
    return true;
  }

  if (signalType === "artifact_creation_progress") {
    const artifactStatus = normalizeText(signal.status).toLowerCase();
    if (artifactStatus === "in-progress") return false;

    const key = `${normalizeText(signal.filename)}:${artifactStatus}`;
    if (tracker.seenArtifacts.has(key)) return false;
    tracker.seenArtifacts.add(key);

    pushStep(tracker, {
      kind: signalType,
      status: artifactStatus === "failed" ? "error" : "completed",
      title: `${artifactStatus === "failed" ? "Artifact failed" : "Artifact ready"}: ${
        normalizeText(signal.filename) || "artifact"
      }`,
    });
    return true;
  }

  if (signalType === "deep_research_progress") {
    const text = normalizeText(signal.status_text);
    const percent = Number.isFinite(signal.progress_percentage)
      ? ` (${signal.progress_percentage}%)`
      : "";
    return addAgentStatusStep(tracker, `${text}${percent}`);
  }

  if (signalType === "llm_invocation") {
    const model =
      normalizeText(signal?.usage?.model) ||
      normalizeText(signal?.request?.model) ||
      "LLM";
    return addAgentStatusStep(tracker, `LLM call: ${model}`);
  }

  return false;
}

export function createExecutionTimelineTracker() {
  return {
    counter: 0,
    steps: [],
    toolCallStepIndex: new Map(),
    seenTexts: new Set(),
    seenArtifacts: new Set(),
    currentAgent: "",
  };
}

export function getExecutionTimelineSnapshot(tracker) {
  if (!tracker) return [];
  return tracker.steps.map((step) => ({ ...step }));
}

export function appendExecutionLifecycleStep(tracker, step) {
  if (!tracker || !step || !step.title) return false;
  pushStep(tracker, {
    kind: step.kind || "lifecycle",
    status: step.status || "info",
    title: step.title,
    detail: step.detail || undefined,
  });
  return true;
}

export function applyStatusUpdateToTimeline(tracker, text, payload) {
  if (!tracker) return false;

  const taskState = payload?.result?.status?.state;
  const signals = extractSignals(payload);
  console.log("[Timeline] status_update", {
    state: taskState,
    signalCount: signals.length,
    signalTypes: signals.map((s) => s.type),
    textPreview: text?.slice(0, 100),
    payloadKeys: Object.keys(payload?.result || {}),
    statusKeys: Object.keys(payload?.result?.status || {}),
    final: payload?.result?.final ?? payload?.final,
  });

  // When the task state is "completed", record a completion step but skip
  // processing the response text so it doesn't appear as a timeline detail.
  if (taskState === "completed") {
    const already = tracker.seenTexts.has("__task_completed__");
    if (!already) {
      tracker.seenTexts.add("__task_completed__");
      pushStep(tracker, {
        kind: "lifecycle",
        status: "completed",
        title: "Task completed",
      });
    }
    return !already;
  }

  let changed = false;

  // Detect agent handoffs
  const agentName = extractAgentName(payload);
  if (agentName && agentName !== tracker.currentAgent) {
    tracker.currentAgent = agentName;
    const label = formatAgentLabel(agentName);
    pushStep(tracker, {
      kind: "agent_handoff",
      status: "info",
      title: `Agent: ${label}`,
    });
    changed = true;
  }

  for (const signal of signals) {
    changed = applySignal(tracker, signal) || changed;
  }

  // Only show structured signals in the timeline — skip raw agent text
  // to avoid cluttering the progress view with streaming content.

  return changed;
}

export function applyArtifactUpdateToTimeline(tracker, payload) {
  if (!tracker) return false;

  const result = payload?.result;
  const artifact = result?.artifact;
  if (!artifact || typeof artifact !== "object") return false;

  const isLastChunk = Boolean(result?.lastChunk ?? result?.last_chunk);
  if (!isLastChunk) return false;

  const artifactName =
    normalizeText(artifact.name) ||
    normalizeText(artifact.filename) ||
    normalizeText(artifact.id) ||
    "artifact";

  const key = `artifact-update:${artifactName}`;
  if (tracker.seenArtifacts.has(key)) return false;
  tracker.seenArtifacts.add(key);

  pushStep(tracker, {
    kind: "artifact_update",
    status: "completed",
    title: `Artifact ready: ${artifactName}`,
  });
  return true;
}
