import React, { useState } from "react";
import { useGateway } from "@/api";
import { AGENTS } from "@/api/agents";
import { useGatewaySession } from "@/hooks/useGatewaySession";
import { useInventory } from "@/hooks/useInventory";
import { useAssistantChat } from "@/hooks/useAssistantChat";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InventoryTable } from "@/components/inventory/InventoryTable";
import { EditItemDialog } from "@/components/inventory/EditItemDialog";
import { DeleteItemDialog } from "@/components/inventory/DeleteItemDialog";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";
import {
  MessageCircleIcon,
  RefreshCwIcon,
  PlusIcon,
  PackageIcon,
} from "lucide-react";

const STORAGE_KEYS = {
  gatewayUrl: "inventory_gateway_url",
  sessionId: "inventory_gateway_session_id",
  agentName: "inventory_gateway_agent_name",
};

export default function InventoryPage() {
  const { client, api } = useGateway();
  const { persistSession } = useGatewaySession(
    client,
    STORAGE_KEYS,
    AGENTS.INVENTORY
  );

  const inventory = useInventory(api, persistSession);
  const chat = useAssistantChat(client, AGENTS.INVENTORY, {
    welcomeText:
      "Inventory chat ready. Ask me to add, update, delete, or explain your inventory.",
    idPrefix: "inventory-chat",
    errorLabel: "Inventory chat failed",
    onComplete: () => inventory.fetchItems({ background: true }),
  });

  const [editItem, setEditItem] = useState(null);
  const [deleteItem, setDeleteItem] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);

  const handleAddViaChat = () => {
    setChatOpen(true);
    chat.setInput("Add to my inventory: ");
  };

  const handleIncrease = async (item, amount) => {
    const success = await inventory.handleIncrease(item, amount);
    if (success) setEditItem(null);
  };

  const handleDecrease = async (item, amount) => {
    const success = await inventory.handleDecrease(item, amount);
    if (success) setEditItem(null);
  };

  const handleDelete = async (item) => {
    const success = await inventory.handleDelete(item);
    if (success) {
      setDeleteItem(null);
      inventory.clearDeleteProgress();
    }
  };

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-[radial-gradient(circle_at_top_left,_rgba(220,252,231,0.95),_#fff_48%),linear-gradient(135deg,_rgba(236,253,245,0.9),_rgba(255,255,255,1))]">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {/* Hero header */}
        <Card className="border-emerald-100 bg-gradient-to-br from-emerald-50 via-green-50 to-white">
          <CardContent className="p-6 md:p-8">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div className="space-y-3 max-w-2xl">
                <Badge className="bg-emerald-500 text-white hover:bg-emerald-500">
                  <PackageIcon className="w-3 h-3 mr-1" />
                  Kitchen Inventory
                </Badge>
                <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-balance">
                  Manage your kitchen inventory
                </h1>
                <p className="text-sm md:text-base text-muted-foreground">
                  Track what you have, add new items, and let the assistant help
                  you stay organized.
                </p>
                <p className="text-xs text-muted-foreground">
                  {inventory.lastSyncedAt
                    ? `Live backend sync: ${inventory.lastSyncedAt.toLocaleTimeString()}`
                    : "Live backend sync: pending"}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  variant="outline"
                  onClick={() => void inventory.fetchItems()}
                  disabled={inventory.loading}
                  className="gap-1.5"
                >
                  <RefreshCwIcon
                    className={`w-3.5 h-3.5 ${inventory.loading ? "animate-spin" : ""}`}
                  />
                  {inventory.loading ? "Refreshing..." : "Refresh"}
                </Button>
                <Button onClick={handleAddViaChat} className="gap-1.5">
                  <PlusIcon className="w-4 h-4" />
                  Add Items
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Inventory table */}
        <Card className="border-emerald-100">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-xl">Items</CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setChatOpen(true)}
                  className="gap-1.5"
                >
                  <MessageCircleIcon className="w-3.5 h-3.5" />
                  Ask Assistant
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {inventory.error && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 mb-4">
                <p className="text-sm text-destructive">
                  Failed to load inventory: {inventory.error.message}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => void inventory.fetchItems()}
                >
                  Retry
                </Button>
              </div>
            )}
            <InventoryTable
              items={inventory.items}
              loading={inventory.loading}
              onEdit={setEditItem}
              onDelete={setDeleteItem}
              sortField={inventory.sortField}
              sortDirection={inventory.sortDirection}
              onToggleSort={inventory.toggleSort}
              newItemKeys={inventory.newItemKeys}
              itemKey={inventory.itemKey}
              categoryFilter={inventory.categoryFilter}
              onCategoryFilterChange={inventory.setCategoryFilter}
              allItems={inventory.allItems}
            />
          </CardContent>
        </Card>
      </div>

      {/* Chat FAB */}
      {!chatOpen && (
        <Button
          className="fixed bottom-6 right-6 z-40 rounded-full shadow-xl h-12 px-4"
          onClick={() => setChatOpen(true)}
        >
          <MessageCircleIcon className="w-5 h-5 mr-1.5" />
          Chat
        </Button>
      )}

      <EditItemDialog
        item={editItem}
        open={!!editItem}
        onOpenChange={(open) => !open && setEditItem(null)}
        onIncrease={handleIncrease}
        onDecrease={handleDecrease}
        loading={inventory.mutating}
      />

      <DeleteItemDialog
        item={deleteItem}
        open={!!deleteItem}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteItem(null);
            inventory.clearDeleteProgress();
          }
        }}
        onConfirm={handleDelete}
        loading={inventory.mutating}
        deleteProgress={inventory.deleteProgress}
      />

      <AssistantPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        title="Kitchen Assistant"
        subtitle="I can help manage your inventory. Just ask!"
        messages={chat.messages}
        activeTimeline={chat.activeTimeline}
        input={chat.input}
        onInputChange={chat.setInput}
        onSend={() => void chat.send()}
        sending={chat.sending}
      />
    </div>
  );
}
