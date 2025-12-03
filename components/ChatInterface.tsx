'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { ChatMessage, ToolCall, CodeExecution, EfficiencyMetrics } from '@/types/chat';
import { ModelConfig, GatewayModel } from '@/lib/providers';

// AI Elements imports
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  ConversationEmptyState,
} from '@/components/ai-elements/conversation';
import {
  Message,
  MessageContent,
  MessageActions,
  MessageAction,
  MessageResponse,
} from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputSubmit,
} from '@/components/ai-elements/prompt-input';
import { Loader } from '@/components/ai-elements/loader';
import { Suggestions, Suggestion } from '@/components/ai-elements/suggestion';
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from '@/components/ai-elements/tool';
import { CodeBlock, CodeBlockCopyButton } from '@/components/ai-elements/code-block';
import {
  ChainOfThought,
  ChainOfThoughtHeader,
  ChainOfThoughtContent,
  ChainOfThoughtStep,
  ChainOfThoughtSearchResults,
  ChainOfThoughtSearchResult,
} from '@/components/ai-elements/chain-of-thought';
import {
  ModelSelector,
  ModelSelectorTrigger,
  ModelSelectorContent,
  ModelSelectorInput,
  ModelSelectorList,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorItem,
  ModelSelectorLogo,
  ModelSelectorName,
} from '@/components/ai-elements/model-selector';

// UI components
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Kbd } from '@/components/ui/kbd';

// Icons
import {
  CopyIcon,
  CheckIcon,
  SquareIcon,
  SparklesIcon,
  WrenchIcon,
  ZapIcon,
  PanelRightIcon,
  BoxIcon,
  ClockIcon,
  CodeIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
} from 'lucide-react';

// Debug Panel
import DebugPanel from './DebugPanel';
import EfficiencyMetricsDisplay from './EfficiencyMetrics';

// Suggested prompts for empty state
const SUGGESTED_PROMPTS = [
  "List Azure subscriptions and any with cost alerts or overruns.",
  "Inventory VMs: OS, status, monitoring, backup missing.",
  "Find underutilized VMs/disks/IPs last 30 days; suggest savings.",
  "Summarize Owner/Contributor assignments on subscriptions/groups.",
  "Show Defender security recommendations and new vulnerabilities.",
  "List App Services/DBs without diagnostics, suggest fixes."
];

// Extended message type to include tool calls and code executions
interface ExtendedMessage extends ChatMessage {
  toolCalls?: ToolCall[];
  codeExecution?: CodeExecution;
}

const STORAGE_KEY = 'ptc-model-config';
const DEFAULT_MODEL_CONFIG: ModelConfig = {
  provider: 'gateway',
  model: 'anthropic/claude-sonnet-4',
};

export default function ChatInterface() {
  const [messages, setMessages] = useState<ExtendedMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [codeExecutions, setCodeExecutions] = useState<CodeExecution[]>([]);
  const [metrics, setMetrics] = useState<EfficiencyMetrics | null>(null);
  const [modelConfig, setModelConfig] = useState<ModelConfig>(DEFAULT_MODEL_CONFIG);
  const [showDebug, setShowDebug] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [gatewayModels, setGatewayModels] = useState<GatewayModel[]>([]);
  const [pendingToolCalls, setPendingToolCalls] = useState<ToolCall[]>([]);
  const [pendingCodeExecution, setPendingCodeExecution] = useState<CodeExecution | null>(null);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load model config from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as ModelConfig;
        if (parsed.provider && parsed.model) {
          setModelConfig(parsed);
        }
      }
    } catch (error) {
      console.error('Failed to load model config from localStorage:', error);
    }
  }, []);

  // Save model config to localStorage when it changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(modelConfig));
    } catch (error) {
      console.error('Failed to save model config to localStorage:', error);
    }
  }, [modelConfig]);

  // Fetch gateway models on mount
  useEffect(() => {
    if (gatewayModels.length === 0) {
      fetch('/api/models')
        .then((res) => res.json())
        .then((data) => {
          if (data.models) {
            setGatewayModels(data.models);
          }
        })
        .catch((error) => console.error('Failed to fetch gateway models:', error));
    }
  }, [gatewayModels.length]);

  // Keyboard shortcut for model selector (Cmd+K / Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setModelSelectorOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleCopy = useCallback(async (content: string, messageId: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(messageId);
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  }, []);

  const handleSubmit = async ({ text }: { text: string }) => {
    if (!text.trim() || isLoading) return;

    const userMessage: ExtendedMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setPendingToolCalls([]);
    setPendingCodeExecution(null);

    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            ...messages.map((m) => ({ role: m.role, content: m.content })),
            { role: 'user', content: text },
          ],
          modelConfig,
          maxSteps: 100,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';
      const assistantMessageId = (Date.now() + 1).toString();
      let receivedToolCalls: ToolCall[] = [];
      let receivedCodeExecution: CodeExecution | null = null;
      const streamingToolCalls = new Map<string, ToolCall>(); // Track tool calls as they stream in
      let toolCallBuffer = ''; // Buffer for incomplete tool call JSON

      const assistantMessage: ExtendedMessage = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
      };

      setStreamingMessageId(assistantMessageId);
      setMessages((prev) => [...prev, assistantMessage]);

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });

          // Handle tool call events (streamed in real-time)
          if (chunk.includes('__TOOL_CALL__:')) {
            // Combine buffer with new chunk
            const fullChunk = toolCallBuffer + chunk;
            toolCallBuffer = '';
            
            // Split by tool call markers
            const parts = fullChunk.split(/__TOOL_CALL__:/);
            let textContent = parts[0]; // Text before first tool call
            
            // Process each tool call event
            for (let i = 1; i < parts.length; i++) {
              const part = parts[i];
              // Find where JSON ends (either at newline or end of string)
              const jsonEnd = part.indexOf('\n');
              
              if (jsonEnd > 0) {
                // Complete JSON found
                const jsonStr = part.substring(0, jsonEnd);
                try {
                  const event = JSON.parse(jsonStr.trim());
                  if (event.type === 'tool-call' && event.data) {
                    const toolCall: ToolCall = {
                      id: event.data.id,
                      toolName: event.data.toolName,
                      args: event.data.args,
                      timestamp: new Date(event.data.timestamp || Date.now()),
                    };
                    streamingToolCalls.set(toolCall.id, toolCall);
                    // Update pending tool calls in real-time
                    setPendingToolCalls(Array.from(streamingToolCalls.values()));
                  }
                } catch (e) {
                  console.error('Failed to parse tool call event:', e, jsonStr);
                }
                // Add remaining text after this tool call event
                textContent += part.substring(jsonEnd + 1);
              } else {
                // Incomplete JSON - buffer it for next chunk
                toolCallBuffer = '__TOOL_CALL__:' + part;
              }
            }
            
            assistantContent += textContent;
          } else if (chunk.includes('__METADATA__:')) {
            const parts = chunk.split('__METADATA__:');
            assistantContent += parts[0];

            try {
              const metadata = JSON.parse(parts[1].trim());
              if (metadata.type === 'metadata') {
                const data = metadata.data;
                const execMetadata = data.codeExecutions?.[0]?.metadata;
                setMetrics({
                  totalTokens: data.totalTokens || 0,
                  promptTokens: data.promptTokens || 0,
                  completionTokens: data.completionTokens || 0,
                  tokensSaved: data.tokensSaved || 0,
                  toolCallCount: data.toolCallCount || 0,
                  executionTimeMs: execMetadata?.executionTimeMs || 0,
                  intermediateTokensSaved: execMetadata?.intermediateTokensSaved || 0,
                  totalTokensSaved: execMetadata?.totalTokensSaved || 0,
                  tokenSavingsBreakdown: execMetadata?.tokenSavingsBreakdown,
                  savingsExplanation: execMetadata?.savingsExplanation,
                });

                if (data.toolCalls) {
                  receivedToolCalls = data.toolCalls.map((tc: ToolCall) => ({
                    ...tc,
                    timestamp: new Date(tc.timestamp),
                  }));
                  setToolCalls(receivedToolCalls);
                  setPendingToolCalls(receivedToolCalls);
                }

                if (data.codeExecutions && data.codeExecutions.length > 0) {
                  receivedCodeExecution = {
                    ...data.codeExecutions[0],
                    timestamp: new Date(),
                  };
                  setCodeExecutions(data.codeExecutions.map((ce: CodeExecution) => ({
                    ...ce,
                    timestamp: new Date(),
                  })));
                  setPendingCodeExecution(receivedCodeExecution);
                }
              }
            } catch (e) {
              console.error('Failed to parse metadata:', e);
            }
          } else {
            assistantContent += chunk;
          }

          // Update the assistant message with tool calls and code execution
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMessageId
                ? {
                    ...m,
                    content: assistantContent,
                    toolCalls: receivedToolCalls,
                    codeExecution: receivedCodeExecution || undefined,
                  }
                : m
            )
          );
        }
      }
    } catch (error: unknown) {
      const err = error as Error;
      if (err.name === 'AbortError') {
        console.log('Request aborted');
      } else {
        console.error('Error:', err);
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            role: 'assistant',
            content: `Error: ${err.message}`,
            timestamp: new Date(),
          },
        ]);
      }
    } finally {
      setIsLoading(false);
      setPendingToolCalls([]);
      setPendingCodeExecution(null);
      setStreamingMessageId(null);
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInput(suggestion);
  };

  const getStatus = () => {
    if (isLoading) return 'streaming';
    return 'ready';
  };

  // Render tool calls for a message
  const renderToolCalls = (calls: ToolCall[] | undefined) => {
    if (!calls || calls.length === 0) return null;

    // Helper to determine tool state
    const getToolState = (call: ToolCall): 'output-available' | 'output-error' | 'input-available' => {
      if (call.error) return 'output-error';
      // Check if result exists and is not undefined/null
      if (call.result !== undefined && call.result !== null) return 'output-available';
      return 'input-available';
    };

    return (
      <div className="mt-4 space-y-2 overflow-hidden max-w-full">
        {calls.map((call) => (
          <Tool key={call.id} defaultOpen={false} className="overflow-hidden">
            <ToolHeader
              title={call.toolName}
              type="tool-invocation"
              state={getToolState(call)}
            />
            <ToolContent>
              <ToolInput input={call.args} />
              {(call.result !== undefined || call.error) && (
                <ToolOutput output={call.result} errorText={call.error} />
              )}
            </ToolContent>
          </Tool>
        ))}
      </div>
    );
  };

  // Render code execution for a message
  const renderCodeExecution = (exec: CodeExecution | undefined) => {
    if (!exec) return null;

    return (
      <div className="mt-4 overflow-hidden max-w-full">
        <ChainOfThought defaultOpen={false} className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <ChainOfThoughtHeader className="text-amber-700 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300">
            <span className="flex items-center gap-2 flex-1">
              <span>Sandbox Execution</span>
              {exec.metadata && (
                <ChainOfThoughtSearchResults className="ml-auto">
                  {exec.metadata.toolCallCount > 0 && (
                    <ChainOfThoughtSearchResult className="border-amber-500/30 bg-amber-500/10">
                      <WrenchIcon className="h-3 w-3" />
                      {exec.metadata.toolCallCount} tools
                    </ChainOfThoughtSearchResult>
                  )}
                  {exec.metadata.executionTimeMs > 0 && (
                    <ChainOfThoughtSearchResult className="border-amber-500/30 bg-amber-500/10">
                      <ClockIcon className="h-3 w-3" />
                      {exec.metadata.executionTimeMs}ms
                    </ChainOfThoughtSearchResult>
                  )}
                  {exec.metadata.totalTokensSaved && exec.metadata.totalTokensSaved > 0 && (
                    <ChainOfThoughtSearchResult className="bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30">
                      <SparklesIcon className="h-3 w-3" />
                      {exec.metadata.totalTokensSaved.toLocaleString()} saved
                    </ChainOfThoughtSearchResult>
                  )}
                </ChainOfThoughtSearchResults>
              )}
            </span>
          </ChainOfThoughtHeader>

          <ChainOfThoughtContent className="mt-3 space-y-1">
            {/* Code Step */}
            <ChainOfThoughtStep
              icon={CodeIcon}
              label="Executed Code"
              status="complete"
            >
              <div className="overflow-x-hidden">
                <CodeBlock code={exec.code} language="javascript" wrapText>
                  <CodeBlockCopyButton />
                </CodeBlock>
              </div>
            </ChainOfThoughtStep>

            {/* Internal Tool Calls Step */}
            {exec.metadata?.sandboxToolCalls && exec.metadata.sandboxToolCalls.length > 0 && (
              <ChainOfThoughtStep
                icon={WrenchIcon}
                label={`Internal Tool Calls (${exec.metadata.sandboxToolCalls.length})`}
                status="complete"
              >
                <div className="space-y-1 mt-2 overflow-hidden max-w-full">
                  {exec.metadata.sandboxToolCalls.map((call, idx) => (
                    <Tool key={idx} defaultOpen={false}>
                      <ToolHeader
                        title={call.toolName}
                        type="tool-invocation"
                        state={call.error ? 'output-error' : call.result ? 'output-available' : 'input-available'}
                      />
                      <ToolContent className="overflow-hidden max-w-fit">
                        <ToolInput input={call.args} className="overflow-hidden max-w-fit" />
                        {(call.result || call.error) && (
                          <ToolOutput output={call.result} errorText={call.error} className="overflow-hidden max-w-fit whitespace-pre-wrap" />
                        )}
                      </ToolContent>
                    </Tool>
                  ))}
                </div>
              </ChainOfThoughtStep>
            )}

            {/* Result Step */}
            {exec.result && (
              <ChainOfThoughtStep
                icon={CheckCircle2Icon}
                label="Result"
                status="complete"
              >
                <div className="overflow-x-auto mt-2">
                  <CodeBlock
                    code={typeof exec.result === 'string' ? exec.result : JSON.stringify(exec.result, null, 2)}
                    language="json"
                    wrapText
                  >
                    <CodeBlockCopyButton />
                  </CodeBlock>
                </div>
              </ChainOfThoughtStep>
            )}

            {/* Token Savings Step */}
            {exec.metadata?.tokenSavingsBreakdown && (
              <ChainOfThoughtStep
                className="text-lg mt-4"
                icon={SparklesIcon}
                label={
                  <span className="text-lg">
                    Token Savings: <strong className="text-amber-600 dark:text-amber-400">{(exec.metadata.totalTokensSaved || 0).toLocaleString()}</strong>
                  </span>
                }
                status="complete"
              >
                <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground mt-2 pl-1">
                  {[
                    { label: "Intermediate results", value: exec.metadata.tokenSavingsBreakdown.intermediateResults },
                    { label: "Context re-sends", value: exec.metadata.tokenSavingsBreakdown.roundTripContext },
                    { label: "Tool overhead", value: exec.metadata.tokenSavingsBreakdown.toolCallOverhead },
                    { label: "LLM decisions", value: exec.metadata.tokenSavingsBreakdown.llmDecisions }
                  ].map((item) => (
                    <div key={item.label}>
                      <b>{item.label}:</b> {item.value.toLocaleString()}
                    </div>
                  ))}
                </div>
              </ChainOfThoughtStep>
            )}
          </ChainOfThoughtContent>
        </ChainOfThought>
      </div>
    );
  };

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex-none flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-lg shadow-violet-500/25">
            <ZapIcon className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Programmatic Tool Calling</h1>
            <p className="text-xs text-muted-foreground">AI SDK with Code Execution</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant={showDebug ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setShowDebug(!showDebug)}
            className="gap-2"
          >
            <PanelRightIcon className="h-4 w-4" />
            {showDebug ? 'Hide Debug' : 'Debug'}
          </Button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Main Chat Area */}
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          {/* Conversation with proper scroll management */}
          <Conversation className="flex-1 min-h-0 overflow-auto">
            {messages.length === 0 ? (
              <ConversationEmptyState
                title="Start a conversation"
                description="Try one of the suggested prompts below or type your own message to see programmatic tool calling in action"
                icon={
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-violet-500/20 to-purple-600/20">
                    <SparklesIcon className="h-8 w-8 text-violet-500" />
                  </div>
                }
              >
                <div className="flex flex-col items-center gap-6">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-violet-500/20 to-purple-600/20">
                    <SparklesIcon className="h-8 w-8 text-violet-500" />
                  </div>
                  <div className="space-y-2 text-center">
                    <h3 className="text-xl font-semibold">Start a conversation</h3>
                    <p className="text-muted-foreground text-sm max-w-md">
                      Try one of the suggested prompts below or type your own message to see programmatic tool calling in action
                    </p>
                  </div>
                  <Suggestions className="justify-center max-w-3xl flex flex-wrap gap-2">
                    {SUGGESTED_PROMPTS.map((prompt) => (
                      <Suggestion
                        key={prompt}
                        suggestion={prompt}
                        onClick={handleSuggestionClick}
                        variant="outline"
                        className="text-sm"
                      />
                    ))}
                  </Suggestions>
                </div>
              </ConversationEmptyState>
            ) : (
              <ConversationContent className="max-w-4xl mx-auto px-4 py-6">
                {messages.map((message) => {
                  const isStreamingMessage = isLoading && message.id === streamingMessageId;
                  const toolCallsToShow = isStreamingMessage && pendingToolCalls.length > 0 
                    ? pendingToolCalls 
                    : message.toolCalls;
                  
                  return (
                    <Message key={message.id} from={message.role as 'user' | 'assistant'}>
                      <MessageContent>
                        {message.role === 'assistant' ? (
                          <>
                            <MessageResponse>{message.content}</MessageResponse>

                            {/* Render code execution if present */}
                            {renderCodeExecution(message.codeExecution)}

                            {/* Render tool calls - use pending ones if this is the streaming message */}
                            {renderToolCalls(toolCallsToShow)}
                            
                            {/* Show loading indicator and pending code execution inline if streaming */}
                            {isStreamingMessage && (
                              <>
                                {pendingCodeExecution && (
                                  <div className="mt-4">
                                    <Card className="p-3 bg-amber-500/5 border-amber-500/20 overflow-hidden">
                                      <div className="flex items-center gap-2 mb-2">
                                        <BoxIcon className="h-4 w-4 text-amber-500 animate-pulse" />
                                        <span className="text-sm font-medium">Sandbox Execution in Progress</span>
                                      </div>
                                      <CodeBlock code={pendingCodeExecution.code} language="javascript" />
                                    </Card>
                                  </div>
                                )}
                                {!pendingCodeExecution && pendingToolCalls.length === 0 && (
                                  <div className="flex items-center gap-2 text-muted-foreground mt-2">
                                    <Loader size={16} />
                                    <span className="text-sm">Thinking...</span>
                                  </div>
                                )}
                              </>
                            )}
                          </>
                        ) : (
                          <p className="whitespace-pre-wrap">{message.content}</p>
                        )}
                      </MessageContent>

                    {/* Message Actions for assistant messages */}
                    {message.role === 'assistant' && message.content && !isLoading && (
                      <MessageActions className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <MessageAction
                          tooltip={copiedMessageId === message.id ? "Copied!" : "Copy"}
                          onClick={() => handleCopy(message.content, message.id)}
                        >
                          {copiedMessageId === message.id ? (
                            <CheckIcon className="h-4 w-4 text-green-500" />
                          ) : (
                            <CopyIcon className="h-4 w-4" />
                          )}
                        </MessageAction>
                      </MessageActions>
                    )}
                  </Message>
                  );
                })}

                {/* Loading state - only show if no streaming message exists yet */}
                {isLoading && !streamingMessageId && (
                  <Message from="assistant">
                    <MessageContent>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader size={16} />
                        <span className="text-sm">Thinking...</span>
                      </div>
                    </MessageContent>
                  </Message>
                )}
              </ConversationContent>
            )}
            <ConversationScrollButton />
          </Conversation>

          {/* Input Area - Fixed at bottom */}
          <div className="flex-none border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-6 py-4">
            <div className="max-w-4xl mx-auto">
              <PromptInput
                onSubmit={handleSubmit}
                className="shadow-lg"
              >
                <PromptInputTextarea
                  placeholder="What would you like to know?"
                  value={input}
                    onChange={(e) => setInput(e.target.value)}
                  disabled={isLoading}
                />
                <PromptInputFooter>
                  <PromptInputTools>
                    <ModelSelector open={modelSelectorOpen} onOpenChange={setModelSelectorOpen}>
                      <ModelSelectorTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-muted-foreground hover:text-foreground">
                          <ModelSelectorLogo 
                            provider={modelConfig.model.split('/')[0] || 'vercel'} 
                            className="h-4 w-4"
                          />
                          <span className="text-xs truncate max-w-[140px]">
                            {modelConfig.model.split('/').pop() || 'Select model'}
                          </span>
                          <Kbd className="hidden sm:inline-flex text-[10px] h-4">⌘K</Kbd>
                          <ChevronDownIcon className="h-3 w-3 opacity-50" />
                        </Button>
                      </ModelSelectorTrigger>
                      <ModelSelectorContent title="Select a model">
                        <ModelSelectorInput placeholder="Search models..." />
                        <ModelSelectorList>
                          <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
                          
                          {/* Group gateway models by provider */}
                          {(() => {
                            // Group models by provider
                            const groupedModels = gatewayModels.reduce((acc, model) => {
                              const provider = model.provider || 'other';
                              if (!acc[provider]) {
                                acc[provider] = [];
                              }
                              acc[provider].push(model);
                              return acc;
                            }, {} as Record<string, GatewayModel[]>);

                            // Define provider display order (popular ones first)
                            const providerOrder = [
                              'anthropic', 'openai', 'google', 'mistral', 'groq', 
                              'xai', 'deepseek', 'meta', 'perplexity', 'cohere'
                            ];

                            // Sort providers: ordered ones first, then alphabetically
                            const sortedProviders = Object.keys(groupedModels).sort((a, b) => {
                              const aIndex = providerOrder.indexOf(a);
                              const bIndex = providerOrder.indexOf(b);
                              if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
                              if (aIndex !== -1) return -1;
                              if (bIndex !== -1) return 1;
                              return a.localeCompare(b);
                            });

                            // Format provider name for display
                            const formatProviderName = (provider: string) => {
                              const providerNames: Record<string, string> = {
                                'anthropic': 'Anthropic',
                                'openai': 'OpenAI',
                                'google': 'Google',
                                'mistral': 'Mistral AI',
                                'groq': 'Groq',
                                'xai': 'xAI',
                                'deepseek': 'DeepSeek',
                                'meta': 'Meta',
                                'perplexity': 'Perplexity',
                                'cohere': 'Cohere',
                                'amazon-bedrock': 'Amazon Bedrock',
                                'azure': 'Azure OpenAI',
                                'google-vertex': 'Google Vertex AI',
                                'fireworks-ai': 'Fireworks AI',
                                'togetherai': 'Together AI',
                                'cerebras': 'Cerebras',
                                'nvidia': 'NVIDIA',
                              };
                              return providerNames[provider] || provider.charAt(0).toUpperCase() + provider.slice(1);
                            };

                            return sortedProviders.map((provider) => (
                              <ModelSelectorGroup key={provider} heading={formatProviderName(provider)}>
                                {groupedModels[provider].map((model) => (
                                  <ModelSelectorItem 
                                    key={model.id}
                                    value={model.id}
                                    onSelect={() => {
                                      setModelConfig({ provider: 'gateway', model: model.id });
                                      setModelSelectorOpen(false);
                                    }}
                                  >
                                    <ModelSelectorLogo provider={provider} />
                                    <ModelSelectorName>
                                      {model.name || model.id.split('/').pop()}
                                    </ModelSelectorName>
                                  </ModelSelectorItem>
                                ))}
                              </ModelSelectorGroup>
                            ));
                          })()}
                        </ModelSelectorList>
                      </ModelSelectorContent>
                    </ModelSelector>
                  </PromptInputTools>
                  {isLoading ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={handleStop}
                      className="gap-2"
                    >
                      <SquareIcon className="h-4 w-4" />
                      Stop
                    </Button>
                  ) : (
                    <PromptInputSubmit
                      disabled={!input.trim()}
                      status={getStatus()}
                    />
                  )}
                </PromptInputFooter>
              </PromptInput>
            </div>
          </div>
        </div>

        {/* Debug Panel */}
        {showDebug && (
          <DebugPanel
            toolCalls={toolCalls}
            codeExecutions={codeExecutions}
            metrics={metrics}
          />
        )}
      </div>

      {/* Efficiency Metrics Bar */}
      {metrics && <EfficiencyMetricsDisplay metrics={metrics} />}
    </div>
  );
}