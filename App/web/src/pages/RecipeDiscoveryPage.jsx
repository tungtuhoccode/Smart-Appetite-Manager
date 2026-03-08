import React, { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  SendIcon,
  MicIcon,
  MicOffIcon,
  ChefHatIcon,
  SparklesIcon,
  RotateCcwIcon,
} from "lucide-react";
import { useGateway } from "../api/hooks";
import { AGENTS } from "../api/agents";

function useSpeechRecognition(onResult) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);

  const supported =
    typeof window !== "undefined" &&
    (!!window.SpeechRecognition || !!window.webkitSpeechRecognition);

  const toggle = useCallback(() => {
    if (!supported) return;

    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      onResult(transcript);
      setListening(false);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, [listening, supported, onResult]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
    };
  }, []);

  return { listening, toggle, supported };
}

const WELCOME_MESSAGE = {
  id: "welcome",
  role: "assistant",
  text: `Welcome to Recipe Discovery! I can help you find recipes based on your inventory, explore new dishes, and find deals on missing ingredients.

Here are some things you can ask me:
• "What can I cook with my inventory?"
• "Find me a quick pasta recipe"
• "Suggest healthy dinner ideas"
• "What recipes can I make with chicken and rice?"`,
};

const SUGGESTED_PROMPTS = [
  "What can I cook with my inventory?",
  "Suggest a quick dinner recipe",
  "Find healthy meal ideas",
];

export default function RecipeDiscoveryPage() {
  const { client, api } = useGateway();
  const [messages, setMessages] = useState([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const msgIdRef = useRef(0);

  const handleDictation = useCallback(
    (transcript) => {
      setInput((prev) => (prev ? prev + " " + transcript : transcript));
    },
    []
  );

  const { listening, toggle: toggleMic, supported: micSupported } =
    useSpeechRecognition(handleDictation);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const sendMessage = useCallback(
    async (text) => {
      const trimmed = (text || input).trim();
      if (!trimmed || sending) return;

      const userMsg = {
        id: `user-${++msgIdRef.current}`,
        role: "user",
        text: trimmed,
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setSending(true);

      try {
        const response = await client.send(trimmed, AGENTS.ORCHESTRATOR);
        const assistantMsg = {
          id: `assistant-${++msgIdRef.current}`,
          role: "assistant",
          text: response.text,
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } catch (err) {
        const errorMsg = {
          id: `error-${++msgIdRef.current}`,
          role: "assistant",
          text: `Sorry, something went wrong: ${err.message}`,
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setSending(false);
        inputRef.current?.focus();
      }
    },
    [input, sending, client]
  );

  const handleNewConversation = useCallback(() => {
    client.resetSession();
    setMessages([WELCOME_MESSAGE]);
    setInput("");
    inputRef.current?.focus();
  }, [client]);

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      <div className="max-w-3xl w-full mx-auto flex flex-col flex-1 min-h-0 px-4 py-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-md">
              <ChefHatIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Recipe Discovery</h1>
              <p className="text-xs text-muted-foreground">
                Find recipes, explore ideas, and plan meals
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleNewConversation}
            className="gap-1.5"
          >
            <RotateCcwIcon className="w-3.5 h-3.5" />
            New conversation
          </Button>
        </div>

        {/* Messages */}
        <Card className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
          >
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-2 ${
                  message.role === "user" ? "flex-row-reverse" : "flex-row"
                }`}
              >
                {message.role === "assistant" && (
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shrink-0 shadow-md">
                    <ChefHatIcon className="w-4 h-4 text-white" />
                  </div>
                )}
                <div
                  className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                    message.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-md"
                      : "bg-muted/60 border rounded-bl-md"
                  }`}
                >
                  {message.text}
                </div>
              </div>
            ))}

            {sending && (
              <div className="flex gap-2 items-end">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shrink-0 shadow-md">
                  <ChefHatIcon className="w-4 h-4 text-white" />
                </div>
                <div className="bg-muted/60 border rounded-2xl rounded-bl-md px-4 py-2">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:0ms]" />
                    <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}

            {/* Suggested prompts - show only when just the welcome message */}
            {messages.length === 1 && !sending && (
              <div className="flex flex-wrap gap-2 pt-2">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <Button
                    key={prompt}
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => sendMessage(prompt)}
                  >
                    <SparklesIcon className="w-3 h-3" />
                    {prompt}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {/* Input area */}
          <div className="border-t px-4 py-3 bg-background">
            <div className="flex items-end gap-2">
              {micSupported && (
                <Button
                  variant={listening ? "destructive" : "ghost"}
                  size="icon"
                  onClick={toggleMic}
                  disabled={sending}
                  title={listening ? "Stop dictation" : "Start dictation"}
                  className="shrink-0"
                >
                  {listening ? (
                    <MicOffIcon className="w-4 h-4" />
                  ) : (
                    <MicIcon className="w-4 h-4" />
                  )}
                </Button>
              )}
              <div className="relative flex-1">
                <textarea
                  ref={inputRef}
                  className="flex min-h-[44px] max-h-[200px] w-full rounded-xl border border-input bg-muted/30 px-3 py-2.5 pr-10 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 resize-none overflow-y-auto"
                  style={{ fieldSizing: "content" }}
                  placeholder={
                    listening
                      ? "Listening..."
                      : "Ask about recipes, ingredients, or meal ideas..."
                  }
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height =
                      Math.min(e.target.scrollHeight, 200) + "px";
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  disabled={sending}
                  rows={1}
                />
              </div>
              <Button
                size="icon"
                onClick={() => sendMessage()}
                disabled={sending || !input.trim()}
                className="shrink-0 rounded-xl"
              >
                <SendIcon className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5 text-center">
              Press Enter to send{micSupported ? " · Click mic to dictate" : ""}
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
