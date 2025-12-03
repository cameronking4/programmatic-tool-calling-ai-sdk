import { tool } from 'ai';
import { z } from 'zod';
import { ToolOrchestrationSandbox } from './sandbox';
import { MCPToolBridge, createMCPBridge } from './mcp-bridge';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolDefinition = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolExecuteFunction = (...args: any[]) => any;

/**
 * Tool wrapper that enables programmatic tool calling using Vercel Sandbox
 * Supports both local tools and MCP tools via the MCP bridge
 */
export class ProgrammaticToolCaller {
  private sandbox: ToolOrchestrationSandbox;
  private tools: Record<string, ToolDefinition>;
  private toolRegistry: Map<string, ToolExecuteFunction>;
  private mcpBridge: MCPToolBridge | null;
  private mcpToolNames: string[];
  private localToolNames: string[];

  constructor(
    tools: Record<string, ToolDefinition>,
    timeout: number = 30000
  ) {
    this.tools = tools;
    this.toolRegistry = new Map();
    this.mcpToolNames = [];
    this.localToolNames = [];
    
    // Create MCP bridge for MCP tools
    this.mcpBridge = createMCPBridge(tools);
    if (this.mcpBridge) {
      this.mcpToolNames = this.mcpBridge.getToolNames();
      console.log(`[ToolWrapper] MCP bridge created with ${this.mcpToolNames.length} tools`);
    }
    
    // Extract execute functions for sandbox
    // Local tools go directly into registry, MCP tools handled via bridge
    for (const [name, toolDef] of Object.entries(tools)) {
      if (toolDef.execute) {
        if (!name.startsWith('mcp_')) {
          // Local tools: add execute function to registry
          this.toolRegistry.set(name, toolDef.execute);
          this.localToolNames.push(name);
        }
        // MCP tools: handled via mcpBridge (not added to local registry)
      }
    }
    
    // Create sandbox with both local registry and MCP bridge
    this.sandbox = new ToolOrchestrationSandbox(
      this.toolRegistry, 
      timeout,
      this.mcpBridge
    );
    
    console.log(`[ToolWrapper] Initialized with ${this.localToolNames.length} local tools and ${this.mcpToolNames.length} MCP tools`);
  }

  /**
   * Get all available tool names (local + MCP)
   */
  getAllToolNames(): string[] {
    return [...this.localToolNames, ...this.mcpToolNames];
  }

  /**
   * Create a code execution tool for programmatic tool calling
   */
  createCodeExecutionTool() {
    return tool({
      description: `Execute JavaScript code to orchestrate multiple tool calls efficiently. USE THIS TOOL when you need to process multiple items or make 3+ tool calls.

REQUIRED for tasks like:
- Getting multiple users (use Promise.all with getUser calls)
- Processing arrays of data
- Making multiple dependent tool calls
- Filtering/aggregating results
- Calling multiple MCP tools in parallel

Available tools in code:
- Local tools: ${this.localToolNames.join(', ') || 'none'}
- MCP tools: ${this.mcpToolNames.join(', ') || 'none'}

**DEFENSIVE HELPER FUNCTIONS (always available):**
- toArray(value) - Converts any value to array safely (handles null, objects, primitives)
- safeGet(obj, 'path.to.prop', defaultValue) - Safe nested property access
- safeMap(value, fn) - Maps over any value (converts to array first)
- safeFilter(value, fn) - Filters any value safely
- first(value) - Gets first item from any value
- len(value) - Gets length of any value safely
- isSuccess(response) - Checks if MCP response was successful
- extractData(response) - Extracts data from various MCP response formats
- extractText(response, default) - Extracts text/string output (for commands, scrapers)
- getCommandOutput(response) - Returns { success, output, error } for command responses

Example for getting multiple users:
const users = await Promise.all([
  getUser({ id: 'user1' }),
  getUser({ id: 'user2' }),
  getUser({ id: 'user3' })
]);
const avg = calculateAverage({ numbers: users.map(u => u.score) });
return filterByScore({ users, minScore: avg.average });

Example for MCP scraping with defensive patterns:
const results = await Promise.all([
  mcp_firecrawl_scrape({ url: 'https://example.com' }),
  mcp_firecrawl_scrape({ url: 'https://example.org' })
]);
// Use defensive patterns for MCP responses:
return safeMap(results, r => ({
  success: isSuccess(r),
  content: safeGet(r, 'markdown', '').substring(0, 200),
  title: safeGet(r, 'metadata.title', 'Unknown')
}));

Example for MCP command execution:
const commands = ['pwd', 'whoami', 'date'];
const results = await Promise.all(
  commands.map(cmd => mcp_run_command({ command: cmd }))
);
// Use extractText to get command output:
return results.map((r, i) => ({
  command: commands[i],
  output: extractText(r, 'No output'),
  success: isSuccess(r)
}));

**CRITICAL RULES FOR MCP TOOLS:**
1. Pass parameters as a SINGLE OBJECT: mcp_tool({ param1: value1, param2: value2 })
2. ALWAYS use defensive helpers - MCP responses vary by server
3. Check isSuccess(response) before using data
4. Use safeGet() for nested properties - they may not exist
5. Use toArray() when iterating - response might not be an array`,
      
      inputSchema: z.object({
        code: z.string().describe('JavaScript code to execute. Can use async/await. Tools are available as functions. Return final result.'),
      }),
      
      execute: async ({ code }) => {
        const startTime = Date.now();
        try {
          console.log('[CODE_EXECUTION] Starting execution...');
          const { output, toolCalls } = await Promise.race([
            this.sandbox.execute(code),
            new Promise<never>((_, reject) => 
              setTimeout(() => reject(new Error('Code execution timeout after 25 seconds')), 25000)
            ),
          ]);
          
          const executionTime = Date.now() - startTime;
          
          // Count local vs MCP tool calls
          const mcpCalls = toolCalls.filter(tc => tc.isMCP);
          const localCalls = toolCalls.filter(tc => !tc.isMCP);
          
          console.log(`[CODE_EXECUTION] Completed in ${executionTime}ms, ${toolCalls.length} tool calls (${localCalls.length} local, ${mcpCalls.length} MCP)`);
          
          // Calculate efficiency metrics - comprehensive savings
          const tokenSavings = this.sandbox.getComprehensiveTokenSavings();
          
          // Ensure output is serializable and meaningful
          let serializableOutput;
          try {
            // Handle undefined/null - try to extract from tool calls if no explicit return
            if (output === undefined || output === null) {
              console.warn('[CODE_EXECUTION] Output was undefined/null, extracting from tool calls');
              
              // Try to build a meaningful result from tool call results
              if (toolCalls.length > 0) {
                const lastCall = toolCalls[toolCalls.length - 1];
                const allResults = toolCalls.map(tc => ({
                  tool: tc.toolName,
                  success: !tc.error,
                  result: tc.result,
                }));
                
                // If only one tool call, use its result directly
                // If multiple, return summary
                serializableOutput = toolCalls.length === 1 
                  ? (lastCall.result || { success: !lastCall.error, message: 'Tool executed' })
                  : { 
                      message: `Executed ${toolCalls.length} tool calls`,
                      results: allResults,
                      lastResult: lastCall.result,
                    };
              } else {
                serializableOutput = { message: 'Code executed but returned no result', success: true };
              }
            } else {
              serializableOutput = JSON.parse(JSON.stringify(output));
            }
          } catch (serializeError) {
            console.warn('[CODE_EXECUTION] Output serialization failed:', serializeError);
            
            // Try alternative serialization strategies
            if (typeof output === 'object' && output !== null) {
              try {
                // Try to extract just the safe properties
                const safeOutput: Record<string, unknown> = {};
                for (const [key, value] of Object.entries(output)) {
                  try {
                    safeOutput[key] = JSON.parse(JSON.stringify(value));
                  } catch {
                    safeOutput[key] = String(value);
                  }
                }
                serializableOutput = safeOutput;
              } catch {
                serializableOutput = { 
                  message: 'Output contained non-serializable data',
                  type: typeof output,
                  keys: Object.keys(output as object),
                };
              }
            } else {
              serializableOutput = { value: String(output), type: typeof output };
            }
          }
          
          return {
            result: serializableOutput,
            metadata: {
              toolCallCount: toolCalls.length,
              localToolCallCount: localCalls.length,
              mcpToolCallCount: mcpCalls.length,
              intermediateTokensSaved: tokenSavings.intermediateResultTokens,
              totalTokensSaved: tokenSavings.totalSaved,
              tokenSavingsBreakdown: {
                intermediateResults: tokenSavings.intermediateResultTokens,
                roundTripContext: tokenSavings.roundTripContextTokens,
                toolCallOverhead: tokenSavings.toolCallOverheadTokens,
                llmDecisions: tokenSavings.llmDecisionTokens,
              },
              savingsExplanation: tokenSavings.breakdown,
              toolsUsed: [...new Set(toolCalls.map(c => c.toolName))],
              mcpToolsUsed: [...new Set(mcpCalls.map(c => c.toolName))],
              localToolsUsed: [...new Set(localCalls.map(c => c.toolName))],
              executionTimeMs: executionTime,
              sandboxToolCalls: toolCalls.map(c => ({
                toolName: c.toolName,
                args: c.args,
                result: c.result,
                error: c.error?.message,
                isMCP: c.isMCP,
                executionTimeMs: c.executionTimeMs,
              })),
            },
          };
        } catch (error) {
          const executionTime = Date.now() - startTime;
          console.error(`[CODE_EXECUTION] Failed after ${executionTime}ms:`, error);
          throw new Error(`Code execution failed: ${(error as Error).message}`);
        } finally {
          this.sandbox.reset();
        }
      },
    });
  }

  /**
   * Generate tool descriptions for LLM to understand available tools
   * Handles both Zod schemas (local tools) and JSON Schema (MCP tools)
   */
  generateToolDocumentation(): string {
    const docs: string[] = [];
    
    for (const [name, toolDef] of Object.entries(this.tools)) {
      const description = (toolDef as { description?: string }).description;
      docs.push(`${name}: ${description || 'No description'}`);
      
      // Try to extract parameter info from different schema formats
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolDefAny = toolDef as Record<string, any>;
      
      // Debug: Log MCP tool structure (first MCP tool only)
      if (name.startsWith('mcp_') && !docs.some(d => d.includes('[DEBUG]'))) {
        console.log(`[ToolWrapper] MCP tool ${name} keys:`, Object.keys(toolDefAny));
        if (toolDefAny.parameters) {
          console.log(`[ToolWrapper] ${name} parameters:`, JSON.stringify(toolDefAny.parameters, null, 2).slice(0, 500));
        }
      }
      
      // Method 1: Check for parameters (MCP tools use JSON Schema)
      if (toolDefAny.parameters) {
        try {
          const params = toolDefAny.parameters as { properties?: Record<string, unknown>; required?: string[] };
          if (params.properties) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const paramDocs = Object.entries(params.properties).map(([key, prop]: [string, any]) => {
              const type = prop.type || 'any';
              const desc = prop.description || '';
              const required = params.required?.includes(key) ? ' (required)' : '';
              
              // Handle nested object schemas
              if (type === 'array' && prop.items) {
                if (prop.items.type === 'object' && prop.items.properties) {
                  const itemProps = Object.entries(prop.items.properties)
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    .map(([k, v]: [string, any]) => `${k}: ${v.type || 'any'}`)
                    .join(', ');
                  return `  - ${key}: array of { ${itemProps} }${required} - ${desc}`;
                }
                return `  - ${key}: array of ${prop.items.type || 'any'}${required} - ${desc}`;
              }
              if (type === 'object' && prop.properties) {
                const objProps = Object.entries(prop.properties)
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  .map(([k, v]: [string, any]) => `${k}: ${v.type || 'any'}`)
                  .join(', ');
                return `  - ${key}: { ${objProps} }${required} - ${desc}`;
              }
              return `  - ${key}: ${type}${required} - ${desc}`;
            });
            docs.push(paramDocs.join('\n'));
          }
        } catch (error) {
          console.warn(`[ToolWrapper] Failed to extract JSON schema for ${name}:`, error);
        }
      }
      // Method 2: Check for inputSchema (Zod-based local tools)
      else if (toolDefAny.inputSchema) {
        try {
          const def = toolDefAny.inputSchema._def as { shape?: () => Record<string, z.ZodType & { _def?: { description?: string } }> } | undefined;
          if (def && typeof def.shape === 'function') {
            const shape = def.shape();
            const params = Object.entries(shape).map(([key, val]) => {
              const desc = val?._def?.description || '';
              return `  - ${key}: ${desc}`;
            });
            docs.push(params.join('\n'));
          }
        } catch (error) {
          console.warn(`[ToolWrapper] Failed to extract Zod schema for ${name}:`, error);
        }
      }
    }
    
    return docs.join('\n\n');
  }

  /**
   * Create enhanced tool set with code execution
   */
  createEnhancedToolSet() {
    return {
      ...this.tools,
      code_execution: this.createCodeExecutionTool(),
    };
  }

  /**
   * Get efficiency stats from last execution
   */
  getEfficiencyMetrics() {
    return {
      intermediateTokensSaved: this.sandbox.getIntermedateTokenEstimate(),
    };
  }

  /**
   * Check if MCP tools are available
   */
  hasMCPTools(): boolean {
    return this.mcpToolNames.length > 0;
  }

  /**
   * Get MCP bridge instance
   */
  getMCPBridge(): MCPToolBridge | null {
    return this.mcpBridge;
  }
}

/**
 * Helper to wrap tools for programmatic calling using Vercel Sandbox
 * @param tools - Tools to wrap (both local and MCP tools supported)
 * @param timeout - Execution timeout in milliseconds (default: 30000)
 */
export function withProgrammaticCalling(
  tools: Record<string, ToolDefinition>,
  timeout: number = 300000
) {
  const wrapper = new ProgrammaticToolCaller(tools, timeout);
  return {
    tools: wrapper.createEnhancedToolSet(),
    wrapper,
  };
}
