import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { inventoryRestApi } from "@/api/inventoryRest";
import { useGateway } from "@/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { InventoryTable } from "@/components/inventory/InventoryTable";
import { AddItemDialog } from "@/components/inventory/AddItemDialog";
import { EditItemDialog } from "@/components/inventory/EditItemDialog";
import { DeleteItemDialog } from "@/components/inventory/DeleteItemDialog";

const gatewayStorage = {
  gatewayUrl: "inventory_gateway_url",
  sessionId: "inventory_gateway_session_id",
  agentName: "inventory_gateway_agent_name",
};

function makeSessionId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return `web-session-${window.crypto.randomUUID()}`;
  }
  return `web-session-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 9)}`;
}

function responseToChatText(result) {
  if (typeof result?.text === "string" && result.text.trim()) {
    return result.text.trim();
  }
  if (result?.data && typeof result.data === "string") {
    return result.data;
  }
  if (result?.data && typeof result.data === "object") {
    return JSON.stringify(result.data, null, 2);
  }
  return "Done.";
}

function extractItems(result) {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  if (Array.isArray(result.rows)) return result.rows;
  const { data, type } = result;
  if (type === "json") {
    if (Array.isArray(data)) return data;
    if (data?.rows && Array.isArray(data.rows)) return data.rows;
    if (data?.data && Array.isArray(data.data)) return data.data;
  }
  if (type === "table" && Array.isArray(data)) return data;
  return [];
}

export default function InventoryPage() {
  const { client, api } = useGateway();
  const [items, setItems] = useState([]);
  const [sortDirection, setSortDirection] = useState("desc");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [deleteItem, setDeleteItem] = useState(null);
  const [mutating, setMutating] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatSessionId, setChatSessionId] = useState("");
  const [chatMessages, setChatMessages] = useState([
    {
      id: "inventory-chat-welcome",
      role: "assistant",
      text: "Inventory chat ready. Ask me to add, update, delete, or explain your inventory.",
    },
  ]);
  const fetchingRef = useRef(false);
  const chatScrollRef = useRef(null);

  const persistSession = useCallback(() => {
    const currentSessionId = client.getSessionId();
    setChatSessionId(currentSessionId);
    localStorage.setItem(gatewayStorage.sessionId, currentSessionId);
    localStorage.setItem(gatewayStorage.agentName, "InventoryManager");
  }, [client]);

  const fetchItems = useCallback(async ({ background = false } = {}) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;

    if (!background) {
      setLoading(true);
    }
    setError(null);

    try {
      const result = await inventoryRestApi.list();
      setItems(extractItems(result));
      setLastSyncedAt(new Date());
    } catch (err) {
      const normalized = err instanceof Error ? err : new Error(String(err));
      setError(normalized);
    } finally {
      fetchingRef.current = false;
      if (!background) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const savedGatewayUrl =
      localStorage.getItem(gatewayStorage.gatewayUrl) || "http://localhost:8000";
    const savedSessionId =
      localStorage.getItem(gatewayStorage.sessionId) || makeSessionId();

    client.setGatewayUrl(savedGatewayUrl);
    client.setSessionId(savedSessionId);
    setChatSessionId(savedSessionId);
    localStorage.setItem(gatewayStorage.gatewayUrl, savedGatewayUrl);
    localStorage.setItem(gatewayStorage.sessionId, savedSessionId);
    localStorage.setItem(gatewayStorage.agentName, "InventoryManager");
  }, [client]);

  useEffect(() => {
    void fetchItems();
    const intervalId = window.setInterval(() => {
      void fetchItems({ background: true });
    }, 5000);
    const onFocus = () => {
      void fetchItems({ background: true });
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
    };
  }, [fetchItems]);

  const handleAdd = async (description) => {
    setMutating(true);
    try {
      await api.inventory.addItems(description);
      persistSession();
      toast.success("Items added successfully");
      setAddOpen(false);
      await fetchItems({ background: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Failed to add items", { description: message });
    } finally {
      setMutating(false);
    }
  };

  const handleIncrease = async (item, amount) => {
    setMutating(true);
    try {
      const unit = item.quantity_unit || item.unit || "unit";
      await api.inventory.increaseStock(item.product_name, amount, unit);
      persistSession();
      toast.success(`Increased ${item.product_name} stock`);
      setEditItem(null);
      await fetchItems({ background: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Failed to increase stock", { description: message });
    } finally {
      setMutating(false);
    }
  };

  const handleDecrease = async (item, amount) => {
    setMutating(true);
    try {
      const unit = item.quantity_unit || item.unit || "unit";
      await api.inventory.decreaseStock(item.product_name, amount, unit);
      persistSession();
      toast.success(`Decreased ${item.product_name} stock`);
      setEditItem(null);
      await fetchItems({ background: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Failed to decrease stock", { description: message });
    } finally {
      setMutating(false);
    }
  };

  const handleDelete = async (item) => {
    setMutating(true);
    try {
      await api.inventory.deleteItem(item.product_name);
      persistSession();
      toast.success(`Deleted ${item.product_name}`);
      setDeleteItem(null);
      await fetchItems({ background: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Failed to delete item", { description: message });
    } finally {
      setMutating(false);
    }
  };

  const sendChat = useCallback(async () => {
    const prompt = chatInput.trim();
    if (!prompt || chatSending) return;

    const userMessage = {
      id: `chat-user-${Date.now()}`,
      role: "user",
      text: prompt,
    };
    setChatMessages((prev) => [...prev, userMessage]);
    setChatInput("");
    setChatSending(true);

    try {
      const result = await api.inventory.prompt(prompt);
      persistSession();
      setChatMessages((prev) => [
        ...prev,
        {
          id: `chat-assistant-${Date.now()}`,
          role: "assistant",
          text: responseToChatText(result),
        },
      ]);
      await fetchItems({ background: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setChatMessages((prev) => [
        ...prev,
        {
          id: `chat-assistant-error-${Date.now()}`,
          role: "assistant",
          text: `Request failed: ${message}`,
        },
      ]);
      toast.error("Inventory chat failed", { description: message });
    } finally {
      setChatSending(false);
    }
  }, [api, chatInput, chatSending, fetchItems, persistSession]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, chatOpen]);

  const sortedItems = useMemo(() => {
    const next = [...items];
    next.sort((a, b) => {
      const aTs = String(a?.updated_at || a?.created_at || "");
      const bTs = String(b?.updated_at || b?.created_at || "");
      if (aTs === bTs) return 0;
      if (sortDirection === "desc") {
        return aTs < bTs ? 1 : -1;
      }
      return aTs > bTs ? 1 : -1;
    });
    return next;
  }, [items, sortDirection]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <CardTitle className="text-2xl font-bold">Inventory</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Manage your kitchen inventory items
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {lastSyncedAt
                ? `Live backend sync: ${lastSyncedAt.toLocaleTimeString()}`
                : "Live backend sync: pending"}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => void fetchItems()}
              disabled={loading}
            >
              {loading ? "Refreshing..." : "Refresh"}
            </Button>
            <Button variant="outline" onClick={() => setChatOpen(true)}>
              Manage via Chat
            </Button>
            <Button onClick={() => setAddOpen(true)}>Add Items</Button>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 mb-4">
              <p className="text-sm text-destructive">
                Failed to load inventory: {error.message}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => void fetchItems()}
              >
                Retry
              </Button>
            </div>
          )}
          <InventoryTable
            items={sortedItems}
            loading={loading}
            onEdit={setEditItem}
            onDelete={setDeleteItem}
            sortDirection={sortDirection}
            onToggleSort={() =>
              setSortDirection((prev) => (prev === "desc" ? "asc" : "desc"))
            }
          />
        </CardContent>
      </Card>

      <AddItemDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onSubmit={handleAdd}
        loading={mutating}
      />

      <EditItemDialog
        item={editItem}
        open={!!editItem}
        onOpenChange={(open) => !open && setEditItem(null)}
        onIncrease={handleIncrease}
        onDecrease={handleDecrease}
        loading={mutating}
      />

      <DeleteItemDialog
        item={deleteItem}
        open={!!deleteItem}
        onOpenChange={(open) => !open && setDeleteItem(null)}
        onConfirm={handleDelete}
        loading={mutating}
      />

      <Dialog open={chatOpen} onOpenChange={setChatOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Inventory Chat</DialogTitle>
            <DialogDescription>
              Manage inventory through chat with the same session context.
              {chatSessionId ? ` Session: ${chatSessionId}` : ""}
            </DialogDescription>
          </DialogHeader>

          <div
            ref={chatScrollRef}
            className="max-h-[50vh] overflow-y-auto rounded-md border bg-muted/20 p-3 space-y-2"
          >
            {chatMessages.map((message) => (
              <div
                key={message.id}
                className={`rounded-md px-3 py-2 text-sm whitespace-pre-wrap ${
                  message.role === "user"
                    ? "ml-8 bg-primary/10 border border-primary/20"
                    : "mr-8 bg-background border"
                }`}
              >
                {message.text}
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <textarea
              className="flex min-h-[88px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-vertical"
              placeholder='Try: "Add 2 kg rice and 1 liter milk", or "decrease eggs by 2 unit".'
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void sendChat();
                }
              }}
              disabled={chatSending}
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Press Ctrl/Cmd + Enter to send.
              </p>
              <Button onClick={() => void sendChat()} disabled={chatSending || !chatInput.trim()}>
                {chatSending ? "Sending..." : "Send"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
