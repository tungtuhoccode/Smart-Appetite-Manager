import React, { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { typeIntoChat } from "@/lib/typeIntoChat";
import { useChatOpen } from "@/context/ChatOpenContext";
import { useGateway } from "@/api";
import { AGENTS } from "@/api/agents";
import { inventoryRestApi } from "@/api/inventoryRest";
import { useGatewaySession } from "@/hooks/useGatewaySession";
import { useInventory } from "@/hooks/useInventory";
import { useShoppingList } from "@/hooks/useShoppingList";
import { useAssistantChat } from "@/hooks/useAssistantChat";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InventoryTable } from "@/components/inventory/InventoryTable";
import { EditItemDialog } from "@/components/inventory/EditItemDialog";
import { DeleteItemDialog } from "@/components/inventory/DeleteItemDialog";
import { ScanReceiptDialog } from "@/components/inventory/ScanReceiptDialog";
import { ShoppingListPanel } from "@/components/inventory/ShoppingListPanel";
import { ReceiptGalleryPanel } from "@/components/inventory/ReceiptGalleryPanel";
import { BarcodeScannerPanel } from "@/components/inventory/BarcodeScannerPanel";
import { AssistantPanel, PANEL_THEMES } from "@/components/assistant/AssistantPanel";
import { readReceiptImages, saveReceiptImage } from "@/lib/receiptStore";
import { Input } from "@/components/ui/input";
import {
  MessageCircleIcon,
  RefreshCwIcon,
  PlusIcon,
  PackageIcon,
  ListChecksIcon,
  ShoppingCartIcon,
  CameraIcon,
  ScanLineIcon,
  SearchIcon,
  SparklesIcon,
  UtensilsCrossedIcon,
} from "lucide-react";

const INVENTORY_TAGS = [
  { label: "What do I have?", prompt: "Show me everything in my inventory" },
  { label: "Expiring soon", prompt: "What items in my inventory are expiring soon?" },
  { label: "Low stock", prompt: "Which items are running low in my inventory?" },
  { label: "Add items", prompt: "Add to my inventory: " },
  { label: "Weekly summary", prompt: "Give me a weekly summary of my inventory changes" },
];

const STORAGE_KEYS = {
  gatewayUrl: "inventory_gateway_url",
  sessionId: "inventory_gateway_session_id",
  agentName: "inventory_gateway_agent_name",
};

export default function InventoryPage() {
  const navigate = useNavigate();
  const { client, api } = useGateway();
  const { persistSession } = useGatewaySession(
    client,
    STORAGE_KEYS,
    AGENTS.INVENTORY
  );

  const inventory = useInventory(api, persistSession);
  const shoppingList = useShoppingList();
  const chat = useAssistantChat(client, AGENTS.INVENTORY, {
    welcomeText:
      "Hey there! I'm your Pantry Agent. I can help you add items, update quantities, remove things, or just tell you what's in your pantry. What can I do for you?",
    idPrefix: "inventory-chat",
    errorLabel: "SAM inventory agent failed",
    onComplete: () => inventory.fetchItems({ background: true }),
  });

  const [activeTab, setActiveTab] = useState("inventory");
  const [editItem, setEditItem] = useState(null);
  const [deleteItem, setDeleteItem] = useState(null);
  const { chatOpen, setChatOpen } = useChatOpen();
  const [scanOpen, setScanOpen] = useState(false);
  const [receipts, setReceipts] = useState(() => readReceiptImages());
  const refreshReceipts = useCallback(() => setReceipts(readReceiptImages()), []);
  const typingCleanup = useRef(null);

  const handleQuickSuggestion = useCallback((tag) => {
    const prompt = typeof tag === "object" ? tag.prompt : tag;
    setChatOpen(true);
    if (typingCleanup.current) typingCleanup.current();
    typingCleanup.current = typeIntoChat(chat.setInput, prompt);
  }, [chat]);

  const handleFindDeals = () => {
    const unchecked = shoppingList.items.filter((it) => !it.checked);
    if (unchecked.length === 0) return;
    const names = unchecked.map((it) => it.product_name).join(", ");
    navigate(`/shopping?items=${encodeURIComponent(names)}`);
  };

  const handleAddViaChat = () => {
    setChatOpen(true);
    if (typingCleanup.current) typingCleanup.current();
    typingCleanup.current = typeIntoChat(chat.setInput, "Add to my inventory: ");
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
                  Track what you have, manage your shopping list, and let SAM
                  help you stay organized.
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
                <Button
                  variant="outline"
                  onClick={() => setScanOpen(true)}
                  className="gap-1.5"
                >
                  <CameraIcon className="w-3.5 h-3.5" />
                  Scan Receipt
                </Button>
                <Button onClick={handleAddViaChat} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white">
                  <PlusIcon className="w-4 h-4" />
                  Add Items
                </Button>
              </div>
            </div>

            {/* Tabs */}
            <div className="mt-5 flex items-center gap-2 border-b border-emerald-100 pb-3">
              <button
                onClick={() => setActiveTab("inventory")}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  activeTab === "inventory"
                    ? "bg-emerald-500 text-white shadow-sm"
                    : "bg-white/70 text-muted-foreground hover:bg-emerald-100"
                }`}
              >
                <PackageIcon className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                Inventory
              </button>
              <button
                onClick={() => setActiveTab("shopping-list")}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  activeTab === "shopping-list"
                    ? "bg-emerald-500 text-white shadow-sm"
                    : "bg-white/70 text-muted-foreground hover:bg-emerald-100"
                }`}
              >
                <ListChecksIcon className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                Shopping List
                {shoppingList.uncheckedCount > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-emerald-600 text-white text-[10px] font-semibold">
                    {shoppingList.uncheckedCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab("receipts")}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  activeTab === "receipts"
                    ? "bg-emerald-500 text-white shadow-sm"
                    : "bg-white/70 text-muted-foreground hover:bg-emerald-100"
                }`}
              >
                <ScanLineIcon className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                Scan &amp; Import
                {receipts.length > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-emerald-600 text-white text-[10px] font-semibold">
                    {receipts.length}
                  </span>
                )}
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Inventory table */}
        {activeTab === "inventory" && (
          <Card className="border-emerald-100">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-xl">Items</CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => navigate("/recipes?fromInventory=1")}
                    className="gap-1.5 bg-orange-500 hover:bg-orange-600 text-white"
                  >
                    <UtensilsCrossedIcon className="w-3.5 h-3.5" />
                    Find Recipes
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setChatOpen(true)}
                    className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    <MessageCircleIcon className="w-3.5 h-3.5" />
                    Ask Agent
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="relative mb-4">
                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search items..."
                  value={inventory.searchQuery}
                  onChange={(e) => inventory.setSearchQuery(e.target.value)}
                  className="pl-9 h-9"
                />
              </div>
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
                searchQuery={inventory.searchQuery}
              />
            </CardContent>
          </Card>
        )}

        {/* Shopping List */}
        {activeTab === "shopping-list" && (
          <Card className="border-emerald-100">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-xl">Shopping List</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {shoppingList.uncheckedCount} remaining
                  </Badge>
                  {shoppingList.uncheckedCount > 0 && (
                    <Button
                      size="sm"
                      onClick={handleFindDeals}
                      className="gap-1.5 bg-blue-500 hover:bg-blue-600"
                    >
                      <ShoppingCartIcon className="w-3.5 h-3.5" />
                      Find Deals
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ShoppingListPanel
                items={shoppingList.items}
                loading={shoppingList.loading}
                onToggle={shoppingList.toggleItem}
                onDelete={shoppingList.deleteItem}
                onAdd={shoppingList.addItems}
                onClearChecked={shoppingList.clearChecked}
                checkedCount={shoppingList.checkedCount}
              />
            </CardContent>
          </Card>
        )}

        {/* Scan & Import */}
        {activeTab === "receipts" && (
          <>
            <Card className="border-emerald-100">
              <CardHeader className="pb-3">
                <CardTitle className="text-xl">Barcode Scanner</CardTitle>
              </CardHeader>
              <CardContent>
                <BarcodeScannerPanel
                  onAddViaChat={(structured, voice) => {
                    const parts = [];
                    if (structured.length > 0) {
                      const lines = structured
                        .map((it) => `- ${it.product_name}: ${it.quantity} ${it.quantity_unit}`)
                        .join("\n");
                      parts.push(`Add these scanned items to my inventory:\n${lines}`);
                    }
                    if (voice && voice.length > 0) {
                      const vLines = voice
                        .map((v) => `- ${v.count > 1 ? `${v.count}x ` : ""}Barcode ${v.code}: "${v.description}"`)
                        .join("\n");
                      parts.push(`Also, I scanned these items but they weren't in the database. Please figure out what they are and add them:\n${vLines}`);
                    }
                    if (parts.length === 0) return;
                    setChatOpen(true);
                    chat.send(parts.join("\n\n"));
                  }}
                />
              </CardContent>
            </Card>

            <Card className="border-emerald-100">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-xl">Receipts</CardTitle>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setScanOpen(true)}
                    className="gap-1.5"
                  >
                    <CameraIcon className="w-3.5 h-3.5" />
                    Scan Receipt
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <ReceiptGalleryPanel
                  receipts={receipts}
                  onRefresh={refreshReceipts}
                  onScanClick={() => setScanOpen(true)}
                />
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Chat FAB */}
      {!chatOpen && (
        <Button
          className="fixed bottom-6 right-6 z-40 rounded-full shadow-xl h-14 pl-5 pr-4 bg-emerald-600 hover:bg-emerald-700 text-white text-base gap-3"
          onClick={() => setChatOpen(true)}
        >
          Ask SAM
          <MessageCircleIcon className="w-5 h-5" />
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

      <ScanReceiptDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        client={client}
        onScanViaChat={(filename, receiptImageDataUrl) => {
          // Save to receipt gallery
          saveReceiptImage({ filename, dataUrl: receiptImageDataUrl }).then(refreshReceipts);
          // Open chat panel immediately so user sees the send in progress
          setChatOpen(true);
          // Fire chat send in background — the panel will show typing indicator
          chat.send(
            `I just uploaded a receipt image called "${filename}". Please scan it and show me the items.`,
            { receiptImage: receiptImageDataUrl }
          );
        }}
      />

      <AssistantPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        title="Pantry Agent"
        subtitle="Connected to SAM for inventory management."
        messages={chat.messages}
        activeTimeline={chat.activeTimeline}
        input={chat.input}
        onInputChange={chat.setInput}
        onSend={() => void chat.send()}
        sending={chat.sending}
        suggestions={INVENTORY_TAGS}
        onSuggestionClick={handleQuickSuggestion}
        theme={PANEL_THEMES.inventory}
        sessionId={client?.getSessionId?.() || ""}
      />
    </div>
  );
}
