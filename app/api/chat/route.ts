import { streamText, stepCountIs } from 'ai';
import { getModel, ModelConfig } from '@/lib/providers';
import { withProgrammaticCalling } from '@/lib/tool-wrapper';
import { ContextManager, withContextManagement } from '@/lib/context-manager';
import { tools } from '@/lib/tools';
import { MCPServerManager, createMCPManager } from '@/lib/mcp';
import type { ToolCall, CodeExecution, CodeExecutionMetadata } from '@/types/chat';

// Type definitions for AI SDK responses
interface ToolResult {
  toolCallId: string;
  output?: unknown;
  result?: unknown;
}

interface ToolCallEvent {
  type: 'tool-call';
  data: {
    id: string;
    toolName: string;
    args: unknown;
    timestamp: string;
  };
}

interface UsageStats {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
}

interface StreamTextStep {
  toolCalls?: Array<{
    toolCallId: string;
    toolName: string;
    args?: unknown;
    input?: { code?: string; [key: string]: unknown };
  }>;
  toolResults?: ToolResult[];
}

interface StreamTextResult {
  steps?: StreamTextStep[];
  response?: {
    steps?: StreamTextStep[];
  };
  usage?: Promise<UsageStats>;
  textStream: AsyncIterable<string>;
}

export const runtime = 'nodejs';
export const maxDuration = 600;

// Global MCP manager instance (initialized once)
let mcpManager: MCPServerManager | null = null;

// Initialize MCP manager on first use
async function getMCPManager(): Promise<MCPServerManager | null> {
  if (!mcpManager) {
    mcpManager = createMCPManager();
    if (mcpManager) {
      try {
        await mcpManager.initialize();
      } catch (error) {
        console.error('[MCP] Failed to initialize MCP manager:', error);
        mcpManager = null;
      }
    }
  }
  return mcpManager;
}

export async function POST(req: Request) {
  try {
    const { messages, modelConfig, maxSteps = 100, mcpServers } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response('Messages array is required', { status: 400 });
    }

    if (!modelConfig || !modelConfig.provider || !modelConfig.model) {
      return new Response('Model configuration is required', { status: 400 });
    }

    // Merge base tools with MCP tools
    let allTools = { ...tools };
    
    // Load MCP tools if servers are provided or configured
    if (mcpServers && Array.isArray(mcpServers) && mcpServers.length > 0) {
      // Create temporary MCP manager for this request
      const tempMCPManager = new MCPServerManager({ servers: mcpServers });
      try {
        await tempMCPManager.initialize();
        const mcpTools = tempMCPManager.getTools();
        allTools = { ...allTools, ...mcpTools };
      } catch (error) {
        console.error('[MCP] Failed to load MCP tools:', error);
      }
    } else {
      // Use global MCP manager if available
      const globalMCPManager = await getMCPManager();
      if (globalMCPManager) {
        const mcpTools = globalMCPManager.getTools();
        allTools = { ...allTools, ...mcpTools };
      }
    }

    // Wrap tools with programmatic calling
    const { tools: enhancedTools, wrapper } = withProgrammaticCalling(allTools);
    const contextManager = new ContextManager();
    const toolCalls: ToolCall[] = [];
    const codeExecutions: CodeExecution[] = [];

    // Get the model instance
    const model = getModel(modelConfig as ModelConfig);
    console.log(`[Chat API] Using model: ${modelConfig.provider}/${modelConfig.model}`);

    // Build tool list for system prompt
    const toolNames = Object.keys(enhancedTools).filter(name => name !== 'code_execution');
    const baseTools = toolNames.filter(name => !name.startsWith('mcp_'));
    const mcpTools = toolNames.filter(name => name.startsWith('mcp_'));
    
    let toolDescription = `You are Azure Copilot, an AI assistant specialized in helping users manage and interact with Azure resources using Azure Resource Manager (ARM) APIs.`;
    toolDescription += `\n\nYou have access to Azure ARM tools: ${baseTools.join(', ')}, and code_execution.`;
    if (mcpTools.length > 0) {
      toolDescription += `\n\nAdditionally, you have access to ${mcpTools.length} MCP (Model Context Protocol) tools: ${mcpTools.slice(0, 5).join(', ')}${mcpTools.length > 5 ? ` and ${mcpTools.length - 5} more` : ''}.`;
      toolDescription += `\nMCP tools are prefixed with 'mcp_' and provide access to external services and data sources.`;
    }
    
    // Generate detailed tool documentation for code_execution
    const toolDocumentation = wrapper.generateToolDocumentation();

    // Prepare messages with system prompt
    const systemMessage = {
      role: 'system' as const,
      content: `${toolDescription}

## CRITICAL: Defensive Code Execution for Azure Operations
Bias towards using code_execution for most operations.

**ALWAYS use code_execution tool when:**
- Making 2+ Azure ARM API calls (even if sequential or parallel)
- Processing multiple subscriptions, resource groups, or resources
- Validating or deploying ARM templates
- Running Azure Resource Graph queries
- Any operation that involves iteration or aggregation

**Why?** Code execution saves tokens, reduces latency, and enables parallel execution of Azure operations.

## Defensive Programming Patterns for Azure ARM Tools

**1. ALWAYS handle errors and null responses defensively:**
- Azure APIs may return null, undefined, or empty arrays
- Network issues can cause partial failures
- Subscription/resource group may not exist

**2. ALWAYS use defensive helper functions:**
- toArray() - Azure responses may be objects or arrays
- safeGet() - Nested properties may not exist
- safeMap() / safeFilter() - Handle null/undefined gracefully

**3. ALWAYS validate subscription IDs and resource names:**
- Check if subscription exists before operations
- Verify resource group exists before listing resources
- Handle missing or invalid resource IDs

**TOOL PARAMETER REFERENCE:**
${toolDocumentation}

**DEFENSIVE HELPER FUNCTIONS (always available in code_execution):**
- toArray(value) - Converts any value to array safely (handles null, objects, primitives)
- safeGet(obj, 'path.to.prop', defaultValue) - Safe nested property access with defaults
- safeMap(value, fn) - Maps over any value safely (converts to array first)
- safeFilter(value, fn) - Filters any value safely
- first(value) - Gets first item from any value safely
- len(value) - Gets length of any value safely
- isSuccess(response) - Checks if response was successful
- extractData(response) - Extracts data from various response formats
- extractText(response, default) - Extracts text/string output

## Azure ARM Code Execution Examples

### Example 1: List resources across multiple resource groups (DEFENSIVE)
\`\`\`javascript
// Get subscriptions first
const subscriptions = await listSubscriptions({ includeDetails: false });
const subIds = safeMap(subscriptions.subscriptions, s => s.subscriptionId || s.id);

// Get resource groups for each subscription in parallel
const rgPromises = safeMap(subIds, async (subId) => {
  try {
    const rgs = await listResourceGroups({ subscriptionId: subId });
    return safeGet(rgs, 'resourceGroups', []).map(rg => ({
      subscriptionId: subId,
      resourceGroup: safeGet(rg, 'name', 'unknown'),
      location: safeGet(rg, 'location', 'unknown')
    }));
  } catch (error) {
    return []; // Return empty array on error
  }
});

const allResourceGroups = (await Promise.all(rgPromises)).flat();
return {
  totalResourceGroups: len(allResourceGroups),
  resourceGroups: allResourceGroups,
  subscriptions: len(subIds)
};
\`\`\`

### Example 2: List all VMs across subscriptions with error handling
\`\`\`javascript
const subscriptions = await listSubscriptions({});
const subIds = safeMap(safeGet(subscriptions, 'subscriptions', []), s => s.subscriptionId || s.id);

// Get resource groups for each subscription
const allRGs = [];
for (const subId of subIds) {
  try {
    const rgs = await listResourceGroups({ subscriptionId: subId });
    const rgNames = safeMap(safeGet(rgs, 'resourceGroups', []), rg => safeGet(rg, 'name'));
    for (const rgName of rgNames) {
      allRGs.push({ subscriptionId: subId, resourceGroup: rgName });
    }
  } catch (error) {
    // Skip subscription on error
    continue;
  }
}

// List VMs in all resource groups in parallel
const vmPromises = safeMap(allRGs, async ({ subscriptionId, resourceGroup }) => {
  try {
    const resources = await listResources({
      subscriptionId,
      resourceGroupName: resourceGroup,
      resourceType: 'Microsoft.Compute/virtualMachines'
    });
    return safeMap(safeGet(resources, 'resources', []), vm => ({
      name: safeGet(vm, 'name'),
      resourceGroup,
      subscriptionId,
      location: safeGet(vm, 'location'),
      type: safeGet(vm, 'type')
    }));
  } catch (error) {
    return []; // Return empty on error
  }
});

const allVMs = (await Promise.all(vmPromises)).flat();
return {
  totalVMs: len(allVMs),
  vms: allVMs,
  resourceGroupsScanned: len(allRGs)
};
\`\`\`

### Example 3: Validate and deploy ARM template (DEFENSIVE)
\`\`\`javascript
const subscriptionId = 'your-subscription-id';
const resourceGroupName = 'rg-production';
const template = '{"$schema": "...", "resources": [...]}';
const parameters = { param1: 'value1' };

// First validate
const validation = await validateARMTemplate({
  subscriptionId,
  resourceGroupName,
  template,
  parameters
});

// Check validation result defensively
const isValid = safeGet(validation, 'valid', false);
const errors = safeGet(validation, 'errors', []);
const warnings = safeGet(validation, 'warnings', []);

if (!isValid || len(errors) > 0) {
  return {
    canDeploy: false,
    errors: safeMap(errors, e => ({
      code: safeGet(e, 'code', 'Unknown'),
      message: safeGet(e, 'message', 'Validation error')
    })),
    warnings: len(warnings)
  };
}

// Deploy if valid
const deployment = await deployARMTemplate({
  subscriptionId,
  resourceGroupName,
  template,
  parameters,
  mode: 'Incremental'
});

return {
  canDeploy: true,
  deploymentId: safeGet(deployment, 'id'),
  provisioningState: safeGet(deployment, 'properties.provisioningState', 'Unknown'),
  resourcesDeployed: safeGet(deployment, 'summary.resourcesDeployed', 0)
};
\`\`\`

### Example 4: Azure Resource Graph query with defensive handling
\`\`\`javascript
const subscriptions = await listSubscriptions({});
const subIds = safeMap(safeGet(subscriptions, 'subscriptions', []), s => s.subscriptionId || s.id);

// Query all subscriptions
const query = 'Resources | where type == "microsoft.compute/virtualmachines" | project name, location, resourceGroup';
const argResult = await runARGquery({
  query,
  subscriptions: subIds,
  options: { top: 100, resultFormat: 'objectArray' }
});

// Defensively extract results
const resources = safeGet(argResult, 'data', []);
const totalRecords = safeGet(argResult, 'totalRecords', 0);

return {
  query,
  resourcesFound: len(resources),
  totalAvailable: totalRecords,
  resources: safeMap(resources, r => ({
    name: safeGet(r, 'name', 'Unknown'),
    location: safeGet(r, 'location', 'Unknown'),
    resourceGroup: safeGet(r, 'resourceGroup', 'Unknown')
  }))
};
\`\`\`

### Example 5: List policies and check assignments (DEFENSIVE)
\`\`\`javascript
const subscriptionId = 'your-subscription-id';

// Get both definitions and assignments
const policies = await listPolicies({
  subscriptionId,
  scope: 'both'
});

const definitions = safeGet(policies, 'definitions', []);
const assignments = safeGet(policies, 'assignments', []);

// Map assignments to their definitions
const policyMap = safeMap(definitions, def => ({
  id: safeGet(def, 'id'),
  name: safeGet(def, 'name'),
  displayName: safeGet(def, 'displayName'),
  policyType: safeGet(def, 'policyType'),
  assigned: safeMap(assignments, a => safeGet(a, 'policyDefinitionId')).includes(safeGet(def, 'id'))
}));

return {
  totalDefinitions: len(definitions),
  totalAssignments: len(assignments),
  policies: policyMap
};
\`\`\`

## Critical Rules for Azure ARM Tools

1. **ALWAYS use code_execution for 2+ operations** - Even simple operations benefit from parallel execution
2. **ALWAYS handle errors** - Wrap tool calls in try-catch or check response validity
3. **ALWAYS use safeGet()** - Azure responses have nested structures that may be missing
4. **ALWAYS use toArray() or safeMap()** - Responses may be objects, arrays, or null
5. **ALWAYS validate subscription/resource group existence** - Don't assume resources exist
6. **ALWAYS check provisioningState** - Resources may be in various states (Succeeded, Failed, InProgress)
7. **NEVER assume response structure** - Different Azure APIs return different formats
8. **ALWAYS use Promise.all() for parallel operations** - Significantly faster than sequential calls

## Best Practices

- **Batch operations**: Use code_execution to batch multiple Azure operations
- **Error resilience**: Always handle partial failures gracefully
- **Resource validation**: Check if resources exist before operations
- **Efficient queries**: Use Azure Resource Graph for cross-subscription queries
- **Template validation**: Always validate ARM templates before deployment
- **Defensive defaults**: Provide sensible defaults for all safeGet() calls

Remember: You are Azure Copilot - be helpful, accurate, and always use defensive programming patterns when working with Azure resources.`,
    };

    // Stream the response
    const result = streamText({
      model,
      messages: [systemMessage, ...messages],
      tools: enhancedTools,
      stopWhen: stepCountIs(maxSteps),
      ...withContextManagement({
        contextManager,
        onStepFinish: (step: StreamTextStep) => {
          // Track tool calls
          if (step.toolCalls) {
            for (const toolCall of step.toolCalls) {
              // Find corresponding result
              const toolResult = step.toolResults?.find(
                (r: ToolResult) => r.toolCallId === toolCall.toolCallId
              );
              const resultOutput = toolResult?.output || toolResult?.result;
              
              const toolCallData = {
                id: toolCall.toolCallId,
                toolName: toolCall.toolName,
                args: toolCall.args || toolCall.input,
                result: resultOutput,
                timestamp: new Date(),
              };
              
              toolCalls.push(toolCallData);

              // Queue tool call event for streaming (before result is available)
              // This allows UI to show tool calls as they're invoked
              toolCallEvents.push({
                type: 'tool-call',
                data: {
                  id: toolCall.toolCallId,
                  toolName: toolCall.toolName,
                  args: toolCall.args || toolCall.input,
                  timestamp: new Date().toISOString(),
                },
              });

              // Track code executions
              if (toolCall.toolName === 'code_execution') {
                // AI SDK 5.0 uses 'input' instead of 'args'
                const code = toolCall.input?.code || (toolCall.args as { code?: string })?.code || '';
                const toolResult = step.toolResults?.find(
                  (r: ToolResult) => r.toolCallId === toolCall.toolCallId
                );
                
                if (toolResult) {
                  // The AI SDK uses 'output' instead of 'result' for tool results
                  // The tool returns { result: serializableOutput, metadata: {...} }
                  const executionResult = toolResult.output || toolResult.result;
                  
                  // Extract metadata - it should be at executionResult.metadata
                  let metadata: CodeExecutionMetadata | undefined = (executionResult as { metadata?: CodeExecutionMetadata })?.metadata;
                  let resultData: unknown = (executionResult as { result?: unknown })?.result;
                  
                  // If executionResult itself has the metadata properties, use it directly
                  if (!metadata && executionResult && typeof executionResult === 'object') {
                    const execResult = executionResult as Record<string, unknown>;
                    if ('toolCallCount' in execResult || 'executionTimeMs' in execResult) {
                      metadata = execResult as unknown as CodeExecutionMetadata;
                      resultData = execResult.result;
                    }
                  }
                  
                  codeExecutions.push({
                    code,
                    toolCalls: [],
                    result: resultData,
                    metadata: metadata || {
                      toolCallCount: 0,
                      intermediateTokensSaved: 0,
                      toolsUsed: [],
                      executionTimeMs: 0,
                    },
                  });
                }
              }
            }
          }
        },
      }),
    });

    // Create a readable stream that includes metadata and tool call events
    const encoder = new TextEncoder();
    const toolCallEvents: ToolCallEvent[] = [];
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    
    const stream = new ReadableStream({
      async start(controller) {
        streamController = controller;
        try {
          // Function to stream pending tool calls
          const streamPendingToolCalls = () => {
            while (toolCallEvents.length > 0 && streamController) {
              const event = toolCallEvents.shift();
              try {
                streamController.enqueue(encoder.encode(`\n__TOOL_CALL__:${JSON.stringify(event)}\n`));
              } catch {
                // Stream may be closed, ignore
              }
            }
          };
          
          // Stream tool calls periodically as they come in
          const toolCallInterval = setInterval(streamPendingToolCalls, 50);
          
          for await (const chunk of result.textStream) {
            controller.enqueue(encoder.encode(chunk));
            // Also check for tool calls after each chunk
            streamPendingToolCalls();
          }
          
          // Clear interval and flush remaining tool calls
          clearInterval(toolCallInterval);
          streamPendingToolCalls();

          // Wait for final result to get usage stats
          const finalResult = await result;
          const usage = await finalResult.usage;

          // Extract usage stats (AI SDK 5.0 uses inputTokens/outputTokens instead of promptTokens/completionTokens)
          const usageObj: UsageStats = (usage as UsageStats) || {};
          const totalTokens = usageObj.totalTokens || 0;
          const inputTokens = usageObj.inputTokens || 0;
          const outputTokens = usageObj.outputTokens || 0;

          // Re-extract code execution metadata from final result to ensure we have complete data
          const finalCodeExecutions = [...codeExecutions];
          
          // Try to get steps from finalResult - it might be in different locations
          const finalResultTyped = finalResult as unknown as StreamTextResult;
          const steps = finalResultTyped.steps || finalResultTyped.response?.steps || [];
          
          if (Array.isArray(steps) && steps.length > 0) {
            for (const step of steps) {
              if (step.toolCalls) {
                for (const toolCall of step.toolCalls) {
                    if (toolCall.toolName === 'code_execution') {
                      // AI SDK 5.0 uses 'input' instead of 'args'
                      const code = toolCall.input?.code || (toolCall.args as { code?: string })?.code || '';
                      const toolResult = step.toolResults?.find(
                        (r: ToolResult) => r.toolCallId === toolCall.toolCallId
                      );
                      // Use 'output' instead of 'result' for AI SDK tool results
                      const executionResult = toolResult?.output || toolResult?.result;
                      if (executionResult) {
                        const existingExec = finalCodeExecutions.find(
                          (ce) => ce.code === code
                        );
                        if (existingExec) {
                          // Update with complete metadata from final result
                          const execResult = executionResult as Record<string, unknown>;
                          const metadata: CodeExecutionMetadata | null = 
                            (execResult.metadata as CodeExecutionMetadata | undefined) || 
                            (executionResult && typeof executionResult === 'object' && 
                             ('toolCallCount' in execResult || 'executionTimeMs' in execResult) 
                             ? (execResult as unknown as CodeExecutionMetadata) : null);
                          if (metadata) {
                            existingExec.metadata = metadata;
                            existingExec.result = (execResult.result as unknown) || executionResult;
                          }
                        }
                      }
                    }
                }
              }
            }
          }

          // Send final metadata
          const finishEvent = {
            type: 'metadata',
            data: {
              tokensSaved: contextManager.getTokensSaved(),
              totalTokens,
              promptTokens: inputTokens, // Map to UI-friendly name
              completionTokens: outputTokens, // Map to UI-friendly name
              toolCallCount: toolCalls.length,
              toolCalls,
              codeExecutions: finalCodeExecutions,
            },
          };
          controller.enqueue(encoder.encode(`\n\n__METADATA__:${JSON.stringify(finishEvent)}\n`));

          controller.close();
          streamController = null;
        } catch (error) {
          streamController = null;
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  } catch (error: unknown) {
    console.error('Chat API error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

