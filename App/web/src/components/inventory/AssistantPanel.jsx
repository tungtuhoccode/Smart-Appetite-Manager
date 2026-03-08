import React, { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { XIcon, SendIcon, MicIcon, MicOffIcon, ChefHatIcon } from "lucide-react";

function AssistantAvatar({ size = "sm" }) {
  const sizeClass = size === "lg" ? "w-16 h-16" : "w-7 h-7";
  return (
    <div
      className={`${sizeClass} rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shrink-0 shadow-md`}
    >
      <ChefHatIcon className={size === "lg" ? "w-8 h-8 text-white" : "w-4 h-4 text-white"} />
    </div>
  );
}

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

export function AssistantPanel({
  open,
  onClose,
  messages,
  input,
  onInputChange,
  onSend,
  sending,
}) {
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  const handleDictation = useCallback(
    (transcript) => {
      // onInputChange is setChatInput from useState, supports function updater
      onInputChange(
        (prev) => (prev ? prev + " " + transcript : transcript)
      );
    },
    [onInputChange]
  );

  const { listening, toggle: toggleMic, supported: micSupported } =
    useSpeechRecognition(handleDictation);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  return (
    <>
      {/* Subtle overlay - clickable to close, no blur */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/5 transition-opacity duration-200"
          onClick={onClose}
        />
      )}

      {/* Side panel */}
      <div
        className={`fixed top-0 right-0 z-50 h-full w-full sm:w-[420px] bg-background border-l shadow-2xl flex flex-col transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b bg-gradient-to-r from-amber-50 to-orange-50">
          <AssistantAvatar size="lg" />
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-foreground">
              Kitchen Assistant
            </h2>
            <p className="text-xs text-muted-foreground">
              I can help manage your inventory. Just ask!
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <XIcon className="w-4 h-4" />
          </Button>
        </div>

        {/* Messages */}
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
                <AssistantAvatar />
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
              <AssistantAvatar />
              <div className="bg-muted/60 border rounded-2xl rounded-bl-md px-4 py-2">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
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
                    : 'Try "Add 2 kg rice" or "What do I have?"'
                }
                value={input}
                onChange={(e) => {
                  onInputChange(e.target.value);
                  // Auto-resize fallback for browsers without field-sizing support
                  e.target.style.height = "auto";
                  e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onSend();
                  }
                }}
                disabled={sending}
                rows={1}
              />
            </div>
            <Button
              size="icon"
              onClick={onSend}
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
      </div>
    </>
  );
}
