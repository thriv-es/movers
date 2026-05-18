import { useState, useRef, useEffect } from 'react'
import type { ChatMessage } from '@workspace/data'
import { Button } from '@workspace/react-ui/components/ui/button'
import { Input } from '@workspace/react-ui/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/react-ui/components/ui/dialog'
import { chatApi } from '@/lib/api-client'
import { PHOTO_INSTRUCTIONS } from '@/constants/photo-instructions'

interface ChatStepProps {
  messages: ChatMessage[]
  onMessagesChange: (messages: ChatMessage[]) => void
  onNext: () => void
}

export function ChatStep({
  messages,
  onMessagesChange,
  onNext,
}: ChatStepProps): JSX.Element {
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isFinished, setIsFinished] = useState(false)
  const [showInstructionsModal, setShowInstructionsModal] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const hasFetchedInitialGreeting = useRef(false)

  useEffect(() => {
    // Fetch initial greeting from LLM if no messages and we haven't fetched yet
    if (messages.length === 0 && !hasFetchedInitialGreeting.current) {
      hasFetchedInitialGreeting.current = true
      setIsLoading(true)
      chatApi([])
        .then((response) => {
          const greeting: ChatMessage = {
            id: `msg-${Date.now()}`,
            role: 'assistant',
            content: response.content,
          }
          onMessagesChange([greeting])
          setIsFinished(response.finished)
        })
        .catch((error) => {
          console.error('Failed to fetch initial greeting:', error)
          // Fallback to a simple message if LLM fails
          const fallbackGreeting: ChatMessage = {
            id: `msg-${Date.now()}`,
            role: 'assistant',
            content: 'Hello! I\'m here to help you get a moving estimate. Let me ask you a few questions to understand your needs.',
          }
          onMessagesChange([fallbackGreeting])
        })
        .finally(() => {
          setIsLoading(false)
        })
    }
  }, [messages.length, onMessagesChange])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}-user`,
      role: 'user',
      content: input.trim(),
    }

    const newMessages = [...messages, userMessage]
    onMessagesChange(newMessages)
    setInput('')
    setIsLoading(true)

    try {
      const response = await chatApi(newMessages)
      const assistantMessage: ChatMessage = {
        id: `msg-${Date.now()}-assistant`,
        role: 'assistant',
        content: response.content,
      }

      onMessagesChange([...newMessages, assistantMessage])
      setIsFinished(response.finished)
    } catch (error) {
      console.error('Chat API error:', error)
      alert(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="~text-xl/2xl font-bold">Tell Us About Your Move</h2>
      <div className="border rounded-lg ~p-2/4 h-96 overflow-y-auto bg-muted/50">
        <div className="space-y-4">
          {messages.map((msg) => {
            // Strip JSON block from assistant messages for display (but keep full content in message object)
            let displayContent = msg.content;
            if (msg.role === 'assistant') {
              const jsonBlockMatch = msg.content.match(/```json\s*([\s\S]*?)\s*```/);
              if (jsonBlockMatch) {
                displayContent = msg.content.substring(0, jsonBlockMatch.index).trim();
              }
            }
            
            return (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg p-3 ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background border'
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{displayContent}</p>
                </div>
              </div>
            );
          })}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-background border rounded-lg p-3">
                <p className="text-sm text-muted-foreground">Thinking...</p>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>
      <div className="flex gap-2">
        <Input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          placeholder="Type your message..."
          disabled={isLoading}
          className="flex-1"
          style={{ fontSize: '16px' }}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="sentences"
        />
        <Button onClick={handleSend} disabled={isLoading || !input.trim()}>
          Send
        </Button>
      </div>
      {isFinished && (
        <Button onClick={() => setShowInstructionsModal(true)} size="lg" className="w-full">
          Continue to Photo Upload
        </Button>
      )}
      
      <Dialog open={showInstructionsModal} onOpenChange={setShowInstructionsModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Photo Upload Instructions</DialogTitle>
            <DialogDescription>
              Follow these guidelines to get the most accurate estimate
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 text-sm">
            <div>
              <h3 className="font-semibold mb-2">{PHOTO_INSTRUCTIONS.whatToPhotograph.title}</h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                {PHOTO_INSTRUCTIONS.whatToPhotograph.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
            
            <div>
              <h3 className="font-semibold mb-2">{PHOTO_INSTRUCTIONS.photoTips.title}</h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                {PHOTO_INSTRUCTIONS.photoTips.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
            
            <div>
              <h3 className="font-semibold mb-2">{PHOTO_INSTRUCTIONS.whatNotToDo.title}</h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                {PHOTO_INSTRUCTIONS.whatNotToDo.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
            
            <div className="bg-muted p-3 rounded-md">
              <p className="text-xs">
                <strong>{PHOTO_INSTRUCTIONS.howMany.label}</strong> {PHOTO_INSTRUCTIONS.howMany.text}
              </p>
            </div>
          </div>
          
          <DialogFooter>
            <Button onClick={() => {
              setShowInstructionsModal(false)
              onNext()
            }} size="lg" className="w-full">
              Got it, Start Uploading
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

