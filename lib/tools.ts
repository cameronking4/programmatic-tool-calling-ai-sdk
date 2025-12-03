import { tool } from 'ai';
import { z } from 'zod';

/**
 * Mock Azure ARM tools for demonstration
 * These tools simulate Azure Resource Manager API calls without authentication
 */

// Helper to generate mock subscription IDs
const generateSubscriptionId = () => 
  `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });

// Helper to generate mock resource IDs
const generateResourceId = (subscriptionId: string, resourceGroup: string, resourceType: string, resourceName: string) =>
  `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/${resourceType}/${resourceName}`;

export const tools = {
  listSubscriptions: tool({
    description: 'List all Azure subscriptions available to the current user',
    inputSchema: z.object({
      includeDetails: z.boolean().optional().describe('Include detailed subscription information')
    }),
    execute: async ({ includeDetails = false }) => {
      console.log('[TOOL] Listing Azure subscriptions');
      
      const mockSubscriptions = [
        {
          id: generateSubscriptionId(),
          subscriptionId: generateSubscriptionId(),
          displayName: 'Production Subscription',
          state: 'Enabled',
          subscriptionPolicies: {
            locationPlacementId: 'Internal_2014-09-01',
            quotaId: 'Internal_2014-09-01',
            spendingLimit: 'On'
          },
          ...(includeDetails && {
            tenantId: generateSubscriptionId(),
            tags: { environment: 'production', owner: 'platform-team' },
            managedByTenants: []
          })
        },
        {
          id: generateSubscriptionId(),
          subscriptionId: generateSubscriptionId(),
          displayName: 'Development Subscription',
          state: 'Enabled',
          subscriptionPolicies: {
            locationPlacementId: 'Internal_2014-09-01',
            quotaId: 'Internal_2014-09-01',
            spendingLimit: 'On'
          },
          ...(includeDetails && {
            tenantId: generateSubscriptionId(),
            tags: { environment: 'development', owner: 'dev-team' },
            managedByTenants: []
          })
        },
        {
          id: generateSubscriptionId(),
          subscriptionId: generateSubscriptionId(),
          displayName: 'Testing Subscription',
          state: 'Warned',
          subscriptionPolicies: {
            locationPlacementId: 'Internal_2014-09-01',
            quotaId: 'Internal_2014-09-01',
            spendingLimit: 'Off'
          },
          ...(includeDetails && {
            tenantId: generateSubscriptionId(),
            tags: { environment: 'testing', owner: 'qa-team' },
            managedByTenants: []
          })
        }
      ];

      return {
        subscriptions: mockSubscriptions,
        count: mockSubscriptions.length
      };
    },
  }),

  listResourceGroups: tool({
    description: 'List resource groups in a subscription',
    inputSchema: z.object({
      subscriptionId: z.string().describe('Azure subscription ID'),
      filter: z.string().optional().describe('Filter expression to apply to the query'),
      top: z.number().optional().describe('Maximum number of results to return')
    }),
    execute: async ({ subscriptionId, filter, top }) => {
      console.log(`[TOOL] Listing resource groups for subscription ${subscriptionId}`);
      
      const mockResourceGroups = [
        {
          id: `/subscriptions/${subscriptionId}/resourceGroups/rg-production`,
          name: 'rg-production',
          location: 'eastus',
          properties: {
            provisioningState: 'Succeeded'
          },
          tags: { environment: 'production', 'cost-center': '1001' }
        },
        {
          id: `/subscriptions/${subscriptionId}/resourceGroups/rg-development`,
          name: 'rg-development',
          location: 'westus2',
          properties: {
            provisioningState: 'Succeeded'
          },
          tags: { environment: 'development', 'cost-center': '1002' }
        },
        {
          id: `/subscriptions/${subscriptionId}/resourceGroups/rg-testing`,
          name: 'rg-testing',
          location: 'centralus',
          properties: {
            provisioningState: 'Succeeded'
          },
          tags: { environment: 'testing', 'cost-center': '1003' }
        },
        {
          id: `/subscriptions/${subscriptionId}/resourceGroups/rg-shared-services`,
          name: 'rg-shared-services',
          location: 'eastus',
          properties: {
            provisioningState: 'Succeeded'
          },
          tags: { environment: 'shared', 'cost-center': '1004' }
        }
      ];

      let filtered = mockResourceGroups;
      if (filter) {
        // Simple mock filtering
        filtered = mockResourceGroups.filter(rg => 
          rg.name.includes(filter) || rg.location.includes(filter)
        );
      }

      if (top) {
        filtered = filtered.slice(0, top);
      }

      return {
        resourceGroups: filtered,
        count: filtered.length,
        subscriptionId
      };
    },
  }),

  listResources: tool({
    description: 'List resources in a subscription or resource group',
    inputSchema: z.object({
      subscriptionId: z.string().describe('Azure subscription ID'),
      resourceGroupName: z.string().optional().describe('Resource group name (optional, lists all resources if not provided)'),
      resourceType: z.string().optional().describe('Filter by resource type (e.g., Microsoft.Compute/virtualMachines)'),
      filter: z.string().optional().describe('OData filter expression'),
      expand: z.string().optional().describe('Comma-separated list of additional properties to include'),
      top: z.number().optional().describe('Maximum number of results to return')
    }),
    execute: async ({ subscriptionId, resourceGroupName, resourceType, top }) => {
      console.log(`[TOOL] Listing resources for subscription ${subscriptionId}${resourceGroupName ? ` in resource group ${resourceGroupName}` : ''}`);
      
      const baseResources = [
        {
          id: generateResourceId(subscriptionId, resourceGroupName || 'rg-production', 'Microsoft.Compute/virtualMachines', 'vm-web-server-01'),
          name: 'vm-web-server-01',
          type: 'Microsoft.Compute/virtualMachines',
          location: 'eastus',
          resourceGroup: resourceGroupName || 'rg-production',
          properties: {
            provisioningState: 'Succeeded',
            vmId: generateSubscriptionId(),
            hardwareProfile: { vmSize: 'Standard_D2s_v3' },
            storageProfile: { imageReference: { publisher: 'MicrosoftWindowsServer', offer: 'WindowsServer', sku: '2019-Datacenter' } }
          },
          tags: { environment: 'production', role: 'web-server' }
        },
        {
          id: generateResourceId(subscriptionId, resourceGroupName || 'rg-production', 'Microsoft.Storage/storageAccounts', 'stproddata001'),
          name: 'stproddata001',
          type: 'Microsoft.Storage/storageAccounts',
          location: 'eastus',
          resourceGroup: resourceGroupName || 'rg-production',
          properties: {
            provisioningState: 'Succeeded',
            kind: 'StorageV2',
            accessTier: 'Hot'
          },
          tags: { environment: 'production', purpose: 'data-storage' }
        },
        {
          id: generateResourceId(subscriptionId, resourceGroupName || 'rg-production', 'Microsoft.Network/virtualNetworks', 'vnet-production'),
          name: 'vnet-production',
          type: 'Microsoft.Network/virtualNetworks',
          location: 'eastus',
          resourceGroup: resourceGroupName || 'rg-production',
          properties: {
            provisioningState: 'Succeeded',
            addressSpace: { addressPrefixes: ['10.0.0.0/16'] },
            subnets: [{ name: 'default', addressPrefix: '10.0.0.0/24' }]
          },
          tags: { environment: 'production', network: 'core' }
        },
        {
          id: generateResourceId(subscriptionId, resourceGroupName || 'rg-development', 'Microsoft.Compute/virtualMachines', 'vm-dev-server-01'),
          name: 'vm-dev-server-01',
          type: 'Microsoft.Compute/virtualMachines',
          location: 'westus2',
          resourceGroup: resourceGroupName || 'rg-development',
          properties: {
            provisioningState: 'Succeeded',
            vmId: generateSubscriptionId(),
            hardwareProfile: { vmSize: 'Standard_B2s' },
            storageProfile: { imageReference: { publisher: 'Canonical', offer: 'UbuntuServer', sku: '18.04-LTS' } }
          },
          tags: { environment: 'development', role: 'dev-server' }
        },
        {
          id: generateResourceId(subscriptionId, resourceGroupName || 'rg-shared-services', 'Microsoft.Web/sites', 'app-shared-api'),
          name: 'app-shared-api',
          type: 'Microsoft.Web/sites',
          location: 'eastus',
          resourceGroup: resourceGroupName || 'rg-shared-services',
          properties: {
            provisioningState: 'Succeeded',
            state: 'Running',
            hostNames: ['app-shared-api.azurewebsites.net'],
            defaultHostName: 'app-shared-api.azurewebsites.net'
          },
          tags: { environment: 'shared', service: 'api' }
        }
      ];

      let filtered = baseResources;
      
      if (resourceGroupName) {
        filtered = filtered.filter(r => r.resourceGroup === resourceGroupName);
      }
      
      if (resourceType) {
        filtered = filtered.filter(r => r.type === resourceType);
      }
      
      if (top) {
        filtered = filtered.slice(0, top);
      }

      return {
        resources: filtered,
        count: filtered.length,
        subscriptionId,
        resourceGroupName: resourceGroupName || 'all'
      };
    },
  }),

  listPolicies: tool({
    description: 'List Azure Policy definitions or assignments',
    inputSchema: z.object({
      subscriptionId: z.string().describe('Azure subscription ID'),
      scope: z.enum(['definitions', 'assignments', 'both']).optional().default('both').describe('Whether to list policy definitions, assignments, or both'),
      filter: z.string().optional().describe('Filter expression'),
      top: z.number().optional().describe('Maximum number of results to return')
    }),
    execute: async ({ subscriptionId, scope = 'both', top }) => {
      console.log(`[TOOL] Listing policies for subscription ${subscriptionId}, scope: ${scope}`);
      
      const mockDefinitions = [
        {
          id: `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/policyDefinitions/require-tags`,
          name: 'require-tags',
          displayName: 'Require tags on resources',
          description: 'Ensures that all resources have required tags',
          policyType: 'Custom',
          mode: 'Indexed',
          metadata: {
            category: 'Tags',
            version: '1.0.0'
          },
          policyRule: {
            if: {
              field: 'tags',
              exists: false
            },
            then: {
              effect: 'deny'
            }
          }
        },
        {
          id: `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/policyDefinitions/allowed-locations`,
          name: 'allowed-locations',
          displayName: 'Allowed locations for resource deployment',
          description: 'Restricts resource deployment to specific Azure regions',
          policyType: 'BuiltIn',
          mode: 'Indexed',
          metadata: {
            category: 'Location',
            version: '1.0.0'
          },
          policyRule: {
            if: {
              not: {
                field: 'location',
                in: ['eastus', 'westus2', 'centralus']
              }
            },
            then: {
              effect: 'deny'
            }
          }
        },
        {
          id: `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/policyDefinitions/enforce-https`,
          name: 'enforce-https',
          displayName: 'Enforce HTTPS for storage accounts',
          description: 'Requires HTTPS for all storage account connections',
          policyType: 'BuiltIn',
          mode: 'Indexed',
          metadata: {
            category: 'Security',
            version: '1.0.0'
          },
          policyRule: {
            if: {
              allOf: [
                { field: 'type', equals: 'Microsoft.Storage/storageAccounts' },
                { field: 'Microsoft.Storage/storageAccounts/supportsHttpsTrafficOnly', equals: false }
              ]
            },
            then: {
              effect: 'audit'
            }
          }
        }
      ];

      const mockAssignments = [
        {
          id: `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/policyAssignments/assign-require-tags`,
          name: 'assign-require-tags',
          displayName: 'Assign Require Tags Policy',
          description: 'Assignment of require-tags policy',
          policyDefinitionId: `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/policyDefinitions/require-tags`,
          scope: `/subscriptions/${subscriptionId}`,
          enforcementMode: 'Default',
          parameters: {
            requiredTags: {
              value: ['environment', 'cost-center']
            }
          }
        },
        {
          id: `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/policyAssignments/assign-allowed-locations`,
          name: 'assign-allowed-locations',
          displayName: 'Assign Allowed Locations Policy',
          description: 'Assignment of allowed-locations policy',
          policyDefinitionId: `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/policyDefinitions/allowed-locations`,
          scope: `/subscriptions/${subscriptionId}`,
          enforcementMode: 'Default',
          parameters: {}
        }
      ];

      const result: {
        definitions?: typeof mockDefinitions;
        definitionCount?: number;
        assignments?: typeof mockAssignments;
        assignmentCount?: number;
      } = {};
      
      if (scope === 'definitions' || scope === 'both') {
        result.definitions = top ? mockDefinitions.slice(0, top) : mockDefinitions;
        result.definitionCount = result.definitions.length;
      }
      
      if (scope === 'assignments' || scope === 'both') {
        result.assignments = top ? mockAssignments.slice(0, top) : mockAssignments;
        result.assignmentCount = result.assignments.length;
      }

      return {
        ...result,
        subscriptionId
      };
    },
  }),

  validateARMTemplate: tool({
    description: 'Validate an Azure Resource Manager (ARM) template before deployment',
    inputSchema: z.object({
      subscriptionId: z.string().describe('Azure subscription ID'),
      resourceGroupName: z.string().optional().describe('Resource group name (optional for template-only validation)'),
      template: z.string().describe('ARM template JSON as string'),
      parameters: z.record(z.string(), z.unknown()).optional().describe('Template parameters object'),
      mode: z.enum(['Incremental', 'Complete']).optional().default('Incremental').describe('Deployment mode')
    }),
    execute: async ({ subscriptionId, resourceGroupName, template, parameters, mode = 'Incremental' }) => {
      console.log(`[TOOL] Validating ARM template for subscription ${subscriptionId}`);
      
      try {
        // Mock template parsing
        const parsedTemplate = JSON.parse(template);
        
        // Mock validation checks
        interface ValidationIssue {
          code: string;
          message: string;
          severity: 'error' | 'warning';
          resourceIndex?: number;
          parameter?: string;
        }
        const errors: ValidationIssue[] = [];
        const warnings: ValidationIssue[] = [];
        
        // Check for required template schema
        if (!parsedTemplate.$schema) {
          warnings.push({
            code: 'MissingSchema',
            message: 'Template does not specify a $schema property',
            severity: 'warning'
          });
        }
        
        // Check for resources
        if (!parsedTemplate.resources || !Array.isArray(parsedTemplate.resources)) {
          errors.push({
            code: 'MissingResources',
            message: 'Template must contain a resources array',
            severity: 'error'
          });
        } else {
          // Validate each resource
          interface ResourceTemplate {
            type?: string;
            apiVersion?: string;
            name?: string;
            [key: string]: unknown;
          }
          parsedTemplate.resources.forEach((resource: ResourceTemplate, index: number) => {
            if (!resource.type) {
              errors.push({
                code: 'MissingResourceType',
                message: `Resource at index ${index} is missing a type property`,
                severity: 'error',
                resourceIndex: index
              });
            }
            if (!resource.apiVersion) {
              warnings.push({
                code: 'MissingApiVersion',
                message: `Resource at index ${index} is missing an apiVersion property`,
                severity: 'warning',
                resourceIndex: index
              });
            }
          });
        }
        
        // Check parameters if provided
        if (parameters && parsedTemplate.parameters) {
          const templateParams = Object.keys(parsedTemplate.parameters);
          const providedParams = Object.keys(parameters);
          const missingParams = templateParams.filter(p => 
            !providedParams.includes(p) && 
            parsedTemplate.parameters[p].defaultValue === undefined
          );
          
          missingParams.forEach(param => {
            warnings.push({
              code: 'MissingParameter',
              message: `Parameter '${param}' is required but not provided`,
              severity: 'warning',
              parameter: param
            });
          });
        }

        return {
          valid: errors.length === 0,
          errors,
          warnings,
          properties: {
            template: {
              $schema: parsedTemplate.$schema || 'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
              contentVersion: parsedTemplate.contentVersion || '1.0.0.0',
              resources: parsedTemplate.resources || []
            },
            mode,
            resourceGroup: resourceGroupName || 'validation-only',
            subscriptionId
          },
          summary: {
            totalResources: parsedTemplate.resources?.length || 0,
            errorCount: errors.length,
            warningCount: warnings.length
          }
        };
      } catch (parseError) {
        return {
          valid: false,
          errors: [{
            code: 'InvalidJSON',
            message: `Template is not valid JSON: ${(parseError as Error).message}`,
            severity: 'error'
          }],
          warnings: [],
          properties: null
        };
      }
    },
  }),

  deployARMTemplate: tool({
    description: 'Deploy an Azure Resource Manager (ARM) template',
    inputSchema: z.object({
      subscriptionId: z.string().describe('Azure subscription ID'),
      resourceGroupName: z.string().describe('Resource group name'),
      template: z.string().describe('ARM template JSON as string'),
      parameters: z.record(z.string(), z.unknown()).optional().describe('Template parameters object'),
      deploymentName: z.string().optional().describe('Deployment name (auto-generated if not provided)'),
      mode: z.enum(['Incremental', 'Complete']).optional().default('Incremental').describe('Deployment mode')
    }),
    execute: async ({ subscriptionId, resourceGroupName, template, parameters, deploymentName, mode = 'Incremental' }) => {
      const deployName = deploymentName || `deployment-${Date.now()}`;
      console.log(`[TOOL] Deploying ARM template '${deployName}' to resource group ${resourceGroupName}`);
      
      try {
        const parsedTemplate = JSON.parse(template);
        const resources = parsedTemplate.resources || [];
        
        // Mock deployment
        const deploymentId = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.Resources/deployments/${deployName}`;
        
        return {
          id: deploymentId,
          name: deployName,
          properties: {
            provisioningState: 'Succeeded',
            correlationId: generateSubscriptionId(),
            timestamp: new Date().toISOString(),
            mode,
            template: parsedTemplate,
            parameters: parameters || {},
            outputs: {
              resourceGroupName: {
                type: 'string',
                value: resourceGroupName
              },
              deploymentName: {
                type: 'string',
                value: deployName
              }
            },
            validatedResources: resources.map((r: { type: string; name?: string }) => ({
              id: generateResourceId(subscriptionId, resourceGroupName, r.type, r.name || `resource-${Math.random().toString(36).substr(2, 9)}`),
              type: r.type,
              name: r.name,
              provisioningState: 'Succeeded'
            }))
          },
          subscriptionId,
          resourceGroupName,
          summary: {
            resourcesDeployed: resources.length,
            deploymentMode: mode,
            status: 'Succeeded'
          }
        };
      } catch (error) {
        return {
          id: null,
          name: deployName,
          properties: {
            provisioningState: 'Failed',
            error: {
              code: 'InvalidTemplate',
              message: `Template deployment failed: ${(error as Error).message}`
            }
          },
          subscriptionId,
          resourceGroupName,
          summary: {
            resourcesDeployed: 0,
            deploymentMode: mode,
            status: 'Failed'
          }
        };
      }
    },
  }),

  listDeployments: tool({
    description: 'List Azure Resource Manager deployments for a subscription or resource group',
    inputSchema: z.object({ 
      subscriptionId: z.string().describe('Azure subscription ID'),
      resourceGroupName: z.string().optional().describe('Resource group name (optional, lists all deployments if not provided)'),
      filter: z.string().optional().describe('Filter expression'),
      top: z.number().optional().describe('Maximum number of results to return')
    }),
    execute: async ({ subscriptionId, resourceGroupName, top }) => {
      console.log(`[TOOL] Listing deployments for subscription ${subscriptionId}${resourceGroupName ? ` in resource group ${resourceGroupName}` : ''}`);
      
      const mockDeployments = [
        {
          id: `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName || 'rg-production'}/providers/Microsoft.Resources/deployments/deployment-web-app`,
          name: 'deployment-web-app',
          properties: {
            provisioningState: 'Succeeded',
            correlationId: generateSubscriptionId(),
            timestamp: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
            mode: 'Incremental',
            outputs: {
              webAppUrl: { type: 'string', value: 'https://app.azurewebsites.net' }
            }
          },
          resourceGroup: resourceGroupName || 'rg-production'
        },
        {
          id: `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName || 'rg-production'}/providers/Microsoft.Resources/deployments/deployment-storage`,
          name: 'deployment-storage',
          properties: {
            provisioningState: 'Succeeded',
            correlationId: generateSubscriptionId(),
            timestamp: new Date(Date.now() - 172800000).toISOString(), // 2 days ago
            mode: 'Incremental',
            outputs: {
              storageAccountName: { type: 'string', value: 'stproddata001' }
            }
          },
          resourceGroup: resourceGroupName || 'rg-production'
        },
        {
          id: `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName || 'rg-development'}/providers/Microsoft.Resources/deployments/deployment-dev-env`,
          name: 'deployment-dev-env',
          properties: {
            provisioningState: 'Succeeded',
            correlationId: generateSubscriptionId(),
            timestamp: new Date(Date.now() - 259200000).toISOString(), // 3 days ago
            mode: 'Complete',
            outputs: {}
          },
          resourceGroup: resourceGroupName || 'rg-development'
        },
        {
          id: `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName || 'rg-production'}/providers/Microsoft.Resources/deployments/deployment-failed`,
          name: 'deployment-failed',
          properties: {
            provisioningState: 'Failed',
            correlationId: generateSubscriptionId(),
            timestamp: new Date(Date.now() - 345600000).toISOString(), // 4 days ago
            mode: 'Incremental',
            error: {
              code: 'ResourceNotFound',
              message: 'Resource group not found'
            }
          },
          resourceGroup: resourceGroupName || 'rg-production'
        }
      ];

      let filtered = mockDeployments;
      
      if (resourceGroupName) {
        filtered = filtered.filter(d => d.resourceGroup === resourceGroupName);
      }
      
      if (top) {
        filtered = filtered.slice(0, top);
      }

      return { 
        deployments: filtered,
        count: filtered.length,
        subscriptionId,
        resourceGroupName: resourceGroupName || 'all'
      };
    },
  }),

  executeAzureRESTAPI: tool({
    description: 'Execute a generic Azure REST API call. Use this for any Azure ARM operation not covered by specific tools',
    inputSchema: z.object({ 
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).describe('HTTP method'),
      path: z.string().describe('Azure REST API path (e.g., /subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/providers/...)'),
      subscriptionId: z.string().optional().describe('Subscription ID (will be substituted in path if {subscriptionId} placeholder exists)'),
      body: z.record(z.string(), z.unknown()).optional().describe('Request body for POST/PUT/PATCH operations'),
      queryParameters: z.record(z.string(), z.string()).optional().describe('Query parameters as key-value pairs'),
      apiVersion: z.string().optional().default('2021-04-01').describe('API version to use')
    }),
    execute: async ({ method, path, subscriptionId, body, queryParameters, apiVersion = '2021-04-01' }) => {
      console.log(`[TOOL] Executing Azure REST API: ${method} ${path}`);
      
      // Substitute subscription ID if provided
      let finalPath = path;
      if (subscriptionId) {
        finalPath = finalPath.replace(/{subscriptionId}/g, subscriptionId);
      }
      
      // Build query string
      const queryString = queryParameters 
        ? '?' + new URLSearchParams({ ...queryParameters, 'api-version': apiVersion }).toString()
        : `?api-version=${apiVersion}`;
      
      const fullUrl = `https://management.azure.com${finalPath}${queryString}`;
      
      // Mock response based on method and path
      interface AzureRESTResponse {
        status: number;
        headers: Record<string, string>;
        data?: unknown;
      }
      const mockResponse: AzureRESTResponse = {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'x-ms-request-id': generateSubscriptionId(),
          'x-ms-correlation-request-id': generateSubscriptionId()
        }
      };

      if (method === 'GET') {
        // Mock GET responses based on path patterns
        if (path.includes('/resourceGroups')) {
          mockResponse.data = {
            id: finalPath.split('?')[0],
            name: finalPath.split('/').pop()?.split('?')[0] || 'resource',
            type: 'Microsoft.Resources/resourceGroups',
            location: 'eastus',
            properties: {
              provisioningState: 'Succeeded'
            }
          };
        } else if (path.includes('/providers')) {
          mockResponse.data = {
            id: finalPath.split('?')[0],
            name: finalPath.split('/').pop()?.split('?')[0] || 'resource',
            type: finalPath.match(/providers\/([^/]+)/)?.[1] || 'Microsoft.Resources/resources',
            location: 'eastus',
            properties: {}
          };
        } else {
          mockResponse.data = {
            value: [],
            nextLink: null
          };
        }
      } else if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        mockResponse.status = 201;
        mockResponse.data = {
          id: finalPath.split('?')[0],
          name: body?.name || finalPath.split('/').pop()?.split('?')[0] || 'resource',
          properties: {
            provisioningState: 'Succeeded',
            ...body
          }
        };
      } else if (method === 'DELETE') {
        mockResponse.status = 200;
        mockResponse.data = {
          status: 'Deleted',
          id: finalPath.split('?')[0]
        };
      }

      return {
        request: {
          method,
          url: fullUrl,
          path: finalPath,
          body: body || null,
          queryParameters: queryParameters || {}
        },
        response: mockResponse,
        apiVersion
      };
    },
  }),

  runARGquery: tool({
    description: 'Execute an Azure Resource Graph (ARG) query using KQL (Kusto Query Language). Query resources across subscriptions and resource groups.',
    inputSchema: z.object({ 
      query: z.string().describe('KQL query string to execute against Azure Resource Graph'),
      subscriptions: z.array(z.string()).optional().describe('Array of subscription IDs to query (optional, queries all accessible subscriptions if not provided)'),
      managementGroups: z.array(z.string()).optional().describe('Array of management group IDs to query (optional)'),
      options: z.object({
        skipToken: z.string().optional().describe('Skip token for pagination'),
        top: z.number().optional().describe('Maximum number of records to return'),
        skip: z.number().optional().describe('Number of records to skip'),
        resultFormat: z.enum(['table', 'objectArray']).optional().default('objectArray').describe('Result format')
      }).optional().describe('Query options')
    }),
    execute: async ({ query, subscriptions, managementGroups, options }) => {
      console.log(`[TOOL] Executing Azure Resource Graph query: ${query.substring(0, 100)}...`);
      
      // Mock query parsing and execution
      const mockSubscriptions = subscriptions || [
        generateSubscriptionId(),
        generateSubscriptionId(),
        generateSubscriptionId()
      ];

      // Generate mock results based on common query patterns
      let mockResults: Record<string, unknown>[] = [];
      
      // Parse common query patterns and generate appropriate mock data
      const queryLower = query.toLowerCase();
      
      if (queryLower.includes('resources') || queryLower.includes('where')) {
        // Resource query - generate mock resources
        mockResults = [
          {
            id: generateResourceId(mockSubscriptions[0], 'rg-production', 'Microsoft.Compute/virtualMachines', 'vm-web-01'),
            name: 'vm-web-01',
            type: 'Microsoft.Compute/virtualMachines',
            resourceGroup: 'rg-production',
            subscriptionId: mockSubscriptions[0],
            location: 'eastus',
            tags: { environment: 'production', role: 'web' },
            properties: {
              provisioningState: 'Succeeded',
              vmSize: 'Standard_D2s_v3'
            }
          },
          {
            id: generateResourceId(mockSubscriptions[0], 'rg-production', 'Microsoft.Storage/storageAccounts', 'stprod001'),
            name: 'stprod001',
            type: 'Microsoft.Storage/storageAccounts',
            resourceGroup: 'rg-production',
            subscriptionId: mockSubscriptions[0],
            location: 'eastus',
            tags: { environment: 'production', purpose: 'data' },
            properties: {
              provisioningState: 'Succeeded',
              kind: 'StorageV2'
            }
          },
          {
            id: generateResourceId(mockSubscriptions[1], 'rg-development', 'Microsoft.Compute/virtualMachines', 'vm-dev-01'),
            name: 'vm-dev-01',
            type: 'Microsoft.Compute/virtualMachines',
            resourceGroup: 'rg-development',
            subscriptionId: mockSubscriptions[1],
            location: 'westus2',
            tags: { environment: 'development', role: 'dev' },
            properties: {
              provisioningState: 'Succeeded',
              vmSize: 'Standard_B2s'
            }
          },
          {
            id: generateResourceId(mockSubscriptions[0], 'rg-production', 'Microsoft.Network/virtualNetworks', 'vnet-prod'),
            name: 'vnet-prod',
            type: 'Microsoft.Network/virtualNetworks',
            resourceGroup: 'rg-production',
            subscriptionId: mockSubscriptions[0],
            location: 'eastus',
            tags: { environment: 'production', network: 'core' },
            properties: {
              provisioningState: 'Succeeded',
              addressSpace: { addressPrefixes: ['10.0.0.0/16'] }
            }
          },
          {
            id: generateResourceId(mockSubscriptions[2], 'rg-testing', 'Microsoft.Web/sites', 'app-test'),
            name: 'app-test',
            type: 'Microsoft.Web/sites',
            resourceGroup: 'rg-testing',
            subscriptionId: mockSubscriptions[2],
            location: 'centralus',
            tags: { environment: 'testing', service: 'web' },
            properties: {
              provisioningState: 'Succeeded',
              state: 'Running'
            }
          }
        ];
      } else if (queryLower.includes('resourcegroups') || queryLower.includes('resource group')) {
        // Resource group query
        mockResults = [
          {
            id: `/subscriptions/${mockSubscriptions[0]}/resourceGroups/rg-production`,
            name: 'rg-production',
            type: 'Microsoft.Resources/resourceGroups',
            subscriptionId: mockSubscriptions[0],
            location: 'eastus',
            tags: { environment: 'production', 'cost-center': '1001' },
            properties: {
              provisioningState: 'Succeeded'
            }
          },
          {
            id: `/subscriptions/${mockSubscriptions[1]}/resourceGroups/rg-development`,
            name: 'rg-development',
            type: 'Microsoft.Resources/resourceGroups',
            subscriptionId: mockSubscriptions[1],
            location: 'westus2',
            tags: { environment: 'development', 'cost-center': '1002' },
            properties: {
              provisioningState: 'Succeeded'
            }
          },
          {
            id: `/subscriptions/${mockSubscriptions[2]}/resourceGroups/rg-testing`,
            name: 'rg-testing',
            type: 'Microsoft.Resources/resourceGroups',
            subscriptionId: mockSubscriptions[2],
            location: 'centralus',
            tags: { environment: 'testing', 'cost-center': '1003' },
            properties: {
              provisioningState: 'Succeeded'
            }
          }
        ];
      } else if (queryLower.includes('summarize') || queryLower.includes('count')) {
        // Aggregation query
        mockResults = [
          {
            type: 'Microsoft.Compute/virtualMachines',
            count: 15,
            locations: ['eastus', 'westus2', 'centralus']
          },
          {
            type: 'Microsoft.Storage/storageAccounts',
            count: 8,
            locations: ['eastus', 'westus2']
          },
          {
            type: 'Microsoft.Web/sites',
            count: 12,
            locations: ['eastus', 'centralus']
          }
        ];
      } else {
        // Default: return resources
        mockResults = [
          {
            id: generateResourceId(mockSubscriptions[0], 'rg-production', 'Microsoft.Compute/virtualMachines', 'vm-default'),
            name: 'vm-default',
            type: 'Microsoft.Compute/virtualMachines',
            resourceGroup: 'rg-production',
            subscriptionId: mockSubscriptions[0],
            location: 'eastus'
          }
        ];
      }

      // Apply pagination if specified
      let paginatedResults = mockResults;
      if (options?.skip) {
        paginatedResults = paginatedResults.slice(options.skip);
      }
      if (options?.top) {
        paginatedResults = paginatedResults.slice(0, options.top);
      }

      return {
        data: options?.resultFormat === 'table' 
          ? {
              columns: Object.keys(paginatedResults[0] || {}).map(key => ({
                name: key,
                type: typeof paginatedResults[0]?.[key as keyof typeof paginatedResults[0]]
              })),
              rows: paginatedResults.map(r => Object.values(r))
            }
          : paginatedResults,
        count: paginatedResults.length,
        totalRecords: mockResults.length,
        query: query,
        subscriptions: subscriptions || mockSubscriptions,
        managementGroups: managementGroups || [],
        facets: [],
        resultTruncated: options?.top ? paginatedResults.length >= (options.top || 0) : false,
        skipToken: options?.skipToken || null
      };
    },
  }),
};

