import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from "react-markdown";
import type { ChatMessage } from '@/data'
import { ArrowRight, Send } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog'
import { chatApi } from '@/lib/api-client'
import { PHOTO_INSTRUCTIONS } from '@/constants/photo-instructions'

interface ChatStepProps {
  messages: ChatMessage[]
  onMessagesChange: (messages: ChatMessage[]) => void
  onNext: () => void
}

const DISPLAY_FONT = "'Source Serif 4', 'Iowan Old Style', Georgia, serif";

/**
 * Strip JSON blocks from an assistant message before display.
 * Handles both code-fenced blocks (```json ... ```) - with or without the closing
 * fence - and raw JSON objects that start on their own line.
 */
function stripJson(content: string): string {
  // Strip from the first ```json opener (with or without a closing fence)
  const fenceIdx = content.indexOf("```json");
  if (fenceIdx !== -1) return content.substring(0, fenceIdx).trim();

  // Strip raw JSON object that starts on its own line
  const rawMatch = content.match(/\n\s*\{/);
  if (rawMatch?.index !== undefined)
    return content.substring(0, rawMatch.index).trim();

  // Entire message is a JSON object
  if (content.trimStart().startsWith("{")) return "";

  return content;
}

export function ChatStep({
  messages,
  onMessagesChange,
  onNext,
}: ChatStepProps): JSX.Element {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [showInstructionsModal, setShowInstructionsModal] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasFetchedInitialGreeting = useRef(false);

  useEffect(() => {
    if (messages.length === 0 && !hasFetchedInitialGreeting.current) {
      hasFetchedInitialGreeting.current = true;
      setIsLoading(true);
      chatApi([])
        .then((response) => {
          onMessagesChange([
            {
              id: `msg-${Date.now()}`,
              role: "assistant",
              content: response.content,
            },
          ]);
          setIsFinished(response.finished);
        })
        .catch(() => {
          onMessagesChange([
            {
              id: `msg-${Date.now()}`,
              role: "assistant",
              content:
                "Hello! I'm here to help you get a moving estimate. Let me ask you a few questions.",
            },
          ]);
        })
        .finally(() => setIsLoading(false));
    }
  }, [messages.length, onMessagesChange]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}-user`,
      role: "user",
      content: input.trim(),
    };
    const newMessages = [...messages, userMessage];
    onMessagesChange(newMessages);
    setInput("");
    setIsLoading(true);

    try {
      const response = await chatApi(newMessages);
      onMessagesChange([
        ...newMessages,
        {
          id: `msg-${Date.now()}-assistant`,
          role: "assistant",
          content: response.content,
        },
      ]);
      setIsFinished(response.finished);
    } catch (error) {
      alert(
        `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <p className="text-eyebrow mb-2">Step 01</p>
        <h2
          className="text-foreground leading-tight"
          style={{
            fontFamily: DISPLAY_FONT,
            fontSize: "26px",
            fontWeight: 400,
            fontStyle: "italic",
          }}
        >
          Tell us about your move
        </h2>
      </div>

      {/* Chat window */}
      <div
        className="rounded-xl border border-border bg-muted/40 p-4 h-80 overflow-y-auto space-y-3"
        style={{ scrollbarWidth: "thin" }}
      >
        {messages.map((msg) => {
          const isAssistant = msg.role === "assistant";
          const displayContent = isAssistant
            ? stripJson(msg.content)
            : msg.content;
          if (!displayContent) return null;

          return (
            <div
              key={msg.id}
              className={`flex ${isAssistant ? "justify-start" : "justify-end"}`}
            >
              <div
                className="max-w-[82%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed"
                style={
                  isAssistant
                    ? {
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        color: "hsl(var(--foreground))",
                      }
                    : { backgroundColor: "var(--thrive)", color: "#fff" }
                }
              >
                {isAssistant ? (
                  <ReactMarkdown
                    components={{
                      p: ({ children }) => (
                        <p className="mb-2 last:mb-0">{children}</p>
                      ),
                      strong: ({ children }) => (
                        <strong className="font-semibold">{children}</strong>
                      ),
                      em: ({ children }) => (
                        <em className="italic">{children}</em>
                      ),
                      ul: ({ children }) => (
                        <ul className="list-disc pl-4 mb-2 space-y-0.5">
                          {children}
                        </ul>
                      ),
                      ol: ({ children }) => (
                        <ol className="list-decimal pl-4 mb-2 space-y-0.5">
                          {children}
                        </ol>
                      ),
                      li: ({ children }) => <li>{children}</li>,
                      // Don't render code blocks - they're stripped above anyway
                      code: ({ children }) => (
                        <code className="font-code text-xs bg-muted px-1 rounded">
                          {children}
                        </code>
                      ),
                      pre: () => null,
                    }}
                  >
                    {displayContent}
                  </ReactMarkdown>
                ) : (
                  <p className="whitespace-pre-wrap">{displayContent}</p>
                )}
              </div>
            </div>
          );
        })}

        {isLoading && (
          <div className="flex justify-start">
            <div
              className="rounded-2xl px-4 py-2.5 text-sm text-muted-foreground"
              style={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
              }}
            >
              <span className="inline-flex gap-1 items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:300ms]" />
              </span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input row */}
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Type your message…"
          disabled={isLoading}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="sentences"
          className="flex-1 rounded-full border border-border bg-card px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 disabled:opacity-50 transition-all"
          style={
            {
              fontSize: "16px",
              "--tw-ring-color": "var(--thrive)",
            } as React.CSSProperties
          }
        />
        <button
          onClick={handleSend}
          disabled={isLoading || !input.trim()}
          className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white disabled:opacity-40 transition-all btn-lift"
          style={{ backgroundColor: "var(--thrive)" }}
          aria-label="Send"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>

      {/* Continue button */}
      {isFinished && (
        <button
          onClick={() => setShowInstructionsModal(true)}
          className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full font-medium text-base text-white btn-lift"
          style={{ backgroundColor: "var(--thrive)" }}
        >
          Continue to photo upload
          <ArrowRight className="w-4 h-4" />
        </button>
      )}

      {/* Photo instructions modal */}
      <Dialog
        open={showInstructionsModal}
        onOpenChange={setShowInstructionsModal}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle
              style={{
                fontFamily: DISPLAY_FONT,
                fontStyle: "italic",
                fontWeight: 400,
              }}
            >
              Photo upload tips
            </DialogTitle>
            <DialogDescription>
              A few guidelines to get the most accurate estimate.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-sm">
            <InstructionBlock
              title={PHOTO_INSTRUCTIONS.whatToPhotograph.title}
              items={PHOTO_INSTRUCTIONS.whatToPhotograph.items}
            />
            <InstructionBlock
              title={PHOTO_INSTRUCTIONS.photoTips.title}
              items={PHOTO_INSTRUCTIONS.photoTips.items}
            />
            <InstructionBlock
              title={PHOTO_INSTRUCTIONS.whatNotToDo.title}
              items={PHOTO_INSTRUCTIONS.whatNotToDo.items}
            />
            <div
              className="rounded-lg px-3 py-2.5 text-xs text-muted-foreground"
              style={{ backgroundColor: "hsl(var(--muted))" }}
            >
              <strong className="text-foreground">
                {PHOTO_INSTRUCTIONS.howMany.label}
              </strong>{" "}
              {PHOTO_INSTRUCTIONS.howMany.text}
            </div>
          </div>

          <DialogFooter>
            <button
              onClick={() => {
                setShowInstructionsModal(false);
                onNext();
              }}
              className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full font-medium text-white btn-lift"
              style={{ backgroundColor: "var(--thrive)" }}
            >
              Got it - start uploading
              <ArrowRight className="w-4 h-4" />
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InstructionBlock({
  title,
  items,
}: {
  title: string;
  items: readonly string[];
}) {
  return (
    <div>
      <p className="font-semibold text-foreground mb-1.5">{title}</p>
      <ul className="space-y-1 text-muted-foreground">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span style={{ color: "var(--thrive)" }}>·</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
